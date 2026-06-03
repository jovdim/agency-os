-- SK Agency Operating System - Initial Schema
-- All tables, enums, triggers, indexes, and RLS policies

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE public.user_role AS ENUM (
  'client', 'sales', 'tech_admin', 'administrator', 'super_admin'
);

CREATE TYPE public.contact_status AS ENUM (
  'new', 'no_answer', 'not_exists', 'interested', 'send_proposal',
  'send_email', 'directory_note', 'converted'
);

CREATE TYPE public.call_outcome AS ENUM (
  'no_answer', 'not_exists', 'interested', 'send_proposal',
  'send_email', 'directory_note', 'callback'
);

CREATE TYPE public.proposal_status AS ENUM (
  'draft', 'sent', 'viewed', 'accepted', 'declined'
);

CREATE TYPE public.website_status AS ENUM (
  'proposal', 'queued', 'building', 'live', 'suspended'
);

CREATE TYPE public.change_request_status AS ENUM (
  'pending', 'approved', 'rejected'
);

CREATE TYPE public.payment_status AS ENUM (
  'pending', 'confirmed', 'failed'
);

CREATE TYPE public.invoice_type AS ENUM (
  'proforma', 'invoice'
);

CREATE TYPE public.credit_tx_type AS ENUM (
  'purchase', 'admin_grant', 'submission_deduct', 'rejection_refund'
);

-- ============================================================
-- TABLES
-- ============================================================

-- 1. Profiles (extends auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.user_role NOT NULL DEFAULT 'client',
  full_name TEXT NOT NULL,
  phone TEXT,
  company_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Contacts (CRM)
CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  website_url TEXT,
  industry TEXT,
  town TEXT,
  location TEXT,
  status public.contact_status NOT NULL DEFAULT 'new',
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  notes TEXT,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Call Logs
CREATE TABLE public.call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  sales_person_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  outcome public.call_outcome NOT NULL,
  notes TEXT,
  callback_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Templates
CREATE TABLE public.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  industry TEXT NOT NULL,
  design_variant TEXT NOT NULL DEFAULT 'default',
  storage_path TEXT NOT NULL,
  thumbnail_path TEXT,
  color_scheme JSONB,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Proposals
CREATE TABLE public.proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  sales_person_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.templates(id),
  company_name TEXT NOT NULL,
  industry TEXT,
  town TEXT,
  services JSONB DEFAULT '[]',
  content_overrides JSONB DEFAULT '{}',
  status public.proposal_status NOT NULL DEFAULT 'draft',
  price DECIMAL(10,2),
  viewed_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Sites
CREATE TABLE public.sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  site_url TEXT,
  codebase_link TEXT,
  domain TEXT,
  status public.website_status NOT NULL DEFAULT 'queued',
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  proposal_id UUID REFERENCES public.proposals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Sections
CREATE TABLE public.sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  "order" INT NOT NULL DEFAULT 0,
  fields JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Change Requests
CREATE TABLE public.change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status public.change_request_status NOT NULL DEFAULT 'pending',
  changes JSONB NOT NULL DEFAULT '[]',
  admin_note TEXT,
  processed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. Credit Balances
CREATE TABLE public.credit_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID UNIQUE NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  balance INT NOT NULL DEFAULT 0
);

-- 10. Payments
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  payment_method TEXT,
  square_payment_id TEXT,
  status public.payment_status NOT NULL DEFAULT 'pending',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. Credit Transactions
CREATE TABLE public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  amount INT NOT NULL,
  type public.credit_tx_type NOT NULL,
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 12. Invoices
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT UNIQUE NOT NULL,
  type public.invoice_type NOT NULL,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL,
  vat_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  line_items JSONB NOT NULL DEFAULT '[]',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  pdf_path TEXT
);

