-- Migration: Allow `how-it-works` as a section_templates category.
-- ============================================================================
-- Adds the 'how-it-works' category to the section_templates check constraint
-- so the composer's section picker can host a dedicated "process / values"
-- intro section (sits between hero and the services grid). The bagerexpress
-- migration is the driver — their "Ako všetko spolu funguje" section doesn't
-- fit naturally in any existing category (it's not really "services" — it's
-- a values / approach intro before the actual service list).
--
-- Same shape as 00047/00058 — drop + re-add the constraint with the new
-- value appended. Idempotent if 'how-it-works' already there.
-- ============================================================================

ALTER TABLE public.section_templates
  DROP CONSTRAINT IF EXISTS section_templates_category_check;

ALTER TABLE public.section_templates
  ADD CONSTRAINT section_templates_category_check CHECK (
    category IN (
      'nav', 'hero', 'about', 'services', 'gallery', 'reviews',
      'faq', 'cta', 'contact', 'footer', 'map', 'testimonials',
      'widgets', 'how-it-works'
    )
  );
