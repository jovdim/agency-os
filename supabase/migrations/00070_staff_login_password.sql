-- Stores the plaintext login password alongside Supabase's bcrypt hash
-- in auth.users. Mirrors the existing `business_email_password` field:
-- the super admin already keeps SMTP passwords in plaintext for the
-- same reason — operational visibility ("what did I set this to?")
-- outweighs the "if the DB leaks, passwords leak" tradeoff for a
-- single-operator staff roster.
--
-- Populated by:
--   - POST /api/admin/users  (on create, with the password the operator typed)
--   - PUT  /api/admin/users/[id]  (whenever new_password is set)
--
-- Stays NULL for accounts that existed before this migration — the
-- Edit dialog shows them as "Password not stored — type a new one to
-- make it visible." Setting any new password from the dialog populates
-- the column going forward.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS login_password TEXT;

COMMENT ON COLUMN public.profiles.login_password IS
  'Plaintext mirror of the auth.users password. Visible to super_admin in the Staff Edit dialog. NULL on legacy rows that pre-date this column.';
