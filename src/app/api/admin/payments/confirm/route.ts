import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getActivePrice } from "@/lib/payments/proposal-utils";
import { generateVariableSymbol } from "@/lib/payments/bysquare";
// Welcome-email helpers no longer imported here (Peter 2026-05-15) —
// see step 16 below for the policy change. Operator drives the email
// send manually via SendWelcomeEmailDialog from the proposal timeline
// or the Live Clients detail page.
import { publishSite } from "@/lib/templates/publish";

// publishSite -> renderSite downloads section templates from Supabase
// Storage via native fetch (Supabase JS internals). Without these
// directives Next.js caches those fetches and re-publishes serve stale
// template HTML/CSS. Matches `/api/sites/[id]/publish/route.ts` +
// `/api/sites/[id]/render/route.ts`.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/**
 * POST /api/admin/payments/confirm
 * Confirm a bank transfer payment for a proposal.
 * Only super_admin can call this.
 *
 * Body: { proposal_id, amount, note? }
 */
export async function POST(req: NextRequest) {
  // Allow cron jobs to call this with CRON_SECRET header
  const cronSecret = req.headers.get("x-cron-secret");
  const isCronAuth = cronSecret && process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;

  let userId: string | null = null;

  if (!isCronAuth) {
    // Normal auth — require super_admin
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = user.app_metadata?.role as string;
    if (role !== "super_admin") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    userId = user.id;
  }

  const body = await req.json();
  const { proposal_id, amount, note } = body as {
    proposal_id: string;
    amount: number;
    note?: string;
  };

  if (!proposal_id || !amount || amount <= 0) {
    return NextResponse.json(
      { error: "proposal_id and a positive amount are required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // 1. Fetch proposal
  const { data: proposal } = await admin
    .from("proposals")
    .select(
      "id, slug, company_name, status, discount_price, base_price, discount_expires_at, variable_symbol, sales_person_id, contact_id",
    )
    .eq("id", proposal_id)
    .single();

  if (!proposal) {
    return NextResponse.json(
      { error: "Proposal not found" },
      { status: 404 },
    );
  }

  // 2. Validate status — only sent or viewed proposals can be confirmed
  if (!["sent", "viewed"].includes(proposal.status)) {
    return NextResponse.json(
      {
        error:
          proposal.status === "paid"
            ? "This proposal has already been paid"
            : `Cannot confirm payment for proposal with status "${proposal.status}"`,
      },
      { status: 409 },
    );
  }

  // 3. Check for existing confirmed payment (prevent double-confirm)
  const { data: existingPayment } = await admin
    .from("payments")
    .select("id")
    .eq("proposal_id", proposal_id)
    .eq("status", "confirmed")
    .maybeSingle();

  if (existingPayment) {
    return NextResponse.json(
      { error: "A confirmed payment already exists for this proposal" },
      { status: 409 },
    );
  }

  // 4. Find the site created for this proposal
  const { data: site } = await admin
    .from("sites")
    .select("id, owner_id")
    .eq("proposal_id", proposal_id)
    .maybeSingle();

  if (!site) {
    return NextResponse.json(
      {
        error:
          "No site found for this proposal. The site may not have been created yet — check the proposal send flow.",
      },
      { status: 400 },
    );
  }

  // 5. Compute expected amount for audit logging
  const expectedAmount = getActivePrice({
    discount_price: proposal.discount_price,
    base_price: proposal.base_price,
    discount_expires_at: proposal.discount_expires_at,
  });

  const variableSymbol =
    proposal.variable_symbol || generateVariableSymbol(proposal.id);

  // 6. Create payment record
  const { data: payment, error: paymentErr } = await admin
    .from("payments")
    .insert({
      profile_id: site.owner_id,
      site_id: site.id,
      proposal_id: proposal.id,
      amount,
      currency: "EUR",
      payment_method: "bank_transfer",
      status: "confirmed",
      description: `Website payment - VS: ${variableSymbol}`,
    })
    .select()
    .single();

  if (paymentErr || !payment) {
    return NextResponse.json(
      { error: paymentErr?.message || "Failed to create payment record" },
      { status: 500 },
    );
  }

  // 7. Update proposal status to paid + flip the payment banner OFF.
  //    Showing a "pay now" QR on a site whose owner already paid is
  //    the worst possible UX moment — they open the site to admire
  //    it post-payment and see "still owes €1111". We turn it off
  //    in the same write that flips status to paid so there's no
  //    window where the row says paid but the banner flag says ON.
  const { error: proposalErr } = await admin
    .from("proposals")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      show_banner: false,
    })
    .eq("id", proposal.id);

  if (proposalErr) {
    return NextResponse.json(
      { error: proposalErr.message },
      { status: 500 },
    );
  }

  // 7b. Silent republish so the deployed HTML loses the widget
  //     <script> tag. Same mechanism BannerDisableDialog uses on
  //     the timeline. We call publishSite() directly rather than
  //     HTTP-fetching the publish endpoint — this route is already
  //     in a privileged server context (caller is super_admin or
  //     authenticated cron) so an HTTP round-trip just adds latency
  //     and an auth dance we don't need.
  //
  //     Fire-and-forget — payment is already confirmed and any
  //     republish hiccup (Cloudflare hiccup, race with a concurrent
  //     edit) doesn't invalidate the payment. If it fails, sales
  //     can manually click Disable on the banner launcher to retry;
  //     the row will already be in the right state so the retry is
  //     a republish-only no-op on the DB side.
  //
  //     We pass an empty PendingFilesMap because banner-toggle
  //     republishes never carry new images — composition is read
  //     fresh from the DB and any pending: URLs were already
  //     resolved by an earlier publish.
  publishSite(
    site.id,
    userId || "system-cron",
    "auto_banner_toggle",
    new Map(),
    { silent: true },
  ).catch((err) => {
    console.error(
      "[ConfirmPayment] Banner republish failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  });

  // 8. Dismiss all reminders for this proposal
  await admin
    .from("proposal_reminders")
    .update({ is_dismissed: true })
    .eq("proposal_id", proposal.id)
    .eq("is_dismissed", false);

  // 9. Generate invoice number: FV-YYYYMMDD-NNN
  const today = new Date();
  const dateStr =
    today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");
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

  // 10. Create invoice (not a VAT payer — vat_amount = 0)
  const { data: invoice, error: invoiceErr } = await admin
    .from("invoices")
    .insert({
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
      issued_at: today.toISOString(),
      paid_at: today.toISOString(),
    })
    .select()
    .single();

  if (invoiceErr) {
    console.error("[ConfirmPayment] Invoice creation failed:", invoiceErr);
    // Non-blocking — payment is already confirmed
  }

  // 11. Audit log
  await logAudit({
    userId: userId || "system-cron",
    action: isCronAuth ? "auto_confirm_bank_transfer" : "confirm_bank_transfer",
    entityType: "payment",
    entityId: payment.id,
    details: {
      proposal_id: proposal.id,
      company_name: proposal.company_name,
      variable_symbol: variableSymbol,
      amount,
      expected_amount: expectedAmount,
      amount_matches: amount === expectedAmount,
      note: note || null,
      invoice_number: invoice?.invoice_number || null,
    },
  });

  // 12. Set site as paid + set billing dates (1-year service from today)
  const liveDate = new Date();
  const nextBilling = new Date();
  nextBilling.setFullYear(nextBilling.getFullYear() + 1);

  await admin
    .from("sites")
    .update({
      is_paid: true,
      website_live_date: liveDate.toISOString().split("T")[0],
      next_billing_date: nextBilling.toISOString().split("T")[0],
      billing_cycle_months: 12,
    })
    .eq("id", site.id);

  // 13. Initial credit balance is NOT granted here anymore.
  // Per Peter 2026-05-11: the only automatic grant happens when the
  // client zone is activated (POST /api/proposals/[id]/create-client-zone
  // grants 37.50 € = 3 free publishes), regardless of payment status.
  // Payment confirmation adds nothing to the credit balance — the
  // client already has their starter balance from activation, and
  // top-ups go through tech grants or Stripe/BySquare (future work).

  // 14. Convert draft change requests to pending.
  // TODO(2026-05-11): legacy-only behavior — modern composer clients no
  // longer create change_requests. This is a no-op for them but stays
  // active for any remaining is_legacy=true sites. Same deferred decision.
  await admin
    .from("change_requests")
    .update({ status: "pending" })
    .eq("site_id", site.id)
    .eq("status", "draft");

  // 14b. Flag contact as client (exclude from calling database)
  if (proposal.contact_id) {
    await admin
      .from("contacts")
      .update({ client_status: "client", status: "converted" })
      .eq("id", proposal.contact_id);
  }

  // 15. Auto-create commission for salesperson
  if (proposal.sales_person_id) {
    const { data: rateData } = await admin
      .from("commission_rates")
      .select("rate")
      .eq("sales_person_id", proposal.sales_person_id)
      .maybeSingle();

    const rate = rateData?.rate || 0.1; // default 10%
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

  // 16. Welcome email — NOT sent here (Peter 2026-05-15).
  //
  // Policy change: payment confirmation (both the cron auto-confirm
  // and the boss's manual /super/payments confirm) ONLY records the
  // payment. It no longer fires the credentials handoff email.
  //
  // Why: the contact email captured at proposal time is often stale
  // by the time payment lands (client may have used a different
  // login email, may want a fresh address, etc.). Auto-sending to a
  // wrong / old address ships credentials to the wrong inbox and the
  // operator can't tell until the client complains. The trade-off
  // is one extra click after each confirmed payment, but it's an
  // operator-controlled click with preview.
  //
  // Where the welcome email gets sent now (all three paths use the
  // SAME SendWelcomeEmailDialog with preview + editable fields):
  //   1. Proposal timeline (/tech|sales/proposals/[id]) →
  //      step "Welcome client" → click → dialog opens.
  //   2. Live Clients detail (/super|tech|sales/live-clients/[id]) →
  //      header "Send welcome email" button → dialog opens.
  //   3. Mark-as-paid flow → optional "Open welcome email after saving"
  //      checkbox → dialog auto-opens after the mark-paid completes.
  //
  // The operator sees the "Welcome client" step on the timeline still
  // showing as `active` after payment — that's the visible task
  // pointer that credentials haven't been sent yet. Re-clicking the
  // launcher in the dialog re-sends if needed.
  //
  // The `proposalFull` re-fetch (which used to read client_temp_password
  // for this block) is also removed — no caller below references it.

  return NextResponse.json({
    payment,
    invoice: invoice || null,
    proposal: {
      id: proposal.id,
      company_name: proposal.company_name,
      status: "paid",
    },
  });
}
