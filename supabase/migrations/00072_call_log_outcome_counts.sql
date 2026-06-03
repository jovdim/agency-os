-- Outcome counts per salesperson, in one round-trip.
--
-- /super/sales-overview/[id] used to SELECT every call_log row for the
-- salesperson, ship them all back to Node, and then forEach() over them
-- to build a Record<outcome, count>. For a long-tenured rep that's
-- thousands of rows on every detail-page visit. The aggregation is what
-- the database is good at.
--
-- Use:
--   SELECT outcome, count FROM public.call_log_outcome_counts(<sales_person_id>);

CREATE OR REPLACE FUNCTION public.call_log_outcome_counts(p_sales_person_id UUID)
RETURNS TABLE(outcome TEXT, count BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT cl.outcome::TEXT, COUNT(*)::BIGINT
  FROM public.call_logs cl
  WHERE cl.sales_person_id = p_sales_person_id
  GROUP BY cl.outcome;
$$;

GRANT EXECUTE ON FUNCTION public.call_log_outcome_counts(UUID)
  TO authenticated, service_role;
