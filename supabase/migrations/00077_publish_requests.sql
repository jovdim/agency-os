-- Client-initiated publish requests (composer era).
--
-- A paid client edits their site in the composer and clicks
-- "Request publish" instead of publishing directly. The request lands
-- here as `pending` AND the 12.50 € is charged immediately at submit
-- time (Peter 2026-05-30 — charge-at-submit, not charge-at-go-live).
-- An IT/tech admin reviews it on the proposal pipeline page
-- (/tech/proposals/[id]) and either:
--   - approves → publishSite() runs, no further charge (already paid),
--                version_id stored on the row
--   - rejects  → 12.50 € refunded, review_note explains why
--
-- Override behavior: a client with a pending request can click submit
-- again at any time. The previous pending row becomes `overridden`
-- (the 12.50 € is forfeit — it was the cost of changing their mind)
-- and a fresh pending row is created with its own 12.50 € charge.
-- IT only ever sees the latest pending row.
--
-- This replaces the old direct client → Cloudflare publish path (the
-- client branch in /api/sites/[id]/publish is now blocked).

CREATE TABLE IF NOT EXISTS public.publish_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  -- The client who requested. SET NULL on profile delete so the
  -- request row (and its audit value) survives a user removal.
  requested_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'overridden')),
  note           TEXT,           -- client's optional "what changed" note
  reviewed_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  review_note    TEXT,           -- IT's reject reason (shown back to client)
  version_id     UUID,           -- site_versions row created on approval
  charged_amount NUMERIC(10, 2), -- € charged at submit (12.50)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most ONE pending request per site. Approve / reject / cancel /
-- override move the row off 'pending' and free the slot for the next
-- request. This is what enforces the override behavior: the RPC below
-- must flip the existing pending → overridden BEFORE inserting the new
-- pending row, otherwise the insert violates this index.
CREATE UNIQUE INDEX IF NOT EXISTS publish_requests_one_pending_per_site
  ON public.publish_requests (site_id)
  WHERE status = 'pending';

-- Live Clients badge + count: "which sites have a pending request".
CREATE INDEX IF NOT EXISTS publish_requests_pending_idx
  ON public.publish_requests (status, created_at DESC);

-- Per-site history (latest request first) — read by the client publish
-- menu (to show pending / rejected state) and the pipeline card.
CREATE INDEX IF NOT EXISTS publish_requests_site_idx
  ON public.publish_requests (site_id, created_at DESC);

-- Reuse the shared updated_at trigger fn from 00001_initial_schema.sql.
CREATE TRIGGER trg_publish_requests_updated_at
  BEFORE UPDATE ON public.publish_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─── RLS ───
-- Every server route touching this table uses the service-role admin
-- client (which bypasses RLS), so these policies are defense-in-depth
-- mirroring the change_requests pattern from 00001.
ALTER TABLE public.publish_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Site owner sees own publish requests"
  ON public.publish_requests FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.sites
    WHERE sites.id = publish_requests.site_id AND sites.owner_id = auth.uid()
  ));

CREATE POLICY "Site owner creates publish requests"
  ON public.publish_requests FOR INSERT
  WITH CHECK (
    requested_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.sites
      WHERE sites.id = publish_requests.site_id AND sites.owner_id = auth.uid()
    )
  );

-- Owner can cancel (UPDATE status → 'cancelled') their own request.
CREATE POLICY "Site owner updates own publish requests"
  ON public.publish_requests FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.sites
    WHERE sites.id = publish_requests.site_id AND sites.owner_id = auth.uid()
  ));

CREATE POLICY "Tech admin sees all publish requests"
  ON public.publish_requests FOR SELECT
  USING (public.get_my_role() IN ('tech_admin', 'administrator', 'super_admin'));

CREATE POLICY "Tech admin manages publish requests"
  ON public.publish_requests FOR UPDATE
  USING (public.get_my_role() IN ('tech_admin', 'super_admin'));


-- ─── Atomic RPCs ─────────────────────────────────────────────────
-- These wrap the charge-and-override-and-insert sequence in a single
-- transaction so we can't end up with a charge but no pending row, or
-- an overridden row with no replacement. The route layer just calls
-- the RPC and translates errors to HTTP codes.

