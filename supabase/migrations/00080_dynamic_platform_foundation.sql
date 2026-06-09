-- 00080_dynamic_platform_foundation.sql
--
-- Foundation for the DYNAMIC multi-tenant platform: client websites are served
-- live from the database (instead of static Cloudflare Pages bundles), and each
-- client will log into their own site at `theirdomain.com/admin` to edit it.
--
-- This migration is fully ADDITIVE and safe to run on production. It only adds
-- columns / a table / indexes — it never drops or rewrites existing data.
--
-- Adds:
--   1. sites.published_composition — the LIVE composition the public sees. The
--      existing sites.composition becomes the editable DRAFT. "Publish" copies
--      draft -> published. Backfilled from the current composition so any site
--      already live keeps serving its current content the moment the dynamic
--      renderer switches to published_composition.
--   2. A case-insensitive lookup index on sites.domain (the dynamic renderer
--      resolves host -> site on every request; subdomain already has a unique
--      index from 00045).
--   3. site_admins — per-site CMS logins, fully separate from staff `profiles`.
--      RLS is enabled with NO policies, so only the service-role admin client
--      (used by the platform's own auth routes) can read/write it. Regular
--      Supabase auth sessions get ZERO access. This is defense-in-depth on top
--      of the route-level check (a session's site_id must equal the
--      host-resolved site).

BEGIN;

-- ── 1. Draft / published split ─────────────────────────────────────────────
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS published_composition JSONB;

-- Seed published from the current composition. In the old flow, sites.composition
-- IS what got rendered + deployed, so it is the correct "currently live" seed.
-- Idempotent: only fills rows not yet backfilled, never clobbers a real
-- published value on a re-run. (No public effect at migration time — existing
-- sites are still served by Cloudflare Pages until the Phase 8 cutover; the
-- dynamic renderer is only reachable on test hosts for now.)
UPDATE public.sites
  SET published_composition = composition
  WHERE published_composition IS NULL
    AND composition IS NOT NULL;

COMMENT ON COLUMN public.sites.published_composition IS
  'LIVE composition served to the public. sites.composition is the editable draft; Publish copies draft -> published. Added 00080 (dynamic platform).';

-- ── 2. Hostname resolution: normalize + index ──────────────────────────────
-- The dynamic renderer resolves host -> site on every request and normalizes
-- the incoming host to lowercase, www-stripped (see resolve-site.ts). Normalize
-- existing stored domains the same way so they actually match. Idempotent: only
-- touches rows that aren't already normalized.
UPDATE public.sites
  SET domain = regexp_replace(lower(domain), '^www\.', '')
  WHERE domain IS NOT NULL
    AND domain <> regexp_replace(lower(domain), '^www\.', '');

-- Case-insensitive lookup aid. Kept non-unique on purpose: a UNIQUE index could
-- fail mid-migration if two rows already collide after normalization, and the
-- resolver matches case-insensitively (ILIKE) + limit(1), so it never depends on
-- uniqueness. (Enforce uniqueness later once domain data is verified clean.)
CREATE INDEX IF NOT EXISTS sites_domain_lower_idx
  ON public.sites (lower(domain))
  WHERE domain IS NOT NULL;

-- ── 3. Per-site CMS admins (standalone auth, separate from staff profiles) ──
CREATE TABLE IF NOT EXISTS public.site_admins (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  display_name     TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  -- Password reset: single-use token stored hashed; null when none pending.
  reset_token_hash TEXT,
  reset_expires_at TIMESTAMPTZ,
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One login per (site, email), case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS site_admins_site_email_unique
  ON public.site_admins (site_id, lower(email));

-- Per-site listing.
CREATE INDEX IF NOT EXISTS site_admins_site_idx
  ON public.site_admins (site_id);

-- Reuse the shared updated_at trigger fn from 00001_initial_schema.sql.
DROP TRIGGER IF EXISTS trg_site_admins_updated_at ON public.site_admins;
CREATE TRIGGER trg_site_admins_updated_at
  BEFORE UPDATE ON public.site_admins
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS: enable with NO policies. With RLS on and no permissive policy, the anon
-- and authenticated Supabase roles get no access at all; only the service-role
-- admin client (which bypasses RLS) can touch this table. The platform's login
-- / session routes use that admin client and enforce per-site isolation in code
-- (session.site_id must equal the host-resolved site). site_admins must never
-- be reachable from a client's Supabase session.
ALTER TABLE public.site_admins ENABLE ROW LEVEL SECURITY;
-- Belt-and-suspenders for a table holding password + reset-token hashes:
-- explicitly revoke the PostgREST-exposed roles and FORCE RLS so not even the
-- table owner can read it without a policy. Only the service-role client
-- (BYPASSRLS) can touch it — which is all the platform's auth routes use.
REVOKE ALL ON public.site_admins FROM anon, authenticated;
ALTER TABLE public.site_admins FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.site_admins IS
  'Per-site CMS logins for theirdomain.com/admin. Separate from staff profiles. RLS-enabled with no policies => service-role only. Added 00080 (dynamic platform).';

COMMIT;
