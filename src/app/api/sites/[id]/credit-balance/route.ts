/**
 * GET /api/sites/[id]/credit-balance
 *
 * Lightweight read used by the composer's publish menu (client mode)
 * to render the "Zostatok X €" line + the per-publish cost suffix on
 * the Publish button. Refetched after every publish so the balance
 * shown reflects the post-charge state.
 *
 * Response: { balance, publish_cost, can_publish, currency, is_paid, paywall_reason }
 *   - balance: current credit balance in € (NUMERIC, 2dp)
 *   - publish_cost: per-publish charge in € (currently fixed 12.50)
 *   - can_publish: convenience boolean — true only when the site is paid
 *                  AND balance >= publish_cost. Drives the composer publish
 *                  button enabled-state.
 *   - currency: always "EUR" — surfaced so the UI can format
 *               consistently without a hardcoded literal
 *   - is_paid: boolean — false for clients before the initial site payment
 *              has been confirmed. Composer routes the click to the
 *              site-payment dialog instead of the publish action.
 *   - paywall_reason: "site_not_paid" | "insufficient_credits" | null —
 *              tells the UI which paywall blocks the publish so it can
 *              show the right CTA without re-deriving the reason.
 *
 * Auth matches the publish endpoint:
 *   - tech_admin / super_admin / administrator → always allowed
 *   - sales → must own the linked proposal
 *   - client → must own the site
 *
 * Returns 0 for sites that have no credit_balances row yet (fresh
 * site never charged or granted) — same contract as the dashboard
 * read sites.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const PUBLISH_COST_EUR = 12.5;

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

  // ── Auth: same matrix as /publish ──────────────────────────
  const isAdminRole = ["administrator", "super_admin", "tech_admin"].includes(
    role ?? "",
  );

  // Always need owner_id + proposal_id for the role-specific checks
  // below, so pull them once and reuse. is_paid feeds the unpaid-site
  // paywall surfaced in the response.
  const { data: site } = await admin
    .from("sites")
    .select("id, owner_id, proposal_id, is_paid")
    .eq("id", id)
    .maybeSingle();
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  if (!isAdminRole) {
    if (role === "client") {
      if (site.owner_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (role === "sales") {
      if (!site.proposal_id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const { data: linkedProposal } = await admin
        .from("proposals")
        .select("sales_person_id")
        .eq("id", site.proposal_id)
        .maybeSingle();
      if (!linkedProposal || linkedProposal.sales_person_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // ── Read balance + latest publish-request state ─────────────
  // The publish_request summary lets the composer's publish menu (client
  // mode) render the "Request publish" / "Pending review" / "Rejected"
  // states without a second round trip. Newest row wins — a fresh
  // request supersedes an older rejected/approved one.
  const [{ data: balanceRow }, { data: latestRequest }] = await Promise.all([
    admin
      .from("credit_balances")
      .select("balance")
      .eq("site_id", id)
      .maybeSingle(),
    admin
      .from("publish_requests")
      .select("id, status, review_note, created_at, reviewed_at")
      .eq("site_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const balance = Number(balanceRow?.balance ?? 0);
  const isPaid = site.is_paid === true;
  // Tolerate float-precision noise on the comparison.
  const balanceSufficient = balance + 0.005 >= PUBLISH_COST_EUR;

  // canPublish is the AND of both gates — site-paid AND enough credit.
  // The UI only needs one boolean to enable/disable the button, but the
  // paywall_reason below tells it WHICH gate fired when can_publish is
  // false, so it can route to the right top-up flow (site activation vs.
  // credit purchase).
  const canPublish = isPaid && balanceSufficient;
  const paywallReason: "site_not_paid" | "insufficient_credits" | null =
    !isPaid
      ? "site_not_paid"
      : !balanceSufficient
        ? "insufficient_credits"
        : null;

  // Only surface a request when it's actionable for the UI: a `pending`
  // one (→ "waiting for review") or a `rejected` one the client hasn't
  // superseded yet (→ show the reason + let them re-request). approved /
  // cancelled rows are historical and don't change the button state.
  const publishRequest =
    latestRequest &&
    (latestRequest.status === "pending" || latestRequest.status === "rejected")
      ? {
          status: latestRequest.status as "pending" | "rejected",
          review_note: latestRequest.review_note ?? null,
          created_at: latestRequest.created_at as string,
          reviewed_at: (latestRequest.reviewed_at as string | null) ?? null,
        }
      : null;

  return NextResponse.json({
    balance,
    publish_cost: PUBLISH_COST_EUR,
    can_publish: canPublish,
    currency: "EUR",
    is_paid: isPaid,
    paywall_reason: paywallReason,
    publish_request: publishRequest,
  });
}
