import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: contactId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, business_email")
    .eq("id", user.id)
    .single();

  if (!profile || !["sales", "tech_admin", "administrator", "super_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { company_name, message } = body as {
    company_name?: string;
    message?: string;
  };

  if (!company_name) {
    return NextResponse.json({ error: "Company name required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { error } = await admin.from("invoice_requests").insert({
    contact_id: contactId,
    sales_person_id: user.id,
    company_name,
    message: message || "",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    action: "invoice_requested",
    entityType: "contact",
    entityId: contactId,
    details: { company_name },
  });

  // Notify super admin via email. Same inbox as domain requests
  // (SMTP_USER, fallback info@youragency.com). Non-blocking — the row in
  // invoice_requests is the source of truth; mail failure must not
  // fail the request.
  try {
    const adminEmail = process.env.SMTP_USER || "info@youragency.com";
    const dashboardUrl =
      process.env.NEXT_PUBLIC_SITE_URL || "https://youragency-zone.vercel.app";
    const requesterName = profile.full_name || "(unknown)";
    const safeMessage = message?.trim()
      ? escapeHtml(message.trim()).replace(/\n/g, "<br>")
      : "<em style='color:#999'>(no message)</em>";

    await sendEmail({
      to: adminEmail,
      replyTo: profile.business_email || undefined,
      subject: `New invoice request — ${company_name}`,
      html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5">
<div style="max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e5e5">
    <h1 style="margin:0 0 16px;font-size:20px;color:#111">New invoice request</h1>
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6">
      Salesperson <strong>${escapeHtml(requesterName)}</strong> submitted a request for the company <strong>${escapeHtml(company_name)}</strong>.
    </p>

    <div style="margin:16px 0;padding:16px;background:#f8f9fa;border-radius:8px;border:1px solid #e5e5e5">
      <p style="margin:0 0 8px;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.04em">Message from the salesperson</p>
      <p style="margin:0;font-size:14px;color:#111;line-height:1.6;white-space:pre-wrap">${safeMessage}</p>
    </div>

    <div style="text-align:center;margin:24px 0 0">
      <a href="${dashboardUrl}/super/invoice-requests" target="_blank" style="display:inline-block;background:#111;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">
        Open requests →
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
  } catch (mailErr) {
    console.error("[InvoiceRequest] Admin notification email failed:", mailErr);
    // Non-blocking
  }

  return NextResponse.json({ success: true });
}
