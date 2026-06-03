-- 00056: Lock credit balance/amount columns as NUMERIC(10,2) and reset to zero.
--
-- Migration 00036 already converted credit *values* to euros via in-place
-- multiplication (1 credit × 12.50 → 12.50€), but never explicitly altered
-- the column types from INT — so the existing DECIMAL math in triggers and
-- code has been quietly relying on PostgreSQL's implicit coercion.
--
-- This migration locks in the euro model now that publish-gating is the
-- new charging surface (no more change_requests for modern clients):
--
--   1. Force NUMERIC(10,2) on credit_balances.balance and
--      credit_transactions.amount. NUMERIC and DECIMAL are aliases —
--      idempotent if 00036 silently coerced columns already.
--   2. Append an `admin_grant`-typed credit_transactions row per site
--      with the negative of the current balance, so the audit trail
--      shows where the money went before we zero everything out.
--   3. Zero every site's balance. Tech admin tops people up via the
--      new +12.50€ button UI as needed (Peter's call: clean slate over
--      preserving values).
--
-- After this, every read site treats `balance` as a euro decimal.

-- ── 1. Lock column types ───────────────────────────────────
ALTER TABLE public.credit_balances
  ALTER COLUMN balance TYPE NUMERIC(10,2) USING balance::numeric,
  ALTER COLUMN balance SET DEFAULT 0;

ALTER TABLE public.credit_transactions
  ALTER COLUMN amount TYPE NUMERIC(10,2) USING amount::numeric;

-- ── 2. Audit-log the reset per non-zero site ───────────────
-- We pin the user_id to the site owner so the row passes the existing
-- "client owns the site" RLS check on credit_transactions reads.
INSERT INTO public.credit_transactions (site_id, user_id, amount, type, note)
SELECT
  cb.site_id,
  s.owner_id,
  -cb.balance,
  'admin_grant'::public.credit_tx_type,
  'Balance reset to 0 € during euro-credits migration (00056). Tech admin will top up via +12.50€ buttons.'
FROM public.credit_balances cb
JOIN public.sites s ON s.id = cb.site_id
WHERE cb.balance <> 0;

-- ── 3. Zero everyone out ───────────────────────────────────
UPDATE public.credit_balances SET balance = 0 WHERE balance <> 0;
