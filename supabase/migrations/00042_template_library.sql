-- Migration: Template Library — foundation for the template-driven proposal builder
-- ============================================================================
-- Adds:
--   1. section_templates table (reusable nav/hero/about/etc. blocks with placeholder schema)
--   2. sites.composition + is_legacy + render/publish timestamps
--   3. site_versions table (per-publish snapshots, replaces git history)
--   4. section-templates storage bucket (HTML/CSS/preview images)
-- Coexists with the legacy GitHub+cheerio pipeline; existing sites get is_legacy=true.

-- ============================================================
-- 1. section_templates table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.section_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category            TEXT NOT NULL,
  name                TEXT NOT NULL,
  html_path           TEXT NOT NULL,
  css_path            TEXT,
  preview_image       TEXT,
  placeholder_schema  JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags                TEXT[] NOT NULL DEFAULT '{}',
  industry_hints      TEXT[] NOT NULL DEFAULT '{}',
  is_published        BOOLEAN NOT NULL DEFAULT true,
  version             INT NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT section_templates_category_check CHECK (
    category IN ('nav', 'hero', 'about', 'services', 'gallery', 'reviews', 'faq', 'cta', 'contact', 'footer', 'map')
  )
);

CREATE INDEX IF NOT EXISTS section_templates_category_published_idx
  ON public.section_templates (category)
  WHERE is_published;

CREATE UNIQUE INDEX IF NOT EXISTS section_templates_category_name_uniq
  ON public.section_templates (category, name);

COMMENT ON TABLE public.section_templates IS
  'Reusable section templates (nav/hero/about/etc.) for the template-driven proposal builder';
COMMENT ON COLUMN public.section_templates.html_path IS
  'Storage path under the section-templates bucket, e.g. hero/hero-01.html';
COMMENT ON COLUMN public.section_templates.placeholder_schema IS
  'JSON map of placeholder_key -> {type, default, default_src} parsed from data-placeholder attrs at upload time';

ALTER TABLE public.section_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read published section_templates"
  ON public.section_templates FOR SELECT
  TO authenticated
  USING (is_published OR (SELECT get_my_role()) IN ('tech_admin', 'super_admin'));

CREATE POLICY "Tech and super admin manage section_templates"
  ON public.section_templates FOR ALL
  TO authenticated
  USING ((SELECT get_my_role()) IN ('tech_admin', 'super_admin'))
  WITH CHECK ((SELECT get_my_role()) IN ('tech_admin', 'super_admin'));

CREATE OR REPLACE FUNCTION public.set_section_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS section_templates_set_updated_at ON public.section_templates;
CREATE TRIGGER section_templates_set_updated_at
  BEFORE UPDATE ON public.section_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_section_templates_updated_at();

-- ============================================================
-- 2. sites — composition + legacy flag + render/publish timestamps
-- ============================================================
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS composition       JSONB,
  ADD COLUMN IF NOT EXISTS is_legacy         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_rendered_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_published_at TIMESTAMPTZ;

COMMENT ON COLUMN public.sites.composition IS
  'Multi-page composition: { pages: [{path, label, sections: [{id, template_id, order, content_overrides}]}], shared: {nav_template_id, nav_overrides, footer_template_id, footer_overrides} }. NULL for legacy sites.';
COMMENT ON COLUMN public.sites.is_legacy IS
  'true = old GitHub+cheerio site (pre-template-library era), false = new template-driven site';

-- Backfill: every existing site is legacy (built with the old GitHub+cheerio path)
UPDATE public.sites SET is_legacy = true WHERE composition IS NULL;

-- ============================================================
-- 3. site_versions — per-publish snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS public.site_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  composition         JSONB NOT NULL,
  rendered_html_path  TEXT,
  reason              TEXT NOT NULL,
  created_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT site_versions_reason_check CHECK (
    reason IN ('tech_publish', 'change_request_apply', 'rollback', 'initial')
  )
);

CREATE INDEX IF NOT EXISTS site_versions_site_id_created_idx
  ON public.site_versions (site_id, created_at DESC);

COMMENT ON TABLE public.site_versions IS
  'Snapshot of sites.composition each time the site is published. Replaces per-site GitHub history under the new pipeline.';
COMMENT ON COLUMN public.site_versions.rendered_html_path IS
  'Optional storage path of the rendered HTML bundle for exact reproducibility. NULL means "regenerate from composition".';

ALTER TABLE public.site_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Site owners read their own versions"
  ON public.site_versions FOR SELECT
  TO authenticated
  USING (site_id IN (SELECT id FROM public.sites WHERE owner_id = auth.uid()));

CREATE POLICY "Tech and admin roles read all versions"
  ON public.site_versions FOR SELECT
  TO authenticated
  USING ((SELECT get_my_role()) IN ('tech_admin', 'administrator', 'super_admin'));

CREATE POLICY "Tech and super admin write versions"
  ON public.site_versions FOR ALL
  TO authenticated
  USING ((SELECT get_my_role()) IN ('tech_admin', 'super_admin'))
  WITH CHECK ((SELECT get_my_role()) IN ('tech_admin', 'super_admin'));

-- ============================================================
-- 4. section-templates storage bucket (HTML, CSS, preview images)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('section-templates', 'section-templates', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Tech roles upload template files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'section-templates'
    AND (SELECT get_my_role()) IN ('tech_admin', 'super_admin')
  );

CREATE POLICY "Tech roles update template files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'section-templates'
    AND (SELECT get_my_role()) IN ('tech_admin', 'super_admin')
  );

CREATE POLICY "Tech roles delete template files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'section-templates'
    AND (SELECT get_my_role()) IN ('tech_admin', 'super_admin')
  );

CREATE POLICY "Public read template files"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'section-templates');
