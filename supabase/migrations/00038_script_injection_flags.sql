-- Fine-grained tracking of which scripts are injected on the deployed site.
-- Each one can be toggled independently by the IT guy in /tech/proposals/[id].
-- Payment widget = proposal-widget.js (payment banner, QR, "I need changes")
-- Contact handler = contact-handler.js (makes contact form send emails)
-- Editor helper  = editor-helper.js (postMessage scroll bridge for iframe)

-- Replaces the binary widget_injected with three separate flags.
-- widget_injected is kept (aliased to payment_widget_injected) for backward compat.

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS contact_handler_injected BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS editor_helper_injected BOOLEAN NOT NULL DEFAULT false;

-- Back-fill: if widget_injected is true, assume all three were injected together (old behavior)
UPDATE public.proposals
  SET contact_handler_injected = true,
      editor_helper_injected = true
  WHERE widget_injected = true;
