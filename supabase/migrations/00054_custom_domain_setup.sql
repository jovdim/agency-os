-- Custom domain setup tracking.
--
-- The "Custom domain" timeline step kicks off a multi-step Cloudflare
-- setup that can take anywhere from a few minutes (zone already
-- delegated) to ~30 min total (zone needs DNS to propagate + SSL to
-- provision). The dashboard polls a tick endpoint every 30 sec to
-- drive the state machine forward without a long-running connection,
-- so we need somewhere on the row to remember WHERE we are in the
-- pipeline between ticks.
--
-- This migration adds those bookkeeping columns. The existing
-- `domain` / `domain_status` / `requested_domain` columns keep
-- their semantics:
--   - `requested_domain` — what sales typed (input, normalized lowercase)
--   - `domain`           — the canonical active custom domain (written
--                          ONLY when setup hits the "active" terminal)
--   - `domain_status`    — the legacy approval workflow ("active",
--                          "register_new", etc.) flips to "active"
--                          when the pipeline finishes successfully
--
-- Why a separate `domain_setup_status` column instead of overloading
-- `domain_status`: keeping the Cloudflare-pipeline state distinct
-- from the customer-facing approval state means each can evolve
-- independently. The pipeline can fail / retry / restart without
-- disturbing the legacy approval workflow that super_admin uses.

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS domain_setup_status TEXT
    CHECK (
      domain_setup_status IS NULL
      OR domain_setup_status IN (
        'not_started',
        'creating_zone',
        'waiting_dns',
        'registering_pages',
        'provisioning_ssl',
        'active',
        'failed'
      )
    );

-- Wall-clock when the current pipeline run began. Used to compute
-- elapsed-time for the live progress UI ("Setting up domain… 4 of 30
-- min") and to enforce per-state timeouts (waiting_dns > 30 min →
-- failed, etc.).
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS domain_setup_started_at TIMESTAMPTZ;

-- Last error message, surfaced verbatim in the failure-state UI so
-- the salesperson can read what went wrong without opening Cloudflare.
-- Cleared at the start of every fresh attempt.
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS domain_setup_error TEXT;

-- Per-state retry counter. The tick endpoint increments this when a
-- soft failure (e.g. Pages "DNS setup" error during the waiting-dns
-- window) occurs so we can detect "stuck" pipelines vs. normal first-
-- few-minutes flakiness. Reset to 0 whenever the state advances.
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS domain_setup_attempts INTEGER NOT NULL DEFAULT 0;

-- Cached Cloudflare zone id for the registrable domain (e.g. the
-- zone for `clientname.sk`, distinct from the project-wide
-- `2dni.sk` zone used for *.2dni.sk subdomains). Cached because we
-- need it on every tick and looking it up by name costs an API call.
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS domain_zone_id TEXT;

-- Nameservers Cloudflare assigned when the zone was created. Surfaced
-- in the timeline so sales can read them off to the customer if
-- Hostcreator's auto-delegation ever fails — and used as the
-- diagnostic in the "Zone not activating" failure state.
-- TEXT[] because Cloudflare returns two (sometimes more on
-- enterprise plans, but we treat 2+ uniformly).
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS domain_nameservers TEXT[];

-- Audit-log entry so super_admin can see the schema bump if they're
-- diffing migrations. logAudit() is application-level; this comment
-- is just a marker for the operations team.
COMMENT ON COLUMN sites.domain_setup_status IS
  'Cloudflare custom-domain pipeline state. Drives the Custom Domain timeline step UI. NULL when no custom domain has been requested yet (legacy rows pre-2026-05-10).';
COMMENT ON COLUMN sites.domain_zone_id IS
  'Cloudflare zone id for the registrable domain (NOT the *.2dni.sk zone — that comes from CLOUDFLARE_ZONE_ID env var).';
