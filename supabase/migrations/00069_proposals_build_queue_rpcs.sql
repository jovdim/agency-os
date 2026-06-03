-- Server-side build-queue query for /tech/proposals.
--
-- The page used to: fetch ALL proposals, fetch ALL sites, fetch ALL
-- deployments, then exclude proposals whose site is live-published or
-- whose deployment row says "live". After a few years of operation that
-- means scanning thousands of historical rows just to surface the ~30
-- proposals still waiting on a build.
--
-- These RPCs push the NOT EXISTS predicates into Postgres and add proper
-- LIMIT/OFFSET, so the page sees only the queue itself.
--
-- "Live" is determined by the same two signals the old TS code used
-- (sites.last_published_at OR deployments.deploy_status='live'). If you
-- change those, /tech/production must change in lockstep.

CREATE OR REPLACE FUNCTION public.proposals_build_queue(
  p_limit INT,
  p_offset INT
)
RETURNS TABLE(
  id UUID,
  company_name TEXT,
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  contact_phone TEXT
)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id,
    p.company_name,
    p.updated_at,
    p.created_at,
    c.phone
  FROM public.proposals p
  LEFT JOIN public.contacts c ON c.id = p.contact_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.sites s
    WHERE s.proposal_id = p.id AND s.last_published_at IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.deployments d
    WHERE d.proposal_id = p.id AND d.deploy_status = 'live'
  )
  ORDER BY p.updated_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.proposals_build_queue(INT, INT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.proposals_build_queue_count()
RETURNS BIGINT
LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)::BIGINT
  FROM public.proposals p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.sites s
    WHERE s.proposal_id = p.id AND s.last_published_at IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.deployments d
    WHERE d.proposal_id = p.id AND d.deploy_status = 'live'
  );
$$;

GRANT EXECUTE ON FUNCTION public.proposals_build_queue_count()
  TO authenticated, service_role;
