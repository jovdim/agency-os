/**
 * GET /api/sites/[id]/site-payment-info
 *
 * Returns the data needed to render the BySquare initial-site-payment
 * dialog when an unpaid client clicks Publish in the composer. Same DB
 * source-of-truth as the deployed-site banner widget
 * (public/proposal-widget.js):
 *
 *   - proposals.base_price / discount_price / discount_expires_at
 *   - proposals.variable_symbol
 *   - proposals.qr_image_cache (base64 PNG data URL)
 *   - env BYSQUARE_IBAN / BYSQUARE_BENEFICIARY
 *
 * Lazy-fetched (publish-menu only calls this when the user actually
 * clicks Publish on an unpaid site), so it doesn't add latency to the
 * normal flow.
 *
 * Auth: owner-only for clients. (Tech / sales / admin don't hit this
 * because they aren't gated by the unpaid state, but we still allow
 * them through so the dialog can be previewed for QA.)
 *
 * Response: { is_paid, base_price, discount_price, discount_expires_at,
 *             variable_symbol, qr_image_data_url, iban, beneficiary }
 *
 *   - is_paid: boolean — clients with is_paid=true shouldn't be hitting
 *     this in the first place, but we return the flag so the caller can
 *     bail out gracefully if the state changed between the credit-balance
 *     read and this fetch.
 *   - Everything else: as on the dashboard card. iban/beneficiary read
 *     from env vars server-side; never leaks the password.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrRefreshProposalQr } from "@/lib/payments/bysquare";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const role = user.app_metadata?.role as string | undefined;
  const admin = createAdminClient();

  // Ownership check — clients can only see their own site's payment info.
  // Tech / sales / super / admin can see any (for QA previews).
  const { data: site } = await admin
    .from("sites")
    .select("id, owner_id, proposal_id, is_paid")
    .eq("id", id)
    .maybeSingle();
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const isAdminish = ["tech_admin", "super_admin", "administrator"].includes(
    role ?? "",
  );
  if (!isAdminish) {
    if (role === "client") {
      if (site.owner_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (role === "sales") {
      // Sales sees the QR / bank info for proposals they own, useful for
      // the timeline preview. Mirrors the publish-route auth matrix.
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

  // Pull the proposal pricing/QR columns the shared helper needs.
  if (!site.proposal_id) {
    // No linked proposal → no pricing data. Return what we have so the
    // caller can gracefully render the "no payment info" fallback.
    return NextResponse.json({
      is_paid: site.is_paid === true,
      base_price: null,
      discount_price: null,
      discount_expires_at: null,
      variable_symbol: null,
      qr_image_data_url: null,
      iban: process.env.BYSQUARE_IBAN ?? null,
      beneficiary: process.env.BYSQUARE_BENEFICIARY ?? null,
    });
  }

  const { data: proposalRow } = await admin
    .from("proposals")
    .select(
      "id, company_name, base_price, discount_price, discount_expires_at, qr_image_cache, qr_cached_amount",
    )
    .eq("id", site.proposal_id)
    .maybeSingle();

  if (!proposalRow) {
    return NextResponse.json({
      is_paid: site.is_paid === true,
      base_price: null,
      discount_price: null,
      discount_expires_at: null,
      variable_symbol: null,
      qr_image_data_url: null,
      iban: process.env.BYSQUARE_IBAN ?? null,
      beneficiary: process.env.BYSQUARE_BENEFICIARY ?? null,
    });
  }

  // Shared cache-or-refresh — same path the deployed-site banner widget
  // takes via /api/public/proposals/[slug]/data. If the price changed
  // since the last QR generation, this regenerates and writes the cache
  // back so the next call (from either surface) is the fast path.
  const { qrImageDataUrl, variableSymbol } = await getOrRefreshProposalQr(
    admin,
    proposalRow,
  );

  return NextResponse.json({
    is_paid: site.is_paid === true,
    base_price: proposalRow.base_price,
    discount_price: proposalRow.discount_price,
    discount_expires_at: proposalRow.discount_expires_at,
    variable_symbol: variableSymbol,
    qr_image_data_url: qrImageDataUrl,
    iban: process.env.BYSQUARE_IBAN ?? null,
    beneficiary: process.env.BYSQUARE_BENEFICIARY ?? null,
  });
}
