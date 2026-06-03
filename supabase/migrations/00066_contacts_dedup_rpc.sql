-- CSV upload performance: replace chunked dedup loop with a single RPC.
--
-- /api/super/contacts/upload previously chunked the phones array into
-- batches of 100 and ran one SELECT per chunk to find pre-existing rows
-- (PostgREST URL length cap on .in()). For a 50k-row CSV that was 500
-- round-trips before the actual insert. The RPC takes the array in the
-- request body, so it's a single round-trip regardless of size.
--
-- Also adds a btree index on contacts.phone because dedup runs
-- `phone = ANY($arr)` against it. The existing idx_contacts_phones is
-- GIN on phones[] (the array column), not equivalent for this lookup.

CREATE INDEX IF NOT EXISTS idx_contacts_phone
  ON public.contacts(phone)
  WHERE phone IS NOT NULL;

CREATE OR REPLACE FUNCTION public.contacts_existing_phones(p_phones TEXT[])
RETURNS TABLE(phone TEXT)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT c.phone
  FROM public.contacts c
  WHERE c.phone = ANY(p_phones);
$$;

GRANT EXECUTE ON FUNCTION public.contacts_existing_phones(TEXT[]) TO service_role;
