-- Phase 4: Credit deduction trigger on change request submission
-- When a change_request is inserted, auto-deduct 1 credit from the site's balance.
-- When a change_request is rejected, auto-refund 1 credit.

-- ─── FUNCTION: deduct credit on change_request INSERT ───
CREATE OR REPLACE FUNCTION public.deduct_credit_on_change_request()
RETURNS TRIGGER AS $$
BEGIN
  -- Deduct 1 credit from the site's balance
  UPDATE public.credit_balances
  SET balance = balance - 1
  WHERE site_id = NEW.site_id;

  -- Log the transaction
  INSERT INTO public.credit_transactions (site_id, user_id, amount, type, note)
  VALUES (
    NEW.site_id,
    NEW.user_id,
    -1,
    'submission_deduct',
    'Auto-deducted for change request ' || NEW.id::text
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_deduct_credit_on_change_request
  AFTER INSERT ON public.change_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.deduct_credit_on_change_request();

-- ─── FUNCTION: refund credit on change_request rejection ───
CREATE OR REPLACE FUNCTION public.refund_credit_on_rejection()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when status changes to 'rejected'
  IF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
    UPDATE public.credit_balances
    SET balance = balance + 1
    WHERE site_id = NEW.site_id;

    INSERT INTO public.credit_transactions (site_id, user_id, amount, type, note)
    VALUES (
      NEW.site_id,
      NEW.processed_by,
      1,
      'rejection_refund',
      'Refunded for rejected change request ' || NEW.id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_refund_credit_on_rejection
  AFTER UPDATE ON public.change_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.refund_credit_on_rejection();

-- ─── Add template_id to sites (for rendering) ───
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.templates(id) ON DELETE SET NULL;
