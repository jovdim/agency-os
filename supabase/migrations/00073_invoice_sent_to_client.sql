-- Track when a salesperson has emailed the invoice PDF directly to the client.
-- Separate from invoice_file_uploaded_at (super admin upload) so the UI can
-- distinguish "PDF available" from "PDF delivered to client".
ALTER TABLE public.invoice_requests
  ADD COLUMN IF NOT EXISTS sent_to_client_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_to_client_email TEXT;

-- Allow sales to UPDATE their own requests (needed when send-to-client
-- runs through the admin client we still want a sanity policy in place).
DROP POLICY IF EXISTS "Sales can update own invoice requests" ON public.invoice_requests;
CREATE POLICY "Sales can update own invoice requests"
  ON public.invoice_requests FOR UPDATE
  USING (sales_person_id = auth.uid())
  WITH CHECK (sales_person_id = auth.uid());
