-- Drop the legacy content / section / template system.
--
-- Superseded by the composer, which stores everything in
-- `sites.composition` (JSON) and renders from `section_templates`. None of
-- the tables below are read or written by the composer anymore.
--
-- Removed in this migration:
--   • change_requests  — the old client self-edit + "support message" pipeline.
--     Client self-editing and in-app messaging were both removed, so the
--     table, its credit-deduction/refund triggers and their functions go too.
--   • sections          — old per-site section rows (composer uses composition).
--   • templates         — old whole-site design templates + the template_id
--     FK columns that pointed at them from proposals and sites.
--
-- DROP TABLE ... CASCADE removes each table's own indexes, RLS policies and
-- triggers automatically. Trigger FUNCTIONS are not owned by the table, so
-- they are dropped explicitly below.
--
-- The `templates` Storage bucket is left in place (clear it manually if you
-- want the space back). The `publish_requests` table is intentionally kept.

BEGIN;

-- ── change_requests ────────────────────────────────────────────────
-- Triggers are dropped with the table (CASCADE); drop the functions they
-- referenced so no orphaned credit-logic functions linger.
DROP TABLE IF EXISTS public.change_requests CASCADE;

DROP FUNCTION IF EXISTS public.deduct_credit_on_change_request() CASCADE;
DROP FUNCTION IF EXISTS public.refund_credit_on_rejection() CASCADE;
DROP FUNCTION IF EXISTS public.deduct_credit_on_draft_to_pending() CASCADE;

-- The status enum existed only for change_requests.status.
DROP TYPE IF EXISTS public.change_request_status;

-- ── sections ───────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.sections CASCADE;

-- ── templates (+ FK columns that referenced it) ────────────────────
-- Drop the dependent FK columns first so the parent table can be removed.
ALTER TABLE public.proposals DROP COLUMN IF EXISTS template_id;
ALTER TABLE public.sites DROP COLUMN IF EXISTS template_id;

DROP TABLE IF EXISTS public.templates CASCADE;

COMMIT;
