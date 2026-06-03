import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDiscountActive } from "@/lib/payments/proposal-utils";
import { getOrRefreshProposalQr } from "@/lib/payments/bysquare";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}

function corsJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders() });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/**
 * GET /api/public/proposals/[slug]/data
 * Returns proposal data for the public proposal page.
 * CORS enabled — called from subdomain.pages.dev
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const admin = createAdminClient();

  const { data: proposal, error } = await admin
    .from("proposals")
    .select(
      "id, status, show_banner, discount_price, base_price, discount_expires_at, company_name, slug, contact_id, sales_person_id, qr_image_cache, qr_cached_amount, client_temp_password",
    )
    .eq("slug", slug)
    .single();

  if (error || !proposal) {
    return corsJson({ active: false }, 404);
  }

  // Single-switch model (per Peter 2026-05-10): the only thing
  // that decides banner visibility is `proposals.show_banner`.
  // Compile-time gate in render.ts already skips the script tag
  // entirely when show_banner is false — this runtime check is
  // belt-and-suspenders for any deployed HTML still carrying a
  // stale script tag from a prior toggle-on state.
  //
  // (Status-based gating used to live here — it was removed
  // because Peter doesn't want banner visibility to depend on
  // sent/viewed/paid lifecycle.)
  const showBanner =
    (proposal as { show_banner?: boolean | null }).show_banner !== false;
  if (!showBanner) {
    return corsJson({ active: false });
  }

  // Get contact info
  let contactPerson: string | null = null;
  let contactEmail: string | null = null;
  let town: string | null = null;
  if (proposal.contact_id) {
    const { data: contact } = await admin
      .from("contacts")
      .select("contact_person, town, email")
      .eq("id", proposal.contact_id)
      .single();
    contactPerson = contact?.contact_person || null;
    contactEmail = contact?.email || null;
    town = contact?.town || null;
  }

  // Compute active price + get-or-refresh the cached QR. Logic lives in
  // getOrRefreshProposalQr so the composer publish dialog reads from the
  // exact same cache-or-refresh path — no two-source drift.
  const discountActive = isDiscountActive(proposal);
  const {
    qrImageDataUrl,
    variableSymbol,
    activePrice,
  } = await getOrRefreshProposalQr(admin, proposal);

  // Generate auto-login link (never expires — uses encrypted email:password)
  // Falls back to Supabase one-time magic link if temp password not stored.
  let magicLoginUrl: string | null = null;
  const clientUrl = process.env.NEXT_PUBLIC_CLIENT_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://client.pages.dev";

  if (contactEmail && proposal.client_temp_password) {
    try {
      const { encrypt } = await import("@/app/api/auth/auto-login/route");
      const token = encrypt(`${contactEmail.trim().toLowerCase()}|${proposal.client_temp_password}`);
      magicLoginUrl = `${clientUrl}/api/auth/auto-login?token=${encodeURIComponent(token)}`;
    } catch (err) {
      console.error("[AutoLogin] Failed to generate token:", err);
    }
  }

  if (!magicLoginUrl && contactEmail) {
    try {
      const { data: linkData } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: contactEmail.trim().toLowerCase(),
        options: { redirectTo: `${clientUrl}/client` },
      });
      if (linkData?.properties?.action_link) {
        // KEEP Supabase verify URL as-is (only Supabase has /auth/v1/verify endpoint).
        // Only fix the redirect_to param to point to our client zone.
        magicLoginUrl = linkData.properties.action_link.replace(
          /redirect_to=[^&]+/,
          `redirect_to=${encodeURIComponent(clientUrl + "/client")}`
        );
      }
    } catch (err) {
      console.error("[AutoLogin] Magic link fallback failed:", err);
    }
  }

  return corsJson({
    active: true,
    activePrice,
    discountPrice: proposal.discount_price,
    basePrice: proposal.base_price,
    discountExpiresAt: proposal.discount_expires_at,
    discountActive,
    contactPerson,
    companyName: proposal.company_name,
    town,
    qrImageDataUrl,
    variableSymbol,
    iban: process.env.BYSQUARE_IBAN || "SK1309000000005221380177",
    beneficiary: process.env.BYSQUARE_BENEFICIARY || "Your Agency",
    magicLoginUrl,
  });
}
