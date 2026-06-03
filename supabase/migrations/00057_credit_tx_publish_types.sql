-- 00057: Add publish_charge + publish_refund to credit_tx_type enum.
--
-- Modern composer-based clients pay 12.50 € per publish (Peter
-- 2026-05-11). Charges go through /api/sites/[id]/publish, which
-- inserts a credit_transactions row tagged with one of these new
-- enum values. Keeps the audit trail readable — a Slovak label
-- like "Publikácia stránky" lands cleanly in the client's
-- transaction history without leaking the legacy change-request
-- terminology ("Odoslanie zmien") into the modern flow.
--
-- ALTER TYPE ... ADD VALUE is NOT transactional in older PostgreSQL
-- versions, so each ADD VALUE runs independently. IF NOT EXISTS makes
-- the migration safely re-runnable.

ALTER TYPE public.credit_tx_type ADD VALUE IF NOT EXISTS 'publish_charge';
ALTER TYPE public.credit_tx_type ADD VALUE IF NOT EXISTS 'publish_refund';
