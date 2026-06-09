/**
 * Host classification for the multi-tenant dynamic platform.
 *
 * The app serves TWO classes of host from one deployment:
 *   - CRM host: the agency dashboard (login, /client, /sales, /tech, /admin,
 *     /super, the marketing "/" landing). This is the host in
 *     NEXT_PUBLIC_SITE_URL (plus localhost in dev).
 *   - Platform hosts: a client website served on its own domain. Today that's
 *     the `*.{PROPOSAL_DOMAIN}` fallback subdomain (e.g. `balkar.2dni.sk`) and,
 *     in dev, `<label>.localhost`. Custom domains (Phase 6, Cloudflare for SaaS)
 *     get added here once they point at this app instead of Cloudflare Pages.
 *
 * These helpers are PURE (env + string ops only) so they're safe to call from
 * the Edge middleware runtime (`src/proxy.ts`). The actual host -> site DB
 * lookup lives in `resolve-site.ts` and runs only in Node route handlers.
 *
 * IMPORTANT: classification is intentionally conservative — anything we can't
 * positively identify as a platform host is treated as the CRM host, so we
 * never accidentally divert dashboard/login/preview traffic into tenant
 * rendering. Phase 6 widens this when custom domains move onto the platform.
 */

/** Internal path prefix the middleware rewrites platform requests to. The
 *  tenant route handler lives at `src/app/site/[host]/[[...path]]/route.ts`.
 *  Kept as a literal segment (not a `_`-prefixed private folder, and not a
 *  bare top-level `[dynamic]` segment) so it can't collide with CRM routes. */
export const TENANT_ROUTE_PREFIX = "site";

/** Internal prefix for the per-site CMS admin (theirdomain.com/admin). Kept on a
 *  SEPARATE route subtree from the public-site catch-all so a page (admin UI)
 *  and the catch-all route handler (public site) never collide. The middleware
 *  rewrites `/admin*` on a platform host to `/{TENANT_ADMIN_PREFIX}/<host>*`. */
export const TENANT_ADMIN_PREFIX = "site-admin";

export function stripPort(host: string): string {
  return host.split(":")[0].toLowerCase();
}

/** The agency dashboard host, derived from NEXT_PUBLIC_SITE_URL. Null when not
 *  configured (we then fall back to treating only known patterns as platform). */
export function getCrmHost(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) return null;
  try {
    return stripPort(new URL(raw).host);
  } catch {
    return null;
  }
}

function proposalDomain(): string {
  return (process.env.PROPOSAL_DOMAIN || "").toLowerCase();
}

/**
 * True when this request should be served as a client website (tenant), not as
 * the agency dashboard. Pure/synchronous — no DB.
 */
export function isPlatformHost(rawHost: string | null | undefined): boolean {
  if (!rawHost) return false;
  const host = stripPort(rawHost);

  // The CRM host and bare localhost are never tenant sites.
  const crm = getCrmHost();
  if (crm && host === crm) return false;
  if (host === "localhost" || host === "127.0.0.1") return false;

  // Dev convenience: `<label>.localhost` is a tenant site (resolved by subdomain).
  if (host.endsWith(".localhost")) return true;

  // `*.{PROPOSAL_DOMAIN}` fallback subdomains are tenant sites — but never the
  // apex itself or its `www.` sibling. Gated on a KNOWN CRM host: if
  // NEXT_PUBLIC_SITE_URL is unset (getCrmHost() === null) we fail safe to
  // "everything is CRM" rather than risk classifying a CRM that happens to be
  // served under PROPOSAL_DOMAIN as a tenant.
  const pd = proposalDomain();
  if (crm && pd && host !== pd && host !== `www.${pd}` && host.endsWith(`.${pd}`)) {
    return true;
  }

  // Custom domains are added in Phase 6 (default-to-platform for non-CRM hosts).
  // Until then, unknown hosts are treated as CRM to avoid any regression.
  return false;
}
