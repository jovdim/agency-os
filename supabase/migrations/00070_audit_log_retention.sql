-- Audit log retention — auto-delete entries older than 90 days.
--
-- Why: audit_log gets a row on every API mutation (proposal status
-- changes, contact reassignment, payment confirmation, etc.). Without a
-- cap it grows forever, and the /super/audit page slows down because
-- every query has to scan the full table. 90 days is enough for any
-- "who did what last week / quarter" investigation; older history can
-- be reconstructed from git + payment + email logs.
--
-- How: a small SECURITY DEFINER function does the DELETE, and pg_cron
-- runs it daily at 03:00 UTC (off-peak for Slovak ops hours). The
-- schedule is idempotent — re-applying the migration unschedules first
-- so we don't accumulate duplicate jobs.
--
-- Manual run anytime:
--   SELECT public.audit_log_retention_cleanup();

CREATE OR REPLACE FUNCTION public.audit_log_retention_cleanup()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INT;
BEGIN
  WITH del AS (
    DELETE FROM public.audit_log
    WHERE created_at < now() - INTERVAL '90 days'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM del;
  RAISE NOTICE 'audit_log_retention_cleanup: deleted % rows older than 90 days', v_deleted;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.audit_log_retention_cleanup()
  TO service_role;

-- Schedule via pg_cron (already enabled on Supabase). Wrapped in a DO
-- block so a missing pg_cron extension (e.g. local dev without it)
-- doesn't break the migration — the function still works and Peter can
-- invoke it manually.
DO $outer$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    -- Drop any prior schedule with our name so re-apply is idempotent.
    IF EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'audit-log-retention-daily'
    ) THEN
      PERFORM cron.unschedule('audit-log-retention-daily');
    END IF;

    PERFORM cron.schedule(
      'audit-log-retention-daily',
      '0 3 * * *',
      'SELECT public.audit_log_retention_cleanup()'
    );

    RAISE NOTICE 'pg_cron job audit-log-retention-daily scheduled (daily 03:00 UTC)';
  ELSE
    RAISE NOTICE 'pg_cron extension not installed — audit_log_retention_cleanup() must be invoked manually';
  END IF;
END
$outer$;
