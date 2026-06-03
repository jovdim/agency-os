/**
 * Extract the registrable apex of a domain.
 *
 *   "www.clientname.sk"     → "clientname.sk"
 *   "shop.www.clientname.sk"→ "clientname.sk"
 *   "clientname.sk"         → "clientname.sk"
 *   "deep.sub.example.co.uk"→ "example.co.uk"
 *
 * "Apex" here means the registrable domain — the level where you'd
 * actually create a Cloudflare zone. For Slovak agency use this is
 * almost always `*.sk`, but we handle a small set of common multi-
 * level public-suffix TLDs so we don't accidentally split
 * `example.co.uk` as `co.uk`.
 *
 * Pure — no I/O, no side effects, safe to import from anywhere.
 *
 * Why a hardcoded list instead of the full PSL: the full Public
 * Suffix List is ~270kb and updates monthly. We don't need that
 * level of coverage — Slovak / EU agency sites fit comfortably in
 * the dozen-ish entries below. If we ever target unusual TLDs (e.g.
 * `example.kawasaki.jp`) we can swap in the real PSL package.
 */

/**
 * Multi-level public suffixes we recognize. Anything ending in one
 * of these gets THREE labels treated as the apex; everything else
 * gets the last two.
 *
 * Keep this lowercase + leading-dot so prefix matching is unambiguous.
 */
const MULTI_LEVEL_SUFFIXES = new Set([
  // United Kingdom
  ".co.uk",
  ".org.uk",
  ".ac.uk",
  ".gov.uk",
  // Australia
  ".com.au",
  ".net.au",
  ".org.au",
  // Brazil
  ".com.br",
  // Czech Republic — used by some Slovak businesses with CZ presence
  ".co.cz",
  // Generic two-segment pattern for academic / government
  ".edu.sk",
  ".gov.sk",
]);

/**
 * Returns the apex (registrable) form of a domain. Lowercases the
 * input first so caller doesn't have to remember to.
 *
 * Throws if `domain` is empty / has fewer than two labels — the
 * caller validates input before calling, so this should never
 * trigger in practice; kept as a safety net.
 */
export function extractApex(domain: string): string {
  const normalized = domain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!normalized) {
    throw new Error("extractApex: empty input");
  }
  const labels = normalized.split(".");
  if (labels.length < 2) {
    throw new Error(`extractApex: "${domain}" has no TLD`);
  }

  // Try the longer multi-level match first.
  if (labels.length >= 3) {
    const lastTwo = "." + labels.slice(-2).join(".");
    if (MULTI_LEVEL_SUFFIXES.has(lastTwo)) {
      return labels.slice(-3).join(".");
    }
  }

  return labels.slice(-2).join(".");
}

/**
 * True if `domain` is a bare apex (no www, no other subdomain).
 *
 * Useful for the timeline UI: when sales types `clientname.sk` we
 * treat that as the canonical naked form; if they type
 * `www.clientname.sk` we'll still set up the redirect, but we
 * surface the naked form as the "primary" everywhere.
 */
export function isApex(domain: string): boolean {
  const normalized = domain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  return normalized === extractApex(normalized);
}