-- create_publish_request: balance check → mark prior pending as
-- overridden (if any) → insert fresh pending → deduct balance → log a
-- publish_charge tx. Raises 'INSUFFICIENT_CREDITS' or 'SITE_NOT_PAID'
-- on the corresponding gate; the route maps those to 402.
CREATE OR REPLACE FUNCTION public.create_publish_request(
  p_site_id UUID,
  p_user_id UUID,
  p_publish_cost NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_paid       BOOLEAN;
  v_balance       NUMERIC;
  v_new_balance   NUMERIC;
  v_overrode_id   UUID;
  v_new_id        UUID;
  v_new_created   TIMESTAMPTZ;
BEGIN
  -- Gate 1: site must be paid (initial site fee already covered).
  SELECT is_paid INTO v_is_paid
  FROM public.sites
  WHERE id = p_site_id;
  IF v_is_paid IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'SITE_NOT_PAID';
  END IF;

  -- Gate 2: client has enough credit. Lock the row so concurrent
  -- requests can't both pass the check and double-spend.
  SELECT balance INTO v_balance
  FROM public.credit_balances
  WHERE site_id = p_site_id
  FOR UPDATE;
  IF v_balance IS NULL OR v_balance + 0.005 < p_publish_cost THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;

  -- Flip any existing pending row → overridden BEFORE inserting the
  -- replacement, so the one-pending-per-site partial unique index
  -- doesn't reject the insert.
  UPDATE public.publish_requests
  SET status = 'overridden'
  WHERE site_id = p_site_id AND status = 'pending'
  RETURNING id INTO v_overrode_id;

  -- Insert the fresh pending row + record what was charged.
  INSERT INTO public.publish_requests
    (site_id, requested_by, status, charged_amount)
  VALUES
    (p_site_id, p_user_id, 'pending', p_publish_cost)
  RETURNING id, created_at INTO v_new_id, v_new_created;

  -- Deduct balance + record the charge tx.
  v_new_balance := ROUND(v_balance - p_publish_cost, 2);
  UPDATE public.credit_balances
  SET balance = v_new_balance
  WHERE site_id = p_site_id;

  INSERT INTO public.credit_transactions (site_id, user_id, amount, type, note)
  VALUES (
    p_site_id,
    p_user_id,
    -p_publish_cost,
    'publish_charge',
    CASE
      WHEN v_overrode_id IS NOT NULL
        THEN 'Publish request (overrides ' || v_overrode_id::text || ')'
      ELSE 'Publish request'
    END
  );

  RETURN jsonb_build_object(
    'request_id',  v_new_id,
    'created_at',  v_new_created,
    'overrode_id', v_overrode_id,
    'new_balance', v_new_balance
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_publish_request(UUID, UUID, NUMERIC) TO authenticated, service_role;

-- reject_publish_request: mark pending → rejected + refund the
-- charged_amount back to the credit balance + log a publish_refund tx.
-- Raises 'NO_PENDING_REQUEST' if there's nothing to reject.
CREATE OR REPLACE FUNCTION public.reject_publish_request(
  p_site_id UUID,
  p_reviewer_id UUID,
  p_review_note TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request_id      UUID;
  v_requester_id    UUID;
  v_charged         NUMERIC;
  v_balance         NUMERIC;
  v_new_balance     NUMERIC;
BEGIN
  -- Find + lock the pending request.
  SELECT id, requested_by, charged_amount
  INTO v_request_id, v_requester_id, v_charged
  FROM public.publish_requests
  WHERE site_id = p_site_id AND status = 'pending'
  FOR UPDATE;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'NO_PENDING_REQUEST';
  END IF;

  -- Mark rejected.
  UPDATE public.publish_requests
  SET status = 'rejected',
      reviewed_by = p_reviewer_id,
      reviewed_at = NOW(),
      review_note = p_review_note
  WHERE id = v_request_id;

  -- Refund (no-op if nothing was charged — defensive for legacy rows).
  IF v_charged IS NOT NULL AND v_charged > 0 THEN
    SELECT balance INTO v_balance
    FROM public.credit_balances
    WHERE site_id = p_site_id
    FOR UPDATE;

    v_new_balance := ROUND(COALESCE(v_balance, 0) + v_charged, 2);

    -- Upsert in case the balance row doesn't exist (defensive — every
    -- paid site should have one from site creation).
    INSERT INTO public.credit_balances (site_id, balance)
    VALUES (p_site_id, v_new_balance)
    ON CONFLICT (site_id) DO UPDATE SET balance = EXCLUDED.balance;

    INSERT INTO public.credit_transactions (site_id, user_id, amount, type, note)
    VALUES (
      p_site_id,
      v_requester_id,
      v_charged,
      'publish_refund',
      'Refund — publish request rejected'
        || CASE WHEN p_review_note IS NOT NULL AND length(p_review_note) > 0
                  THEN ': ' || p_review_note
                ELSE ''
           END
    );
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'refunded',   COALESCE(v_charged, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_publish_request(UUID, UUID, TEXT) TO authenticated, service_role;
