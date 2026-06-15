-- Direct publish charge for the per-site /admin editor (no approval step).
--
-- The old client flow charged 12.50 € per publish at request-submit time via
-- create_publish_request (00077), which also inserted a publish_requests row
-- for an IT admin to approve. The new dynamic platform lets the client publish
-- DIRECTLY from theirdomain.com/admin, so we want the same money behaviour
-- (gate on paid + sufficient balance, deduct, log a publish_charge tx) WITHOUT
-- the approval machinery — and we fold the draft→live copy into the same
-- transaction so a client can never be charged without the publish landing.
--
-- Raises 'SITE_NOT_PAID' / 'INSUFFICIENT_CREDITS' on the corresponding gate;
-- the route maps both to HTTP 402.

CREATE OR REPLACE FUNCTION public.platform_publish_charge(
  p_site_id      UUID,
  p_user_id      UUID,     -- the site owner (for the credit_transactions row); may be NULL
  p_publish_cost NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_paid     BOOLEAN;
  v_balance     NUMERIC;
  v_new_balance NUMERIC;
  v_unchanged   BOOLEAN;
BEGIN
  -- Gate 1: the site fee must already be paid.
  SELECT is_paid INTO v_is_paid FROM public.sites WHERE id = p_site_id;
  IF v_is_paid IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'SITE_NOT_PAID';
  END IF;

  -- Ensure a balance row exists so the lock + deduct always have a target
  -- (defensive for legacy sites that never received a starter grant).
  INSERT INTO public.credit_balances (site_id, balance)
  VALUES (p_site_id, 0)
  ON CONFLICT (site_id) DO NOTHING;

  -- Lock the balance row so two concurrent publishes can't double-spend.
  SELECT balance INTO v_balance
  FROM public.credit_balances
  WHERE site_id = p_site_id
  FOR UPDATE;

  -- No-op / retry guard: if the draft already equals the live copy there's
  -- nothing new to publish — don't charge again. Covers a lost-response retry
  -- and a republish with no edits (free no-op).
  SELECT composition IS NOT DISTINCT FROM published_composition
    INTO v_unchanged
  FROM public.sites
  WHERE id = p_site_id;
  IF v_unchanged THEN
    RETURN jsonb_build_object('new_balance', v_balance, 'charged', false);
  END IF;

  -- Gate 2: enough credit for a real publish.
  IF v_balance IS NULL OR v_balance + 0.005 < p_publish_cost THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;

  -- Deduct + record the charge (same shape as create_publish_request).
  v_new_balance := ROUND(v_balance - p_publish_cost, 2);
  UPDATE public.credit_balances SET balance = v_new_balance WHERE site_id = p_site_id;

  INSERT INTO public.credit_transactions (site_id, user_id, amount, type, note)
  VALUES (p_site_id, p_user_id, -p_publish_cost, 'publish_charge', 'Website publish');

  -- Publish: copy the draft composition into the live column, atomically with
  -- the charge above. The public tenant renderer reads published_composition.
  UPDATE public.sites
  SET published_composition = composition,
      last_published_at = now()
  WHERE id = p_site_id;

  RETURN jsonb_build_object('new_balance', v_new_balance, 'charged', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_publish_charge(UUID, UUID, NUMERIC)
  TO service_role;
