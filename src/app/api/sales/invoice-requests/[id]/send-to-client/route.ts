/**
 * Send an invoice PDF directly to the client via email.
 *
 * POST { recipient_email, subject?, message? }
 *
 * Auth: salesperson who owns the request (or higher role).
 * Flow:
 *  1. Verify request exists and belongs to this salesperson
 *  2. Pull PDF from Supabase Storage
 *  3. Send email via Hostinger SMTP (per-salesperson business_email if available)
 *  4. Record sent_to_client_at + sent_to_client_email on the row
 */
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { profile } = await requireRole("sales");
  const { id: requestId } = await params;
  const admin = createAdminClient();

  const body = await req.json().catch(() => ({}));
  const recipientEmail = (body.recipient_email as string | undefined)?.trim();
  const customMessage = (body.message as string | undefined)?.trim() || "";

  if (!recipientEmail || !validateEmail(recipientEmail)) {
    return NextResponse.json(
      { error: "Valid recipient email required" },
      { status: 400 },
    );
  }

  // 1) Fetch the request — verify ownership unless caller is admin tier
  const { data: request } = await admin
    .from("invoice_requests")
    .select(
      "id, sales_person_id, company_name, invoice_file_path, invoice_file_name",
    )
    .eq("id", requestId)
    .single();

  if (!request) {
    return NextResponse.json({ error: "Invoice request not found" }, { status: 404 });
  }

  const isAdminTier = ["tech_admin", "administrator", "super_admin"].includes(
    profile.role,
  );
  if (!isAdminTier && request.sales_person_id !== profile.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!request.invoice_file_path) {
    return NextResponse.json(
      { error: "No invoice PDF uploaded yet" },
      { status: 400 },
    );
  }

  // 2) Download PDF from Supabase Storage
  const { data: fileBlob, error: dlErr } = await admin.storage
    .from("invoices")
    .download(request.invoice_file_path);
  if (dlErr || !fileBlob) {
    return NextResponse.json(
      { error: `Failed to load PDF: ${dlErr?.message || "unknown error"}` },
      { status: 500 },
    );
  }
  const buffer = Buffer.from(await fileBlob.arrayBuffer());

  // 3) Look up the salesperson's business email so the message comes from them
  const { data: senderProfile } = await admin
    .from("profiles")
    .select("full_name, business_email, business_email_password, company_name")
    .eq("id", request.sales_person_id)
    .single();

  const senderName = senderProfile?.full_name || "";
  const senderCompany = senderProfile?.company_name || "Your Agency";
  const fileName = request.invoice_file_name || "Invoice.pdf";

  const subject =
    (body.subject as string | undefined)?.trim() ||
    `Invoice — ${request.company_name}`;

  const bodyHtml = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5">
<div style="max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e5e5">
    <h1 style="margin:0 0 16px;font-size:20px;color:#111">Invoice</h1>
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6">
      Hello,
    </p>
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6">
      Please find attached the invoice for <strong>${escapeHtml(request.company_name)}</strong>.
    </p>
    ${customMessage ? `<p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6;white-space:pre-wrap">${escapeHtml(customMessage)}</p>` : ""}
    <p style="margin:24px 0 0;font-size:14px;color:#333;line-height:1.6">
      Best regards,<br/>
      <strong>${escapeHtml(senderName)}</strong><br/>
      ${escapeHtml(senderCompany)}
    </p>
  </div>
  <div style="text-align:center;padding:16px 0;font-size:11px;color:#999">
    <p style="margin:0;line-height:1.5">This project is operated by Your Agency.</p>
  </div>
</div>
</body>
</html>`;

  // 4) Send the email — use salesperson's business_email if available
  try {
    await sendEmail({
      to: recipientEmail,
      subject,
      html: bodyHtml,
      replyTo: senderProfile?.business_email || undefined,
      type: "sales",
      senderEmail: senderProfile?.business_email || undefined,
      senderPassword: senderProfile?.business_email_password || undefined,
      attachments: [
        {
          filename: fileName,
          content: buffer,
          contentType: "application/pdf",
        },
      ],
    });
  } catch (mailErr) {
    return NextResponse.json(
      {
        error: `Email send failed: ${mailErr instanceof Error ? mailErr.message : "unknown"}`,
      },
      { status: 500 },
    );
  }

  // 5) Record the send on the row
  const nowIso = new Date().toISOString();
  await admin
    .from("invoice_requests")
    .update({
      sent_to_client_at: nowIso,
      sent_to_client_email: recipientEmail,
    })
    .eq("id", requestId);

  await logAudit({
    userId: profile.id,
    action: "invoice_sent_to_client",
    entityType: "invoice_request",
    entityId: requestId,
    details: {
      recipient_email: recipientEmail,
      company_name: request.company_name,
    },
  });

  return NextResponse.json({
    success: true,
    sent_at: nowIso,
    recipient: recipientEmail,
  });
}
