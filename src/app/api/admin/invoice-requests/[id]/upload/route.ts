/**
 * Upload the PDF for an invoice request.
 *
 * POST multipart/form-data { file: <PDF> }
 *
 * Auth: super_admin or tech_admin only.
 * Storage: invoices bucket, path = {requestId}/{filename}.pdf
 *
 * Replaces any previous file for this request (the column is single-
 * valued — 1 PDF per request per Peter 2026-05-20). The old file is
 * removed from Storage before the new one writes so we don't leak
 * orphan PDFs.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — matches migration cap
const ALLOWED_MIMES = new Set(["application/pdf"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // tech_admin is the floor — administrators and super_admins are above
  // in the hierarchy and pass automatically. Sales / client can't upload.
  const { profile } = await requireRole("tech_admin");
  const { id: requestId } = await params;
  const admin = createAdminClient();

  // 1) Look up the request — fails fast if it doesn't exist
  const { data: request } = await admin
    .from("invoice_requests")
    .select("id, invoice_file_path, company_name, sales_person_id, message")
    .eq("id", requestId)
    .single();
  if (!request) {
    return NextResponse.json(
      { error: "Invoice request not found" },
      { status: 404 },
    );
  }

  // 2) Parse multipart form
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "No file uploaded (expected multipart field 'file')" },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413 },
    );
  }
  if (!ALLOWED_MIMES.has(file.type)) {
    return NextResponse.json(
      { error: `Only PDF allowed (got ${file.type || "unknown"})` },
      { status: 415 },
    );
  }

  // 3) If there's an existing file, remove it. Best-effort — a stale
  //    file in Storage is annoying but doesn't block the new upload.
  if (request.invoice_file_path) {
    await admin.storage
      .from("invoices")
      .remove([request.invoice_file_path])
      .catch(() => {
        /* swallow — orphan file is acceptable, broken upload is not */
      });
  }

  // 4) Sanitize filename. Allow letters, digits, dot, dash, underscore.
  //    Anything else collapses to underscore. Preserves the extension.
  const rawName = file.name || "invoice.pdf";
  const safeName = rawName
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 80);
  const storagePath = `${requestId}/${Date.now()}_${safeName}`;

  // 5) Upload to Storage
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await admin.storage
    .from("invoices")
    .upload(storagePath, buffer, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadErr) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  // 6) Patch the invoice_request row
  const nowIso = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("invoice_requests")
    .update({
      invoice_file_path: storagePath,
      invoice_file_name: safeName,
      invoice_file_uploaded_at: nowIso,
    })
    .eq("id", requestId);
  if (updateErr) {
    // Roll back the Storage upload to keep things consistent — DB is
    // the source of truth, so an orphan file shouldn't survive a
    // failed DB write.
    await admin.storage.from("invoices").remove([storagePath]).catch(() => {});
    return NextResponse.json(
      { error: `DB update failed: ${updateErr.message}` },
      { status: 500 },
    );
  }

  await logAudit({
    userId: profile.id,
    action: "invoice_file_uploaded",
    entityType: "invoice_request",
    entityId: requestId,
    details: {
      company_name: request.company_name,
      file_name: safeName,
      storage_path: storagePath,
    },
  });

  // Notify the salesperson — PDF goes straight to their inbox so they
  // can forward to the client without hunting through the dashboard.
  // Non-blocking: failing here doesn't roll back the upload (the row
  // is the source of truth; salesperson can still grab the file from
  // /sales/faktury).
  if (request.sales_person_id) {
    try {
      const { data: salesProfile } = await admin
        .from("profiles")
        .select("full_name, business_email")
        .eq("id", request.sales_person_id)
        .single();

      let recipientEmail = salesProfile?.business_email || null;
      if (!recipientEmail) {
        const { data: userLookup } = await admin.auth.admin.getUserById(
          request.sales_person_id,
        );
        recipientEmail = userLookup?.user?.email || null;
      }

      if (recipientEmail) {
        const dashboardUrl =
          process.env.NEXT_PUBLIC_SITE_URL ||
          "https://youragency-zone.vercel.app";
        const recipientName = salesProfile?.full_name || "Salesperson";

        await sendEmail({
          to: recipientEmail,
          subject: `Your invoice is ready — ${request.company_name}`,
          attachments: [
            {
              filename: safeName,
              content: buffer,
              contentType: "application/pdf",
            },
          ],
          html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5">
<div style="max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e5e5">
    <h1 style="margin:0 0 16px;font-size:20px;color:#111">Your invoice is ready</h1>
    <p style="margin:0 0 12px;font-size:14px;color:#333;line-height:1.6">
      Hi ${escapeHtml(recipientName)},
    </p>
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6">
      The invoice for <strong>${escapeHtml(request.company_name)}</strong> has been issued. You'll find the PDF attached to this email.
    </p>

    <div style="margin:16px 0;padding:16px;background:#f8f9fa;border-radius:8px;border:1px solid #e5e5e5">
      <p style="margin:0 0 6px;font-size:13px;color:#333"><strong>File:</strong> ${escapeHtml(safeName)}</p>
      <p style="margin:0;font-size:13px;color:#333"><strong>Company:</strong> ${escapeHtml(request.company_name)}</p>
    </div>

    <div style="text-align:center;margin:24px 0 0">
      <a href="${dashboardUrl}/sales/faktury" target="_blank" style="display:inline-block;background:#111;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">
        Open my invoices →
      </a>
    </div>
  </div>

  <div style="text-align:center;padding:24px 0;font-size:11px;color:#999">
    <p style="margin:0;line-height:1.5">This project is funded and operated by the business consulting agency <strong>Your Agency</strong> and was created to support the digitalization of small and medium-sized businesses as an affordable form of professional web and marketing solutions.</p>
  </div>
</div>
</body>
</html>`,
          type: "global",
        });
      }
    } catch (mailErr) {
      console.error(
        "[InvoiceUpload] Salesperson notification email failed:",
        mailErr,
      );
    }
  }

  return NextResponse.json({
    success: true,
    file_path: storagePath,
    file_name: safeName,
    uploaded_at: nowIso,
  });
}
