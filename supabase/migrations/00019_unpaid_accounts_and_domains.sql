-- Migration: Unpaid client accounts + domain selection
--
-- 1. Allow sites to exist before payment (is_paid flag)
-- 2. Domain selection workflow (register new / transfer / decide later)
-- 3. Store temp password on proposals for email delivery

-- Unpaid account tracking (default true = backward compat for existing sites)
ALTER TABLE sites ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT true;

-- Domain selection fields
ALTER TABLE sites ADD COLUMN IF NOT EXISTS domain_status TEXT DEFAULT 'none'
  CHECK (domain_status IN ('none', 'register_new', 'transfer', 'decided_later', 'active'));
ALTER TABLE sites ADD COLUMN IF NOT EXISTS requested_domain TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS domain_auth_code TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS domain_notes TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS domain_decided_at TIMESTAMPTZ;

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS client_temp_password TEXT;
