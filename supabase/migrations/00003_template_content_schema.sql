-- Phase 3: Template content schema
-- Adds content_schema column to store parsed content.json in the templates table

ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS content_schema JSONB DEFAULT '{}';

-- ═══════════════════════════════════════════════════════════════
-- Storage bucket: templates
-- ═══════════════════════════════════════════════════════════════

-- 1. Create the bucket (public so rendered sites can load CSS/JS/images)
INSERT INTO storage.buckets (id, name, public)
VALUES ('templates', 'templates', true)
ON CONFLICT (id) DO NOTHING;

-- 2. SELECT — anyone can read (public bucket for serving design assets)
CREATE POLICY "templates_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'templates');

-- 3. INSERT — only super_admin can upload files
CREATE POLICY "templates_super_admin_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'templates'
    AND (SELECT raw_app_meta_data ->> 'role' FROM auth.users WHERE id = auth.uid()) = 'super_admin'
  );

-- 4. UPDATE — only super_admin can overwrite files
CREATE POLICY "templates_super_admin_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'templates'
    AND (SELECT raw_app_meta_data ->> 'role' FROM auth.users WHERE id = auth.uid()) = 'super_admin'
  );

-- 5. DELETE — only super_admin can remove files
CREATE POLICY "templates_super_admin_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'templates'
    AND (SELECT raw_app_meta_data ->> 'role' FROM auth.users WHERE id = auth.uid()) = 'super_admin'
  );
