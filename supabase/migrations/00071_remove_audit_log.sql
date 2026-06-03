-- Remove audit_log entirely.
--
-- Decision (Peter 2026-05-20): the audit trail was a "just in case"
-- safety net that the team never opened in practice. Writes were
-- silent background work but each insert still hit the DB, and the
-- table was on track to grow forever. Dropping it removes the bloat
-- and the maintenance ceremony around retention.
--
-- The TypeScript helper at src/lib/audit.ts is being turned into a
-- no-op in the same change so the ~30 callers that already do
-- `await logAudit(...)` don't have to be edited — they keep importing
-- the same function, which now does nothing.
--
-- If pg_cron WAS enabled and migration 00070's schedule had landed,
-- unschedule it manually first with:
--   SELECT cron.unschedule('audit-log-retention-daily');
-- Skipped here because referencing cron.job from a plpgsql IF
-- condition errors out at parse time when the schema doesn't exist,
-- regardless of short-circuit logic.

DROP FUNCTION IF EXISTS public.audit_log_retention_cleanup();

DROP TABLE IF EXISTS public.audit_log CASCADE;
