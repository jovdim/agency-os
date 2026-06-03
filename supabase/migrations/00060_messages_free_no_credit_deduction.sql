-- Free "Contact support" messages — no credit deduction.
--
-- Background: the client zone exposes a "Potrebujete pomoc?" page where
-- clients can send a free-form message to the IT team (questions,
-- general support, "can you help me with X"). These are stored as
-- `change_requests` rows with `changes = [{ action: "message", ... }]`
-- so they show up in the same /tech/queue review surface that real
-- edit requests do.
--
-- Peter 2026-05-11: messages should NEVER cost credit. They're support
-- channel, not billable edit work. Both the API and this trigger used
-- to charge 1 credit on submission; now the API skips the gate and
-- this trigger skips the deduction for message-shaped change rows.
--
-- Two triggers are updated:
--   1) deduct_credit_on_change_request  (fires on INSERT)
--   2) deduct_credit_on_draft_to_pending (fires on UPDATE when a draft
--      gets converted to pending — e.g. after a client pays and their
--      pre-payment drafts auto-promote)
--
-- Both functions now early-return for message-shaped change rows:
--   jsonb_array_length(changes) = 1 AND changes->0->>'action' = 'message'

CREATE OR REPLACE FUNCTION public.deduct_credit_on_change_request()
RETURNS TRIGGER AS $$
DECLARE
  v_is_message BOOLEAN;
BEGIN
  -- Detect "message" change_requests: single-item array, action="message".
  -- Defensive jsonb_typeof check in case `changes` is ever a non-array
  -- (legacy rows or future shape changes).
  v_is_message := (
    jsonb_typeof(NEW.changes) = 'array'
    AND jsonb_array_length(NEW.changes) = 1
    AND (NEW.changes->0->>'action') = 'message'
  );

  IF NEW.status = 'pending' AND NOT v_is_message THEN
    UPDATE public.credit_balances
    SET balance = balance - 1
    WHERE site_id = NEW.site_id;

    INSERT INTO public.credit_transactions (site_id, user_id, amount, type, note)
    VALUES (
      NEW.site_id,
      NEW.user_id,
      -1,
      'submission_deduct',
      'Auto-deducted for change request ' || NEW.id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.deduct_credit_on_draft_to_pending()
RETURNS TRIGGER AS $$
DECLARE
  v_is_message BOOLEAN;
BEGIN
  v_is_message := (
    jsonb_typeof(NEW.changes) = 'array'
    AND jsonb_array_length(NEW.changes) = 1
    AND (NEW.changes->0->>'action') = 'message'
  );

  IF OLD.status = 'draft' AND NEW.status = 'pending' AND NOT v_is_message THEN
    UPDATE public.credit_balances
    SET balance = balance - 1
    WHERE site_id = NEW.site_id;

    INSERT INTO public.credit_transactions (site_id, user_id, amount, type, note)
    VALUES (
      NEW.site_id,
      NEW.user_id,
      -1,
      'submission_deduct',
      'Draft converted to pending for change request ' || NEW.id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
