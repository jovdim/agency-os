-- Broad database: phones array + district for contacts

-- Store all available phone numbers as array (dashboard shows first, hover shows all)
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS phones TEXT[];

-- District (Okres) for regional filtering/assignment
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS district TEXT;

-- Index for deduplication by phone
CREATE INDEX IF NOT EXISTS idx_contacts_phones ON public.contacts USING GIN (phones);

-- Index for district filtering
CREATE INDEX IF NOT EXISTS idx_contacts_district ON public.contacts(district) WHERE district IS NOT NULL;
