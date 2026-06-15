/**
 * POST /api/payments/stripe/create-session
 *
 * Creates a Stripe Checkout session for a credit top-up. Two callers:
 *   - CRM client/staff: authenticated by a Supabase session; must own the site.
 *   - Per-site CMS admin (theirdomain.com/admin): authenticated by the host-
 *     scoped site-admin cookie (no Supabase user). The payment is attributed to
 *     the site's owner profile, and Stripe returns the user to /admin/balance on
 *     their own host.
 *
 * Flow: validate → resolve caller + ownership → insert a pending `payments` row
 * (its UUID rides in Stripe metadata so the webhook can find it) → create the
 * Checkout session → return the hosted URL.
 *
 * Body: { site_id: string, credits: number }   (credits = publish count, 1-100)
 * Returns: { sessionId, url }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/payments/stripe";
import { getSiteAdminForSite } from "@/lib/platform/site-admin-guard";
import { rateLimit } from "@/lib/platform/rate-limit";

const CREDIT_PRICE_EUR = 12.5;

/** 402 for topping up a site that hasn't paid its activation fee — the credit
 *  would be unspendable (publish gates on is_paid first). Fresh response per
 *  call (a shared NextResponse instance can't be returned twice). */
function unpaidResponse() {
  return NextResponse.json(
    {
      error:
        "Your website isn't active yet — the website fee must be paid before topping up.",
      code: "SITE_NOT_PAID",
    },
    { status: 402 },
  );
}

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

  // ── Body validation (parsed first — site_id is needed to authorize a
  //    cookie-only site admin before we touch the DB). ──
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { site_id, credits } = body as { site_id?: unknown; credits?: unknown };
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

  // ── Auth + ownership ─────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = createAdminClient();

  let profileId: string; // who the payment is attributed to (a profiles row)
  let siteName: string;
  let customerEmail: string | undefined;
  let returnBase: string; // where Stripe sends the user back

  if (user) {
    // CRM client/staff — must own the site.
    const { data: site } = await admin
      .from("sites")
      .select("id, owner_id, name, is_paid")
      .eq("id", site_id)
      .eq("owner_id", user.id)
      .single();
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }
    if (site.is_paid !== true) return unpaidResponse();
    profileId = user.id;
    siteName = site.name;
    customerEmail = user.email ?? undefined;
    returnBase = `${process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin || "http://localhost:3000"}/client/balance`;
  } else {
    // Per-site CMS admin — cookie bound to exactly this site. Attribute the
    // payment to the site owner's profile so the webhook + history behave
    // identically to a CRM top-up.
    const sa = await getSiteAdminForSite(site_id);
    if (!sa) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: site } = await admin
      .from("sites")
      .select("id, owner_id, name, is_paid")
      .eq("id", site_id)
      .single();
    if (!site || !site.owner_id) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }
    if (site.is_paid !== true) return unpaidResponse();
    profileId = site.owner_id;
    siteName = site.name;
    customerEmail = undefined;
    // The request arrived on the tenant host, so its origin is theirdomain.com.
    returnBase = `${req.nextUrl.origin}/admin/balance`;
  }

  // Throttle: cap top-up sessions per profile+site so a logged-in caller can't
  // script unbounded pending payment rows (the row is created before Stripe).
  const { blocked } = await rateLimit({
    key: `topup-session:${profileId}:${site_id}`,
    windowSeconds: 600,
    max: 10,
  });
  if (blocked) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429 },
    );
  }

  const amountEur = credits * CREDIT_PRICE_EUR;

  // ── Insert pending payment row FIRST ─────────────────────
  const { data: payment, error: paymentErr } = await admin
    .from("payments")
    .insert({
      profile_id: profileId,
      site_id: site_id,
      amount: amountEur,
      currency: "USD",
      payment_method: "stripe",
      status: "pending",
      description: `Pending Stripe: ${credits} publishes ($${amountEur})`,
    })
    .select("id")
    .single();
  if (paymentErr || !payment) {
    return NextResponse.json(
      {
        error: `Failed to record pending payment: ${paymentErr?.message ?? "unknown"}`,
      },
      { status: 500 },
    );
  }

  // ── Create Stripe Checkout session ───────────────────────
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
              description: `Balance top-up for ${siteName}`,
            },
            unit_amount: Math.round(amountEur * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${returnBase}?topup=success`,
      cancel_url: `${returnBase}?topup=cancelled`,
      customer_email: customerEmail,
      // The webhook reads payment_id to look up the pending row.
      metadata: {
        payment_id: payment.id,
        site_id: site_id,
        profile_id: profileId,
        credits: String(credits),
        amount_eur: String(amountEur),
      },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (err) {
    // Roll back the pending payment row on Stripe API failure.
    await admin.from("payments").delete().eq("id", payment.id);
    const message = err instanceof Error ? err.message : "Unknown Stripe error";
    return NextResponse.json({ error: `Stripe error: ${message}` }, { status: 502 });
  }
}
