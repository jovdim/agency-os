-- 00046_proposal_tags.sql
--
-- Proposal tagging: salespersons can label proposals with one-or-more tags
-- (Urgent / Priority / Premium / Basic / custom) for fast triage on the
-- proposal list, the detail page, the sales dashboard, and the super-admin
-- oversight view.
--
-- Design notes:
--   - Tags are SHARED across the team (one library for the whole agency,
--     not per-user). When a salesperson creates a tag on the fly it
--     becomes available to everyone — easy cross-sales coordination.
--   - Many-to-many via a join table (a proposal can have N tags, a tag can
--     be on M proposals).
--   - "Urgent" is just a built-in tag, not a special boolean column. We
--     seed the four defaults via slug so the UI can find them by a stable
--     identifier even after a rename.
--   - color is a Tailwind hue keyword ("red", "orange", "purple", …) —
--     resolved to actual classes in the React components. Storing the
--     keyword (not the full class string) keeps the DB free of presentation
--     details and lets us swap palettes later without a migration.

-- ─── Tag library ───
CREATE TABLE IF NOT EXISTS public.proposal_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Display name shown in chips and the picker. Unique per slug, not name,
  -- so "Urgent" and "urgent" don't both exist.
  name        TEXT NOT NULL,
  -- Stable slug used to find seeded tags from code (e.g. "urgent"). Lower-
  -- case alphanumeric + hyphens. Unique.
  slug        TEXT NOT NULL,
  -- Tailwind hue keyword: red, orange, amber, yellow, green, emerald,
  -- teal, cyan, blue, indigo, violet, purple, pink, rose, gray. The
  -- React component maps this to bg/text/border classes.
  color       TEXT NOT NULL DEFAULT 'gray',
  -- Who created it (null for the seeded defaults). On user delete we keep
  -- the tag — losing the creator attribution is fine, losing the tag is not.
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT proposal_tags_slug_format
    CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'),
  CONSTRAINT proposal_tags_color_known
    CHECK (color IN (
      'red','orange','amber','yellow','green','emerald','teal','cyan',
      'blue','indigo','violet','purple','pink','rose','gray','slate'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS proposal_tags_slug_unique
  ON public.proposal_tags (slug);

-- ─── Many-to-many link to proposals ───
CREATE TABLE IF NOT EXISTS public.proposal_tag_assignments (
  proposal_id  UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  tag_id       UUID NOT NULL REFERENCES public.proposal_tags(id) ON DELETE CASCADE,
  -- Audit who attached it (helpful for "why is this Urgent?" investigations).
  assigned_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, tag_id)
);

-- Reverse-lookup index: "show me all proposals tagged Urgent" filters by
-- tag_id, so a tag-first index is the one that matters most for filtering.
CREATE INDEX IF NOT EXISTS idx_proposal_tag_assignments_tag
  ON public.proposal_tag_assignments (tag_id);

-- ─── RLS ───
ALTER TABLE public.proposal_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_tag_assignments ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read the tag library — chips show in many places
-- (sales, super, even client zone potentially) so we keep this open.
CREATE POLICY "Anyone authenticated can read tags"
  ON public.proposal_tags FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Sales+ can create new tags. Per the chosen UX: sales create on the fly,
-- super admin can clean up later.
CREATE POLICY "Sales+ can create tags"
  ON public.proposal_tags FOR INSERT
  WITH CHECK (public.get_my_role() IN ('sales', 'tech_admin', 'administrator', 'super_admin'));

-- Tag rename / recolor / delete: super_admin always; the original creator
-- can rename their own. Keeps the library tidy without locking sales out
-- of fixing typos.
CREATE POLICY "Super admin manages all tags"
  ON public.proposal_tags FOR ALL
  USING (public.get_my_role() = 'super_admin');

CREATE POLICY "Creators can edit own tags"
  ON public.proposal_tags FOR UPDATE
  USING (created_by = auth.uid());

-- ─── Assignments RLS ───
-- Read: anyone who can see the proposal can see its tags. We delegate by
-- joining to proposals and reusing its row-level policy.
CREATE POLICY "Read assignments for visible proposals"
  ON public.proposal_tag_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id = proposal_tag_assignments.proposal_id
    )
  );

-- Sales can attach/detach on their own proposals; admins on any.
CREATE POLICY "Sales manage tags on own proposals"
  ON public.proposal_tag_assignments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id = proposal_tag_assignments.proposal_id
        AND p.sales_person_id = auth.uid()
    )
    OR public.get_my_role() IN ('tech_admin', 'administrator', 'super_admin')
  );

-- ─── Seed defaults ───
-- The four "out of the box" tags Peter asked for. We use ON CONFLICT DO
-- NOTHING so re-running the migration in dev (or applying it to a DB that
-- already has them) is safe.
INSERT INTO public.proposal_tags (slug, name, color) VALUES
  ('urgent',   'Urgent',   'red'),
  ('priority', 'Priority', 'orange'),
  ('premium',  'Premium',  'purple'),
  ('basic',    'Basic',    'gray')
ON CONFLICT (slug) DO NOTHING;

COMMENT ON TABLE public.proposal_tags IS
  'Shared tag library for proposals (Urgent, Priority, Premium, Basic, plus sales-created custom tags).';
COMMENT ON TABLE public.proposal_tag_assignments IS
  'Many-to-many join: which tags are on which proposals. Cascades delete with both sides.';
