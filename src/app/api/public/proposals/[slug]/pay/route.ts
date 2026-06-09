/**
 * GET /api/public/proposals/[slug]/pay
 *
 * The single "pay for this website" entry point. Public, no auth — it's
 * hit by the prospect from the payment banner on their live proposal
 * site, either by clicking "Order website" or by scanning the QR (the QR
 * encodes THIS url, so a phone scan lands straight here).
 *
 * Flow:
 *   1. Look up the proposal + its linked site + contact
 *   2. Compute the current active price (discount window aware)
 *   3. Insert a PENDING `payments` row so its UUID can ride along in
 *      Stripe metadata — the webhook looks the row up by that UUID
 *   4. Create a Stripe Checkout session for that price
 *   5. 302-redirect the browser to the hosted Checkout page
 *
 * On success Stripe fires checkout.session.completed →
 * /api/payments/stripe/webhook → confirmProposalPayment() marks the
 * proposal paid, invoices it, dismisses reminders, and emails the client
 * their login. No human in the loop.
 *
 * A fresh session is created per click/scan (mirrors the credit top-up
 * flow). Abandoned sessions leave a vestigial `pending` payment row that
 * super_admin can clean up later — they never confirm on their own.
 *
 * Why GET (not POST): the banner uses a plain <a href> + a QR image, both
 * of which are GET navigations. Keeping it GET means the QR can encode a
 * stable, never-expiring URL while the short-lived Stripe session is
 * minted only when someone actually intends to pay.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePrice } from "@/lib/payments/proposal-utils";
import { getStripe } from "@/lib/payments/stripe";

export const dynamic = "force-dynamic";

/** Minimal branded HTML page for the dead-ends (not configured, no site,
 *  already paid without a thank-you target). Keeps the prospect on a clean
 *  page instead of a raw JSON blob when they tapped a payment link. */
function messagePage(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
    html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f1117;color:#e7e9ee;}
    .wrap{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px;}
    .card{max-width:440px;text-align:center;background:#171a22;border:1px solid #262a35;border-radius:16px;padding:36px 28px;}
    h1{font-size:19px;margin:0 0 10px;font-weight:600;}
    p{font-size:14px;line-height:1.6;color:#aab1c0;margin:0;}
  </style></head><body><div class="wrap"><div class="card"><h1>${title}</h1><p>${body}</p></div></div></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const admin = createAdminClient();

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || req.nextUrl.origin;

  // ── Proposal ──
  const { data: proposal } = await admin
    .from("proposals")
    .select(
      "id, slug, status, show_banner, company_name, base_price, discount_price, discount_expires_at, contact_id",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!proposal) {
    return messagePage(
      "Proposal not found",
      "This payment link is no longer valid. Please contact us if you believe this is a mistake.",
      404,
    );
  }

  // Already paid — send them to the thank-you page rather than charging twice.
  if (proposal.status === "paid") {
    return NextResponse.redirect(`${origin}/proposal/${slug}/paid`);
  }

  // Honor the banner kill-switch. show_banner is the operator's "turn off
  // payment" control (paid offline / demoing a clean site / widget acting
  // up). The data route hides the QR when it's false; mirror that here so
  // the stable pay URL a cached QR points at can't keep charging after the
  // operator has deliberately switched payment off. (We gate ONLY on
  // show_banner, never on lifecycle status — that decoupling is intentional.)
  if ((proposal as { show_banner?: boolean | null }).show_banner === false) {
    return messagePage(
      "Payment unavailable",
      "Online payment for this website is currently turned off. Please contact us to complete your order.",
      409,
    );
  }

  const stripe = getStripe();
  if (!stripe) {
    return messagePage(
      "Card payment unavailable",
      "Card payments are not set up yet. Please contact us and we'll help you complete your order.",
      503,
    );
  }

  // ── Linked site (must exist so the webhook can mark it paid) ──
  // sites.proposal_id is not unique (legacy dup site rows) — prefer the
  // most-recently-published one, matching ensure-client-zone, so a dup
  // doesn't make .maybeSingle() error and falsely report "not ready".
  const { data: site } = await admin
    .from("sites")
    .select("id, owner_id, name, site_url")
    .eq("proposal_id", proposal.id)
    .order("last_published_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!site) {
    return messagePage(
      "Almost ready",
      "Your order isn't quite ready for online payment yet. Please contact us and we'll finalize it for you.",
      409,
    );
  }

  // ── Contact email (prefill Checkout) ──
  let contactEmail: string | null = null;
  if (proposal.contact_id) {
    const { data: contact } = await admin
      .from("contacts")
      .select("email")
      .eq("id", proposal.contact_id)
      .maybeSingle();
    contactEmail = contact?.email ?? null;
  }

  const activePrice = getActivePrice({
    base_price: proposal.base_price,
    discount_price: proposal.discount_price,
    discount_expires_at: proposal.discount_expires_at,
  });

  if (!Number.isFinite(activePrice) || activePrice <= 0) {
    return messagePage(
      "Price unavailable",
      "We couldn't determine the price for this website. Please contact us.",
      409,
    );
  }

  // ── Pending payment row (UUID rides along in Stripe metadata) ──
  const { data: payment, error: paymentErr } = await admin
    .from("payments")
    .insert({
      profile_id: site.owner_id,
      site_id: site.id,
      proposal_id: proposal.id,
      amount: activePrice,
      currency: "USD",
      payment_method: "card",
      status: "pending",
      description: `Pending Stripe: website ${proposal.company_name ?? ""}`.trim(),
    })
    .select("id")
    .single();

  if (paymentErr || !payment) {
    return messagePage(
      "Something went wrong",
      "We couldn't start the payment. Please try again in a moment.",
      500,
    );
  }

  // ── Stripe Checkout session ──
  // success → in-app thank-you page (the webhook emails login details).
  // cancel  → back to their live site where the banner still offers to pay.
  const successUrl = `${origin}/proposal/${slug}/paid`;
  const cancelUrl = site.site_url || origin;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: proposal.company_name
                ? `Website — ${proposal.company_name}`
                : "Website",
              description: "Design, build and launch of your business website",
            },
            unit_amount: Math.round(activePrice * 100),
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: contactEmail ?? undefined,
      // The webhook branches on `kind` and looks the row up by payment_id.
      metadata: {
        kind: "proposal",
        payment_id: payment.id,
        proposal_id: proposal.id,
        site_id: site.id,
        slug,
        amount_eur: String(activePrice),
      },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    if (!session.url) {
      throw new Error("Stripe returned no Checkout URL");
    }
    return NextResponse.redirect(session.url, { status: 303 });
  } catch (err) {
    // Roll back the pending row so a Stripe failure doesn't leave orphans.
    await admin.from("payments").delete().eq("id", payment.id);
    console.error("[ProposalPay] Stripe session creation failed:", err);
    return messagePage(
      "Payment could not be started",
      "We hit a snag starting your card payment. Please try again, or contact us and we'll help.",
      502,
    );
  }
}
