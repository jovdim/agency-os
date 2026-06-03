-- Add fields from the bazos.sk leads CSV format that we don't already have.
-- Source column is intentionally NOT added (already exists + we don't need the CSV's source value).

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS total_listings INT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS services_offered TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS cities_count INT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS location_raw TEXT;

COMMENT ON COLUMN public.contacts.total_listings IS 'Number of listings this seller has on the source site';
COMMENT ON COLUMN public.contacts.description IS 'Long-form seller description (truncated for display)';
COMMENT ON COLUMN public.contacts.services_offered IS 'Pipe-separated list of services/categories the seller offers';
COMMENT ON COLUMN public.contacts.source_url IS 'URL of the original listing the contact was scraped from';
COMMENT ON COLUMN public.contacts.cities_count IS 'Number of cities the seller operates in (when Location is "X cities")';
COMMENT ON COLUMN public.contacts.postal_code IS 'Slovak postal code extracted from Location column (e.g. "851 06")';
COMMENT ON COLUMN public.contacts.location_raw IS 'Original Location column value as imported, for reference';
