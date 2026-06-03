-- Add in-progress statuses for domain pipeline.
-- Admin moves requests through: requested (register_new/transfer) → in_progress → active (done) or rejected.
-- register_in_progress: admin is actively registering a new domain
-- transfer_in_progress: admin is actively handling the transfer

ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_domain_status_check;
ALTER TABLE sites ADD CONSTRAINT sites_domain_status_check
  CHECK (domain_status IN (
    'none',
    'register_new',
    'register_in_progress',
    'transfer',
    'transfer_in_progress',
    'decided_later',
    'active',
    'rejected'
  ));
