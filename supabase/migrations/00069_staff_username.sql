-- Adds an optional `username` column on profiles so staff can sign in
-- with either a username or an email. Username is stored lowercase for
-- predictable lookup and made unique when present (NULL allowed
-- multiple times so existing staff without a username are unaffected).
--
-- Login flow (resolve-identifier API):
--   1. If input contains '@', treat as email → pass straight to Supabase auth
--   2. Else, look up profiles.username (lowercased) → use the matching
--      auth.users.email for the signInWithPassword call
--
-- When a teammate is created with ONLY a username (no real email), we
-- synthesize a placeholder email like `username@staff.local` for the
-- auth.users row. The user never sees that synthesized email and only
-- logs in via their username.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT;

-- Case-insensitive uniqueness: store lowercase, partial-unique index so
-- NULL is allowed for any number of rows without conflict.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

COMMENT ON COLUMN public.profiles.username IS
  'Optional alphanumeric handle for username-based login. Stored lowercase. NULL = email-only login.';
