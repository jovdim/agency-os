-- Invoice requests from salespeople to super admin
CREATE TABLE IF NOT EXISTS public.invoice_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  sales_person_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  message TEXT NOT NULL,
  is_done BOOLEAN DEFAULT false,
  admin_response TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sales can create invoice requests"
  ON public.invoice_requests FOR INSERT
  WITH CHECK (public.get_my_role() IN ('sales', 'super_admin'));

CREATE POLICY "Super admin manages invoice requests"
  ON public.invoice_requests FOR ALL
  USING (public.get_my_role() = 'super_admin');

CREATE POLICY "Sales can see own invoice requests"
  ON public.invoice_requests FOR SELECT
  USING (sales_person_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_invoice_requests_pending ON public.invoice_requests(is_done, created_at DESC) WHERE is_done = false;
