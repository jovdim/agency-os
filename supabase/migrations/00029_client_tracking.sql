-- Client tracking: company registration, billing address, domain lifecycle, billing cycle

-- Add company registration + billing address to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ico TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS dic TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ic_dph TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS billing_street TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS billing_city TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS billing_zip TEXT;

-- Add domain lifecycle + billing cycle to sites
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS domain_expiry_date DATE;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS domain_registrar TEXT;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS domain_renewal_status TEXT DEFAULT 'pending';
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS next_billing_date DATE;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS billing_cycle_months INT DEFAULT 12;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS website_live_date DATE;

-- Client notes table
CREATE TABLE IF NOT EXISTS public.client_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin manages client notes"
  ON public.client_notes FOR ALL
  USING (public.get_my_role() = 'super_admin');

CREATE INDEX IF NOT EXISTS idx_client_notes_profile ON public.client_notes(profile_id, created_at DESC);

-- Index for domain expiry queries
CREATE INDEX IF NOT EXISTS idx_sites_domain_expiry ON public.sites(domain_expiry_date) WHERE domain_expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sites_next_billing ON public.sites(next_billing_date) WHERE next_billing_date IS NOT NULL;
