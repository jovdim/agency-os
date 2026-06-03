-- Migration 00072 — Domain + business-email request attribution + staff
-- notifications.
--
-- WHY
--   Tech admins and salespeople need to be able to request domain
--   registration / transfer + business-email provisioning ON BEHALF of
--   a paying client (Peter 2026-05-20: "we may do it ourselves not the
--   client"). The existing PUT /api/sites/[id]/domain already accepts
--   staff submissions, but two things are missing:
--
--   1. WHO made the request — when super_admin completes the work, we
--      need to know which staff member to notify. Currently the API
--      only records the requested_domain + the prefix, not the actor.
--
--   2. The notification itself — staff want an in-app banner on their
--      dashboard when their pending request goes active. No email,
--      no realtime sub — just a row they read on next page load.
--
-- WHAT
--   - Two attribution columns on sites: domain_requested_by + email_
--     requested_by (nullable, FK → profiles). API writes auth.uid() on
--     a staff submission; client submissions leave them null (client
--     is the owner, the owner_id already says it's them).
--
--   - staff_notifications table — small append-only ledger of "X is
--     done" events for a recipient. Banner component reads recipient_id
--     = auth.uid() AND dismissed_at IS NULL. Insert path is service-
--     role (API), select+update is RLS-scoped to the recipient.
--
-- HOW TO APPLY
--   Peter applies the file per the parallel-session rule. Safe on a
--   populated table: additive only, no existing-data backfill needed
--   (existing requests stay attribution-less; only new submissions
--   carry the requester ID).

-- ── Attribution columns on sites ─────────────────────────────────────
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS domain_requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email_requested_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.sites.domain_requested_by IS
  'Staff member (tech_admin / sales) who submitted the current domain request. NULL when the client submitted it themselves (owner_id is the implicit requester in that case). Cleared on next request.';
COMMENT ON COLUMN public.sites.email_requested_by IS
  'Staff member who submitted the current business-email request (the requested_email_prefix). NULL when the client picked it themselves. Cleared on next request.';

-- ── staff_notifications: in-app banner ledger ────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 'domain_active' = super marked the domain active for a site the
  -- recipient requested. 'email_ready' = business email + password
  -- saved on profiles for a site the recipient requested. Extend
  -- the union by adding new kinds — UI switches on this string.
  kind          TEXT NOT NULL,
  site_id       UUID REFERENCES public.sites(id) ON DELETE SET NULL,
  -- Free-form payload (company name, domain string, email address)
  -- so the banner can render rich text without a JOIN. Stale payload
  -- on a deleted site still renders (the JOIN-free read is the whole
  -- point of denormalizing into payload).
  payload       JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  dismissed_at  TIMESTAMPTZ
);

-- Partial index: every read filters dismissed_at IS NULL. Keeping it
-- partial keeps the index tiny (dismissed rows are forever in the
-- majority once a recipient has been around for a while).
CREATE INDEX IF NOT EXISTS idx_staff_notifications_active
  ON public.staff_notifications (recipient_id, created_at DESC)
  WHERE dismissed_at IS NULL;

ALTER TABLE public.staff_notifications ENABLE ROW LEVEL SECURITY;

-- Recipient can read + dismiss their own notifications. Inserts are
-- service-role only (API endpoints write them); no client insert
-- policy exists by design.
DROP POLICY IF EXISTS "staff_notifications_self_select" ON public.staff_notifications;
CREATE POLICY "staff_notifications_self_select" ON public.staff_notifications
  FOR SELECT TO authenticated
  USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS "staff_notifications_self_update" ON public.staff_notifications;
CREATE POLICY "staff_notifications_self_update" ON public.staff_notifications
  FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

COMMENT ON TABLE public.staff_notifications IS
  'In-app dashboard banner ledger. One row per "X is done" event, scoped to a single recipient (the staff member who originally requested the work). Banner component reads dismissed_at IS NULL.';
