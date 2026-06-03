-- AI content generation for the composer.
--
-- Two tables:
--   composer_ai_settings — single-row config (the copywriting guide
--     Peter writes once and tweaks over time; the active provider/model;
--     who edited it last). One row, never multiple. The settings UI
--     edits the existing row in place.
--   ai_generations — append-only log of every generation, for cost
--     tracking + debugging + future credit gating. Keeps the model and
--     a token-cost estimate so super_admin can see real spend even
--     while we're on a free tier.

CREATE TABLE IF NOT EXISTS public.composer_ai_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  copywriting_guide TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'gemini',
  model TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.ai_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  mode TEXT NOT NULL CHECK (mode IN ('all', 'section')),
  section_id TEXT,
  custom_prompt TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INT,
  output_tokens INT,
  cost_estimate_usd NUMERIC(10, 6),
  duration_ms INT,
  status TEXT NOT NULL CHECK (status IN ('success', 'parse_retry', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_generations_site_id_idx
  ON public.ai_generations (site_id);
CREATE INDEX IF NOT EXISTS ai_generations_created_at_idx
  ON public.ai_generations (created_at DESC);

-- Seed the copywriting guide so AI generation works the moment the
-- migration is applied. Super admin can replace via /super/settings/ai
-- without touching code. The seed below is Peter's draft 2026-05-09.
INSERT INTO public.composer_ai_settings (copywriting_guide)
VALUES ($GUIDE$
NO AI FLUFF. NO GENERIC FILLER. NO EM DASHES. Specifically:

- DO NOT write "We are professionals", "We are experts", "We are reliable",
  "We are your trusted partner", "Quality is our priority",
  "Customer satisfaction first", "Years of experience",
  "Best in the industry", or any variant of self-praise.
- DO NOT write empty corporate phrases like "tailored solutions",
  "cutting-edge", "synergy", "passionate team", "we deliver excellence",
  "your vision, our mission".
- DO NOT pad sentences. If a service description can be 12 words,
  do not stretch it to 40.
- DO NOT invent fake stats like "500+ happy clients" or
  "25 years of experience" unless I give them to you.
- DO NOT use em dashes (—) anywhere in the copy. Use commas,
  colons, periods, parentheses, or regular hyphens.

WRITE INSTEAD what the company actually does FOR THE CUSTOMER:

- What problem does this service solve for the visitor?
- What concrete thing does the customer get, receive, or walk away with?
- Where, on what, for whom is this service performed?
- Concrete materials, surfaces, objects, situations, use-cases.

Example, BAD (AI fluff):
  "We are a professional sandblasting company with years of experience
   delivering top-quality results to satisfied customers across Slovakia."

Example, GOOD (concrete, customer-facing):
  "Sandblasting of fences, gates, car bodies, machine parts and steel
   structures. We remove rust, old paint and corrosion so the surface
   is ready for primer or powder coating. We come to you anywhere in
   Slovakia, or you bring the part to our workshop in <city>."

Tone: plain, direct, written for a real customer reading on their phone,
not for a brochure.
$GUIDE$)
ON CONFLICT DO NOTHING;

-- Enable RLS, then apply policies.
-- Super admin manages the row; tech_admin and client read it (so
-- the composer endpoint can fetch it). Regular RLS doesn't need to
-- gate writes here because the API endpoint uses createAdminClient.
ALTER TABLE public.composer_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generations ENABLE ROW LEVEL SECURITY;

-- Settings: any authenticated user can read; only super_admin writes.
DROP POLICY IF EXISTS "ai_settings_read" ON public.composer_ai_settings;
CREATE POLICY "ai_settings_read" ON public.composer_ai_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ai_settings_super_admin_write" ON public.composer_ai_settings;
CREATE POLICY "ai_settings_super_admin_write" ON public.composer_ai_settings
  FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

-- Generations log: super_admin reads everything; users read their own.
-- Inserts always come from the API endpoint via admin client, so no
-- INSERT policy is required.
DROP POLICY IF EXISTS "ai_generations_self_or_super" ON public.ai_generations;
CREATE POLICY "ai_generations_self_or_super" ON public.ai_generations
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'super_admin'
    OR user_id = auth.uid()
  );
