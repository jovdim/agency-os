-- Track whether the payment widget/scripts have been injected into the deployed site.
-- IT guy toggles this ON/OFF via "Inject widget" button in the build workspace.
-- Used to show status badge and prevent unnecessary re-injection.

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS widget_injected BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_proposals_widget_injected
  ON public.proposals(widget_injected)
  WHERE widget_injected = true;
