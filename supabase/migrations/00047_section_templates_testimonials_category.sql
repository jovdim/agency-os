-- Migration: Allow `testimonials` as a section_templates category.
-- ============================================================================
-- The original 00042 constraint only listed 11 categories (nav..map). The
-- testimonials section type already exists in the section-registry on the
-- app side; this just unblocks uploading testimonials-XX templates to the
-- library.
-- ============================================================================

ALTER TABLE public.section_templates
  DROP CONSTRAINT IF EXISTS section_templates_category_check;

ALTER TABLE public.section_templates
  ADD CONSTRAINT section_templates_category_check CHECK (
    category IN (
      'nav', 'hero', 'about', 'services', 'gallery', 'reviews',
      'faq', 'cta', 'contact', 'footer', 'map', 'testimonials'
    )
  );
