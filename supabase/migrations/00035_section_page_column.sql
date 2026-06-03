-- Add page column to sections table
-- Supports multi-page websites where each section belongs to a specific page.
-- Values: NULL or 'home' = home page, 'about', 'services', etc.
-- 'all' = appears on every page (navigation, footer)
-- Single-page sites have all sections with NULL page (backward compatible).

ALTER TABLE public.sections
  ADD COLUMN IF NOT EXISTS page TEXT;

-- Original content.json section ID (e.g. "hero_1", "services_grid_1", "detail_kov")
-- Maps to data-section attribute in HTML, used for scroll-to-section in preview
ALTER TABLE public.sections
  ADD COLUMN IF NOT EXISTS content_id TEXT;

-- Index for filtering sections by page
CREATE INDEX IF NOT EXISTS idx_sections_page ON public.sections (site_id, page);
