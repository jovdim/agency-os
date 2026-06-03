import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  MIN_DISCOUNT_PRICE,
  getReminderSchedule,
} from "@/lib/payments/proposal-utils";
import { sendEmail, buildProposalEmailHtml, parseCcInput } from "@/lib/email";
import { generateVariableSymbol } from "@/lib/payments/bysquare";

/**
 * GET /api/proposals/[id] — Get a single proposal with template + contact data
 */
export async function GET(
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
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("proposals")
    .select(
      "*, contacts(company_name, contact_person, phone, email, business_email, industry, town, website_url, location, social_links, notes, quoted_price)",
    )
    .eq("id", id)
    .single();

  if (error || !data)
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });

  // Sales: own organic proposals OR any MIGRATED row. Migrated proposals
  // carry the importing tech/super as sales_person_id (FK formality), so
  // every salesperson may act on them — same rule as the live-client pages
  // and salesCanViewProposal. Without the exception sales is denied on
  // every live/migrated client.
  const role = user.app_metadata?.role as string;
  if (
    role === "sales" &&
    data.sales_person_id !== user.id &&
    data.is_migrated !== true
  ) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  return NextResponse.json({ proposal: data });
}

/**
 * PUT /api/proposals/[id] — Update a proposal
 */
export async function PUT(
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

  // Verify ownership. We also pull the current pricing so the
  // standalone discount/base/expiry update path below can do
  // cross-field validation against the merged (incoming + existing)
  // values without an extra round-trip.
  const { data: existing } = await admin
    .from("proposals")
    .select(
      "sales_person_id, is_migrated, status, slug, company_name, contact_id, template_id, content_overrides, discount_price, base_price, discount_expires_at, client_temp_password, variable_symbol",
    )
    .eq("id", id)
    .single();
  if (!existing)
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });

  // Sales: own organic proposals OR any MIGRATED row (migrated proposals
  // carry the importing tech/super as sales_person_id only to satisfy the
  // FK — every salesperson may act on them, same as the live-client pages).
  const role = user.app_metadata?.role as string;
  if (
    role === "sales" &&
    existing.sales_person_id !== user.id &&
    existing.is_migrated !== true
  ) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};
  if (body.company_name !== undefined) updates.company_name = body.company_name;
  if (body.industry !== undefined) updates.industry = body.industry;
  if (body.town !== undefined) updates.town = body.town;
  if (body.services !== undefined) updates.services = body.services;
  if (body.content_overrides !== undefined)
    updates.content_overrides = body.content_overrides;
  if (body.price !== undefined) updates.price = body.price;
  if (body.requirements !== undefined) updates.requirements = body.requirements;
  if (body.feedback !== undefined) updates.feedback = body.feedback;
  if (body.built_by !== undefined) updates.built_by = body.built_by;
  if (body.show_banner !== undefined) updates.show_banner = !!body.show_banner;

  // ── Standalone pricing updates (BannerConfigDialog 2026-05-10) ─
  // The Send-to-client flow further down still owns the
  // first-time pricing write (it bundles those updates with
  // payment-link generation, reminders, and the email). This
  // block exists for the *banner config* surface, where sales
  // adjusts the price/expiry on a proposal that's already been
  // sent. We validate upfront against the merged values so the
  // request is atomic — any constraint failure aborts before
  // we touch the row. (See feedback_atomic_operations.md.)
  if (
    body.status === undefined &&
    (body.discount_price !== undefined ||
      body.base_price !== undefined ||
      body.discount_expires_at !== undefined)
  ) {
    const existingDiscount =
      (existing as { discount_price?: number | null }).discount_price ?? null;
    const existingBase =
      (existing as { base_price?: number | null }).base_price ?? null;

    let nextDiscount = existingDiscount;
    if (body.discount_price !== undefined) {
      const n = parseFloat(String(body.discount_price));
      if (!Number.isFinite(n) || n < MIN_DISCOUNT_PRICE) {
        return NextResponse.json(
          { error: `The discounted price must be at least €${MIN_DISCOUNT_PRICE}.` },
          { status: 400 },
        );
      }
      nextDiscount = n;
    }

    let nextBase = existingBase;
    if (body.base_price !== undefined) {
      const n = parseFloat(String(body.base_price));
      if (!Number.isFinite(n) || n < MIN_DISCOUNT_PRICE) {
        return NextResponse.json(
          { error: `The price after expiry must be at least €${MIN_DISCOUNT_PRICE}.` },
          { status: 400 },
        );
      }
      nextBase = n;
    }

    if (nextDiscount != null && nextBase != null && nextBase < nextDiscount) {
      return NextResponse.json(
        {
          error:
            "The price after expiry must be greater than or equal to the discounted price.",
        },
        { status: 400 },
      );
    }

    if (body.discount_expires_at !== undefined) {
      // Allow null to clear, otherwise must parse to a valid date.
      if (body.discount_expires_at === null) {
        updates.discount_expires_at = null;
      } else {
        const d = new Date(String(body.discount_expires_at));
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json(
            { error: "Invalid discount end date." },
            { status: 400 },
          );
        }
        updates.discount_expires_at = d.toISOString();
      }
    }

    if (body.discount_price !== undefined) {
      updates.discount_price = nextDiscount;
      // Mirror to legacy `price` column so anything still reading it
      // (BySquare QR cache, public proposal API computed price)
      // stays in sync. Same pattern the "sent" branch already uses.
      updates.price = nextDiscount;
    }
    if (body.base_price !== undefined) {
      updates.base_price = nextBase;
    }
  }

  if (body.status !== undefined) {
    const validTransitions: Record<string, string[]> = {
      submitted: ["building"],
      building: ["review"],
      review: ["revision", "sent"],
      revision: ["building", "review"],
      sent: ["sent", "archived"],      // allow re-send or archive
      viewed: ["sent", "archived"],    // allow re-send or archive
      accepted: [],
      paid: [],
      archived: ["sent"],              // unarchive back to pipeline
    };
    // An already-PAID proposal (e.g. a migrated / live client) can still
    // "send" the proposal email — staff often want to re-notify the client
    // that their site is live. We let the send proceed (email below), but
    // the status is NOT written (see the `if (!notifyPaidClient)` guard on
    // the status write further down). Downgrading paid→sent would both
    // mark a paying client as unpaid AND drop them off the live-clients
    // list, which filters `status = "paid"`.
    const notifyPaidClient =
      existing.status === "paid" && body.status === "sent";
    if (
      !notifyPaidClient &&
      !validTransitions[existing.status]?.includes(body.status)
    ) {
      // Admin/super can force any status
      if (!["administrator", "super_admin"].includes(role)) {
        return NextResponse.json(
          {
            error: `Cannot change status from ${existing.status} to ${body.status}`,
          },
          { status: 400 },
        );
      }
    }

    // Gate: before moving to "review" (IT guy → sales), require a client account/site to exist
    if (body.status === "review" && !["administrator", "super_admin"].includes(role)) {
      const { data: siteRow } = await admin
        .from("sites")
        .select("id")
        .eq("proposal_id", id)
        .limit(1)
        .maybeSingle();
      if (!siteRow) {
        return NextResponse.json(
          {
            error:
              "Create client account first before sending to sales. Open the build workspace and use 'Create client account' after deploying.",
          },
          { status: 400 },
        );
      }
    }

    // Keep an already-paid client on "paid" — the email still sends, the
    // status just doesn't regress (see notifyPaidClient above).
    if (!notifyPaidClient) {
      updates.status = body.status;
    }

    // Special handling for "sent" — set up sent_at, variable_symbol,
    // reminders, send email. Pricing + discount window are NOT set
    // here anymore (2026-05-23): they live behind the standalone
    // "Trigger discount + banner" button so sales can let the client
    // view the live site first, then push pricing later when ready
    // to close. The pricing branch above (BannerConfigDialog path)
    // handles all discount_price / base_price / discount_expires_at
    // writes — keep the two flows fully separate.
    if (body.status === "sent") {
      // Require greeting_text
      if (!body.greeting_text?.trim()) {
        return NextResponse.json(
          { error: "Greeting text is required when sending" },
          { status: 400 },
        );
      }

      // CC — validate UP-FRONT (before reminders insert) so a bad CC
      // address can't leave orphaned reminders behind on a proposal
      // that never actually flips to "sent". Empty / missing → no CC.
      // The parsed list is consumed later in the email branch below.
      const ccParse = parseCcInput(body?.cc);
      if (!ccParse.ok) {
        return NextResponse.json({ error: ccParse.error }, { status: 400 });
      }
      const ccList = ccParse.cc;

      // Recipient override — the send dialog's editable "Pre" field. When
      // present (and valid) the email goes here instead of the contact's
      // stored address; the contact record is left untouched. Validate
      // up-front so a malformed override can't reach the SMTP send.
      let recipientOverride: string | null = null;
      if (typeof body.recipient_email === "string" && body.recipient_email.trim()) {
        const r = body.recipient_email.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r)) {
          return NextResponse.json(
            { error: "Invalid recipient email address." },
            { status: 400 },
          );
        }
        recipientOverride = r;
      }

      const sentAt = new Date();

      updates.greeting_text = body.greeting_text.trim();
      updates.sent_at = sentAt.toISOString();
      // Stamp a variable symbol on first send so the live banner /
      // QR code can reference a stable VS once pricing is later
      // configured. Cheap to set early, harmless if pricing never
      // arrives. Only set if not already present so re-sends don't
      // generate a new VS and orphan any payment already in flight.
      if (!(existing as { variable_symbol?: string | null }).variable_symbol) {
        updates.variable_symbol = generateVariableSymbol(id);
      }

      // Create follow-up reminders — but NOT for an already-paid client.
      // The reminder schedule (day 4/10/14/30) chases an unpaid client to
      // pay; a paid/migrated client being re-notified that their site is
      // live doesn't need chasing.
      if (!notifyPaidClient) {
        const reminders = getReminderSchedule(sentAt);
        const reminderRows = reminders.map((r) => ({
          proposal_id: id,
          sales_person_id: existing.sales_person_id,
          reminder_type: r.reminder_type,
          due_at: r.due_at.toISOString(),
        }));

        // Delete old reminders first (in case of re-send)
        await admin.from("proposal_reminders").delete().eq("proposal_id", id);
        await admin.from("proposal_reminders").insert(reminderRows);
      }

      // Look up deployment + contact data (needed by both injection and email)
      const { data: deployment } = await admin
        .from("deployments")
        .select("subdomain, github_repo")
        .eq("proposal_id", id)
        .eq("deploy_status", "live")
        .order("deployed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Resolve the live website URL. Composer-published sites store it
      // on the sites row (site_url = friendly URL incl. custom domain,
      // else subdomain); ONLY legacy GitHub-pipeline sites populate the
      // deployments table. We MUST check sites too — otherwise every
      // composer-built proposal resolves liveUrl=null, the email below
      // is skipped, and the CLIENT NEVER RECEIVES THE PROPOSAL while the
      // status still flips to "sent". Fixed 2026-05-29.
      let liveUrl: string | null = deployment?.subdomain
        ? `https://${deployment.subdomain}.pages.dev`
        : null;
      if (!liveUrl) {
        const { data: siteForUrl } = await admin
          .from("sites")
          .select("site_url, subdomain")
          .eq("proposal_id", id)
          .order("last_published_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
        if (siteForUrl?.site_url) {
          liveUrl = siteForUrl.site_url;
        } else if (siteForUrl?.subdomain) {
          liveUrl = `https://${siteForUrl.subdomain}.pages.dev`;
        }
      }

      let contact: { email: string | null; contact_person: string | null; town?: string | null; business_email?: string | null; phone?: string | null } | null = null;
      if (existing.contact_id) {
        const { data: c } = await admin
          .from("contacts")
          .select("email, contact_person, town, business_email, phone")
          .eq("id", existing.contact_id)
          .single();
        contact = c;
      }

      // Channel selection: "email" (default, SMTP send) or "whatsapp"
      // (sales opens wa.me from the browser themselves; server skips
      // SMTP and just logs the handover for traceability).
      const channel = body.channel === "whatsapp" ? "whatsapp" : "email";

      if (channel === "whatsapp") {
        // Log the WhatsApp send. recipient_email is NOT NULL on the
        // table so we store the phone number there with a `whatsapp:`
        // prefix to keep the channel readable in queries even without
        // joining on email_type. body.recipient_phone is the (possibly
        // edited) number from the dialog; fall back to the contact's
        // stored phone if for some reason it wasn't echoed back.
        const recipientPhone =
          (typeof body.recipient_phone === "string" && body.recipient_phone.trim()) ||
          contact?.phone ||
          "";
        await admin.from("proposal_emails").insert({
          proposal_id: id,
          sent_by: existing.sales_person_id,
          email_type: "proposal_whatsapp",
          subject: `Website for ${existing.company_name} — WhatsApp`,
          body_html: body.greeting_text.trim(),
          recipient_email: `whatsapp:${recipientPhone}`,
        });
      } else {
        // Email channel — SMTP send. The proposal email carries the
        // website link + login credentials, so a missing recipient or
        // an unpublished site must HARD-FAIL (return an error) instead
        // of silently no-op'ing while the proposal flips to "sent".
        // Client delivery is critical (Peter 2026-05-29).
        const recipientEmail = recipientOverride || contact?.email || null;
        if (!recipientEmail) {
          return NextResponse.json(
            { error: "The recipient has no email address. Enter one in the To field." },
            { status: 400 },
          );
        }
        if (!liveUrl) {
          return NextResponse.json(
            {
              error:
                "The website is not published yet. Publish it before sending.",
            },
            { status: 400 },
          );
        }
        try {
          const { data: salesProfile } = await admin
            .from("profiles")
            .select("full_name")
            .eq("id", existing.sales_person_id)
            .single();

          // Resolve client-zone credentials so the proposal email
          // ships login details inline (welcome_client step was
          // removed 2026-05-21 — credentials go out with the
          // proposal email itself now). Best-effort: if no site /
          // owner / password exists yet (client zone wasn't created
          // before sending) we just skip the credentials block —
          // buildProposalEmailHtml is conditional on both values
          // being present.
          let loginEmail: string | null = null;
          const loginPassword = (existing as { client_temp_password?: string | null }).client_temp_password ?? null;
          const { data: siteRow } = await admin
            .from("sites")
            .select("owner_id")
            .eq("proposal_id", id)
            .limit(1)
            .maybeSingle();
          if (siteRow?.owner_id) {
            const { data: ownerAuth } = await admin.auth.admin.getUserById(
              siteRow.owner_id,
            );
            loginEmail = ownerAuth?.user?.email ?? null;
          }
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
          const loginUrl = appUrl ? `${appUrl}/login` : null;

          const emailSubject = body.email_subject || `Website for ${existing.company_name}, Your Agency`;

          const html = buildProposalEmailHtml({
            bodyHtml: body.greeting_text.trim(),
            companyName: existing.company_name,
            liveUrl,
            salesPersonName: salesProfile?.full_name || null,
            loginEmail,
            loginPassword,
            loginUrl,
          });

          const emailResult = await sendEmail({
            to: recipientEmail,
            cc: ccList.length > 0 ? ccList : undefined,
            subject: emailSubject,
            html,
            replyTo: process.env.SMTP_USER,
          });
          console.log("[Send] Email result:", emailResult);

          // SMTP rejected the message (sendEmail returns success:false
          // rather than throwing). Surface it so the operator knows the
          // client did NOT get the email — don't mark the proposal sent.
          if (!emailResult.success) {
            return NextResponse.json(
              {
                error: `Failed to send email: ${emailResult.error ?? "unknown error"}`,
              },
              { status: 502 },
            );
          }

          // Log email to proposal_emails table
          await admin.from("proposal_emails").insert({
            proposal_id: id,
            sent_by: existing.sales_person_id,
            email_type: "proposal",
            subject: emailSubject,
            body_html: body.greeting_text.trim(),
            recipient_email: recipientEmail,
          });
        } catch (emailErr) {
          console.error("[Send] Email sending failed:", emailErr);
          return NextResponse.json(
            {
              error: `Failed to send email: ${emailErr instanceof Error ? emailErr.message : "unknown error"}`,
            },
            { status: 502 },
          );
        }
      }

      // Widget injection + client account creation are handled by IT guy
      // in /tech/proposals/[id] (inject-widget button + create-client step).
      // Sales just sends the email — no infrastructure work here.
    }
  }

  const { data, error } = await admin
    .from("proposals")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    userId: user.id,
    action: "update_proposal",
    entityType: "proposal",
    entityId: id,
    details: {
      ...(body.status !== undefined && { status: body.status }),
      company_name: existing.company_name,
      fields_changed: Object.keys(body),
    },
  });

  return NextResponse.json({ proposal: data });
}

/**
 * DELETE /api/proposals/[id] — Delete a draft proposal
 */
export async function DELETE(
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
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("proposals")
    .select("sales_person_id, status")
    .eq("id", id)
    .single();
  if (!existing)
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });

  const role = user.app_metadata?.role as string;
  if (role === "sales" && existing.sales_person_id !== user.id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // Sales can delete submitted or archived proposals. Super admin can delete any.
  const deletableStatuses = ["submitted", "archived"];
  if (!deletableStatuses.includes(existing.status) && role !== "super_admin") {
    return NextResponse.json(
      { error: "Only submitted or archived proposals can be deleted" },
      { status: 400 },
    );
  }

  const { error } = await admin.from("proposals").delete().eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
