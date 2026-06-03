-- Per-user "last active" heartbeat for the super-admin team overview pages.
-- Bumped from middleware on every authenticated page nav; the WHERE clause
-- in bump_my_last_seen() debounces writes to once per minute per user so
-- the hot path stays cheap.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS profiles_last_seen_at_idx
  ON profiles (last_seen_at DESC NULLS LAST);

-- Returns void; called via RPC from middleware. SECURITY DEFINER because the
-- caller is an authenticated user but profiles UPDATE policy may not allow
-- self-update of this column. The WHERE clause restricts the row to auth.uid()
-- so a user can only bump their own timestamp.
CREATE OR REPLACE FUNCTION bump_my_last_seen()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE profiles
  SET last_seen_at = now()
  WHERE id = auth.uid()
    AND (last_seen_at IS NULL OR last_seen_at < now() - INTERVAL '1 minute');
$$;

GRANT EXECUTE ON FUNCTION bump_my_last_seen() TO authenticated;
