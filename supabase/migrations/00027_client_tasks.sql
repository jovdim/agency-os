-- Client Tasks table for Admin Management Desk
-- Boss tracks: what clients bought, how much, done/not done, notes

CREATE TABLE IF NOT EXISTS public.client_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL,
  service_type TEXT NOT NULL DEFAULT 'website',
  amount NUMERIC,
  paid_at TIMESTAMPTZ,
  is_done BOOLEAN DEFAULT false,
  done_at TIMESTAMPTZ,
  notes TEXT,
  needs_attention BOOLEAN DEFAULT false,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.client_tasks ENABLE ROW LEVEL SECURITY;

-- Super admin and administrator can do everything
CREATE POLICY "admin_all_client_tasks" ON public.client_tasks
  FOR ALL USING (public.get_my_role() IN ('super_admin', 'administrator'));

-- Tech admin can read tasks assigned to them
CREATE POLICY "tech_read_client_tasks" ON public.client_tasks
  FOR SELECT USING (
    public.get_my_role() = 'tech_admin'
    AND (assigned_to = auth.uid() OR needs_attention = true)
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_client_tasks_is_done ON public.client_tasks(is_done);
CREATE INDEX IF NOT EXISTS idx_client_tasks_service_type ON public.client_tasks(service_type);
CREATE INDEX IF NOT EXISTS idx_client_tasks_created_at ON public.client_tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_tasks_needs_attention ON public.client_tasks(needs_attention) WHERE needs_attention = true;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_client_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER client_tasks_updated_at
  BEFORE UPDATE ON public.client_tasks
  FOR EACH ROW EXECUTE FUNCTION update_client_tasks_updated_at();
