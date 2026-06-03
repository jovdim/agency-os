-- ============================================================
-- Sales Commission Rates & Enhanced Commissions
-- ============================================================

-- Commission rates per salesperson per type
-- Allows different rates for website_sale vs other (credits, services)
CREATE TABLE IF NOT EXISTS public.commission_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_person_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  commission_type TEXT NOT NULL DEFAULT 'website_sale',  -- 'website_sale' or 'other'
  rate DECIMAL(5,4) NOT NULL DEFAULT 0.10,              -- e.g. 0.10 = 10%, 0.20 = 20%
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sales_person_id, commission_type)
);

-- Add columns to existing commissions table
ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS rate DECIMAL(5,4),
  ADD COLUMN IF NOT EXISTS commission_type TEXT DEFAULT 'website_sale';

-- RLS for commission_rates
ALTER TABLE public.commission_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sales see own commission rates"
  ON public.commission_rates FOR SELECT
  USING (sales_person_id = auth.uid());

CREATE POLICY "Admin sees all commission rates"
  ON public.commission_rates FOR SELECT
  USING (public.get_my_role() IN ('administrator', 'super_admin'));

CREATE POLICY "Super admin manages commission rates"
  ON public.commission_rates FOR ALL
  USING (public.get_my_role() = 'super_admin');

CREATE POLICY "Admin manages commission rates"
  ON public.commission_rates FOR ALL
  USING (public.get_my_role() = 'administrator');

-- Index
CREATE INDEX IF NOT EXISTS idx_commission_rates_sales_person ON public.commission_rates(sales_person_id);
