import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishSite } from "@/lib/templates/publish";

// publishSite → renderSite downloads template HTML/CSS from Supabase
// Storage via native fetch; without these directives Next caches those
// fetches and the publish can serve STALE template HTML. Mirrors the
// /publish + /render routes (see memory: feedback_publish_route_cache_busting).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/**
 * POST /api/sites/[id]/publish-request/approve
 *
 * IT/tech (or super) approves a client's pending publish request from
 * the proposal pipeline page. This is the ONLY place a client edit
 * actually goes live.
 *
 * Charge model — the $12.50 was already deducted at submit time
 * (Peter 2026-05-30: charge-at-submit). Approve does NOT charge again.
 * If the publish itself fails, we leave the row as `pending` so IT can
 * retry; if it's truly broken, IT rejects instead, which refunds.
 *
 * The version is attributed to the CLIENT (requested_by) with reason
 * "change_request_apply" so the publish history reads "Client edit
 * applied · Client" rather than crediting the IT approver.
 */
export async function POST(
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
  if (!["tech_admin", "super_admin"].includes(role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // ── Validate ────────────────────────────────────────────────
  const { data: site, error: siteErr } = await admin
    .from("sites")
    .select("id, owner_id, is_paid")
    .eq("id", id)
    .maybeSingle();
  if (siteErr || !site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }
  if (site.is_paid !== true) {
    return NextResponse.json(
      { error: "Site is not paid — cannot publish." },
      { status: 409 },
    );
  }

  const { data: request, error: reqErr } = await admin
    .from("publish_requests")
    .select("id, requested_by, status, charged_amount")
    .eq("site_id", id)
    .eq("status", "pending")
    .maybeSingle();
  if (reqErr) {
    return NextResponse.json({ error: reqErr.message }, { status: 500 });
  }
  if (!request) {
    return NextResponse.json(
      { error: "No pending publish request for this site." },
      { status: 409 },
    );
  }

  // Attribute the version to the requester so the history shows it as
  // a client edit. Fall back to the owner / approver only if the
  // requester is gone (shouldn't happen — a publish request implies
  // an owner).
  const clientUserId =
    (request.requested_by as string | null) ?? site.owner_id ?? user.id;

  // ── Publish ─────────────────────────────────────────────────
  // No charge here — the $12.50 was deducted at submit time. If
  // publishSite throws, we leave the row pending so IT can retry; if
  // they decide it's truly broken, rejecting refunds the client.
  let result;
  try {
    result = await publishSite(id, clientUserId, "change_request_apply");
  } catch (publishErr) {
    const message =
      publishErr instanceof Error ? publishErr.message : "Publish failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // ── Success: close out the request ──────────────────────────
  // Race guard: only flip to `approved` if the row is STILL pending.
  // If the client overrode during publishSite() (which takes a few
  // seconds), the row is already `overridden` and we must NOT
  // rewrite that — the override row is the canonical audit fact.
  // The publish itself still went through (using the latest
  // composition, which already includes the override edits), so the
  // site is in the right state; only the request bookkeeping needs
  // to respect what happened.
  await admin
    .from("publish_requests")
    .update({
      status: "approved",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      version_id: result.versionId ?? null,
    })
    .eq("id", request.id)
    .eq("status", "pending");

  return NextResponse.json({
    success: true,
    url: result.friendlyUrl,
    deploymentUrl: result.url,
    versionId: result.versionId,
    // Echo what was already on the row from the submit-time charge so
    // the IT-side UI can show "Charged $12,50" without a second read.
    charged_amount_eur: Number(request.charged_amount ?? 0),
  });
}
