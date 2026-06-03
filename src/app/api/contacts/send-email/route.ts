import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";

/**
 * POST /api/contacts/send-email
 * Sends an email to a contact using the salesperson's business email.
 * Body: { contact_id, subject, body_html }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { contact_id, subject, body_html } = await req.json();
  if (!contact_id || !subject || !body_html) {
    return NextResponse.json({ error: "contact_id, subject, and body_html required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Get contact email
  const { data: contact } = await admin
    .from("contacts")
    .select("email, company_name")
    .eq("id", contact_id)
    .single();

  if (!contact?.email) {
    return NextResponse.json({ error: "Contact has no email address" }, { status: 400 });
  }

  // Get salesperson's business email credentials
  const { data: profile } = await admin
    .from("profiles")
    .select("business_email, business_email_password, full_name")
    .eq("id", user.id)
    .single();

  const result = await sendEmail({
    to: contact.email,
    subject,
    html: body_html,
    type: "sales",
    senderEmail: profile?.business_email || undefined,
    senderPassword: profile?.business_email_password || undefined,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error || "Failed to send email" }, { status: 500 });
  }

  // Log the action
  await admin.from("call_logs").insert({
    contact_id,
    sales_person_id: user.id,
    outcome: "send_email",
    notes: `Email sent: ${subject}`,
  });

  await logAudit({
    userId: user.id,
    action: "email_sent",
    entityType: "contact",
    entityId: contact_id,
    details: { subject, to: contact.email, from: profile?.business_email || "global" },
  });

  return NextResponse.json({ success: true, to: contact.email });
}
