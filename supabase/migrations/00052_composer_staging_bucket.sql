-- Composer staging bucket — holds image uploads BEFORE publish.
--
-- WHY: until 2026-05-09 the composer kept pending uploads in the
-- uploader's browser IndexedDB only, then pushed them to Cloudflare at
-- publish time. That broke cross-device editing (your phone can't see
-- a logo you uploaded on your laptop) and cross-role review (the client
-- can't preview an image the IT team just uploaded but hasn't published).
--
-- This bucket fixes that: every upload now writes here immediately, the
-- composition stores the public Supabase URL, and the iframe preview
-- works for any user / device. At publish time the publish flow copies
-- bytes from this bucket to Cloudflare and rewrites composition URLs to
-- `/_uploads/...` paths, same as before.
--
-- Storage cost trade-off:
--   - We pay for every upload, including abandoned tries.
--   - An orphan-cleanup task (added in a follow-up migration / cron
--     job) periodically deletes files not referenced by any site's
--     composition. Until that's running, expect mild bloat over months.
--   - 8 MB cap per file (enforced in the API route + image-store.ts).
--
-- Layout: `composer-staging/{site_id}/{uuid}.{ext}` so cleanup can
-- query by site and a delete-on-site-removal trigger has an obvious
-- prefix to nuke.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'composer-staging',
  'composer-staging',
  true,                                 -- public read so the iframe preview can <img src="...">
  8388608,                              -- 8 MB hard cap (Postgres-level)
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/svg+xml','image/avif']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Storage policies ──
-- Public read so unauthenticated iframe loads (preview, published-but-
-- still-pointing-here renders) work without signed URLs. Authenticated
-- users only for write/delete; the API route is the actual gatekeeper
-- (validates siteId + permissions), but RLS adds a second layer.

DROP POLICY IF EXISTS "composer_staging_public_read" ON storage.objects;
CREATE POLICY "composer_staging_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'composer-staging');

DROP POLICY IF EXISTS "composer_staging_authenticated_write" ON storage.objects;
CREATE POLICY "composer_staging_authenticated_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'composer-staging');

DROP POLICY IF EXISTS "composer_staging_authenticated_update" ON storage.objects;
CREATE POLICY "composer_staging_authenticated_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'composer-staging');

DROP POLICY IF EXISTS "composer_staging_authenticated_delete" ON storage.objects;
CREATE POLICY "composer_staging_authenticated_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'composer-staging');
