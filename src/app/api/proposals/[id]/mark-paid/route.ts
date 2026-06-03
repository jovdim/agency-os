import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { sendEmail, buildClientWelcomeEmailHtml } from "@/lib/email";
import { generateVariableSymbol } from "@/lib/payments/bysquare";
import { publishSite } from "@/lib/templates/publish";

// publishSite -> renderSite downloads section templates from Supabase
// Storage. Without these directives Next.js caches those fetches and
// publishes serve stale template HTML/CSS. Same convention as
// /api/admin/payments/confirm and /api/sites/[id]/publish.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/**
 * POST /api/proposals/[id]/mark-paid
 *
 * Manual payment confirmation for proposals paid OUTSIDE the QR
 * banner flow — invoice paid by bank transfer, cash on a handshake,
 * card-on-file, etc. Mirrors /api/admin/payments/confirm in what it
 * actually does (creates payment + invoice, flips proposal to paid,
 * sets site.is_paid, dismisses reminders, auto-commissions, sends
 * welcome email) but:
 *
 *   1. Auth allows tech_admin + super_admin + sales (their own
 *      proposals only). The original confirm route is super-only
 *      because it was designed for boss-confirms-VS-match. This
 *      route is the day-to-day handover action.
 *   2. Status check is permissive — any non-paid status can transition
 *      to paid (submitted / building / review / revision / sent /
 *      viewed). The confirm route only accepts sent/viewed because
 *      it assumes the QR was hit; here the QR may never have been
 *      involved.
 *   3. Caller picks the `payment_method` (bank_transfer / invoice /
 *      cash / card). confirm-route hardcodes bank_transfer because
 *      it's wired to the bank-notification flow.
 *   4. `send_welcome_email` defaults to true (this IS the handover
 *      moment in the manual flow), but caller can flip it off when
 *      they want to mark paid first and email credentials later.
 *
 * Behaviours kept identical to confirm-route on purpose so revenue
 * reporting + commission accrual + invoice numbering + audit log
 * formatting all stay consistent across the two surfaces. If you
 * change the payment side effects here, update confirm-route too.
 *
 * Body: {
 *   amount: number (required, > 0, EUR),
 *   paid_on?: string (ISO date, default today),
 *   payment_method?: "bank_transfer" | "invoice" | "cash" | "card",
 *   note?: string,
 *   // Optional handover-time updates applied in the same transaction
 *   main_domain?: string | null  // sets sites.domain (and domain_status='active' when non-empty)
 *   starting_credits?: number    // upserts credit_balances.balance to this value
 *   // Welcome email — when `welcome_email.send=true`, operator-edited
 *   // body fields are passed straight to buildClientWelcomeEmailHtml so
 *   // the email Peter sees in the wizard preview is byte-for-byte what
 *   // the client receives. Omit the object to skip the welcome email.
 *   welcome_email?: {
 *     send: boolean,
 *     to?: string,             // recipient (defaults to contact email)
 *     login_email?: string,    // shown in email + synced to auth user
 *     login_password?: string, // shown in email + synced to auth user
 *     custom_message?: string, // appended to the email body
 *   }
 * }
 *
 * Requires the proposal to already have a linked site (created via
 * the standard send/create-client-zone flow or via the migrate-client
 * import). If no site exists, returns 400 with a hint to build the
 * site first.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Auth ──
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = user.app_metadata?.role as string;
  if (!["tech_admin", "super_admin", "sales"].includes(role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { id: proposalId } = await params;

  // ── Body parsing + validation ──
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is acceptable; caller can submit defaults-only via
    // an empty POST. Validation below catches the missing amount.
    body = {};
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount is required and must be a positive number" },
      { status: 400 },
    );
  }
  const paidOnRaw =
    typeof body.paid_on === "string" ? body.paid_on.trim() : "";
  let paidOnIso: string;
  if (paidOnRaw) {
    const parsed = new Date(paidOnRaw);
    if (isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: "paid_on must be a valid date" },
        { status: 400 },
      );
    }
    paidOnIso = parsed.toISOString();
  } else {
    paidOnIso = new Date().toISOString();
  }
  const allowedMethods = new Set([
    "bank_transfer",
    "invoice",
    "cash",
    "card",
    // Catch-all so off-channel payments (PayPal, partial-on-handshake,
    // platform-specific gateway, etc.) can still be recorded with the
    // exact details kept in the internal note. Keeps the payments
    // table values bounded while letting reality through.
    "other",
  ]);
  const paymentMethodRaw =
    typeof body.payment_method === "string" ? body.payment_method : "";
  const paymentMethod = allowedMethods.has(paymentMethodRaw)
    ? paymentMethodRaw
    : "bank_transfer";
  const note = typeof body.note === "string" ? body.note.trim() : "";

  // ── Main domain (sites.domain) ──
  // The wizard surfaces this so Peter records what the client uses as
  // their main customer-facing domain (e.g. balkar.sk). Empty string
  // or null = no change to the existing value. Bare hostname only —
  // strip protocol + trailing slash so a copy-paste from the browser
  // bar doesn't poison the DNS lookup.
  let mainDomain: string | null | undefined = undefined;
  if (body.main_domain !== undefined) {
    if (body.main_domain === null) {
      mainDomain = null;
    } else if (typeof body.main_domain === "string") {
      const cleaned = body.main_domain
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "")
        .replace(/\s+/g, "");
      mainDomain = cleaned || null;
    }
  }

  // ── Starting credits override ──
  let startingCredits: number | undefined = undefined;
  if (body.starting_credits !== undefined && body.starting_credits !== null) {
    const parsed = Number(body.starting_credits);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return NextResponse.json(
        { error: "starting_credits must be 0 or higher" },
        { status: 400 },
      );
    }
    startingCredits = parsed;
  }

  // ── Welcome email payload ──
  // Wizard sends the operator-edited preview values so the email the
  // client gets matches what Peter saw on screen. Backward compat:
  // when the wizard isn't in play, old callers can still pass the
  // bare `send_welcome_email` boolean and we fall back to contact
  // email + stored temp password.
  type WelcomeEmailInput = {
    send: boolean;
    to?: string;
    login_email?: string;
    login_password?: string;
    custom_message?: string;
  };
  const welcomeEmailInput: WelcomeEmailInput | null = (() => {
    if (body.welcome_email && typeof body.welcome_email === "object") {
      const w = body.welcome_email as Record<string, unknown>;
      return {
        send: w.send === true,
        to: typeof w.to === "string" ? w.to.trim() : undefined,
        login_email:
          typeof w.login_email === "string" ? w.login_email.trim() : undefined,
        login_password:
          typeof w.login_password === "string"
            ? w.login_password
            : undefined,
        custom_message:
          typeof w.custom_message === "string"
            ? w.custom_message.trim()
            : undefined,
      };
    }
    // Legacy boolean fallback (default true preserves old call sites)
    const legacy =
      body.send_welcome_email === undefined ||
      body.send_welcome_email === true;
    return { send: legacy };
  })();

  const admin = createAdminClient();

  // ── Fetch proposal + linked site + contact ──
  const { data: proposal } = await admin
    .from("proposals")
    .select(
      `
        id,
        slug,
        company_name,
        status,
        sales_person_id,
        contact_id,
        variable_symbol,
        client_temp_password,
        contacts(contact_person, email, company_name)
      `,
    )
    .eq("id", proposalId)
    .maybeSingle();

  if (!proposal) {
    return NextResponse.json(
      { error: "Proposal not found" },
      { status: 404 },
    );
  }

  // Sales scope check — same own-only rule as elsewhere.
  if (role === "sales" && proposal.sales_person_id !== user.id) {
    return NextResponse.json(
      { error: "You can only mark your own proposals as paid" },
      { status: 403 },
    );
  }

  // Idempotency — already-paid proposals can't be paid twice.
  if (proposal.status === "paid") {
    return NextResponse.json(
      { error: "This proposal is already marked as paid" },
      { status: 409 },
    );
  }

  // ── Find linked site (must exist) ──
  const { data: site } = await admin
    .from("sites")
    .select("id, owner_id")
    .eq("proposal_id", proposalId)
    .maybeSingle();

  if (!site) {
    return NextResponse.json(
      {
        error:
          "No site linked to this proposal yet. Build the site (or send the proposal so the client zone gets created) before marking paid.",
      },
      { status: 400 },
    );
  }

  // Defensive: don't allow two confirmed payments on the same
  // proposal even if status somehow drifted. Mirrors confirm-route.
  const { data: existingPayment } = await admin
    .from("payments")
    .select("id")
    .eq("proposal_id", proposalId)
    .eq("status", "confirmed")
    .maybeSingle();
  if (existingPayment) {
    return NextResponse.json(
      { error: "A confirmed payment already exists for this proposal" },
      { status: 409 },
    );
  }

  const variableSymbol =
    proposal.variable_symbol || generateVariableSymbol(proposal.id);

  // ── Payment row ──
  const methodLabel: Record<string, string> = {
    bank_transfer: "Bank transfer payment",
    invoice: "Invoice payment",
    cash: "Cash payment",
    card: "Card payment",
    // "Other" deliberately keeps the generic "Payment" so the
    // description on the invoice stays neutral; the operator's
    // note carries the actual channel for bookkeeping.
    other: "Payment",
  };
  const description = `${methodLabel[paymentMethod] ?? "Payment"} - VS: ${variableSymbol}${note ? ` · ${note}` : ""}`;

  const { data: payment, error: paymentErr } = await admin
    .from("payments")
    .insert({
      profile_id: site.owner_id,
      site_id: site.id,
      proposal_id: proposal.id,
      amount,
      currency: "EUR",
      payment_method: paymentMethod,
      status: "confirmed",
      description,
    })
    .select("id")
    .single();

  if (paymentErr || !payment) {
    return NextResponse.json(
      { error: paymentErr?.message || "Failed to create payment row" },
      { status: 500 },
    );
  }

  // ── Update proposal: paid + banner off ──
  const { error: proposalErr } = await admin
    .from("proposals")
    .update({
      status: "paid",
      paid_at: paidOnIso,
      show_banner: false,
    })
    .eq("id", proposal.id);
  if (proposalErr) {
    return NextResponse.json(
      { error: proposalErr.message },
      { status: 500 },
    );
  }

  // ── Silent republish so the deployed HTML loses the QR widget ──
  // Fire-and-forget; same pattern as confirm-route. A republish hiccup
  // doesn't invalidate the payment.
  publishSite(site.id, user.id, "auto_banner_toggle", new Map(), {
    silent: true,
  }).catch((err) => {
    console.error(
      "[MarkPaid] Banner republish failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  });

  // ── Dismiss all open reminders for this proposal ──
  await admin
    .from("proposal_reminders")
    .update({ is_dismissed: true })
    .eq("proposal_id", proposal.id)
    .eq("is_dismissed", false);

  // ── Invoice generation (FV-YYYYMMDD-NNN) ──
  // Numbered against the paid date — not today — so an invoice issued
  // for a payment that landed last month carries last month's date in
  // the prefix (mirrors confirm-route logic on this point).
  const dateBase = new Date(paidOnIso);
  const dateStr =
    dateBase.getFullYear().toString() +
    String(dateBase.getMonth() + 1).padStart(2, "0") +
    String(dateBase.getDate()).padStart(2, "0");
  const prefix = `FV-${dateStr}-`;

  const { data: lastInvoice } = await admin
    .from("invoices")
    .select("invoice_number")
    .like("invoice_number", `${prefix}%`)
    .order("invoice_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  let seq = 1;
  if (lastInvoice?.invoice_number) {
    const lastSeq = parseInt(
      lastInvoice.invoice_number.replace(prefix, ""),
      10,
    );
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }
  const invoiceNumber = `${prefix}${String(seq).padStart(3, "0")}`;

  const { error: invoiceErr } = await admin.from("invoices").insert({
    invoice_number: invoiceNumber,
    type: "invoice",
    profile_id: site.owner_id,
    site_id: site.id,
    payment_id: payment.id,
    amount,
    vat_amount: 0,
    line_items: [
      {
        description: `Website creation - ${proposal.company_name}`,
        quantity: 1,
        unit_price: amount,
        vat_rate: 0,
        total: amount,
      },
    ],
    issued_at: paidOnIso,
    paid_at: paidOnIso,
  });
  if (invoiceErr) {
    console.error("[MarkPaid] Invoice creation failed:", invoiceErr);
    // Non-blocking — payment already confirmed
  }

  // ── Set site as paid + billing cycle dates (+ optional main domain) ──
  const liveDate = new Date(paidOnIso);
  const nextBilling = new Date(paidOnIso);
  nextBilling.setFullYear(nextBilling.getFullYear() + 1);

  const siteUpdate: Record<string, unknown> = {
    is_paid: true,
    website_live_date: liveDate.toISOString().split("T")[0],
    next_billing_date: nextBilling.toISOString().split("T")[0],
    billing_cycle_months: 12,
  };
  // Wizard captures the customer-facing main domain at handover. Flip
  // domain_status to 'active' so the domain card on the client zone
  // stops nagging them to choose one. Null = explicit clear, undefined
  // = no change.
  if (mainDomain !== undefined) {
    siteUpdate.domain = mainDomain;
    if (mainDomain) {
      siteUpdate.domain_status = "active";
      siteUpdate.domain_decided_at = new Date().toISOString();
    }
  }
  await admin.from("sites").update(siteUpdate).eq("id", site.id);

  // ── Starting credits override (wizard) ──
  // Upsert keyed on site_id so a freshly-created balance row OR an
  // existing row both end up at the requested amount. Skipped when
  // the wizard didn't pass it so the row is left alone for callers
  // that don't care about credits at this step.
  if (startingCredits !== undefined) {
    await admin
      .from("credit_balances")
      .upsert(
        { site_id: site.id, balance: startingCredits },
        { onConflict: "site_id" },
      );
  }

  // ── Promote draft change_requests to pending (legacy path) ──
  await admin
    .from("change_requests")
    .update({ status: "pending" })
    .eq("site_id", site.id)
    .eq("status", "draft");

  // ── Mark contact as client + converted ──
  if (proposal.contact_id) {
    await admin
      .from("contacts")
      .update({ client_status: "client", status: "converted" })
      .eq("id", proposal.contact_id);
  }

  // ── Auto-create commission for the salesperson ──
  if (proposal.sales_person_id) {
    const { data: rateData } = await admin
      .from("commission_rates")
      .select("rate")
      .eq("sales_person_id", proposal.sales_person_id)
      .maybeSingle();
    const rate = rateData?.rate || 0.1;
    const commissionAmount = Math.round(amount * rate * 100) / 100;
    if (commissionAmount > 0) {
      await admin.from("commissions").insert({
        sales_person_id: proposal.sales_person_id,
        proposal_id: proposal.id,
        payment_id: payment.id,
        amount: commissionAmount,
        is_paid: false,
      });
    }
  }

  // ── Welcome email ──
  // The manual-mark flow IS the handover moment, so emailing
  // credentials is the natural next step. Wizard passes operator-
  // edited recipient + login + password + custom message so the email
  // matches the preview byte-for-byte. Legacy callers (boolean flag,
  // no payload) still work via the fallback inside welcomeEmailInput.
  //
  // Non-blocking on failure: payment is already confirmed, the wizard
  // surfaces a "Retry email" CTA in the success view based on the
  // `welcome_email_sent` flag in the response.
  let welcomeEmailSent = false;
  let welcomeEmailError: string | null = null;
  if (welcomeEmailInput?.send) {
    try {
      const contact = Array.isArray(proposal.contacts)
        ? proposal.contacts[0]
        : proposal.contacts;
      const fallbackRecipient = contact?.email ?? null;
      const recipientEmail =
        welcomeEmailInput.to || fallbackRecipient || null;
      const loginEmail =
        welcomeEmailInput.login_email ||
        recipientEmail ||
        fallbackRecipient ||
        null;
      const loginPassword =
        welcomeEmailInput.login_password || proposal.client_temp_password || null;
      const fullName =
        contact?.contact_person ||
        contact?.company_name ||
        recipientEmail ||
        proposal.company_name;

      if (!recipientEmail) {
        welcomeEmailError = "No recipient email on file";
      } else if (!loginPassword) {
        welcomeEmailError = "No login password to share";
      } else {
        const dashboardUrl =
          process.env.NEXT_PUBLIC_CLIENT_URL ||
          process.env.NEXT_PUBLIC_SITE_URL ||
          "https://client.pages.dev";
        const loginUrl = `${dashboardUrl}/login`;

        const { data: siteRow } = await admin
          .from("sites")
          .select("site_url, name")
          .eq("id", site.id)
          .single();

        const html = buildClientWelcomeEmailHtml({
          fullName,
          companyName: proposal.company_name || undefined,
          loginEmail,
          loginPassword,
          siteUrl: siteRow?.site_url || undefined,
          loginUrl,
          customMessage: welcomeEmailInput.custom_message || undefined,
        });

        const subject = `Your client zone — ${proposal.company_name || siteRow?.name || "Your Agency"}`;
        const result = await sendEmail({
          to: recipientEmail,
          subject,
          html,
          type: "client",
        });

        if (result.success) {
          welcomeEmailSent = true;
          await admin.from("proposal_emails").insert({
            proposal_id: proposal.id,
            sent_by: user.id,
            email_type: "welcome",
            subject,
            body_html: html,
            recipient_email: recipientEmail,
          });

          // Sync the operator-chosen login/password to the auth user
          // so the client can actually log in with what the email shows.
          // Mirrors /api/admin/clients/send-welcome behaviour. Best
          // effort — auth user might not exist yet for proposals that
          // never minted a client zone.
          if (loginEmail && loginPassword) {
            try {
              const normalizedEmail = loginEmail.toLowerCase();
              const { data: usersList } =
                await admin.auth.admin.listUsers({ perPage: 1000 });
              const match = usersList?.users?.find(
                (u) => u.email?.toLowerCase() === normalizedEmail,
              );
              if (match) {
                await admin.auth.admin.updateUserById(match.id, {
                  password: loginPassword,
                });
              }
              await admin
                .from("proposals")
                .update({ client_temp_password: loginPassword })
                .eq("id", proposal.id);
            } catch (syncErr) {
              console.error(
                "[MarkPaid] Welcome email password sync failed (non-fatal):",
                syncErr,
              );
            }
          }
        } else {
          welcomeEmailError = result.error || "SMTP send failed";
        }
      }
    } catch (err) {
      welcomeEmailError =
        err instanceof Error ? err.message : "Unknown email send error";
      console.error("[MarkPaid] Welcome email send failed:", err);
      // Non-blocking — payment is already confirmed.
    }
  }

  // ── Audit log ──
  await logAudit({
    userId: user.id,
    action: "mark_proposal_paid",
    entityType: "payment",
    entityId: payment.id,
    details: {
      proposal_id: proposal.id,
      company_name: proposal.company_name,
      variable_symbol: variableSymbol,
      amount,
      paid_on: paidOnIso,
      payment_method: paymentMethod,
      note: note || null,
      invoice_number: invoiceNumber,
      welcome_email_sent: welcomeEmailSent,
      welcome_email_error: welcomeEmailError,
      main_domain: mainDomain ?? null,
      starting_credits: startingCredits ?? null,
      from_status: proposal.status,
    },
  });

  return NextResponse.json({
    success: true,
    payment_id: payment.id,
    invoice_number: invoiceNumber,
    welcome_email_sent: welcomeEmailSent,
    welcome_email_error: welcomeEmailError,
    main_domain: mainDomain ?? null,
    starting_credits: startingCredits ?? null,
  });
}
