-- 00065_proposals_show_banner_default_false.sql
--
-- Flip the `proposals.show_banner` column default from TRUE to FALSE
-- so the payment banner becomes OPT-IN at publish time.
--
-- Background: 00048 added the column with `DEFAULT TRUE`, which meant
-- every new proposal got the banner script auto-injected on the first
-- publish — before sales had configured a discount / base price /
-- expiry. The widget then rendered with default/empty pricing on the
-- live site until someone manually disabled it or set up the prices.
--
-- New behavior (Peter 2026-05-15): the banner stays OFF until sales
-- explicitly opens the BannerConfigDialog, fills in the prices, and
-- toggles it on. That dialog already sets `show_banner = TRUE` and
-- triggers an auto-republish, so the deployed HTML and the DB flag
-- stay in lock-step.
--
-- We only change the DEFAULT — existing rows are left alone. Sites
-- that are currently `show_banner = TRUE` (sales already configured
-- the banner under the old behavior) continue rendering the widget.
-- Sites that explicitly have it FALSE stay disabled. Only NEW
-- proposals inserted after this migration get the new default.

ALTER TABLE public.proposals
  ALTER COLUMN show_banner SET DEFAULT FALSE;

COMMENT ON COLUMN public.proposals.show_banner IS
  'Opt-in flag for the payment banner widget. Renderer injects the proposal-widget.js script ONLY when this is TRUE. Flipped to TRUE by the BannerConfigDialog after sales configures discount + base prices. Default FALSE since 00065 — previously default TRUE caused the banner to ship on first publish with unconfigured prices.';
