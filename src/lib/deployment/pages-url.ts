import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolves the Cloudflare Pages `.pages.dev` URL for a site — the one
 * the composer iframe should use as its `<base href>` for asset
 * resolution.
 *
 * Why a separate URL from `sites.site_url`:
 *   `site_url` holds the user-friendly URL (custom domain → 2dni.sk
 *   subdomain → pages.dev as last resort). The friendly URL is the
 *   right thing to show in UI (LIVE AT pill, Open button), but it's
 *   the WRONG thing to use as the iframe base href because every
 *   hostname change (subdomain rename, custom-domain attach) requires
 *   DNS+SSL propagation. During that window — minutes to hours — the
 *   new hostname returns 404 for every `/_uploads/*` request and the
 *   composer shows "Propagating" placeholders for every image, even
 *   though the deployment itself is fine.
 *
 *   The `.pages.dev` URL is fronted directly by Cloudflare with no
 *   DNS step. It works the instant a deployment exists. By using it
 *   as the iframe base href we sidestep every propagation window —
 *   first publish, republish, subdomain change, custom-domain attach.
 *
 * Resolution chain (each step is more expensive than the last):
 *   1. `site_versions.deployment_url` — latest publish's per-deploy URL.
 *      Project name extracted out of it. Free DB read.
 *   2. Sanitized `site.slug` — works when the slug matches the actual
 *      CF project name (no suffix collision). Free.
 *   3. Cloudflare API lookup — list all Pages projects on the account,
 *      find the one whose custom_domains array contains the site's
 *      friendly hostname. Reliable but costs one network round-trip.
 *      Required for sites where CF appended a random suffix to the
 *      project name (e.g. slug `test-website` → project
 *      `test-website-mp50f88m`), where step 2 produces a URL that
 *      404s on every image fetch.
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

function extractCfProjectName(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    // Direct: "{project}.pages.dev"
    const direct = host.match(/^([a-z0-9-]+)\.pages\.dev$/);
    if (direct) return direct[1];
    // Preview: "{hash}.{project}.pages.dev" — strip the hash prefix
    const preview = host.match(/^[a-f0-9]+\.([a-z0-9-]+)\.pages\.dev$/);
    if (preview) return preview[1];
    return null;
  } catch {
    return null;
  }
}

function sanitizeProjectName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 58);
}

/** Extract the bare hostname from a URL string. Returns null on
 *  malformed input or empty values. Used to compare against CF Pages
 *  custom_domains entries (which are bare hostnames, not URLs). */
function extractHostname(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    if (/^https?:\/\//i.test(trimmed)) return new URL(trimmed).hostname;
    // Bare hostname (e.g. "balkar.sk", "testsds2.2dni.sk") — strip any
    // trailing slash defensively.
    return trimmed.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Look up the Cloudflare Pages project that owns this hostname by
 * reading the CNAME DNS record. Returns the project name or null if
 * the record doesn't exist or doesn't point at *.pages.dev.
 *
 * Why this approach: when [setCustomDomain](cloudflare.ts:119) creates
 * a custom-domain mapping, it ALWAYS creates a CNAME record from the
 * domain to `${projectName}.pages.dev`. That record IS the source of
 * truth — far more reliable than listing all projects and matching
 * their `domains` arrays (which the list endpoint may not even
 * return). Single API call, no pagination, no guessing.
 */
async function findCfProjectByDomain(
  domain: string,
): Promise<string | null> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!zoneId || !apiToken) return null;

  try {
    const res = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(domain)}`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      success?: boolean;
      result?: Array<{ content?: string }>;
    };
    if (!json.success || !json.result?.[0]) return null;
    const target = json.result[0].content?.toLowerCase() ?? "";
    // Strip ".pages.dev" suffix to get the project name. If the
    // target isn't a pages.dev URL (e.g. someone CNAMEd to a third
    // party), bail out.
    const m = target.match(/^([a-z0-9-]+)\.pages\.dev$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the latest pages.dev URL for a site. Returns null only when
 * every strategy fails (no version row, no slug, no matching CF
 * project) — at that point the caller falls back to `siteUrl` which is
 * the original broken behavior. Sites that have been published at
 * least once should always resolve here.
 *
 * Pass `friendlyHost` (e.g. `testsds2.2dni.sk` or `balkar.sk`) so the
 * CF-API fallback knows what custom_domains entry to search for.
 * Without it the CF lookup is skipped — the caller can omit it on
 * pages where the friendly hostname isn't readily available.
 */
export async function resolvePagesUrl(
  admin: SupabaseClient,
  site: { id: string; slug?: string | null; site_url?: string | null },
): Promise<string | null> {
  // ── Strategy 1: latest site_versions row with deployment_url ──
  const { data: lastVersion } = await admin
    .from("site_versions")
    .select("deployment_url")
    .eq("site_id", site.id)
    .not("deployment_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const fromDeploy = extractCfProjectName(lastVersion?.deployment_url);
  if (fromDeploy) return `https://${fromDeploy}.pages.dev`;

  // ── Strategy 2: sanitized slug ──
  // Works for sites where the CF project name matches the slug
  // 1-for-1. Breaks for sites where CF appended a random suffix to
  // disambiguate (e.g. slug `test-website` → project
  // `test-website-mp50f88m`). In that case strategy 3 picks up.
  if (site.slug) {
    const sanitized = sanitizeProjectName(site.slug);
    if (sanitized) {
      // Don't return yet — we'll prefer strategy 3 if the friendly
      // hostname is available, because CF's own response is more
      // authoritative than our guessed-from-slug name. But fall back
      // to the slug guess if CF lookup fails.
      const friendlyHost = extractHostname(site.site_url);
      if (friendlyHost) {
        const fromCf = await findCfProjectByDomain(friendlyHost);
        if (fromCf) return `https://${fromCf}.pages.dev`;
      }
      return `https://${sanitized}.pages.dev`;
    }
  }

  // ── Strategy 3 (slug-less fallback): pure CF lookup ──
  // No slug to guess from — only CF API can tell us the project name.
  const friendlyHost = extractHostname(site.site_url);
  if (friendlyHost) {
    const fromCf = await findCfProjectByDomain(friendlyHost);
    if (fromCf) return `https://${fromCf}.pages.dev`;
  }

  return null;
}
