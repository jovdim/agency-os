-- Calling System Updates
-- Extends contact statuses and call outcomes for the calling database
-- NOTE: Must be run in 2 parts due to PostgreSQL enum limitation
--       (new enum values can't be used in indexes in the same transaction)

-- ============ PART 1: Run first ============

-- Add new contact statuses
ALTER TYPE contact_status ADD VALUE IF NOT EXISTS 'not_interested';
ALTER TYPE contact_status ADD VALUE IF NOT EXISTS 'callback';
ALTER TYPE contact_status ADD VALUE IF NOT EXISTS 'needs_ecommerce';
ALTER TYPE contact_status ADD VALUE IF NOT EXISTS 'local_market';
ALTER TYPE contact_status ADD VALUE IF NOT EXISTS 'send_invoice';

-- Add new call outcomes
ALTER TYPE call_outcome ADD VALUE IF NOT EXISTS 'not_interested';
ALTER TYPE call_outcome ADD VALUE IF NOT EXISTS 'needs_ecommerce';
ALTER TYPE call_outcome ADD VALUE IF NOT EXISTS 'local_market';
ALTER TYPE call_outcome ADD VALUE IF NOT EXISTS 'send_invoice';
ALTER TYPE call_outcome ADD VALUE IF NOT EXISTS 'handed_over';
ALTER TYPE call_outcome ADD VALUE IF NOT EXISTS 'whatsapp_sent';
ALTER TYPE call_outcome ADD VALUE IF NOT EXISTS 'note';

-- Add local market flag to contacts
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS is_local_market BOOLEAN DEFAULT false;

-- ============ PART 2: Run separately after Part 1 is committed ============

-- Index for calling page queries (unprocessed contacts per salesperson)
CREATE INDEX IF NOT EXISTS idx_contacts_status_assigned ON public.contacts(status, assigned_to) WHERE status = 'new';
CREATE INDEX IF NOT EXISTS idx_contacts_callback ON public.contacts(status, assigned_to) WHERE status = 'callback';
CREATE INDEX IF NOT EXISTS idx_contacts_local_market ON public.contacts(is_local_market) WHERE is_local_market = true;

-- Index for call logs per salesperson per day
CREATE INDEX IF NOT EXISTS idx_call_logs_salesperson_date ON public.call_logs(sales_person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_contact ON public.call_logs(contact_id, created_at DESC);
