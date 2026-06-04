-- Rename contacts.district → contacts.state
--
-- "District" (Okres) was the original Slovak regional field. The app now
-- uses "State" terminology everywhere (Add Contact form, contacts table,
-- CSV bulk upload). RENAME COLUMN preserves all existing data — only the
-- column name changes. The partial index's column reference + predicate
-- follow the column automatically; we rename the index itself for clarity.

-- Guarded so the migration is safe to re-run (RENAME COLUMN has no IF EXISTS):
-- only rename when the old column still exists and the new one doesn't.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'district'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'state'
  ) THEN
    ALTER TABLE public.contacts RENAME COLUMN district TO state;
  END IF;
END $$;

ALTER INDEX IF EXISTS idx_contacts_district RENAME TO idx_contacts_state;
