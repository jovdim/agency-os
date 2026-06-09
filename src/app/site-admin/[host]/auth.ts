import { headers, cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSiteByHost } from "@/lib/platform/resolve-site";
import { isPlatformHost } from "@/lib/platform/hosts";
import {
  verifySessionToken,
  SITE_SESSION_COOKIE,
} from "@/lib/platform/site-session";

export interface SiteAdminContext {
  host: string;
  siteId: string;
  /** True only when a valid host-scoped session maps to an ACTIVE site_admins
   *  row for THIS site. Re-checked on every load so a deactivated admin loses
   *  access immediately, despite the signed token's 7-day TTL. */
  authed: boolean;
}

/**
 * Shared auth + host→site resolution for every per-site /admin page (overview,
 * editor, balance, domain, …). Returns null when the request isn't a genuine
 * platform host or the host maps to no site — the caller should notFound().
 * When `authed` is false the caller should render the <LoginForm/>.
 */
export async function resolveSiteAdminContext(
  rawHost: string,
): Promise<SiteAdminContext | null> {
  const host = decodeURIComponent(rawHost);

  const hdrs = await headers();
  if (!isPlatformHost(hdrs.get("host"))) return null;

  const site = await resolveSiteByHost(host);
  if (!site) return null;

  const cookieStore = await cookies();
  const token = cookieStore.get(SITE_SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);

  let authed = false;
  if (session && session.site_id === site.id) {
    const admin = createAdminClient();
    const { data: adminRow } = await admin
      .from("site_admins")
      .select("id, is_active")
      .eq("id", session.sid)
      .eq("site_id", site.id)
      .maybeSingle();
    authed =
      !!adminRow &&
      (adminRow as { is_active?: boolean | null }).is_active !== false;
  }

  return { host, siteId: site.id, authed };
}
