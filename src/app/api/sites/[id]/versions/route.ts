import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/sites/[id]/versions
 *
 * Returns the latest 5 published versions of the site (most-recent first).
 * Used by the composer's "Versions" history dropdown for revert.
 *
 * Response shape:
 *   { versions: [
 *       { id, created_at, reason, created_by_name }
 *     ] }
 *
 * The composition JSONB itself is NOT returned (could be large) — fetch the
 * full row only when actually reverting via /versions/[v]/revert.
 *
 * Auth — same shape as PUT /sites/[id] and POST /sites/[id]/publish:
 *   - tech_admin / super_admin → always allowed
 *   - sales → allowed iff they own the linked proposal (added 2026-05-10
 *     so the shared timeline UI on /sales/proposals/[id]/composer can
 *     show publish history same as /tech)
 *   - client → allowed iff they own the site (Phase C — clients see their
 *     own publish history in the composer's PublishMenu)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
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

    if (!["tech_admin", "super_admin"].includes(role ?? "")) {
      if (role === "sales") {
        const { data: siteRow } = await admin
          .from("sites")
          .select("proposal_id")
          .eq("id", id)
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
        // Client owner check via admin client (RLS may hide the site row).
        const { data: ownerRow, error: ownerErr } = await admin
          .from("sites")
          .select("owner_id")
          .eq("id", id)
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

    const { data, error } = await admin
      .from("site_versions")
      .select(
        // We surface the publisher's role, not their name — the UI groups
        // people into teams (IT team / Salesperson / Client) so future
        // attribution doesn't lock us into showing personal names.
        `id, created_at, reason, deployment_url, created_by, profiles:created_by(full_name, role)`,
      )
      .eq("site_id", id)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) throw new Error(`Failed to load versions: ${error.message}`);

    const versions = (data ?? []).map((v) => {
      const profileRow = v.profiles as
        | { full_name?: string | null; role?: string | null }
        | { full_name?: string | null; role?: string | null }[]
        | null;
      const profile = Array.isArray(profileRow) ? profileRow[0] : profileRow;
      return {
        id: v.id,
        created_at: v.created_at,
        reason: v.reason,
        deployment_url: v.deployment_url ?? null,
        created_by_name: profile?.full_name ?? null,
        created_by_role: profile?.role ?? null,
      };
    });

    return NextResponse.json({ versions });
  } catch (err) {
    console.error("[versions list] ERROR:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
