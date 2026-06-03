-- Phase 5: AI website generation & auto-deployment support
-- Adds AI generation columns to proposals, new deployments table

-- ─── Make template_id NULLABLE (AI proposals won't have a template) ───
ALTER TABLE public.proposals ALTER COLUMN template_id DROP NOT NULL;

-- ─── Add AI generation columns to proposals ───
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS generation_method TEXT NOT NULL DEFAULT 'template';
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS ai_generated_html TEXT;
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS ai_generation_status TEXT;
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS ai_generation_error TEXT;
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS flagged_for_review BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ;

-- ─── New table: deployments ───
CREATE TABLE public.deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID REFERENCES public.proposals(id) ON DELETE CASCADE,
  site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
  github_repo TEXT NOT NULL,
  github_url TEXT,
  cloudflare_project_id TEXT,
  subdomain TEXT NOT NULL,
  deploy_status TEXT NOT NULL DEFAULT 'pending',
  deploy_error TEXT,
  deployed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Add deployment_id to sites ───
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS deployment_id UUID REFERENCES public.deployments(id) ON DELETE SET NULL;

-- ─── RLS for deployments ───
ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;

-- Super admin: full access
CREATE POLICY "Super admin full access on deployments"
  ON public.deployments FOR ALL
  USING (public.get_my_role() = 'super_admin');

-- Tech admin + administrator: read all
CREATE POLICY "Tech admin and admin read deployments"
  ON public.deployments FOR SELECT
  USING (public.get_my_role() IN ('tech_admin', 'administrator'));

-- Sales: read own (via proposal join)
CREATE POLICY "Sales read own deployments"
  ON public.deployments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id = deployments.proposal_id
      AND p.sales_person_id = auth.uid()
    )
  );

-- Sales: insert own deployments
CREATE POLICY "Sales insert own deployments"
  ON public.deployments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id = proposal_id
      AND p.sales_person_id = auth.uid()
    )
  );

-- Sales: update own deployments
CREATE POLICY "Sales update own deployments"
  ON public.deployments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id = deployments.proposal_id
      AND p.sales_person_id = auth.uid()
    )
  );

-- ─── Index for faster lookups ───
CREATE INDEX IF NOT EXISTS idx_deployments_proposal_id ON public.deployments(proposal_id);
CREATE INDEX IF NOT EXISTS idx_deployments_subdomain ON public.deployments(subdomain);
CREATE INDEX IF NOT EXISTS idx_proposals_flagged ON public.proposals(flagged_for_review) WHERE flagged_for_review = true;
