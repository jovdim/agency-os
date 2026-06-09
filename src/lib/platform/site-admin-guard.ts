import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifySessionToken, SITE_SESSION_COOKIE } from "./site-session";

/**
 * Authorize the current request as the per-site CMS admin for `siteId`.
 *
 * Reads the host-scoped session cookie, verifies its HMAC signature + expiry,
 * requires session.site_id === siteId, and re-confirms the site_admin row still
 * exists and is active (so deactivation takes effect immediately).
 *
 * Used by the API routes the composer calls (autosave / publish / uploads) so
 * `theirdomain.com/admin` works WITHOUT a CRM Supabase session — strictly scoped
 * to its own site. Returns null when not a valid site admin for this site.
 */
export async function getSiteAdminForSite(
  siteId: string,
): Promise<{ siteAdminId: string } | null> {
  const store = await cookies();
  const token = store.get(SITE_SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);
  if (!session || session.site_id !== siteId) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("site_admins")
    .select("id, is_active")
    .eq("id", session.sid)
    .eq("site_id", siteId)
    .maybeSingle();
  const row = data as { id: string; is_active?: boolean | null } | null;
  if (!row || row.is_active === false) return null;
  return { siteAdminId: row.id };
}