-- 13. Services
CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  starts_at DATE,
  expires_at DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  price DECIMAL(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 14. Commissions
CREATE TABLE public.commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_person_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  proposal_id UUID REFERENCES public.proposals(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL,
  is_paid BOOLEAN NOT NULL DEFAULT false,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 15. Audit Log
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_contacts_assigned_to ON public.contacts(assigned_to);
CREATE INDEX idx_contacts_status ON public.contacts(status);
CREATE INDEX idx_contacts_industry ON public.contacts(industry);
CREATE INDEX idx_call_logs_contact_id ON public.call_logs(contact_id);
CREATE INDEX idx_call_logs_sales_person ON public.call_logs(sales_person_id);
CREATE INDEX idx_call_logs_callback ON public.call_logs(callback_at) WHERE callback_at IS NOT NULL;
CREATE INDEX idx_proposals_sales_person ON public.proposals(sales_person_id);
CREATE INDEX idx_proposals_status ON public.proposals(status);
CREATE INDEX idx_sites_owner ON public.sites(owner_id);
CREATE INDEX idx_sites_status ON public.sites(status);
CREATE INDEX idx_sections_site_order ON public.sections(site_id, "order");
CREATE INDEX idx_change_requests_site ON public.change_requests(site_id);
CREATE INDEX idx_change_requests_status ON public.change_requests(status);
CREATE INDEX idx_change_requests_user ON public.change_requests(user_id);
CREATE INDEX idx_credit_transactions_site ON public.credit_transactions(site_id);
CREATE INDEX idx_payments_profile ON public.payments(profile_id);
CREATE INDEX idx_invoices_profile ON public.invoices(profile_id);
CREATE INDEX idx_commissions_sales_person ON public.commissions(sales_person_id);
CREATE INDEX idx_audit_log_user ON public.audit_log(user_id);
CREATE INDEX idx_audit_log_entity ON public.audit_log(entity_type, entity_id);
CREATE INDEX idx_services_site ON public.services(site_id);
CREATE INDEX idx_services_expires ON public.services(expires_at) WHERE is_active = true;

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Helper: get current user role from JWT
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name)
  VALUES (
    NEW.id,
    COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'client'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );
  RETURN NEW;
END;
$$;

-- Custom JWT claims hook: inject user_role into access token
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims JSONB;
  user_role public.user_role;
BEGIN
  SELECT role INTO user_role FROM public.profiles WHERE id = (event->>'user_id')::UUID;

  claims := event->'claims';

  IF user_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
  ELSE
    claims := jsonb_set(claims, '{user_role}', '"client"');
  END IF;

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-create profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at triggers
CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_contacts
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_proposals
  BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_sites
  BEFORE UPDATE ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_change_requests
  BEFORE UPDATE ON public.change_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ─── PROFILES ───
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.get_my_role() IN ('administrator', 'super_admin'));

CREATE POLICY "Super admin can manage profiles"
  ON public.profiles FOR ALL
  USING (public.get_my_role() = 'super_admin');

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ─── CONTACTS ───
CREATE POLICY "Sales see own contacts"
  ON public.contacts FOR SELECT
  USING (assigned_to = auth.uid());

CREATE POLICY "Admins see all contacts"
  ON public.contacts FOR SELECT
  USING (public.get_my_role() IN ('administrator', 'super_admin'));

CREATE POLICY "Sales manage own contacts"
  ON public.contacts FOR UPDATE
  USING (assigned_to = auth.uid());

CREATE POLICY "Sales can insert contacts"
  ON public.contacts FOR INSERT
  WITH CHECK (public.get_my_role() IN ('sales', 'administrator', 'super_admin'));

CREATE POLICY "Super admin manages all contacts"
  ON public.contacts FOR ALL
  USING (public.get_my_role() = 'super_admin');

-- ─── CALL LOGS ───
CREATE POLICY "Sales see own call logs"
  ON public.call_logs FOR SELECT
  USING (sales_person_id = auth.uid());

CREATE POLICY "Sales insert own call logs"
  ON public.call_logs FOR INSERT
  WITH CHECK (sales_person_id = auth.uid());

CREATE POLICY "Admins see all call logs"
  ON public.call_logs FOR SELECT
  USING (public.get_my_role() IN ('administrator', 'super_admin'));

-- ─── TEMPLATES ───
CREATE POLICY "Authenticated users can view active templates"
  ON public.templates FOR SELECT
  USING (is_active = true AND auth.uid() IS NOT NULL);

CREATE POLICY "Super admin manages templates"
  ON public.templates FOR ALL
  USING (public.get_my_role() = 'super_admin');

-- ─── PROPOSALS ───
CREATE POLICY "Sales see own proposals"
  ON public.proposals FOR SELECT
  USING (sales_person_id = auth.uid());

CREATE POLICY "Sales manage own proposals"
  ON public.proposals FOR ALL
  USING (sales_person_id = auth.uid());

CREATE POLICY "Admins see all proposals"
  ON public.proposals FOR SELECT
  USING (public.get_my_role() IN ('administrator', 'super_admin'));

-- ─── SITES ───
CREATE POLICY "Clients see own sites"
  ON public.sites FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Tech admin sees all sites"
  ON public.sites FOR SELECT
  USING (public.get_my_role() IN ('tech_admin', 'administrator', 'super_admin'));

