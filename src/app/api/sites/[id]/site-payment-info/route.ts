/**
 * GET /api/sites/[id]/site-payment-info
 *
 * Returns the data the in-dashboard "pay for your website" paywall needs
 * (site-activation-dialog) when an unpaid client tries to publish or set
 * up their domain/email. Same money path as the deployed-site banner:
 * Stripe Checkout via the public pay endpoint.
 *
 *   - proposals.base_price / discount_price / discount_expires_at (pricing)
 *   - pay_url  → /api/public/proposals/<slug>/pay (Stripe Checkout entry)
 *   - qr_image_data_url → a QR of pay_url (scan-to-pay-by-card)
 *
 * Lazy-fetched (only when the user clicks "Show payment details").
 *
 * Auth: owner-only for clients; tech/sales/super/admin allowed for QA.
 *
 * Response: { is_paid, base_price, discount_price, discount_expires_at,
 *             active_price, pay_url, qr_image_data_url }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import QRCode from "qrcode";
import { getActivePrice } from "@/lib/payments/proposal-utils";
import { getSiteAdminForSite } from "@/lib/platform/site-admin-guard";

interface PaymentInfoResponse {
  is_paid: boolean;
  base_price: number | null;
  discount_price: number | null;
  discount_expires_at: string | null;
  active_price: number | null;
  pay_url: string | null;
  qr_image_data_url: string | null;
}

function emptyResponse(isPaid: boolean): PaymentInfoResponse {
  return {
    is_paid: isPaid,
    base_price: null,
    discount_price: null,
    discount_expires_at: null,
    active_price: null,
    pay_url: null,
    qr_image_data_url: null,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = createAdminClient();

  const { data: site } = await admin
    .from("sites")
    .select("id, owner_id, proposal_id, is_paid")
    .eq("id", id)
    .maybeSingle();
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // Two callers: CRM client/staff (Supabase session + role/ownership), and the
  // per-site CMS admin on theirdomain.com (host-scoped cookie bound to this
  // exact site — no Supabase user). The cookie already proves access to THIS
  // site, so it needs no extra ownership check.
  let isSiteAdmin = false;
  if (!user) {
    const sa = await getSiteAdminForSite(id);
    if (!sa) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    isSiteAdmin = true;
  } else {
    const role = user.app_metadata?.role as string | undefined;
    const isAdminish = ["tech_admin", "super_admin", "administrator"].includes(
      role ?? "",
    );
    if (!isAdminish) {
      if (role === "client") {
        if (site.owner_id !== user.id) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      } else if (role === "sales") {
        if (!site.proposal_id) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const { data: linked } = await admin
          .from("proposals")
          .select("sales_person_id")
          .eq("id", site.proposal_id)
          .maybeSingle();
        if (!linked || linked.sales_person_id !== user.id) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      } else {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  if (!site.proposal_id) {
    // No linked proposal → no pricing / pay link.
    return NextResponse.json(emptyResponse(site.is_paid === true));
  }

  const { data: proposalRow } = await admin
    .from("proposals")
    .select("id, slug, base_price, discount_price, discount_expires_at")
    .eq("id", site.proposal_id)
    .maybeSingle();

  if (!proposalRow?.slug) {
    return NextResponse.json(emptyResponse(site.is_paid === true));
  }

  const activePrice = getActivePrice({
    base_price: proposalRow.base_price,
    discount_price: proposalRow.discount_price,
    discount_expires_at: proposalRow.discount_expires_at,
  });

  // The pay URL is the SAME public Stripe entry point the deployed-site
  // banner uses — one money path for every surface. It's stable (never
  // expires); the short-lived Stripe session is minted only on click/scan.
  // Site admins are on the tenant host — keep the pay link on that origin so
  // 'Pay by card'/QR stay on theirdomain.com instead of bouncing to the CRM.
  const origin = isSiteAdmin
    ? req.nextUrl.origin
    : process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || req.nextUrl.origin;
  const payUrl = `${origin}/api/public/proposals/${proposalRow.slug}/pay`;

  let qrImageDataUrl: string | null = null;
  try {
    qrImageDataUrl = await QRCode.toDataURL(payUrl, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: "M",
      color: { dark: "#0f1117", light: "#ffffff" },
    });
  } catch (err) {
    console.error("[SitePaymentInfo] QR generation failed:", err);
  }

  return NextResponse.json({
    is_paid: site.is_paid === true,
    base_price: proposalRow.base_price,
    discount_price: proposalRow.discount_price,
    discount_expires_at: proposalRow.discount_expires_at,
    active_price: activePrice,
    pay_url: payUrl,
    qr_image_data_url: qrImageDataUrl,
  } satisfies PaymentInfoResponse);
}
