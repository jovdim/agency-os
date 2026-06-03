-- Migration: Proposal Handover — payment links, pricing, reminders
-- Adds columns needed for the sales landing page + QR payment flow

-- 1. Add 'paid' to proposal_status enum
ALTER TYPE proposal_status ADD VALUE IF NOT EXISTS 'paid' AFTER 'accepted';

-- 2. New columns on proposals for handover flow
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS greeting_text TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS discount_price DECIMAL(10,2);
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS base_price DECIMAL(10,2) DEFAULT 299;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS discount_expires_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS payment_link_url TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS payment_link_id TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- 3. Add proposal_id to payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS proposal_id UUID REFERENCES proposals(id) ON DELETE SET NULL;

-- 4. Proposal reminders table for follow-up tracking
CREATE TABLE IF NOT EXISTS proposal_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  sales_person_id UUID NOT NULL REFERENCES profiles(id),
  reminder_type TEXT NOT NULL,  -- 'day_4', 'day_10', 'day_14_expired', 'day_30_cleanup'
  due_at TIMESTAMPTZ NOT NULL,
  is_dismissed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS for proposal_reminders
ALTER TABLE proposal_reminders ENABLE ROW LEVEL SECURITY;

-- Sales see own reminders
CREATE POLICY "Sales see own reminders"
  ON proposal_reminders FOR SELECT
  USING (
    sales_person_id = auth.uid()
    OR get_my_role() IN ('administrator', 'super_admin')
  );

-- Sales can update (dismiss) own reminders
CREATE POLICY "Sales dismiss own reminders"
  ON proposal_reminders FOR UPDATE
  USING (sales_person_id = auth.uid())
  WITH CHECK (sales_person_id = auth.uid());

-- Service role can insert/delete
CREATE POLICY "Service role manages reminders"
  ON proposal_reminders FOR ALL
  USING (auth.role() = 'service_role');
