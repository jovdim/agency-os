-- 2026-05-15: existing-client migration flag
--
-- Marks a proposal that represents an EXISTING paying client moved into
-- the CRM from outside the normal sales pipeline (e.g. legacy customers
-- from before the dashboard existed, or one-off direct sales that
-- skipped the proposal/email/QR-payment flow).
--
-- Behaviour driven by this flag:
--   - Live-clients pages (/super/, /tech/, /sales/live-clients) show a
--     'Migrated' tag + offer a filter tab for them.
--   - Composer hides four UI sections that are meaningless on a paid-
--     since-day-1 row: SendProposalDialog, BannerConfigDialog,
--     ProposalTimeline, follow-up reminders + discount countdown.
--   - No commission accrues (sales_person_id is null on these rows,
--     handled at insert time by the migrate-client API route).
--   - No proposal_reminders ever get scheduled.
--   - No QR payment widget injected into the published site.
--
-- Default false so every existing organic proposal stays untouched.
-- Partial index because the vast majority of rows will be FALSE — a
-- full b-tree on a low-cardinality boolean wastes space; the partial
-- form indexes only the small migrated subset that filter queries
-- actually want.

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS is_migrated BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_proposals_is_migrated
  ON public.proposals(is_migrated)
  WHERE is_migrated = TRUE;