CREATE POLICY "Tech admin manages sites"
  ON public.sites FOR UPDATE
  USING (public.get_my_role() IN ('tech_admin', 'super_admin'));

CREATE POLICY "Super admin full site access"
  ON public.sites FOR ALL
  USING (public.get_my_role() = 'super_admin');

-- ─── SECTIONS ───
CREATE POLICY "Site owner sees sections"
  ON public.sections FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.sites WHERE sites.id = sections.site_id AND sites.owner_id = auth.uid()
  ));

CREATE POLICY "Tech admin sees all sections"
  ON public.sections FOR SELECT
  USING (public.get_my_role() IN ('tech_admin', 'super_admin'));

CREATE POLICY "Tech admin manages sections"
  ON public.sections FOR ALL
  USING (public.get_my_role() IN ('tech_admin', 'super_admin'));

-- ─── CHANGE REQUESTS ───
CREATE POLICY "Users see own change requests"
  ON public.change_requests FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can submit change requests"
  ON public.change_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Tech admin sees all change requests"
  ON public.change_requests FOR SELECT
  USING (public.get_my_role() IN ('tech_admin', 'administrator', 'super_admin'));

CREATE POLICY "Tech admin manages change requests"
  ON public.change_requests FOR UPDATE
  USING (public.get_my_role() IN ('tech_admin', 'super_admin'));

-- ─── CREDIT BALANCES ───
CREATE POLICY "Site owner sees credit balance"
  ON public.credit_balances FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.sites WHERE sites.id = credit_balances.site_id AND sites.owner_id = auth.uid()
  ));

CREATE POLICY "Admin sees all credit balances"
  ON public.credit_balances FOR SELECT
  USING (public.get_my_role() IN ('tech_admin', 'administrator', 'super_admin'));

CREATE POLICY "Super admin manages credit balances"
  ON public.credit_balances FOR ALL
  USING (public.get_my_role() = 'super_admin');

-- ─── CREDIT TRANSACTIONS ───
CREATE POLICY "Site owner sees own transactions"
  ON public.credit_transactions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.sites WHERE sites.id = credit_transactions.site_id AND sites.owner_id = auth.uid()
  ));

CREATE POLICY "Admin sees all transactions"
  ON public.credit_transactions FOR SELECT
  USING (public.get_my_role() IN ('administrator', 'super_admin'));

-- ─── PAYMENTS ───
CREATE POLICY "Users see own payments"
  ON public.payments FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Admin sees all payments"
  ON public.payments FOR SELECT
  USING (public.get_my_role() IN ('administrator', 'super_admin'));

CREATE POLICY "Super admin manages payments"
  ON public.payments FOR ALL
  USING (public.get_my_role() = 'super_admin');

-- ─── INVOICES ───
CREATE POLICY "Users see own invoices"
  ON public.invoices FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Admin sees all invoices"
  ON public.invoices FOR SELECT
  USING (public.get_my_role() IN ('administrator', 'super_admin'));

CREATE POLICY "Super admin manages invoices"
  ON public.invoices FOR ALL
  USING (public.get_my_role() = 'super_admin');

-- ─── SERVICES ───
CREATE POLICY "Site owner sees own services"
  ON public.services FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.sites WHERE sites.id = services.site_id AND sites.owner_id = auth.uid()
  ));

CREATE POLICY "Admin sees all services"
  ON public.services FOR SELECT
  USING (public.get_my_role() IN ('administrator', 'super_admin'));

CREATE POLICY "Super admin manages services"
  ON public.services FOR ALL
  USING (public.get_my_role() = 'super_admin');

-- ─── COMMISSIONS ───
CREATE POLICY "Sales see own commissions"
  ON public.commissions FOR SELECT
  USING (sales_person_id = auth.uid());

CREATE POLICY "Admin sees all commissions"
  ON public.commissions FOR SELECT
  USING (public.get_my_role() IN ('administrator', 'super_admin'));

CREATE POLICY "Super admin manages commissions"
  ON public.commissions FOR ALL
  USING (public.get_my_role() = 'super_admin');

-- ─── AUDIT LOG ───
CREATE POLICY "Super admin reads audit log"
  ON public.audit_log FOR SELECT
  USING (public.get_my_role() = 'super_admin');

-- Audit log inserts should be done via service role (server-side only)
-- No INSERT policy for regular users

-- ============================================================
-- GRANT USAGE ON CUSTOM JWT HOOK
-- ============================================================

-- Grant usage so auth can call the hook
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
