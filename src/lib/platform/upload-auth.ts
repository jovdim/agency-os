import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteAdminForSite } from "@/lib/platform/site-admin-guard";

/**
 * Single source of truth for "may this caller touch media on this site?" —
 * shared by the composer upload + delete routes so the per-site ownership
 * matrix can't drift between them (which is exactly how the DELETE handler
 * ended up able to remove any tenant's media).
 *
 *   - cookieless per-site CMS admin → only their own bound site
 *   - tech_admin / super_admin      → any site
 *   - sales                         → a site whose linked proposal they own
 *   - client                        → only sites they own (owner_id)
 *   - anything else                 → denied
 *
 * Node-only (uses the service-role admin client + the site-admin cookie guard).
 */
export async function canAccessSiteMedia(
  siteId: string,
  user: User | null,
): Promise<boolean> {
  if (!siteId) return false;

  // Per-site CMS admin (no Supabase session) — the guard binds the session to
  // exactly this siteId, so this authorizes ONLY their own site.
  if (!user) {
    return Boolean(await getSiteAdminForSite(siteId));
  }

  const role = (user.app_metadata?.role as string | undefined) ?? "unknown";
  if (role === "tech_admin" || role === "super_admin") return true;

  const admin = createAdminClient();

  if (role === "sales") {
    const { data: siteRow } = await admin
      .from("sites")
      .select("proposal_id")
      .eq("id", siteId)
      .maybeSingle();
    if (!siteRow?.proposal_id) return false;
    const { data: proposal } = await admin
      .from("proposals")
      .select("sales_person_id")
      .eq("id", siteRow.proposal_id)
      .maybeSingle();
    return Boolean(proposal && proposal.sales_person_id === user.id);
  }

  if (role === "client") {
    const { data: ownerRow } = await admin
      .from("sites")
      .select("owner_id")
      .eq("id", siteId)
      .maybeSingle();
    return Boolean(ownerRow && ownerRow.owner_id === user.id);
  }

  return false;
}
