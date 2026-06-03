/**
 * POST /api/payments/stripe/create-session
 *
 * Creates a Stripe Checkout session for a credit top-up. Flow:
 *   1. Verify the client owns the site
 *   2. Insert a pending `payments` row (so we have an ID to embed in
 *      Stripe metadata — the webhook uses this ID to look the row up)
 *   3. Create the Checkout session with line item + metadata
 *   4. Return the hosted Checkout URL — caller redirects to it
 *
 * On success → Stripe fires `checkout.session.completed` to our webhook,
 * which credits the balance.
 * On cancel → Stripe redirects back to /client/balance?topup=cancelled,
 * the payment row stays `pending` (becomes vestigial; super_admin can
 * clean up later).
 *
 * Body: { site_id: string, credits: number }   (credits = publish count, 1-100)
 * Returns: { sessionId, url }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/payments/stripe";

const CREDIT_PRICE_EUR = 12.5;

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      {
        error: "Stripe is not configured on the server.",
        hint: "Add STRIPE_SECRET_KEY to environment variables.",
      },
      { status: 503 },
    );
  }

  // ── Auth ──────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Body validation ──────────────────────────────────────
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { site_id, credits } = body as {
    site_id?: unknown;
    credits?: unknown;
  };
  if (
    typeof site_id !== "string" ||
    typeof credits !== "number" ||
    !Number.isInteger(credits) ||
    credits < 1 ||
    credits > 100
  ) {
    return NextResponse.json(
      { error: "Invalid site_id or credits (must be integer 1-100)" },
      { status: 400 },
    );
  }

  // ── Ownership check ──────────────────────────────────────
  const admin = createAdminClient();
  const { data: site } = await admin
    .from("sites")
    .select("id, owner_id, name")
    .eq("id", site_id)
    .eq("owner_id", user.id)
    .single();
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const amountEur = credits * CREDIT_PRICE_EUR;

  // ── Insert pending payment row FIRST ─────────────────────
  // We need its UUID to embed in Stripe metadata — the webhook then
  // looks the row up by that UUID, so even if Stripe sends events out
  // of order or duplicates them, the lookup is exact.
  const { data: payment, error: paymentErr } = await admin
    .from("payments")
    .insert({
      profile_id: user.id,
      site_id: site.id,
      amount: amountEur,
      currency: "EUR",
      payment_method: "stripe",
      status: "pending",
      description: `Pending Stripe: ${credits} publishes (${amountEur} €)`,
    })
    .select("id")
    .single();
  if (paymentErr || !payment) {
    return NextResponse.json(
      { error: `Failed to record pending payment: ${paymentErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  // ── Create Stripe Checkout session ───────────────────────
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin || "http://localhost:3000";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `${credits} publishes`,
              description: `Balance top-up for ${site.name}`,
            },
            // Stripe expects unit_amount in the smallest currency unit
            // (cents). amountEur is a multiple of 12.50, so * 100
            // yields a clean integer.
            unit_amount: Math.round(amountEur * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/client/balance?topup=success`,
      cancel_url: `${origin}/client/balance?topup=cancelled`,
      // Pre-fill the customer's email if we can — saves them typing.
      customer_email: user.email ?? undefined,
      // The webhook reads payment_id to look up the pending row.
      // Other fields are convenience for debugging in the Stripe dashboard.
      metadata: {
        payment_id: payment.id,
        site_id: site.id,
        profile_id: user.id,
        credits: String(credits),
        amount_eur: String(amountEur),
      },
      // 30 min to complete checkout. After this Stripe expires the
      // session — the pending payment row stays in DB but never confirms.
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (err) {
    // Roll back the pending payment row — we don't want orphaned rows
    // from Stripe API failures (network blip, auth failure, etc.).
    await admin.from("payments").delete().eq("id", payment.id);
    const message = err instanceof Error ? err.message : "Unknown Stripe error";
    return NextResponse.json(
      { error: `Stripe error: ${message}` },
      { status: 502 },
    );
  }
}
