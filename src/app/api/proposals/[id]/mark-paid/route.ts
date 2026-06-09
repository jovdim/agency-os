import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  confirmProposalPayment,
  type WelcomeEmailInput,
} from "@/lib/payments/confirm-proposal-payment";

// confirmProposalPayment -> publishSite -> renderSite downloads section
// templates from Supabase Storage. Without these directives Next.js caches
// those fetches and publishes serve stale template HTML/CSS. Same
// convention as /api/sites/[id]/publish.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/**
 * POST /api/proposals/[id]/mark-paid
 *
 * MANUAL payment confirmation, for proposals paid OUTSIDE the Stripe
 * card flow — cash on a handshake, an off-channel bank transfer, etc.
 * The normal path is now automatic: the client pays by card on their
 * live site, Stripe fires checkout.session.completed, and the webhook
 * (/api/payments/stripe/webhook) confirms the payment with no human in
 * the loop. This route is the operator override for everything else.
 *
 * Both surfaces call the SAME `confirmProposalPayment` helper, so manual
 * and automatic payments produce identical records (payment row, invoice,
 * paid status, banner-off republish, reminders, commission, welcome
 * email). The only differences here are:
 *
 *   1. Auth — tech_admin + super_admin + sales (their own proposals only).
 *   2. The caller picks the `payment_method` + `amount` (the webhook
 *      reads the amount Stripe actually charged).
 *   3. Optional handover-time site updates (main_domain, starting_credits)
 *      that only make sense in the manual wizard.
 *   4. `send_welcome_email` defaults to true (this IS the handover moment
 *      in the manual flow), but the caller can flip it off.
 *
 * Body: {
 *   amount: number (required, > 0, EUR),
 *   paid_on?: string (ISO date, default today),
 *   payment_method?: "bank_transfer" | "invoice" | "cash" | "card" | "other",
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

  // ── Sales scope check — own proposals only ──
  // confirmProposalPayment re-fetches the proposal internally, but the
  // sales own-only rule must run BEFORE we mutate anything, so do a cheap
  // ownership lookup up front.
  const { data: scope } = await admin
    .from("proposals")
    .select("sales_person_id")
    .eq("id", proposalId)
    .maybeSingle();
  if (!scope) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }
  if (role === "sales" && scope.sales_person_id !== user.id) {
    return NextResponse.json(
      { error: "You can only mark your own proposals as paid" },
      { status: 403 },
    );
  }

  // ── Run the shared payment-confirmation side-effects ──
  // Identical code path to the Stripe webhook, so manual + automatic
  // payments produce the same records.
  const result = await confirmProposalPayment(admin, {
    proposalId,
    amount,
    paymentMethod,
    paidOnIso,
    note,
    actorUserId: user.id,
    mainDomain,
    startingCredits,
    welcomeEmail: welcomeEmailInput ?? undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // ── Audit log ──
  await logAudit({
    userId: user.id,
    action: "mark_proposal_paid",
    entityType: "payment",
    entityId: result.paymentId,
    details: {
      proposal_id: proposalId,
      company_name: result.companyName,
      variable_symbol: result.variableSymbol,
      amount,
      paid_on: paidOnIso,
      payment_method: paymentMethod,
      note: note || null,
      invoice_number: result.invoiceNumber,
      welcome_email_sent: result.welcomeEmailSent,
      welcome_email_error: result.welcomeEmailError,
      main_domain: mainDomain ?? null,
      starting_credits: startingCredits ?? null,
      from_status: result.fromStatus,
    },
  });

  return NextResponse.json({
    success: true,
    payment_id: result.paymentId,
    invoice_number: result.invoiceNumber,
    welcome_email_sent: result.welcomeEmailSent,
    welcome_email_error: result.welcomeEmailError,
    main_domain: mainDomain ?? null,
    starting_credits: startingCredits ?? null,
  });
}
