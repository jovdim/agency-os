-- Add 'draft' status for unpaid client change requests
-- Drafts are saved but NOT sent to tech team until client pays
ALTER TYPE public.change_request_status ADD VALUE IF NOT EXISTS 'draft';


CREATE OR REPLACE FUNCTION public.deduct_credit_on_change_request()
RETURNS TRIGGER AS $$
BEGIN

  IF NEW.status = 'pending' THEN
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
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'pending' THEN
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

CREATE TRIGGER trg_deduct_credit_on_draft_to_pending
  AFTER UPDATE ON public.change_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.deduct_credit_on_draft_to_pending();
