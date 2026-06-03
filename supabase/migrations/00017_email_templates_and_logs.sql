-- Email templates (reusable by salespeople)
CREATE TABLE public.email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT false,
  category TEXT NOT NULL DEFAULT 'follow_up',  -- 'proposal' | 'follow_up'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sales see own email templates"
  ON email_templates FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Sales manage own email templates"
  ON email_templates FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Email log per proposal
CREATE TABLE public.proposal_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  sent_by UUID NOT NULL REFERENCES public.profiles(id),
  email_type TEXT NOT NULL DEFAULT 'follow_up',  -- 'proposal' | 'follow_up'
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE proposal_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sales see own proposal emails"
  ON proposal_emails FOR SELECT
  USING (sent_by = auth.uid());

CREATE POLICY "Service role manages proposal emails"
  ON proposal_emails FOR ALL
  USING (auth.role() = 'service_role');
