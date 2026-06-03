-- Track when the business-email setup notification was emailed to the client.
-- Drives the "Business email" step on the new tech proposal timeline:
--   - state="active"  → clientZoneDone && business_email_sent_at IS NULL
--   - state="done"    → business_email_sent_at IS NOT NULL
--
-- The actual credentials (Hostinger mailbox + password) live on the linked
-- client profile (profiles.business_email + profiles.business_email_password,
-- already added in 00031_business_email_credentials.sql for salespeople and
-- reused here for clients). This column is just the timestamp marker.
--
-- Additive only — safe to apply on a populated table.

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS business_email_sent_at TIMESTAMPTZ;
