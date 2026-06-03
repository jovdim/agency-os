-- Migration 00007_fix: Add message_type column if missing from proposal_messages
--
-- Context: The original 00007 migration was run before the column was renamed
-- from "type" to "message_type". This fix handles databases where:
--   a) The table exists but has "type" instead of "message_type"
--   b) The table exists but is missing "message_type" entirely
--   c) The enum type doesn't exist yet
--
-- Safe to run multiple times (all statements use IF NOT EXISTS / IF EXISTS).

-- 1. Create the enum if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_type') THEN
    CREATE TYPE public.message_type AS ENUM ('message', 'revision_request', 'status_update');
  END IF;
END$$;

-- 2. If the old "type" column exists, rename it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'proposal_messages' AND column_name = 'type'
  ) THEN
    ALTER TABLE proposal_messages RENAME COLUMN type TO message_type;
  END IF;
END$$;

-- 3. If message_type column still doesn't exist (table was created without either), add it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'proposal_messages' AND column_name = 'message_type'
  ) THEN
    ALTER TABLE proposal_messages ADD COLUMN message_type public.message_type NOT NULL DEFAULT 'message';
  END IF;
END$$;

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
