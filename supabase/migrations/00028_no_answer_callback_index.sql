-- Performance index for counting no_answer calls per contact (retry badge on callback contacts)
CREATE INDEX IF NOT EXISTS idx_call_logs_contact_no_answer
  ON public.call_logs(contact_id)
  WHERE outcome = 'no_answer';
