-- Migration: Allow `widgets` as a section_templates category.
-- ============================================================================
-- Adds the 'widgets' category to the section_templates check constraint so
-- the composer can host floating-page utilities (WhatsApp button, scroll-to-top,
-- phone-call bubble, cookie consent bar, etc.) alongside regular content
-- sections.
--
-- Widgets behave like normal addable sections in the composer (you pick one
-- from the picker and it appears in the composition list), but their rendered
-- HTML uses position: fixed so they overlay every other section regardless
-- of where they sit in the document order.
--
-- Same shape as 00047 — drop + re-add the constraint with the new value
-- appended. Idempotent if 'widgets' already there.
-- ============================================================================

ALTER TABLE public.section_templates
  DROP CONSTRAINT IF EXISTS section_templates_category_check;

ALTER TABLE public.section_templates
  ADD CONSTRAINT section_templates_category_check CHECK (
    category IN (
      'nav', 'hero', 'about', 'services', 'gallery', 'reviews',
      'faq', 'cta', 'contact', 'footer', 'map', 'testimonials', 'widgets'
    )
  );
