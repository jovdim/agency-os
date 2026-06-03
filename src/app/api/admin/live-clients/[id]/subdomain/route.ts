import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateSubdomainFormat } from "@/lib/deployment/subdomain";
import {
  updateCustomDomain,
  cleanupOrphanedFallbackSubdomains,
} from "@/lib/deployment/cloudflare";
import { logAudit } from "@/lib/audit";

export const maxDuration = 60;
// Same cache-busting directives as publishSite + payments-confirm —
// any route that touches Cloudflare via fetch() needs Next.js's fetch
// layer disabled or the response gets stale-cached.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/**
 * PUT /api/admin/live-clients/[id]/subdomain
 *
 * Change the subdomain on a paid client's site (live-clients flow).
 * Distinct from /api/deploy/subdomain which operates on the legacy
 * `deployments` table — this one works against `sites` (where the
 * composer-published sites live) and pushes the new mapping to
 * Cloudflare so the new URL is live immediately.
 *
 * `id` is the PROPOSAL id (matches the rest of /live-clients/[id]).
 *
 * Body: { subdomain: string }
 *
 * Atomic flow:
 *   1. Validate format + uniqueness (across sites.subdomain only —
 *      legacy deployments table has its own namespace)
 *   2. Resolve the Cloudflare project name (same fallback chain as
 *      publish.ts: latest site_versions.deployment_url → site.slug)
 *   3. Call updateCustomDomain(project, oldDomain, newDomain) — this
 *      removes the old DNS CNAME + Pages custom-domain mapping and
 *      adds the new pair. Best-effort on the remove side.
 *   4. Update sites.subdomain in the DB AFTER Cloudflare confirms,
 *      so a CF failure doesn't leave the DB pointing at a dead URL.
 *   5. Audit log.
 *
 * Auth: tech_admin / super_admin / sales (own only).
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
  let body: { subdomain?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const newSubdomain = (body.subdomain ?? "").trim().toLowerCase();

  const formatCheck = validateSubdomainFormat(newSubdomain);
  if (!formatCheck.valid) {
    return NextResponse.json({ error: formatCheck.error }, { status: 400 });
  }

  const admin = createAdminClient();

  // Fetch the proposal + site + sales ownership check up front.
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
    .select("id, slug, subdomain")
    .eq("proposal_id", proposalId)
    .maybeSingle();
  if (!site) {
    return NextResponse.json(
      { error: "No site linked to this proposal" },
      { status: 404 },
    );
  }

  // No-op when the requested value matches what's stored. Saves a
  // Cloudflare round-trip and a wasted audit row.
  if (site.subdomain === newSubdomain) {
    return NextResponse.json({
      subdomain: newSubdomain,
      live_url: `https://${newSubdomain}.pages.dev`,
      unchanged: true,
    });
  }

  // ── Uniqueness check across sites.subdomain ──
  // Excludes the current site (we're about to overwrite its row).
  const { data: dup } = await admin
    .from("sites")
    .select("id")
    .eq("subdomain", newSubdomain)
    .neq("id", site.id)
    .maybeSingle();
  if (dup) {
    return NextResponse.json(
      { error: `Subdomain "${newSubdomain}" is already taken` },
      { status: 409 },
    );
  }

  // ── Resolve Cloudflare project name ──
  // Mirrors publish.ts's lookup so we always operate on the SAME CF
  // project the last publish wrote to. If the URL extraction fails
  // (no prior publishes, weird URL, etc.) we fall back to a sanitized
  // slug — same fallback publish.ts uses for bootstrap.
  const { data: lastVersion } = await admin
    .from("site_versions")
    .select("deployment_url")
    .eq("site_id", site.id)
    .not("deployment_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const projectName =
    extractCfProjectName(lastVersion?.deployment_url) ??
    sanitizeProjectName(site.slug || site.id);

  // ── Push to Cloudflare ──
  // Old subdomain may be empty (newly-created migrated site that never
  // published). In that case skip the remove-old step and just attach
  // the new domain — updateCustomDomain's remove logic is already best-
  // effort, but passing an empty oldDomain would 404 noisily.
  const oldDomain = site.subdomain ? `${site.subdomain}.pages.dev` : "";
  const newDomain = `${newSubdomain}.pages.dev`;
  try {
    await updateCustomDomain(projectName, oldDomain, newDomain);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Cloudflare update failed";
    console.error("[LiveClients subdomain change] CF error:", msg);
    return NextResponse.json(
      { error: `Cloudflare update failed: ${msg}` },
      { status: 500 },
    );
  }

  // ── DB update AFTER CF confirms ──
  // If CF failed above, we already returned — getting here means the
  // mapping is real. Now sync the DB. If this update fails the live
  // URL works but the DB is stale; that's fixable manually on next
  // publish and arguably better than the inverse failure mode.
  const { error: updateErr } = await admin
    .from("sites")
    .update({
      subdomain: newSubdomain,
      updated_at: new Date().toISOString(),
    })
    .eq("id", site.id);
  if (updateErr) {
    return NextResponse.json(
      { error: `DB update failed: ${updateErr.message}` },
      { status: 500 },
    );
  }

  // Self-healing sweep of any *.pages.dev orphans left behind on this
  // project — updateCustomDomain's DELETE is best-effort and the old
  // subdomain sometimes refuses to delete (Verifying state, CF blip,
  // etc). Scoped to THIS project only; other sites untouched. Errors
  // logged but never bubble up.
  try {
    const cleanup = await cleanupOrphanedFallbackSubdomains({
      projectName,
      keepSubdomain: newDomain,
    });
    if (cleanup.removed.length > 0) {
      console.log(
        `[live-clients subdomain PUT] Cleaned ${cleanup.removed.length} orphan(s): ${cleanup.removed.join(", ")}`,
      );
    }
    if (cleanup.errors.length > 0) {
      console.warn(
        `[live-clients subdomain PUT] Cleanup non-fatal errors:`,
        cleanup.errors,
      );
    }
  } catch (cleanupErr) {
    console.error(
      "[live-clients subdomain PUT] Cleanup threw (non-fatal):",
      cleanupErr,
    );
  }

  await logAudit({
    userId: user.id,
    action: "change_subdomain",
    entityType: "site",
    entityId: site.id,
    details: {
      proposal_id: proposalId,
      from: site.subdomain,
      to: newSubdomain,
    },
  });

  return NextResponse.json({
    subdomain: newSubdomain,
    live_url: `https://${newDomain}`,
  });
}

// ── Local helpers ────────────────────────────────────────────────────────
// Mirror of the same-named functions in publish.ts. Kept duplicated
// instead of refactored-into-a-shared-module so a publish.ts change
// can't silently shift this route's behavior — these are tiny pure
// functions and the duplication cost is one screenful.

function extractCfProjectName(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const direct = host.match(/^([a-z0-9-]+)\.pages\.dev$/);
    if (direct) return direct[1];
    const preview = host.match(/^[a-f0-9]+\.([a-z0-9-]+)\.pages\.dev$/);
    if (preview) return preview[1];
    return null;
  } catch {
    return null;
  }
}

function sanitizeProjectName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 58); // CF Pages project names max ~58 chars
}
