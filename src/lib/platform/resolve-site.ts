import { createAdminClient } from "@/lib/supabase/admin";
import type { SiteComposition } from "@/lib/templates/render";
import { stripPort } from "./hosts";

/**
 * Resolve an incoming request host to a site. Runs in Node route handlers only
 * (uses the Supabase admin/service-role client). Order of resolution:
 *   1. Exact custom-domain match (`sites.domain`), www-insensitive.
 *   2. `*.{PROPOSAL_DOMAIN}` fallback subdomain match (`sites.subdomain`).
 *   3. Dev convenience: `<label>.localhost` -> subdomain == label.
 *
 * Returns the site id, its legacy flag, and the LIVE (`published_composition`)
 * content. Returns null when no site matches (caller serves a platform 404).
 *
 * Resilience: `published_composition` was added in migration 00080. If that
 * migration hasn't been applied yet, the column-bearing select fails and we
 * transparently fall back to a select without it (publishedComposition =
 * null) so the tenant route still resolves the site during the rollout window.
 *
 * NOTE: not cached yet — the tenant route is `force-dynamic` for Phase 1.
 * Phase 3 wraps this in `unstable_cache` tagged `host:{host}`, revalidated when
 * a domain is attached/detached.
 */
export interface ResolvedSite {
  id: string;
  isLegacy: boolean;
  /** Live content. Null when the site has never been published (or pre-00080). */
  publishedComposition: SiteComposition | null;
}

type SiteRow = {
  id: string;
  is_legacy: boolean | null;
  published_composition?: unknown;
};

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

function toResolved(row: SiteRow): ResolvedSite {
  return {
    id: row.id,
    isLegacy: !!row.is_legacy,
    publishedComposition:
      (row.published_composition as SiteComposition | null) ?? null,
  };
}

/** Escape LIKE/ILIKE wildcards so a host is matched literally (hostnames don't
 *  normally contain % or _, but never let one act as a wildcard). */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Look up a site by domain or subdomain, tolerating a pre-00080 schema that
 * lacks `published_composition`.
 *   - domain: matched CASE-INSENSITIVELY (stored casing isn't guaranteed).
 *   - subdomain: exact match (already lowercase-validated at write time).
 * Uses `.limit(1)` (not `.maybeSingle()`) so an accidental duplicate row can
 * never surface as a query error -> silent 404.
 */
async function lookupSite(
  column: "domain" | "subdomain" | "slug",
  value: string,
): Promise<ResolvedSite | null> {
  if (!value) return null;
  const admin = createAdminClient();

  const filtered = (cols: string) => {
    const q = admin.from("sites").select(cols);
    // domain is matched case-insensitively; subdomain/slug are exact.
    return column === "domain"
      ? q.ilike("domain", escapeLike(value))
      : q.eq(column, value);
  };

  const withPublished = await filtered(
    "id, is_legacy, published_composition",
  ).limit(1);
  if (!withPublished.error) {
    const row = withPublished.data?.[0] as unknown as SiteRow | undefined;
    return row ? toResolved(row) : null;
  }

  // Fallback for the pre-migration window (published_composition doesn't exist).
  const minimal = await filtered("id, is_legacy").limit(1);
  if (minimal.error) return null;
  const row = minimal.data?.[0] as unknown as SiteRow | undefined;
  return row ? toResolved(row) : null;
}

export async function resolveSiteByHost(
  rawHost: string,
): Promise<ResolvedSite | null> {
  const host = stripWww(stripPort(rawHost));

  // 1. Custom domain (apex stored without www).
  const byDomain = await lookupSite("domain", host);
  if (byDomain) return byDomain;

  // 2. *.{PROPOSAL_DOMAIN} fallback subdomain.
  const pd = (process.env.PROPOSAL_DOMAIN || "").toLowerCase();
  if (pd && host.endsWith(`.${pd}`)) {
    const sub = host.slice(0, host.length - pd.length - 1);
    const hit = await lookupSite("subdomain", sub);
    if (hit) return hit;
  }

  // 3. <label>.localhost (dev only): match subdomain first, then slug — so ANY
  //    site is reachable locally at <slug>.localhost without setting a subdomain.
  if (host.endsWith(".localhost")) {
    const label = host.slice(0, host.length - ".localhost".length);
    return (
      (await lookupSite("subdomain", label)) ||
      (await lookupSite("slug", label))
    );
  }

  return null;
}
