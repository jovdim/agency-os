-- Store plaintext temp password on sites table so tech/super admin can retrieve
-- it later when helping the client (e.g. non-techie client asks admin to log in
-- as them and make a change).
-- Already stored on proposals.client_temp_password for proposal-driven clients;
-- this column covers manually-created clients (/tech/clients) that have no proposal.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS client_temp_password TEXT;
