-- Composer video bucket — holds raw video uploads for client websites.
--
-- WHY a separate bucket from composer-staging (images):
--   1. Different size envelope. Images sit at 25 MB; video routinely hits
--      50-200 MB even for short clips. Mixing them in one bucket forces
--      either a too-small video cap or a too-large image cap (which makes
--      "image too large" feedback in the composer less precise).
--   2. Different lifecycle. composer-staging is TRANSIENT: publish.ts
--      copies images to Cloudflare Pages and deletes the staging file.
--      Cloudflare Pages can't reasonably host 100 MB videos (it's a
--      static-site host, 25 MB per file). Until we wire up R2 for video,
--      composer-video is PERMANENT — the live site references the
--      Supabase URL directly. publish.ts is taught to skip composer-video
--      URLs entirely so they survive every publish.
--   3. Different MIME allowlist. Sharp / WebP optimization makes zero
--      sense for video, so we don't want a video file to ever slip into
--      the image-processing path. Bucket-level MIME enforcement is the
--      strongest gate.
--
-- Layout mirrors composer-staging: `composer-video/{site_id}/{uuid}.{ext}`.
-- Per-site prefix lets the future cleanup task query by site without
-- walking the bucket.
--
-- Cap: 200 MB. Sized for ~30-second 1080p clips with reasonable bitrate.
-- Bump (here + the API route + image-store.ts MAX_VIDEO_BYTES) if the
-- agency starts shipping longer / 4K reels. Cap is enforced at three
-- layers — keep them in sync.
--
-- Mime allowlist:
--   - mp4 (h.264/h.265): universal browser support
--   - webm: Chrome/Firefox-first, good compression
--   - quicktime (.mov): iPhone default, browsers transcode lazily
--   - x-matroska (.mkv): occasionally requested for higher-quality masters
-- Skipping legacy avi/wmv/flv on purpose — they'd need transcoding before
-- the browser could play them in a <video> tag, which we don't do.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'composer-video',
  'composer-video',
  true,                                 -- public read so the iframe + live site <video> can stream
  209715200,                            -- 200 MB hard cap (200 * 1024 * 1024)
  ARRAY['video/mp4','video/webm','video/quicktime','video/x-matroska']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Storage policies ──
-- Same shape as composer-staging policies. Public read so unauthenticated
-- live-site visitors can play the video without signed URLs. Authenticated
-- writes; the upload-url API route is the actual gatekeeper that checks
-- site ownership, the RLS policy is a second-layer fence so a stolen
-- signed URL still requires an authenticated session at the bucket layer.

DROP POLICY IF EXISTS "composer_video_public_read" ON storage.objects;
CREATE POLICY "composer_video_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'composer-video');

DROP POLICY IF EXISTS "composer_video_authenticated_write" ON storage.objects;
CREATE POLICY "composer_video_authenticated_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'composer-video');

DROP POLICY IF EXISTS "composer_video_authenticated_update" ON storage.objects;
CREATE POLICY "composer_video_authenticated_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'composer-video');

DROP POLICY IF EXISTS "composer_video_authenticated_delete" ON storage.objects;
CREATE POLICY "composer_video_authenticated_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'composer-video');
