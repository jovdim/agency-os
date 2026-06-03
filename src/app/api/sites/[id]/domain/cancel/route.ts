/**
 * POST /api/sites/[id]/domain/cancel
 *
 * Aborts an in-progress or failed custom-domain setup pipeline by
 * resetting all `domain_setup_*` columns + clearing `requested_domain`.
 * The site falls back to its `*.{PROPOSAL_DOMAIN}` subdomain.
 *
 * Use case: testing with a fake domain that gets stuck in
 * `waiting_dns` — without this, you'd wait the full 30-min timeout
 * (or run SQL by hand). Also useful if sales typed the wrong domain
 * and wants a clean slate before retrying.
 *
 * Behavior:
 *   - Resets:  domain_setup_status / _started_at / _attempts / _error,
 *              domain_zone_id, domain_nameservers, requested_domain
 *   - Preserves: `domain` column — if a previous pipeline succeeded
 *     and is the active live domain, we keep serving it. Cancel only
 *     affects the IN-PROGRESS or FAILED setup, not a working one.
 *   - Does NOT delete the Cloudflare zone. Cancelling shouldn't
 *     destroy DNS records the user may rely on. If the user is
 *     cleaning up a fake test zone, they delete it in the CF dashboard.
 *     `findOrCreateZone` reuses any existing zone on the next start.
 *
 * Auth matches /domain/start — tech_admin / super_admin /
 * administrator always; sales for the linked proposal they own.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

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
  const admin = createAdminClient();

  // ── Auth: same matrix as /domain/start ─────────────────────
  const { data: siteForAuth } = await admin
    .from("sites")
    .select(
      "id, proposal_id, requested_domain, domain, domain_setup_status, domain_zone_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!siteForAuth) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const isAdminRole = ["administrator", "super_admin", "tech_admin"].includes(
    role ?? "",
  );
  if (!isAdminRole) {
    if (role !== "sales") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!siteForAuth.proposal_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { data: linkedProposal } = await admin
      .from("proposals")
      .select("sales_person_id")
      .eq("id", siteForAuth.proposal_id)
      .maybeSingle();
    if (!linkedProposal || linkedProposal.sales_person_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Snapshot what we're about to clear, for the audit entry.
  const snapshot = {
    requested_domain: siteForAuth.requested_domain,
    previous_status: siteForAuth.domain_setup_status,
    zone_id: siteForAuth.domain_zone_id,
    // Note: site.domain is preserved (active live domain stays live).
  };

  const { data: updated, error: updErr } = await admin
    .from("sites")
    .update({
      requested_domain: null,
      domain_setup_status: null,
      domain_setup_started_at: null,
      domain_setup_attempts: 0,
      domain_setup_error: null,
      domain_zone_id: null,
      domain_nameservers: null,
    })
    .eq("id", id)
    .select(
      "id, requested_domain, domain, domain_status, domain_setup_status, domain_setup_started_at, domain_setup_attempts, domain_setup_error, domain_zone_id, domain_nameservers",
    )
    .single();
  if (updErr || !updated) {
    return NextResponse.json(
      { error: `Failed to cancel setup: ${updErr?.message || "unknown"}` },
      { status: 500 },
    );
  }

  await logAudit({
    userId: user.id,
    action: "cancel_custom_domain_setup",
    entityType: "site",
    entityId: id,
    details: snapshot,
  });

  return NextResponse.json({ site: updated });
}
