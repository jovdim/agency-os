import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, parseCcInput } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import {
  buildBusinessEmailSetupHtml,
  defaultBusinessEmailSubject,
} from "@/lib/emails/business-email-setup";

/**
 * POST /api/proposals/[id]/send-business-email
 *
 * Step 6 of the tech proposal timeline: tech admin has just created an
 * info@clientcompany.sk mailbox in Hostinger and pastes the credentials
 * here. We:
 *   1. Save them on the client's profile (so the client sees them later
 *      in their /client zone — same columns Hostinger creds live in for
 *      salespeople, see migration 00031).
 *   2. Email the credentials to the client's primary contact address
 *      using an English template (sent from info@youragency.com, the system
 *      account — never from the new mailbox itself, since we want
 *      reply-to-system semantics).
 *   3. Stamp `proposals.business_email_sent_at` so the timeline step
 *      flips to "done".
 *
 * Body:
 *   { to_email?: string,                // override recipient; defaults to
 *                                        //  contact.email when omitted.
 *                                        //  Validated as a real email.
 *     business_email: string,           // info@clientcompany.sk
 *     business_email_password: string,  // Hostinger pass for that mailbox
 *     subject?: string,                 // tech-edited subject; falls back
 *                                        //  to "Your new company email
 *                                        //  mailbox — {company_name}"
 *     body_html?: string }              // tech-composed Tiptap HTML body
 *                                        //  (full email — heading,
 *                                        //  credentials, signature). Falls
 *                                        //  back to the English default.
 *
 * Caller must be tech_admin, super_admin, or sales (sales-role 2026-05-10:
 * the salesperson view of /sales/proposals/[id] reuses the shared timeline
 * UI, including this dialog. Sales is constrained to proposals they own —
 * see the ownership check after the proposal lookup below).
 *
 * Atomic-ish: we save creds + send + stamp in order. If the email fails
 * we still keep the saved creds (tech can retry from the UI without
 * re-typing) but DON'T stamp sent_at — the step stays "active".
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = user.app_metadata?.role as string | undefined;
  if (role !== "tech_admin" && role !== "super_admin" && role !== "sales") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: proposalId } = await params;

  const body = await req.json().catch(() => ({}));
  const businessEmail =
    typeof body?.business_email === "string" ? body.business_email.trim().toLowerCase() : "";
  const businessEmailPassword =
    typeof body?.business_email_password === "string"
      ? body.business_email_password.trim()
      : "";
  const overrideToEmail =
    typeof body?.to_email === "string" && body.to_email.trim().length > 0
      ? body.to_email.trim().toLowerCase()
      : null;
  const customSubject =
    typeof body?.subject === "string" && body.subject.trim().length > 0
      ? body.subject.trim()
      : null;
  const customBodyHtml =
    typeof body?.body_html === "string" && body.body_html.trim().length > 0
      ? body.body_html
      : null;

  if (!businessEmail || !businessEmailPassword) {
    return NextResponse.json(
      { error: "Both business_email and business_email_password are required." },
      { status: 400 },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(businessEmail)) {
    return NextResponse.json(
      { error: "Invalid email format." },
      { status: 400 },
    );
  }
  if (overrideToEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(overrideToEmail)) {
    return NextResponse.json(
      { error: "Invalid recipient (To) email format." },
      { status: 400 },
    );
  }

  // CC — optional, validated as a parsed list. Empty / missing → no CC.
  const ccParse = parseCcInput(body?.cc);
  if (!ccParse.ok) {
    return NextResponse.json({ error: ccParse.error }, { status: 400 });
  }
  const ccList = ccParse.cc;

  const admin = createAdminClient();

  // Load proposal + linked site (for owner_id) + contact (recipient address).
  // sales_person_id pulled in for the sales-role ownership guard below.
  const { data: proposal, error: pErr } = await admin
    .from("proposals")
    .select(
      "id, company_name, contact_id, sales_person_id, is_migrated, contacts(email, contact_person, company_name)",
    )
    .eq("id", proposalId)
    .single();

  if (pErr || !proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  // Sales-role guard: salespeople can act on their own proposals OR any
  // MIGRATED row (migrated proposals carry the importing tech/super as
  // sales_person_id only to satisfy the FK — every salesperson may manage
  // them, same as tech/super and the live-client pages). tech_admin/
  // super_admin keep full access. Same 404 shape as a missing row so
  // existence isn't leaked.
  if (
    role === "sales" &&
    (proposal as { sales_person_id: string }).sales_person_id !== user.id &&
    (proposal as { is_migrated?: boolean }).is_migrated !== true
  ) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  type ContactRow = {
    email: string | null;
    contact_person: string | null;
    company_name: string | null;
  };
  const contactRaw = (proposal as { contacts?: ContactRow | ContactRow[] }).contacts;
  const contact: ContactRow | null = Array.isArray(contactRaw)
    ? contactRaw[0] ?? null
    : contactRaw ?? null;

  if (!contact?.email) {
    return NextResponse.json(
      { error: "Proposal contact has no email — cannot deliver setup notification." },
      { status: 400 },
    );
  }

  const { data: site } = await admin
    .from("sites")
    .select("id, owner_id, email_requested_by, name")
    .eq("proposal_id", proposalId)
    .limit(1)
    .maybeSingle();

  if (!site?.owner_id) {
    return NextResponse.json(
      {
        error:
          "No client zone yet. Create the client account first before sending the business-email setup.",
      },
      { status: 400 },
    );
  }

  // 1. Save credentials on the client profile (idempotent — overwrites
  //    if tech is updating).
  const { error: profErr } = await admin
    .from("profiles")
    .update({
      business_email: businessEmail,
      business_email_password: businessEmailPassword,
    })
    .eq("id", site.owner_id);

  if (profErr) {
    return NextResponse.json(
      { error: "Failed to save credentials on client profile: " + profErr.message },
      { status: 500 },
    );
  }

  // 2. Build + send the setup email. The dialog composes the
  //    full body (heading + greeting + credentials + closing) — server
  //    just wraps it in the plain-email shell and ships. If for some
  //    reason `body_html` wasn't sent, fall back to the default
  //    English template populated with the current creds.
  //
  //    Recipient: tech can override the `to_email` from the dialog (e.g.
  //    when the contact's primary inbox isn't where they want the
  //    Hostinger creds delivered). Falls back to contact.email when
  //    omitted.
  const resolvedCompany = contact.company_name || proposal.company_name;
  const recipient = overrideToEmail ?? contact.email;
  const html = buildBusinessEmailSetupHtml({
    companyName: resolvedCompany,
    bodyHtml: customBodyHtml,
    defaults: {
      contactPersonalEmail: recipient,
      businessEmail,
      businessEmailPassword,
    },
  });

  const sendResult = await sendEmail({
    to: recipient,
    cc: ccList.length > 0 ? ccList : undefined,
    subject: customSubject ?? defaultBusinessEmailSubject(resolvedCompany),
    html,
    type: "client",
    replyTo: process.env.SMTP_USER || undefined,
  });

  if (!sendResult.success) {
    // Creds are saved; let tech retry without re-typing. Don't stamp sent_at.
    return NextResponse.json(
      {
        error:
          "Credentials saved but email failed to send: " +
          (sendResult.error ?? "unknown error"),
        creds_saved: true,
      },
      { status: 502 },
    );
  }

  // 3. Stamp sent_at so the timeline step flips to "done".
  const sentAt = new Date().toISOString();
  await admin
    .from("proposals")
    .update({ business_email_sent_at: sentAt })
    .eq("id", proposalId);

  // 4. Drop an in-app banner notification for whoever requested the
  //    business-email setup (tech / sales / super). Recipient defaults
  //    to email_requested_by; falls back to owner_id (client) when
  //    nobody on staff was attributed. Self-skip avoids banner-pinging
  //    the person who just did the work. See migration 00072 for the
  //    table; the dashboard `StaffNotificationBanner` reads it on
  //    every page load.
  const emailRecipientId =
    (site as { email_requested_by?: string | null }).email_requested_by ??
    site.owner_id ??
    null;
  if (emailRecipientId && emailRecipientId !== user.id) {
    await admin.from("staff_notifications").insert({
      recipient_id: emailRecipientId,
      kind: "email_ready",
      site_id: site.id,
      payload: {
        business_email: businessEmail,
        site_name:
          (site as { name?: string | null }).name ?? proposal.company_name,
      },
    });
  }

  await logAudit({
    userId: user.id,
    action: "send_business_email_setup",
    entityType: "proposal",
    entityId: proposalId,
    details: {
      site_id: site.id,
      client_user_id: site.owner_id,
      business_email: businessEmail,
      delivered_to: recipient,
      to_overridden: overrideToEmail !== null && overrideToEmail !== contact.email,
    },
  });

  return NextResponse.json({
    ok: true,
    sent_at: sentAt,
    delivered_to: recipient,
  });
}

// Email template lives in src/lib/emails/business-email-setup.ts so the
// Compose dialog can render an identical preview client-side.
