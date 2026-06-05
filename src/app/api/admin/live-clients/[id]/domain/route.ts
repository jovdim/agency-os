import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * PUT /api/admin/live-clients/[id]/domain
 *
 * Update the custom-domain field on a paid client's site. This is
 * intentionally LIGHTWEIGHT — it just updates `sites.domain` +
 * `sites.domain_status`. Cloudflare DNS setup (nameserver
 * verification, certificate provisioning, custom-domain attachment
 * on the Pages project) stays in /super/domains where the heavier
 * domain-onboarding flow lives.
 *
 * This endpoint is for cases like:
 *   - Marking a migrated client's existing-elsewhere domain as
 *     active so /live-clients reflects it
 *   - Correcting a typo
 *   - Clearing a domain (pass empty string) to revert the row to
 *     the pages.dev subdomain
 *
 * Body: { domain: string | null }
 *   - Non-empty string → trim, lowercase, validate, set
 *     domain_status to "active"
 *   - Null / empty → clear domain, set domain_status to "none"
 *
 * Auth: tech_admin / super_admin / sales (own / migrated).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = user.app_metadata?.role as string;
  if (!["tech_admin", "super_admin", "sales"].includes(role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { id: proposalId } = await params;
  let body: { domain?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Normalize: trim, lowercase, treat empty as null. We accept the
  // raw user-typed string and don't strip protocol — operator should
  // enter a bare hostname like `balkar.sk`, not `https://balkar.sk`.
  // We catch the http:// prefix explicitly so a paste-from-browser
  // doesn't produce a broken row.
  let normalized: string | null;
  const raw = (body.domain ?? "").trim().toLowerCase();
  if (!raw) {
    normalized = null;
  } else {
    const stripped = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    // Bare-bones hostname validation — at least one dot, allowed chars
    // are letters/digits/dots/hyphens, no leading/trailing dot or
    // hyphen on any label. Operators paste real domains here so we
    // catch the common typos (spaces, http://, trailing slashes) but
    // don't try to be a full domain validator.
    if (!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(stripped)) {
      return NextResponse.json(
        { error: "Domain must be a valid hostname (e.g. yourcompany.com)" },
        { status: 400 },
      );
    }
    normalized = stripped;
  }

  const admin = createAdminClient();

  const { data: proposal } = await admin
    .from("proposals")
    .select("id, sales_person_id, is_migrated")
    .eq("id", proposalId)
    .maybeSingle();
  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }
  if (role === "sales") {
    const owns = proposal.sales_person_id === user.id;
    const isMigrated = proposal.is_migrated === true;
    if (!owns && !isMigrated) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { data: site } = await admin
    .from("sites")
    .select("id, domain")
    .eq("proposal_id", proposalId)
    .maybeSingle();
  if (!site) {
    return NextResponse.json(
      { error: "No site linked to this proposal" },
      { status: 404 },
    );
  }

  // Mark as active when we have a value, none when we clear it. We
  // skip the intermediate setup states (register_new / transfer /
  // decided_later) because this endpoint is for paid-client manual
  // overrides — the full DNS workflow lives in /super/domains.
  const { error: updateErr } = await admin
    .from("sites")
    .update({
      domain: normalized,
      domain_status: normalized ? "active" : "none",
      updated_at: new Date().toISOString(),
    })
    .eq("id", site.id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    action: "change_custom_domain",
    entityType: "site",
    entityId: site.id,
    details: {
      proposal_id: proposalId,
      from: site.domain,
      to: normalized,
    },
  });

  return NextResponse.json({
    domain: normalized,
    domain_status: normalized ? "active" : "none",
  });
}
