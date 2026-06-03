-- Store the Cloudflare deployment URL on each site_versions row so the
-- composer's history dropdown can offer a per-version preview link
-- (each CF deployment keeps a permanent {hash}.{slug}.pages.dev URL).

ALTER TABLE public.site_versions
  ADD COLUMN IF NOT EXISTS deployment_url TEXT;

COMMENT ON COLUMN public.site_versions.deployment_url IS
  'Permanent Cloudflare deployment URL for this version (e.g. https://abc123.nexedge77-moutrvyt.pages.dev). Used for read-only previews from the version history dropdown. Null on rows inserted before this column was added.';
