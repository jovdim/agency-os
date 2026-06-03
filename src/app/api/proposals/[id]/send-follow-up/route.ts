import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, buildFollowUpEmailHtml } from "@/lib/email";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const admin = createAdminClient();

  // Verify proposal exists and belongs to user
  const { data: proposal } = await admin
    .from("proposals")
    .select("sales_person_id, status, company_name, contact_id")
    .eq("id", id)
    .single();

  if (!proposal)
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });

  if (proposal.sales_person_id !== user.id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // Allow sending emails at any proposal stage

  // Channel-aware (Peter 2026-05-15): "email" sends via SMTP and
  // logs the row; "whatsapp" skips SMTP entirely (the browser
  // opens wa.me with the prefilled message) and only logs the
  // row for traceability. body_html is required for both; subject
  // is required only for email.
  const channel = body.channel === "whatsapp" ? "whatsapp" : "email";
  const { subject, body_html } = body;

  if (!body_html?.trim()) {
    return NextResponse.json(
      { error: "Body is required" },
      { status: 400 },
    );
  }
  if (channel === "email" && !subject?.trim()) {
    return NextResponse.json(
      { error: "Subject is required for email follow-ups" },
      { status: 400 },
    );
  }

  // Get contact (email + phone)
  const { data: contact } = await admin
    .from("contacts")
    .select("email, phone")
    .eq("id", proposal.contact_id)
    .single();

  if (channel === "email" && !contact?.email) {
    return NextResponse.json(
      { error: "Contact has no email address" },
      { status: 400 },
    );
  }

  if (channel === "whatsapp") {
    // WhatsApp path — no SMTP send. Log the follow-up for sales
    // history. Recipient phone is stored on the existing
    // recipient_email column (NOT NULL on the table) prefixed
    // with `whatsapp:` to keep the channel readable in queries
    // without joining on email_type. Same convention used by
    // the initial-send path in /api/proposals/[id] PUT.
    const recipientPhone =
      (typeof body.recipient_phone === "string" &&
        body.recipient_phone.trim()) ||
      contact?.phone ||
      "";
    await admin.from("proposal_emails").insert({
      proposal_id: id,
      sent_by: user.id,
      email_type: "follow_up_whatsapp",
      subject: `Follow-up ${proposal.company_name} — WhatsApp`,
      body_html: body_html.trim(),
      recipient_email: `whatsapp:${recipientPhone}`,
    });

    return NextResponse.json({ success: true });
  }

  // ── Email path (default) ──

  // Get deployment URL
  const { data: deployment } = await admin
    .from("deployments")
    .select("subdomain")
    .eq("proposal_id", id)
    .eq("deploy_status", "live")
    .order("deployed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const liveUrl = deployment?.subdomain
    ? `https://${deployment.subdomain}.pages.dev`
    : null;

  // Get salesperson name
  const { data: salesProfile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const html = buildFollowUpEmailHtml({
    bodyHtml: body_html.trim(),
    companyName: proposal.company_name,
    liveUrl,
    salesPersonName: salesProfile?.full_name || null,
  });

  const emailResult = await sendEmail({
    to: contact!.email!,
    subject: subject.trim(),
    html,
    replyTo: process.env.SMTP_USER,
  });

  if (!emailResult.success) {
    return NextResponse.json(
      { error: emailResult.error || "Failed to send email" },
      { status: 500 },
    );
  }

  // Log to proposal_emails
  await admin.from("proposal_emails").insert({
    proposal_id: id,
    sent_by: user.id,
    email_type: "follow_up",
    subject: subject.trim(),
    body_html: body_html.trim(),
    recipient_email: contact!.email!,
  });

  return NextResponse.json({ success: true });
}
