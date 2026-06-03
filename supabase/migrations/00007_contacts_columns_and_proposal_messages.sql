-- Migration 00007: Add missing contact columns + proposal_messages table
--
-- 1. Add social_links, quoted_price, client_status to contacts
-- 2. Create proposal_messages table for sales<->tech communication
-- 3. RLS policies for proposal_messages

-- ============================================================
-- 1. Add missing columns to contacts
-- ============================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS social_links TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS quoted_price DECIMAL(10,2);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS client_status TEXT;

-- ============================================================
-- 2. Proposal Messages — threaded communication
-- ============================================================

-- Message types: message (general), revision_request (sales asking for changes), status_update (auto)
CREATE TYPE public.message_type AS ENUM ('message', 'revision_request', 'status_update');

CREATE TABLE public.proposal_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sender_role public.user_role NOT NULL,
  message TEXT NOT NULL,
  message_type public.message_type NOT NULL DEFAULT 'message',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_proposal_messages_proposal ON proposal_messages(proposal_id);
CREATE INDEX idx_proposal_messages_created ON proposal_messages(created_at);

-- Enable RLS
ALTER TABLE proposal_messages ENABLE ROW LEVEL SECURITY;

-- Sales can read messages on their own proposals
CREATE POLICY "Sales can read own proposal messages"
  ON proposal_messages FOR SELECT
  TO authenticated
  USING (
    (SELECT get_my_role()) = 'sales'
    AND proposal_id IN (
      SELECT id FROM proposals WHERE sales_person_id = auth.uid()
    )
  );

-- Sales can insert messages on their own proposals
CREATE POLICY "Sales can insert own proposal messages"
  ON proposal_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT get_my_role()) = 'sales'
    AND sender_id = auth.uid()
    AND proposal_id IN (
      SELECT id FROM proposals WHERE sales_person_id = auth.uid()
    )
  );

-- Tech admin can read all proposal messages
CREATE POLICY "Tech admin can read proposal messages"
  ON proposal_messages FOR SELECT
  TO authenticated
  USING ((SELECT get_my_role()) = 'tech_admin');

-- Tech admin can insert messages on any proposal
CREATE POLICY "Tech admin can insert proposal messages"
  ON proposal_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT get_my_role()) = 'tech_admin'
    AND sender_id = auth.uid()
  );

-- Admin/super can read all messages
CREATE POLICY "Admin roles can read proposal messages"
  ON proposal_messages FOR SELECT
  TO authenticated
  USING ((SELECT get_my_role()) IN ('administrator', 'super_admin'));
