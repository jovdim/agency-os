import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateSubdomainFormat } from "@/lib/deployment/subdomain";
import {
  updateCustomDomain,
  ensureCustomDomain,
  cleanupOrphanedFallbackSubdomains,
} from "@/lib/deployment/cloudflare";
import { logAudit } from "@/lib/audit";

const PROPOSAL_DOMAIN = process.env.PROPOSAL_DOMAIN || "";

/**
 * GET /api/sites/[id]/subdomain
 *   → { subdomain, available?, error? } — cheap availability check used by
 *     the editor to gate the Save button. Pass `?check=<value>` to test
 *     a candidate value without committing.
 *
 * PUT /api/sites/[id]/subdomain
 *   → body: { subdomain }
 *   → swaps the Cloudflare custom domain mapping AND persists the new
 *     subdomain to sites.subdomain + site_url.
 *
 * Both routes require tech_admin / super_admin / sales (sales can rename
 * subdomains per the workflow).
 */

function sanitizeProjectName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 58);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { profile } = await requireAuth();
    if (!["tech_admin", "super_admin", "sales"].includes(profile.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const admin = createAdminClient();
    const { searchParams } = new URL(req.url);
    const candidate = searchParams.get("check");

    const { data: site, error: siteErr } = await admin
      .from("sites")
      .select(
        "id, subdomain, domain, domain_status, domain_setup_status",
      )
      .eq("id", id)
      .single();
    if (siteErr || !site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    // No `check` param → return current subdomain AND custom-domain
    // info so the SubdomainEditor can decide which view to render.
    // Per Peter 2026-05-10 v2: when a custom domain is active, the
    // subdomain editor should lock and show the custom domain as the
    // primary URL instead.
    //
    // "Active" must respect BOTH state columns:
    //   - domain_setup_status: Cloudflare verification (DNS + SSL).
    //     'failed' / 'pending' / 'verifying' here means CF is NOT actually
    //     serving the domain — the composer must NOT show "Live".
    //   - domain_status: business workflow flag. Set by super admin when a
    //     domain request is approved. Stale after CF failures.
    //
    // Rules:
    //   1. If domain_setup_status === 'failed' → NOT active, full stop.
    //   2. If domain_setup_status === 'active' → active (CF says so).
    //   3. Legacy sites have domain_setup_status === null — fall back to
    //      domain_status === 'active' for backward compat. The proposal
    //      timeline treats NULL the same way.
    if (!candidate) {
      type SiteRow = typeof site & {
        domain?: string | null;
        domain_status?: string | null;
        domain_setup_status?: string | null;
      };
      const s = site as SiteRow;
      const setupFailed = s.domain_setup_status === "failed";
      const setupActive = s.domain_setup_status === "active";
      const legacyApproved =
        !s.domain_setup_status && s.domain_status === "active";
      const isCustomDomainActive =
        !!s.domain &&
        s.domain.length > 0 &&
        !setupFailed &&
        (setupActive || legacyApproved);
      return NextResponse.json({
        subdomain: site.subdomain ?? null,
        domain: PROPOSAL_DOMAIN || null,
        customDomain: s.domain ?? null,
        customDomainActive: isCustomDomainActive,
      });
    }

    // Format validation first — cheap, no DB hit needed for invalid input.
    const fmt = validateSubdomainFormat(candidate);
    if (!fmt.valid) {
      return NextResponse.json({
        subdomain: candidate,
        available: false,
        error: fmt.error,
      });
    }

    // Same value as the site already has → trivially "available" (no-op).
    if (candidate === site.subdomain) {
      return NextResponse.json({
        subdomain: candidate,
        available: true,
        unchanged: true,
      });
    }

    // Uniqueness check — exclude the current site so its own value
    // doesn't collide with itself.
    const { data: conflict } = await admin
      .from("sites")
      .select("id")
      .eq("subdomain", candidate)
      .neq("id", id)
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      subdomain: candidate,
      available: !conflict,
      error: conflict ? "Subdomain is already in use" : undefined,
    });
  } catch (err) {
    console.error("[subdomain GET] ERROR:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, profile } = await requireAuth();
    if (!["tech_admin", "super_admin", "sales"].includes(profile.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const next = typeof body.subdomain === "string" ? body.subdomain.trim() : "";

    // ── Validate format ──
    const fmt = validateSubdomainFormat(next);
    if (!fmt.valid) {
      return NextResponse.json({ error: fmt.error }, { status: 400 });
    }

    if (!PROPOSAL_DOMAIN) {
      return NextResponse.json(
        { error: "PROPOSAL_DOMAIN env var not configured on the server" },
        { status: 500 },
      );
    }

    const admin = createAdminClient();

    // ── Load current state ──
    const { data: site, error: siteErr } = await admin
      .from("sites")
      .select("id, slug, subdomain")
      .eq("id", id)
      .single();
    if (siteErr || !site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const oldSubdomain = site.subdomain ?? null;

    // No-op if unchanged — saves a Cloudflare round-trip.
    if (next === oldSubdomain) {
      return NextResponse.json({
        success: true,
        subdomain: next,
        url: `https://${next}.${PROPOSAL_DOMAIN}`,
        unchanged: true,
      });
    }

    // ── Uniqueness check (race-safe via the DB unique index too) ──
    const { data: conflict } = await admin
      .from("sites")
      .select("id")
      .eq("subdomain", next)
      .neq("id", id)
      .limit(1)
      .maybeSingle();
    if (conflict) {
      return NextResponse.json(
        { error: "Subdomain is already in use by another site" },
        { status: 409 },
      );
    }

    const projectName = sanitizeProjectName(site.slug || site.id);
    const newDomain = `${next}.${PROPOSAL_DOMAIN}`;

    // ── Cloudflare side ──
    // If there was an old mapping, swap (deletes old DNS+Pages domain, adds
    // new). If this is the first time, just register the new domain.
    if (oldSubdomain) {
      const oldDomain = `${oldSubdomain}.${PROPOSAL_DOMAIN}`;
      try {
        await updateCustomDomain(projectName, oldDomain, newDomain);
      } catch (err) {
        console.error("[subdomain PUT] CF updateCustomDomain failed:", err);
        return NextResponse.json(
          {
            error:
              err instanceof Error
                ? `Cloudflare update failed: ${err.message}`
                : "Cloudflare update failed",
          },
          { status: 502 },
        );
      }
    } else {
      const ok = await ensureCustomDomain(projectName, newDomain);
      if (!ok) {
        return NextResponse.json(
          { error: "Failed to register custom domain on Cloudflare" },
          { status: 502 },
        );
      }
    }

    // ── DB persist (only after CF succeeds) ──
    const newUrl = `https://${newDomain}`;
    const { error: updErr } = await admin
      .from("sites")
      .update({ subdomain: next, site_url: newUrl })
      .eq("id", id);
    if (updErr) {
      // CF is already updated; surface the error so the user can retry, but
      // the live site URL still resolves correctly via DNS — only the DB
      // record is stale until next publish.
      console.error(
        "[subdomain PUT] DB update failed AFTER successful CF swap:",
        updErr,
      );
      return NextResponse.json(
        {
          error: `DB update failed but Cloudflare is configured: ${updErr.message}`,
        },
        { status: 500 },
      );
    }

    // ── Self-healing cleanup ──
    // Sweep any *.{PROPOSAL_DOMAIN} mappings still on this CF Pages
    // project that DON'T match the new subdomain. updateCustomDomain's
    // DELETE is best-effort so leftovers can pile up across rapid
    // changes; this clears them in one shot. Scoped to THIS project
    // only — other sites' CF mappings are not touched. Best-effort:
    // errors are logged but don't fail the user's save.
    try {
      const cleanup = await cleanupOrphanedFallbackSubdomains({
        projectName,
        keepSubdomain: newDomain,
      });
      if (cleanup.removed.length > 0) {
        console.log(
          `[subdomain PUT] Cleaned ${cleanup.removed.length} orphan(s): ${cleanup.removed.join(", ")}`,
        );
      }
      if (cleanup.errors.length > 0) {
        console.warn(
          `[subdomain PUT] Cleanup non-fatal errors:`,
          cleanup.errors,
        );
      }
    } catch (cleanupErr) {
      console.error("[subdomain PUT] Cleanup threw (non-fatal):", cleanupErr);
    }

    await logAudit({
      userId: user.id,
      action: "update_subdomain",
      entityType: "site",
      entityId: id,
      details: { from: oldSubdomain, to: next, domain: newDomain },
    });

    return NextResponse.json({
      success: true,
      subdomain: next,
      url: newUrl,
    });
  } catch (err) {
    console.error("[subdomain PUT] ERROR:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
