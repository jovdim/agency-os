-- Add business_email to contacts table
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS business_email TEXT;

-- Contact form submissions table
CREATE TABLE public.contact_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_phone TEXT,
  message TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;

-- Super admin can see all submissions
CREATE POLICY "super_admin_all_contact_submissions" ON public.contact_submissions
  FOR ALL USING (public.get_my_role() = 'super_admin');

-- Tech admin can see all submissions
CREATE POLICY "tech_admin_read_contact_submissions" ON public.contact_submissions
  FOR SELECT USING (public.get_my_role() = 'tech_admin');

-- Allow anonymous inserts (from public contact forms)
CREATE POLICY "anon_insert_contact_submissions" ON public.contact_submissions
  FOR INSERT WITH CHECK (true);

-- Index for rate limiting lookups
CREATE INDEX idx_contact_submissions_ip_created ON public.contact_submissions(ip_address, created_at DESC);
