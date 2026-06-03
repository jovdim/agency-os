-- Invoice request file attachments — store the PDF the super admin
-- uploads when fulfilling a salesperson's invoice request.
--
-- Flow (Peter 2026-05-20):
--   1. Sales clicks "Send invoice" on a contact → row inserted into
--      invoice_requests with the message ("Webstránka 149€, GBP 75€...").
--   2. Super admin opens /super/invoice-requests, generates the invoice
--      externally (in their accounting software), uploads the PDF here.
--   3. Salesperson can download the PDF from their dashboard.
--
-- WHY a private bucket (not public like composer-staging):
--   Invoices carry client billing data (company name, IČO, amount). They
--   must NEVER be world-readable. Access is gated through an authenticated
--   server route that checks the requester is (a) the salesperson who
--   submitted the request, OR (b) any super admin / tech admin.
--
-- WHY ONE PDF PER REQUEST (not multiple files):
--   95% case is a single tax invoice. Keeping it 1:1 means no separate
--   join table — the file path lives directly on invoice_requests. If a
--   second file is needed in future (e.g. payment receipt) we'll either
--   replace or add a sibling column rather than a separate attachments
--   table.

-- Add three columns to invoice_requests
ALTER TABLE invoice_requests
  ADD COLUMN IF NOT EXISTS invoice_file_path text,
  ADD COLUMN IF NOT EXISTS invoice_file_name text,
  ADD COLUMN IF NOT EXISTS invoice_file_uploaded_at timestamptz;

COMMENT ON COLUMN invoice_requests.invoice_file_path IS
  'Storage path inside the "invoices" bucket. Format: {request_id}/{filename}.pdf. NULL until the super admin uploads.';
COMMENT ON COLUMN invoice_requests.invoice_file_name IS
  'Original filename at upload time (e.g. "FV-2026-00042.pdf"). Shown to the salesperson on the download link.';
COMMENT ON COLUMN invoice_requests.invoice_file_uploaded_at IS
  'When the file was uploaded. Used to badge "new invoice" in the salesperson UI.';

-- Private bucket — file_size_limit 20 MB is generous for a tax invoice
-- PDF; allowed MIME is PDF only (refusing accidental .docx / .jpg keeps
-- the "invoice" semantics strict).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invoices',
  'invoices',
  false,                                  -- private; access via signed URL or RLS
  20971520,                               -- 20 MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies
-- Only authenticated users with a role of sales / tech_admin / super_admin
-- can read or write. The API route is the actual access gate (it filters
-- which invoice_requests a salesperson can see); these policies are a
-- second-layer fence so a stolen signed URL still requires a session.

DROP POLICY IF EXISTS "invoices_authenticated_read" ON storage.objects;
CREATE POLICY "invoices_authenticated_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'invoices'
    AND get_my_role() IN ('sales', 'tech_admin', 'administrator', 'super_admin')
  );

DROP POLICY IF EXISTS "invoices_admin_write" ON storage.objects;
CREATE POLICY "invoices_admin_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'invoices'
    AND get_my_role() IN ('tech_admin', 'administrator', 'super_admin')
  );

DROP POLICY IF EXISTS "invoices_admin_update" ON storage.objects;
CREATE POLICY "invoices_admin_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'invoices'
    AND get_my_role() IN ('tech_admin', 'administrator', 'super_admin')
  );

DROP POLICY IF EXISTS "invoices_admin_delete" ON storage.objects;
CREATE POLICY "invoices_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'invoices'
    AND get_my_role() IN ('tech_admin', 'administrator', 'super_admin')
  );
