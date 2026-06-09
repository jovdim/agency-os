import { NextRequest, NextResponse } from "next/server";
import { renderSitePage } from "@/lib/templates/render";
import { resolveSiteByHost } from "@/lib/platform/resolve-site";
import { isPlatformHost } from "@/lib/platform/hosts";

/**
 * Tenant render endpoint — the public, DB-driven serving of a client website.
 *
 * Reached only via internal rewrite from `src/proxy.ts`: a request to
 * `balkar.2dni.sk/o-nas` is rewritten to `/site/balkar.2dni.sk/o-nas`, which
 * this optional-catch-all route handler serves. We return a full raw HTML
 * document (not a React page) so the renderer's `<html>…</html>` output isn't
 * wrapped in Next's app shell.
 *
 * Phase 1: renders the live `composition` straight from the DB on every request
 * (force-dynamic, mirroring /api/sites/[id]/render). Phase 2 switches the
 * source to `published_composition`; Phase 3 adds per-site tag caching +
 * revalidate-on-publish so this isn't a cold render on every hit.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
} as const;

/** Map a request path (clean URL) to a composition page path. */
function toPagePath(segments: string[] | undefined): string {
  const parts = (segments || []).filter(Boolean);
  if (parts.length === 0) return "index.html";
  const joined = parts.join("/");
  return joined.endsWith(".html") ? joined : `${joined}.html`;
}

function miniDoc(title: string, body: string, status: number): NextResponse {
  return new NextResponse(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;color:#475569;background:#f8fafc}div{text-align:center;padding:40px;max-width:32rem}h1{font-size:1.25rem;color:#0f172a;margin:0 0 .5rem}p{margin:0;font-size:.95rem}</style></head><body><div><h1>${title}</h1><p>${body}</p></div></body></html>`,
    { status, headers: HTML_HEADERS },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ host: string; path?: string[] }> },
) {
  const { host: rawHost, path } = await params;
  const host = decodeURIComponent(rawHost);

  // This route serves ONLY genuine tenant traffic (rewritten here by
  // src/proxy.ts). Reject a direct hit on the CRM origin — e.g. a logged-in
  // dashboard user requesting crm-host/site/<anything> — by requiring the REAL
  // request Host to be a platform host. Tenant content must never render under
  // the trusted CRM origin (content spoofing / future cookie-scope confusion).
  if (!isPlatformHost(req.headers.get("host"))) {
    return miniDoc("Not found", "Not found.", 404);
  }

  const site = await resolveSiteByHost(host);
  if (!site) {
    return miniDoc("Site not found", "This address is not connected to a website yet.", 404);
  }
  if (site.isLegacy) {
    // Legacy (GitHub+cheerio) sites are not served by the dynamic platform.
    return miniDoc("Not available", "This website is hosted on the legacy platform.", 404);
  }

  const requestedPage = toPagePath(path);
  // Serve the LIVE (published) content. When a site has no published content
  // yet (never published, or migration 00080 not applied), fall back to the
  // draft composition so dev/test hosts still render. Once the platform serves
  // real public traffic (Phase 8 cutover), a null published_composition should
  // become a "coming soon"/404 instead of leaking the draft.
  let result: Awaited<ReturnType<typeof renderSitePage>>;
  try {
    result = await renderSitePage(site.id, {
      pagePath: requestedPage,
      preview: false,
      siteUrl: `https://${host}`,
      ...(site.publishedComposition
        ? { compositionOverride: site.publishedComposition }
        : {}),
    });
  } catch (e) {
    // renderSite() throws on some invalid compositions (e.g. a contact form
    // enabled without a recipient email). Degrade to a styled 503 instead of a
    // raw 500 so a bad draft never hard-crashes the public page.
    return miniDoc(
      "Temporarily unavailable",
      e instanceof Error ? e.message : "Render failed",
      503,
    );
  }

  // Render errors (no composition, no pages) — 503 (not 200) so crawlers don't
  // index a broken state as a valid page.
  if ("error" in result) {
    return miniDoc("Temporarily unavailable", result.error, 503);
  }

  // renderSitePage falls back to the home page when the requested page doesn't
  // exist — turn that into a real 404 for unknown deep paths (SEO correctness).
  if (requestedPage !== "index.html" && result.pagePath !== requestedPage) {
    return miniDoc("Page not found", "The page you are looking for does not exist.", 404);
  }

  return new NextResponse(result.html, {
    status: 200,
    headers: {
      ...HTML_HEADERS,
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
