-- Migration: Toggle for the payment banner widget on the deployed proposal site
--
-- Adds a per-proposal flag that lets the IT guy (or tech admin) hide the
-- BySquare payment banner from the live site. Useful when:
--   - The client has paid offline / outside the dashboard
--   - The boss wants to demo a clean version of the site without the banner
--   - The widget is misbehaving on a particular template
--
-- The render pipeline (src/lib/templates/render.ts) already gates the
-- proposal-widget script on proposal status (`sent` / `viewed`). Adding
-- `show_banner` as an additional AND condition lets us suppress the banner
-- without changing the proposal lifecycle.
--
-- Defaults to TRUE so existing proposals keep their current behavior.

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS show_banner BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.proposals.show_banner IS
  'When false, the payment banner widget is omitted from the deployed proposal site even when status is sent/viewed.';
