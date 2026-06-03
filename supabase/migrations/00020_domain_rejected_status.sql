-- Add 'rejected' to domain_status check constraint
-- so super admin can reject domain requests with feedback

ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_domain_status_check;
ALTER TABLE sites ADD CONSTRAINT sites_domain_status_check
  CHECK (domain_status IN ('none', 'register_new', 'transfer', 'decided_later', 'active', 'rejected'));
