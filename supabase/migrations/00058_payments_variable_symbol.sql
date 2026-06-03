-- 00058: Add variable_symbol column to payments table for credit-purchase tracking.
--
-- Background: proposal payments are looked up by `proposals.variable_symbol`
-- when SLSP bank emails arrive. Credit-purchase payments use a different
-- VS scheme (generateCreditVariableSymbol — starts with "9") which has
-- no DB table to look up against — so until now the auto-confirm cron
-- silently failed for every credit purchase.
--
-- This migration gives the payments table its own variable_symbol column
-- so credit-purchase QRs can store the VS at generation time and the
-- cron can match against it. Indexed because the cron does an `eq`
-- lookup on every incoming email.
--
-- Idempotent re-run: ADD COLUMN IF NOT EXISTS guards re-application.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS variable_symbol TEXT;

COMMENT ON COLUMN public.payments.variable_symbol IS
  'BySquare VS the customer used to pay. For credit-purchase rows this is set at QR-generation time so auto-confirm can match the bank email back to the pending payment. NULL on legacy rows + Stripe rows (those go through webhook, no VS needed).';

-- Partial index — only payments with a VS are searchable by it. Keeps
-- the index small (Stripe / legacy rows skip it).
CREATE INDEX IF NOT EXISTS idx_payments_variable_symbol
  ON public.payments(variable_symbol)
  WHERE variable_symbol IS NOT NULL;
