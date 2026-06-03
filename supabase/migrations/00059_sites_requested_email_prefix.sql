-- Add the client-requested prefix for their business email (the local
-- part of `prefix@<their-domain>`).
--
-- Surfaces on /client/domain right next to the domain register/transfer
-- picker — Peter 2026-05-11 wants the activation setup to live in one
-- place so the client picks "info" / "kontakt" / "peter" at the same
-- time they pick a domain. Tech admin reads this when provisioning the
-- Hostinger mailbox and writes the resulting full address back to
-- `profiles.business_email` (and the password to
-- `profiles.business_email_password`).
--
-- Plain TEXT, no constraint: clients can type whatever, tech admin
-- normalises during provisioning. Validation is UI-side (lowercase
-- ASCII, no @, max 32 chars) so we don't have to write a CHECK that
-- bakes in policy.
--
-- Additive only — safe to apply on a populated table.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS requested_email_prefix TEXT;

COMMENT ON COLUMN public.sites.requested_email_prefix IS
  'Local part the client wants for their business email (e.g. "info" or "peter"). Tech reads this during email provisioning; the resulting full address is written to profiles.business_email.';
