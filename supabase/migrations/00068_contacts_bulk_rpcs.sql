-- Server-side helpers for /super/contacts after it switched to paginated
-- mode. With the client only holding the current page, anything that
-- needs to act over the *whole* matching set (dropdown counts, "reassign
-- all matching the filter", "quick-assign N unassigned") has to run as a
-- single round-trip on the database.

-- Counts per salesperson + the unassigned bucket. Powers the filter
-- dropdown ("John (1,234)") and the Distribution tab.
CREATE OR REPLACE FUNCTION public.contacts_counts_by_sales()
RETURNS TABLE(assigned_to UUID, contacts_count BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT c.assigned_to, COUNT(*)::BIGINT
  FROM public.contacts c
  GROUP BY c.assigned_to;
$$;

GRANT EXECUTE ON FUNCTION public.contacts_counts_by_sales()
  TO authenticated, service_role;

-- Bulk-reassign every contact that matches the current filter on
-- /super/contacts. The WHERE clause must stay in sync with the paginated
-- SELECT in the page component, or the user sees N rows but the bulk op
-- touches a different N.
--
-- p_search:        NULL/empty = no search; otherwise ILIKE %p_search% on
--                  company_name / contact_person / town.
-- p_sales_filter:  NULL = no assigned_to filter (matches the UI's "All").
--                  'unassigned' = assigned_to IS NULL.
--                  Otherwise interpreted as a UUID.
-- p_target_id:     NULL = unassign; otherwise the new assignee.
--
-- SECURITY INVOKER (default) — RLS still applies, so only super_admin
-- (whose RLS policy allows all contacts) gets the global behavior.
CREATE OR REPLACE FUNCTION public.contacts_reassign_matching(
  p_search TEXT,
  p_sales_filter TEXT,
  p_target_id UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated BIGINT;
  v_pattern TEXT;
BEGIN
  v_pattern := CASE
    WHEN p_search IS NULL OR p_search = '' THEN NULL
    ELSE '%' || p_search || '%'
  END;

  WITH updated AS (
    UPDATE public.contacts c
    SET
      assigned_to = p_target_id,
      assigned_at = CASE WHEN p_target_id IS NULL THEN NULL ELSE now() END,
      updated_at  = now()
    WHERE
      (
        v_pattern IS NULL
        OR c.company_name   ILIKE v_pattern
        OR c.contact_person ILIKE v_pattern
        OR c.town           ILIKE v_pattern
      )
      AND (
        p_sales_filter IS NULL
        OR (p_sales_filter = 'unassigned' AND c.assigned_to IS NULL)
        OR (p_sales_filter <> 'unassigned' AND c.assigned_to = p_sales_filter::UUID)
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated FROM updated;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.contacts_reassign_matching(TEXT, TEXT, UUID)
  TO authenticated, service_role;

-- "Quick Assign N unassigned contacts to salesperson X." Picks the N
-- oldest unassigned rows with SKIP LOCKED so two admins clicking at the
-- same time don't fight over the same set.
CREATE OR REPLACE FUNCTION public.contacts_quick_assign(
  p_count INT,
  p_target_id UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated BIGINT;
BEGIN
  IF p_count IS NULL OR p_count <= 0 THEN
    RETURN 0;
  END IF;

  WITH picked AS (
    SELECT id FROM public.contacts
    WHERE assigned_to IS NULL
    ORDER BY created_at ASC
    LIMIT p_count
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.contacts c
    SET assigned_to = p_target_id,
        assigned_at = now(),
        updated_at  = now()
    FROM picked
    WHERE c.id = picked.id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated FROM updated;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.contacts_quick_assign(INT, UUID)
  TO authenticated, service_role;
