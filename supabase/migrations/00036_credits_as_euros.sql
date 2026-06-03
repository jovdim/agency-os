-- Credits are now stored as euros (1 unit = 1€)
-- Cost per change request = 12.50€
-- Deduct 12.5 on submission, refund 12.5 on rejection

-- Update deduction trigger: 1 → 12.5
CREATE OR REPLACE FUNCTION public.deduct_credit_on_change_request()
RETURNS TRIGGER AS $$
BEGIN
  -- Only deduct for 'pending' status (not drafts)
  IF NEW.status = 'pending' THEN
    UPDATE public.credit_balances
    SET balance = balance - 12.5
    WHERE site_id = NEW.site_id;

    INSERT INTO public.credit_transactions (site_id, user_id, amount, type, note)
    VALUES (
      NEW.site_id,
      NEW.user_id,
      -12.5,
      'submission_deduct',
      'Auto-deducted 12.50€ for change request ' || NEW.id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update refund trigger: 1 → 12.5
CREATE OR REPLACE FUNCTION public.refund_credit_on_rejection()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
    UPDATE public.credit_balances
    SET balance = balance + 12.5
    WHERE site_id = NEW.site_id;

    INSERT INTO public.credit_transactions (site_id, user_id, amount, type, note)
    VALUES (
      NEW.site_id,
      NEW.processed_by,
      12.5,
      'rejection_refund',
      'Refunded 12.50€ for rejected change request ' || NEW.id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Convert existing balances: old credits × 12.5 = new euro balance
UPDATE public.credit_balances SET balance = balance * 12.5 WHERE balance > 0 AND balance < 100;

-- Convert existing transactions
UPDATE public.credit_transactions SET amount = amount * 12.5 WHERE amount != 0 AND amount > -100 AND amount < 100;
