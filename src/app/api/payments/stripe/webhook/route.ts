/**
 * POST /api/payments/stripe/webhook
 *
 * Receives `checkout.session.completed` events from Stripe and credits
 * the client's site balance. Signature-validated using STRIPE_WEBHOOK_SECRET
 * so unauthenticated callers (or replays of old payloads) are rejected.
 *
 * Idempotent: if the payment row's status is already `confirmed`, we
 * acknowledge and skip — Stripe retries webhooks for up to 3 days on
 * any non-200 response, and the dashboard occasionally fires the same
 * event twice in a single delivery.
 *
 * On `checkout.session.completed` (the success event):
 *   - Look up the pending `payments` row by metadata.payment_id
 *   - Bump credit_balances.balance
 *   - Insert credit_transactions row (type='purchase')
 *   - Flip payments.status to 'confirmed'
 *   - Audit log: stripe_payment_confirmed
 *
 * All other event types are 200-acknowledged without action (so Stripe
 * stops retrying) so we can subscribe broadly without breaking on
 * uninteresting events.
 *
 * IMPORTANT: This route MUST read the raw request body — the Stripe
 * SDK signature check compares against the exact bytes sent. Next.js
 * App Router preserves the raw body when we use `req.text()`.
 */
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getStripe } from "@/lib/payments/stripe";

export const runtime = "nodejs"; // Stripe SDK + raw body need Node runtime, not edge.

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook not configured" },
      { status: 503 },
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  // Read raw body (signature is computed over the exact bytes Stripe sent).
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    console.error("[Stripe webhook] Signature verification failed:", message);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 },
    );
  }

  // ── Handle checkout.session.completed ────────────────────
  // This is the only event type we currently act on. Stripe will keep
  // retrying for up to 3 days if we return non-200, so always 200 even
  // on app-level errors (we surface them in the response body for
  // dashboard visibility but don't fail the webhook).
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = session.metadata ?? {};
    const paymentId = metadata.payment_id;
    const profileIdFromMeta = metadata.profile_id;

    if (!paymentId) {
      console.error("[Stripe webhook] Missing payment_id in session metadata", {
        sessionId: session.id,
      });
      return NextResponse.json({
        received: true,
        warning: "Missing payment_id in metadata",
      });
    }

    const admin = createAdminClient();
    const { data: payment } = await admin
      .from("payments")
      .select("id, site_id, amount, profile_id, status")
      .eq("id", paymentId)
      .maybeSingle();

    if (!payment) {
      console.error(
        `[Stripe webhook] Pending payment not found: ${paymentId}`,
        { sessionId: session.id },
      );
      // 200 so Stripe doesn't retry forever — the row is gone, retries
      // won't change that.
      return NextResponse.json({
        received: true,
        warning: "Payment row not found",
      });
    }

    // Idempotency: if already confirmed, ack + skip
    if (payment.status === "confirmed") {
      return NextResponse.json({ received: true, already_confirmed: true });
    }

    if (!payment.site_id) {
      console.error(
        `[Stripe webhook] Payment has no site_id: ${paymentId}`,
      );
      return NextResponse.json({
        received: true,
        warning: "Payment has no site_id",
      });
    }

    // Use the actual paid amount from Stripe (in cents → $). Should
    // match payment.amount exactly since we built the session that way,
    // but Stripe is the source of truth for what the customer was
    // actually charged.
    const paidAmountEur =
      typeof session.amount_total === "number"
        ? session.amount_total / 100
        : Number(payment.amount);

    // 1. Bump balance
    const { data: balanceRow } = await admin
      .from("credit_balances")
      .select("balance")
      .eq("site_id", payment.site_id)
      .maybeSingle();
    const currentBalance = Number(balanceRow?.balance ?? 0);
    const newBalance = Number((currentBalance + paidAmountEur).toFixed(2));

    const balanceWrite = balanceRow
      ? await admin
          .from("credit_balances")
          .update({ balance: newBalance })
          .eq("site_id", payment.site_id)
      : await admin
          .from("credit_balances")
          .insert({ site_id: payment.site_id, balance: newBalance });
    if (balanceWrite.error) {
      console.error(
        `[Stripe webhook] Balance update failed: ${balanceWrite.error.message}`,
      );
      return NextResponse.json({
        received: true,
        warning: `balance update failed: ${balanceWrite.error.message}`,
      });
    }

    // 2. Log the credit transaction
    const { error: txErr } = await admin.from("credit_transactions").insert({
      site_id: payment.site_id,
      user_id: payment.profile_id,
      amount: paidAmountEur,
      type: "purchase",
      payment_id: payment.id,
      note: `Stripe Checkout · session ${session.id}`,
    });
    if (txErr) {
      console.error(`[Stripe webhook] tx insert failed: ${txErr.message}`);
    }

    // 3. Mark payment confirmed
    const { error: updErr } = await admin
      .from("payments")
      .update({ status: "confirmed" })
      .eq("id", payment.id);
    if (updErr) {
      console.error(`[Stripe webhook] payment update failed: ${updErr.message}`);
    }

    // 4. Audit log
    await logAudit({
      userId: payment.profile_id || profileIdFromMeta || "system",
      action: "stripe_payment_confirmed",
      entityType: "site",
      entityId: payment.site_id,
      details: {
        payment_id: payment.id,
        stripe_session_id: session.id,
        paid_amount_eur: paidAmountEur,
        new_balance_eur: newBalance,
        customer_email: session.customer_email,
      },
    });

    console.log(
      `[Stripe webhook] ✓ Credited $${paidAmountEur} to site=${payment.site_id} (session=${session.id})`,
    );

    return NextResponse.json({ received: true, confirmed: true });
  }

  // Any other event type — acknowledge so Stripe stops retrying.
  return NextResponse.json({ received: true, type: event.type, handled: false });
}
