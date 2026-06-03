-- Migration: Allow `subpage` as a section_templates category.
-- ============================================================================
-- Adds the 'subpage' category to the section_templates check constraint so
-- the composer's section rail can host page-header templates for subpages
-- (O nás, Služby — detail, regional service pages like "Plynár Bratislava",
-- blog posts). The rail already has a Subpage slot with a "Soon" badge —
-- this migration is what makes the first real subpage template (subpage-01)
-- insertable.
--
-- Same shape as 00047 / 00058 / 00063 — drop + re-add the constraint with the
-- new value appended. Idempotent if 'subpage' is already in the list.
-- ============================================================================

ALTER TABLE public.section_templates
  DROP CONSTRAINT IF EXISTS section_templates_category_check;

ALTER TABLE public.section_templates
  ADD CONSTRAINT section_templates_category_check CHECK (
    category IN (
      'nav', 'hero', 'about', 'services', 'gallery', 'reviews',
      'faq', 'cta', 'contact', 'footer', 'map', 'testimonials',
      'widgets', 'how-it-works', 'subpage'
    )
  );
