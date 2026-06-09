import { unstable_cache, revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderSitePage, type SiteComposition } from "@/lib/templates/render";

/**
 * Per-site render caching for the public tenant pages.
 *
 * Without this, every visitor triggered a fresh DB read + template downloads +
 * render — slow, costly, and (worse) a path straight to the database under a
 * traffic spike / DDoS. With it, a page is rendered ONCE and served from
 * Next.js's Data Cache to every visitor; the database + renderer are only
 * touched again when the site is re-published (which calls `revalidateSite`).
 *
 * This is the layer that decouples DB load from visitor traffic — so 10 or
 * 10,000 views of a page cost the same, and the database barely sees them.
 */

function siteTag(siteId: string): string {
  return `tenant-site:${siteId}`;
}

export type CachedRender = { html: string; pagePath: string } | { error: string };

/**
 * Render a site's PUBLISHED page, cached and tagged `tenant-site:{id}`.
 * Returns the cached result until the site publishes (revalidateSite) or the
 * 60-second safety TTL elapses (so a missed invalidation self-heals fast).
 */
export async function getCachedTenantPage(
  siteId: string,
  pagePath: string,
  host: string,
): Promise<CachedRender> {
  const run = unstable_cache(
    async (): Promise<CachedRender> => {
      const admin = createAdminClient();
      const { data } = await admin
        .from("sites")
        .select("published_composition")
        .eq("id", siteId)
        .maybeSingle();
      const published =
        ((data as { published_composition?: unknown } | null)
          ?.published_composition as SiteComposition | null) ?? null;
      return renderSitePage(siteId, {
        pagePath,
        preview: false,
        siteUrl: `https://${host}`,
        // Serve the LIVE composition. Fall back to the draft only when nothing
        // has been published yet (new sites / pre-migration) so dev/test hosts
        // still render.
        ...(published ? { compositionOverride: published } : {}),
      });
    },
    // Cache key — distinct per (site, page, host). Host is included so
    // og:image/canonical (which embed the host) don't bleed across domains.
    ["tenant-page", siteId, pagePath, host],
    // 60s TTL = robust caching that self-heals quickly even if a tag
    // invalidation is ever missed. Under traffic this still collapses the
    // DB/render to ~once per minute per page.
    { tags: [siteTag(siteId)], revalidate: 60 },
  );
  return run();
}

/**
 * Invalidate every cached page for a site. Call after the site publishes.
 * Best-effort: the per-site cache also self-expires on its 60s TTL, so if the
 * tag invalidation is ever a no-op the change still appears within ~a minute.
 */
export async function revalidateSite(siteId: string): Promise<void> {
  try {
    revalidateTag(siteTag(siteId), "max");
  } catch {
    /* fall back to the cache's own TTL */
  }
}
