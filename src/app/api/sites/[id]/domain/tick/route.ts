/**
 * POST /api/sites/[id]/domain/tick
 *
 * Advances the Cloudflare custom-domain pipeline by ONE state
 * transition. Called every 30 sec by the dashboard's
 * CustomDomainAction component while a setup is in progress.
 *
 * Body: empty (we don't need anything from the client — the row's
 * current state on the server is the source of truth).
 *
 * Behavior:
 *   - Loads the site's pipeline row.
 *   - Calls runStep() to perform whichever Cloudflare interaction is
 *     appropriate for the current state.
 *   - Persists the resulting patch.
 *   - Returns the updated row.
 *
 * Returns the same shape as /domain/start so the client can render
 * uniformly without a discriminator.
 *
 * Auth matches PUT /api/sites/[id]/domain — tech_admin/super_admin
 * always; sales for the linked proposal they own.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  type DomainSetupRow,
  type DomainSetupStatus,
  resolveAttempts,
  runStep,
} from "@/lib/deployment/custom-domain";

function sanitizeProjectName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 58);
}

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

  // ── Auth + load row in one go ──────────────────────────────
  const { data: site, error: loadErr } = await admin
    .from("sites")
    .select(
      "id, slug, subdomain, proposal_id, requested_domain, domain, domain_status, domain_setup_status, domain_setup_started_at, domain_setup_attempts, domain_setup_error, domain_zone_id, domain_nameservers",
    )
    .eq("id", id)
    .maybeSingle();
  if (loadErr || !site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // Auth: same matrix as the start endpoint.
  const isAdminRole = ["administrator", "super_admin", "tech_admin"].includes(
    role ?? "",
  );
  if (!isAdminRole) {
    if (role !== "sales") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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
  }

  // ── Build the row shape runStep expects ────────────────────
  const row: DomainSetupRow = {
    domain_setup_status: site.domain_setup_status as DomainSetupStatus | null,
    domain_setup_started_at: site.domain_setup_started_at ?? null,
    domain_setup_attempts: site.domain_setup_attempts ?? 0,
    domain_zone_id: site.domain_zone_id ?? null,
    domain_nameservers: site.domain_nameservers ?? null,
    requested_domain: site.requested_domain ?? null,
    domain: site.domain ?? null,
  };

  const projectName = sanitizeProjectName(site.slug || id);

  // Compose the *.{PROPOSAL_DOMAIN} fallback hostname so the
  // pipeline's terminal step can clean it up post-success.
  const proposalDomainSuffix = process.env.PROPOSAL_DOMAIN || "";
  const fullSubdomain =
    site.subdomain && proposalDomainSuffix
      ? `${site.subdomain}.${proposalDomainSuffix}`
      : null;

  // ── Run one step ───────────────────────────────────────────
  // Cloudflare hiccups (rate limits, transient 5xx) are caught here
  // and logged onto the row. The pipeline doesn't fail outright on
  // a single bad tick — the next poll will try again. Only the
  // total-time budget (60 min, enforced inside nextStep()) makes
  // us give up.
  let patch;
  try {
    patch = await runStep({ row, projectName, fullSubdomain });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // Bump attempts + record the error message, but stay in the
    // current state so the next tick retries. If we hit the total
    // timeout the next nextStep() call will return "abort" and
    // flip us to failed.
    const { data: updated } = await admin
      .from("sites")
      .update({
        domain_setup_attempts: (row.domain_setup_attempts ?? 0) + 1,
        domain_setup_error: message,
      })
      .eq("id", id)
      .select(
        "id, requested_domain, domain, domain_status, domain_setup_status, domain_setup_started_at, domain_setup_attempts, domain_setup_error, domain_zone_id, domain_nameservers",
      )
      .single();
    return NextResponse.json({ site: updated, transient_error: message });
  }

  // No-op tick (already terminal) → just return the row as-is.
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ site });
  }

  const finalPatch = resolveAttempts({
    patch,
    currentStatus: row.domain_setup_status,
    currentAttempts: row.domain_setup_attempts,
  });

  const { data: updated, error: updErr } = await admin
    .from("sites")
    .update(finalPatch)
    .eq("id", id)
    .select(
      "id, requested_domain, domain, domain_status, domain_setup_status, domain_setup_started_at, domain_setup_attempts, domain_setup_error, domain_zone_id, domain_nameservers",
    )
    .single();
  if (updErr || !updated) {
    return NextResponse.json(
      { error: `Failed to persist tick: ${updErr?.message || "unknown"}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ site: updated });
}
