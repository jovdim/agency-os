/**
 * POST /api/sites/[id]/domain/start
 *
 * Kicks off the Cloudflare custom-domain setup pipeline for a site.
 * Body: { domain: string }
 *
 * Behavior:
 *   - Normalizes the input to its apex form (`www.x.sk` → `x.sk`).
 *   - Resets the per-row pipeline state (status, attempts, error,
 *     zone_id, nameservers, started_at) — so retrying after a failure
 *     starts cleanly.
 *   - Runs the init step (zone create-or-find) inline so the caller
 *     gets the zone id + nameservers back immediately, without
 *     waiting on the first poll.
 *   - Returns the post-init row.
 *
 * After this call returns, the dashboard polls
 * POST /api/sites/[id]/domain/tick every 30 sec to drive the rest
 * of the state machine forward.
 *
 * Auth matches PUT /api/sites/[id]/domain — tech_admin/super_admin
 * always; sales for the linked proposal they own.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  type DomainSetupRow,
  resolveAttempts,
  runStep,
  type SetupPatch,
} from "@/lib/deployment/custom-domain";
import { extractApex, isApex } from "@/lib/deployment/extract-apex";
import { ensureDirectUploadProject } from "@/lib/deployment/cloudflare-direct";

// publishSite -> renderSite downloads templates from Supabase Storage via
// native fetch; without these directives Next.js caches those fetches and
// the auto-republish after a domain change can serve stale template HTML.
// Matches the other publish-adjacent routes.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const DOMAIN_REGEX = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]?(\.[a-z]{2,})+$/;

/**
 * Same shape used by publish.ts + subdomain.ts. Duplicated here
 * because there's no shared helper file yet — promote when there
 * are 3 callsites.
 */
function sanitizeProjectName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 58);
}

export async function POST(
  req: NextRequest,
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

  // ── Auth: same matrix as PUT /api/sites/[id]/domain ────────
  // tech_admin / super_admin / administrator → always allowed
  // sales → must own the linked proposal
  // anything else → 403
  const { data: siteForAuth } = await admin
    .from("sites")
    .select("id, slug, proposal_id, subdomain")
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

  // ── Validate body ──────────────────────────────────────────
  const body = (await req.json().catch(() => null)) as
    | { domain?: unknown }
    | null;
  if (!body || typeof body.domain !== "string") {
    return NextResponse.json(
      { error: "Body must include { domain: string }" },
      { status: 400 },
    );
  }
  const requestedRaw = body.domain.trim().toLowerCase();
  if (!requestedRaw) {
    return NextResponse.json({ error: "Domain is required" }, { status: 400 });
  }
  if (!DOMAIN_REGEX.test(requestedRaw)) {
    return NextResponse.json(
      { error: "Invalid domain format (e.g. clientname.sk)" },
      { status: 400 },
    );
  }
  // Anchor the pipeline on the apex. www.* and other subdomains get
  // collapsed to their registrable domain.
  const naked = isApex(requestedRaw) ? requestedRaw : extractApex(requestedRaw);
  const projectName = sanitizeProjectName(siteForAuth.slug || id);

  // ── Ensure the Cloudflare Pages project exists ─────────────
  // The pipeline's `registering_pages` step needs the Pages project
  // to be present (it calls registerPagesDomain on it). On a fresh
  // site that hasn't been published yet, the project doesn't exist —
  // publishSite() lazily creates it on first publish. Calling
  // ensureDirectUploadProject here lets sales kick off the custom-
  // domain setup BEFORE first publish without surfacing a confusing
  // "project not found" error mid-pipeline. Idempotent — if publish
  // already created the project, this is a no-op (HTTP 200 with the
  // existing project's data).
  //
  // Per Peter 2026-05-10: custom domain should always be enabled,
  // regardless of payment OR publish state. This change closes the
  // publish-state-gating gap so the IdleSetupView can lose its
  // amber "publish first" warning.
  try {
    await ensureDirectUploadProject(projectName);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        error: `Failed to create Cloudflare Pages project for this site: ${message}`,
      },
      { status: 502 },
    );
  }

  // ── Reset pipeline state ───────────────────────────────────
  // We blow away the previous run's status so retrying after a
  // failure starts from scratch. We DO NOT clear `domain` here —
  // if a previous setup succeeded, the row keeps its active domain
  // until this new run replaces it (writes happen in the SSL-active
  // terminal step, see custom-domain.ts).
  const seedRow: DomainSetupRow = {
    domain_setup_status: "not_started",
    domain_setup_started_at: null,
    domain_setup_attempts: 0,
    domain_zone_id: null,
    domain_nameservers: null,
    requested_domain: naked,
    domain: null,
  };

  // Persist the reset BEFORE running init — so a crash mid-init
  // leaves the row in a coherent "not_started, requested=clientname.sk"
  // state the next tick can recover from.
  const { error: resetErr } = await admin
    .from("sites")
    .update({
      requested_domain: naked,
      domain_setup_status: "not_started",
      domain_setup_started_at: null,
      domain_setup_attempts: 0,
      domain_setup_error: null,
      domain_zone_id: null,
      domain_nameservers: null,
    })
    .eq("id", id);
  if (resetErr) {
    return NextResponse.json(
      { error: `Failed to reset pipeline state: ${resetErr.message}` },
      { status: 500 },
    );
  }

  // ── Run init ───────────────────────────────────────────────
  // findOrCreateZone runs here. If the zone already exists in our
  // CF account, this is fast (~200ms). If it's a fresh zone, this
  // takes ~1-3s while CF allocates nameservers.
  // Compose the full *.{PROPOSAL_DOMAIN} fallback hostname so the
  // pipeline's terminal step can clean it up after the custom domain
  // is verified live. Null when no subdomain — pipeline skips cleanup.
  const proposalDomainSuffix = process.env.PROPOSAL_DOMAIN || "";
  const fullSubdomain =
    siteForAuth.subdomain && proposalDomainSuffix
      ? `${siteForAuth.subdomain}.${proposalDomainSuffix}`
      : null;

  let initPatch: SetupPatch;
  try {
    initPatch = await runStep({ row: seedRow, projectName, fullSubdomain });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // Persist the failure so the timeline UI can show it. Status
    // becomes "failed" so the user can hit Retry without thinking.
    await admin
      .from("sites")
      .update({
        domain_setup_status: "failed",
        domain_setup_error: message,
      })
      .eq("id", id);
    return NextResponse.json(
      { error: `Init failed: ${message}` },
      { status: 502 },
    );
  }

  const patch = resolveAttempts({
    patch: initPatch,
    currentStatus: "not_started",
    currentAttempts: 0,
  });

  const { data: updated, error: updErr } = await admin
    .from("sites")
    .update(patch)
    .eq("id", id)
    .select(
      "id, requested_domain, domain, domain_status, domain_setup_status, domain_setup_started_at, domain_setup_attempts, domain_setup_error, domain_zone_id, domain_nameservers",
    )
    .single();
  if (updErr || !updated) {
    return NextResponse.json(
      { error: `Failed to persist init state: ${updErr?.message || "unknown"}` },
      { status: 500 },
    );
  }

  await logAudit({
    userId: user.id,
    action: "start_custom_domain_setup",
    entityType: "site",
    entityId: id,
    details: {
      requested: naked,
      zone_id: updated.domain_zone_id,
      project: projectName,
    },
  });

  return NextResponse.json({ site: updated });
}
