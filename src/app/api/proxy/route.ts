import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/proxy?url=<encoded_url>
 * Proxies an external URL for iframe embedding.
 * Strips CSP/X-Frame-Options headers and injects a <base> tag
 * so relative assets resolve correctly against the original domain.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json(
      { error: "Missing url parameter" },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(url, { cache: "no-store" });
    const contentType = response.headers.get("content-type") || "";

    const headers = new Headers(response.headers);

    // Strip security headers that prevent iframe embedding
    headers.delete("content-security-policy");
    headers.delete("x-frame-options");
    headers.delete("content-encoding");
    headers.delete("transfer-encoding");
    headers.delete("content-length");

    // Prevent caching so updates show immediately
    headers.set("cache-control", "no-cache, no-store, must-revalidate");
    headers.set("pragma", "no-cache");

    // For HTML pages, inject <base> tag so relative assets resolve correctly
    if (contentType.includes("text/html")) {
      const html = await response.text();

      const parsed = new URL(url);
      const pathParts = parsed.pathname.split("/");
      const hasExt = pathParts[pathParts.length - 1]?.includes(".");
      const basePath = hasExt
        ? pathParts.slice(0, -1).join("/") + "/"
        : parsed.pathname.replace(/\/?$/, "/");
      const baseUrl = `${parsed.origin}${basePath}`;

      const injection = `
      <base href="${baseUrl}">
      <script>
        document.addEventListener('DOMContentLoaded', () => {
          const overrideLinks = () => {
            document.querySelectorAll('a').forEach(a => {
              if (a.href && !a.href.startsWith('javascript:') && !a.href.includes('/api/proxy')) {
                try {
                  const targetUrl = new URL(a.href, '${baseUrl}');
                  a.href = '/api/proxy?url=' + encodeURIComponent(targetUrl.href);
                } catch(e) {}
              }
            });
          };
          overrideLinks();
          setInterval(overrideLinks, 1000);
        });
      </script>
      `;

      const injectedHtml = html.replace(/<head[^>]*>/i, `$&${injection}\n`);

      return new NextResponse(injectedHtml, {
        status: response.status,
        headers,
      });
    }

    // For non-HTML assets, pass through
    return new NextResponse(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    console.error("Proxy error:", error);
    return NextResponse.json(
      { error: "Failed to fetch proxied URL" },
      { status: 500 },
    );
  }
}
