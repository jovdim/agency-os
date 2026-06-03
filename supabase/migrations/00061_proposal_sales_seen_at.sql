-- 00061: Sales-side NEW badge support.
--
-- Tracks when the assigned salesperson last opened a proposal's detail
-- page. Combined with sites.last_published_at, this drives:
--   - The NEW chip on /sales/active rows
--   - The unread count badge on the sidebar "Aktívne" entry
--   - Sort order on /sales/active (NEW first, then by last_published_at)
--
-- Rule (Peter 2026-05-11, "publish is the pivot"): a proposal is NEW for
-- the salesperson when its linked site is published AND the salesperson
-- hasn't seen the latest publish:
--   sites.last_published_at IS NOT NULL
--   AND (proposals.sales_seen_at IS NULL
--        OR proposals.sales_seen_at < sites.last_published_at)
--
-- Set by the server component at /sales/proposals/[id] on every visit.
-- Re-publishes by the tech team flip the NEW state back on because
-- last_published_at moves forward past sales_seen_at.
--
-- Index supports the "count unread for this salesperson" query that
-- powers the sidebar badge.

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS sales_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_proposals_sales_seen_at
  ON public.proposals (sales_person_id, sales_seen_at);
