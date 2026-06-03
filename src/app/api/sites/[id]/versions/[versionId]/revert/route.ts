import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishSite } from "@/lib/templates/publish";
import { logAudit } from "@/lib/audit";

// publishSite -> renderSite downloads templates from Supabase Storage via
// native fetch. Without these directives Next.js caches those fetches and
// reverts can re-publish using stale template HTML/CSS. Matches the other
// publish-adjacent routes.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/**
 * POST /api/sites/[id]/versions/[versionId]/revert
 *
 * Atomic revert flow:
 *   1. Validate auth + that the version belongs to this site (no side effects yet)
 *   2. Copy the version's composition into sites.composition (DB-only, reversible)
 *   3. Call publishSite() — renders + uploads to Cloudflare, inserts a new
 *      site_versions row with reason="rollback"
 *   4. Return the live URL
 *
 * If publishSite throws, sites.composition is left as the reverted version.
 * That's intentional: the user explicitly asked to roll back, so even if
 * the deploy step fails, their composition state matches what they wanted.
 * They can retry publish manually.
 *
 * Auth — same shape as PUT /sites/[id] and POST /sites/[id]/publish:
 *   - tech_admin / super_admin → always allowed
 *   - client → allowed iff they own the site (Phase C — Revert is exposed
 *     to clients in the PublishMenu; under the hood it's just a re-publish
 *     of an older snapshot, which clients are already allowed to do)
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: siteId, versionId } = await params;
    const role = user.app_metadata?.role as string | undefined;
    const admin = createAdminClient();

    if (!["tech_admin", "super_admin"].includes(role ?? "")) {
      if (role === "sales") {
        // Sales: must own the linked proposal. Same shape as the
        // GET /versions check, kept inline rather than DRY'd because
        // each route's auth tweaks tend to drift; explicit > clever.
        const { data: siteRow } = await admin
          .from("sites")
          .select("proposal_id")
          .eq("id", siteId)
          .maybeSingle();
        if (!siteRow?.proposal_id) {
          return NextResponse.json({ error: "Site not found" }, { status: 404 });
        }
        const { data: linkedProposal } = await admin
          .from("proposals")
          .select("sales_person_id")
          .eq("id", siteRow.proposal_id)
          .maybeSingle();
        if (!linkedProposal || linkedProposal.sales_person_id !== user.id) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      } else if (role === "client") {
        const { data: ownerRow, error: ownerErr } = await admin
          .from("sites")
          .select("owner_id")
          .eq("id", siteId)
          .maybeSingle();
        if (ownerErr || !ownerRow) {
          return NextResponse.json({ error: "Site not found" }, { status: 404 });
        }
        if (ownerRow.owner_id !== user.id) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      } else {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    console.log(`[revert] site=${siteId} version=${versionId} user=${user.id} role=${role ?? "(none)"}`);

    // ── 1. VALIDATE — find the version and confirm it belongs to this site
    const { data: version, error: vErr } = await admin
      .from("site_versions")
      .select("id, site_id, composition, created_at")
      .eq("id", versionId)
      .single();
    if (vErr || !version) {
      throw new Error("Version not found");
    }
    if (version.site_id !== siteId) {
      throw new Error("Version does not belong to this site");
    }

    // ── 2. WRITE composition back to the site (reversible if next step fails)
    const { error: updErr } = await admin
      .from("sites")
      .update({ composition: version.composition })
      .eq("id", siteId);
    if (updErr) {
      throw new Error(`Failed to load composition: ${updErr.message}`);
    }

    // ── 3. PUBLISH — irreversible, but at this point everything has validated
    const result = await publishSite(siteId, user.id, "rollback");

    await logAudit({
      userId: user.id,
      action: "revert_site",
      entityType: "site",
      entityId: siteId,
      details: {
        sourceVersionId: versionId,
        sourceVersionCreatedAt: version.created_at,
        deploymentId: result.deploymentId,
        url: result.url,
      },
    });

    console.log(`[revert] success site=${siteId} url=${result.url}`);

    return NextResponse.json({
      success: true,
      url: result.url,
      pagesUrl: result.pagesUrl,
      deploymentId: result.deploymentId,
      versionId: result.versionId,
    });
  } catch (err) {
    console.error("[revert] ERROR:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
