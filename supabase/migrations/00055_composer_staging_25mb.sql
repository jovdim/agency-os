-- Bump the composer-staging bucket's file_size_limit from 8 MB to 25 MB.
--
-- The original cap (migration 00052) was tuned for already-optimized
-- web images. In practice the IT team uploads raw camera shots, screen
-- captures, and uncompressed PNGs that routinely cross 8 MB. publish.ts
-- runs every staging file through optimizeImage() before Cloudflare
-- ships it, so the loose entry gate does NOT bloat the deployed site
-- — it just stops "image too large" friction in the composer.
--
-- Three layers must agree on this number:
--   1. src/lib/composer/image-store.ts  (client-side fail-fast)
--   2. src/app/api/composer/upload/route.ts (server-side guard)
--   3. storage.buckets.file_size_limit  (this migration)
--
-- 26214400 = 25 * 1024 * 1024.
--
-- Caveat: Vercel's serverless function body size cap (~4.5 MB on Hobby,
-- larger on Pro) sits ABOVE this layer — uploads bigger than that get
-- rejected by Vercel before reaching the API route. The bucket limit
-- therefore caps the upper bound; the platform tier caps the realistic
-- ceiling. If we ever need uploads >50 MB, switch to direct-to-Supabase
-- signed URLs so the bytes never traverse Vercel.

UPDATE storage.buckets
   SET file_size_limit = 26214400
 WHERE id = 'composer-staging';
