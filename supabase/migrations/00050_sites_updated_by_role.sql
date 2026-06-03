-- Track which TEAM (not which person) last touched a site's composition.
-- Drives the stale-data banner in the composer: when a tech_admin and a
-- client both have the composer open and one of them saves, the other
-- side polls /api/sites/[id]/version, sees a newer updated_at, and the
-- banner can name the responsible team ("Client just published changes
-- — Refresh to see them") instead of a generic "someone changed it."
--
-- Per-team granularity is intentional — Peter's `feedback_team_attribution`
-- memory: never display personal names in audit-style UI, always the role
-- group. Mirrors `roleToTeam()` in src/components/composer/publish-menu.tsx
-- (IT team / Salesperson / Client / Admin).
--
-- Additive. Safe to apply on a populated table.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS updated_by_role TEXT;

-- Backfill existing rows so the banner has something sensible to show
-- on the first load after the migration. owner_id's profile.role is the
-- best heuristic for "who last touched this": for non-legacy sites the
-- composer flow always has the owner role match the editor role.
UPDATE public.sites s
SET updated_by_role = p.role
FROM public.profiles p
WHERE p.id = s.owner_id
  AND s.updated_by_role IS NULL;
