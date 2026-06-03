-- 00045_sites_subdomain.sql
--
-- Adds a `subdomain` column to `sites` for the agency's *.2dni.sk subdomain
-- mapping (Phase 1 of the custom-domain feature). Default is null; the
-- publish flow auto-derives from the site slug on first publish and stores
-- it back. Sales can override per-site later via the editable UI (Phase 2).
--
-- Why a dedicated column (rather than reusing requested_domain): that one
-- is for the CLIENT'S real domain (the post-purchase flow). The subdomain
-- here is the agency-owned URL on 2dni.sk that all proposals get for free.
-- Conflating the two would tangle the two flows.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS subdomain TEXT;

-- Subdomain must be unique across all sites (each one maps to a distinct
-- DNS record on 2dni.sk). Partial index — null subdomain (not yet set up)
-- shouldn't conflict with anything.
CREATE UNIQUE INDEX IF NOT EXISTS sites_subdomain_unique
  ON public.sites (subdomain)
  WHERE subdomain IS NOT NULL;

-- Format check: lowercase alphanumeric + hyphens, 3-50 chars, no leading/
-- trailing hyphens. Mirrors validateSubdomainFormat() in subdomain.ts so
-- bad data can't sneak in via direct DB writes.
ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_subdomain_format_check;
ALTER TABLE public.sites
  ADD CONSTRAINT sites_subdomain_format_check
  CHECK (
    subdomain IS NULL OR (
      subdomain ~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$'
    )
  );

COMMENT ON COLUMN public.sites.subdomain IS
  'Agency-owned subdomain on *.2dni.sk (Cloudflare Pages custom domain). Auto-derived from slug on first publish; sales can override.';
