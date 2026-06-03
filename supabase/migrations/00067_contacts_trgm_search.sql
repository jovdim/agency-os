-- Trigram indexes for fast substring search on contacts.
--
-- /super/contacts searches by company_name, contact_person, and town with
-- case-insensitive substring matching. Without pg_trgm, ILIKE '%foo%'
-- forces a sequential scan over the whole table — fine at hundreds, fatal
-- at the 500k row target.
--
-- GIN + gin_trgm_ops supports both LIKE and ILIKE. Partial indexes skip
-- NULL rows where applicable (company_name is NOT NULL per the schema).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_contacts_company_name_trgm
  ON public.contacts USING GIN (company_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_contacts_contact_person_trgm
  ON public.contacts USING GIN (contact_person gin_trgm_ops)
  WHERE contact_person IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_town_trgm
  ON public.contacts USING GIN (town gin_trgm_ops)
  WHERE town IS NOT NULL;
