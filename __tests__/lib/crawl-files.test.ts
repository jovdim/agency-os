import { describe, it, expect } from "vitest";
import {
  buildRobotsTxt,
  buildSitemapXml,
  buildNotFoundHtml,
} from "@/lib/templates/crawl-files";

/**
 * Tests for the three publish-time files: robots.txt, sitemap.xml,
 * 404.html. These ride along with the HTML in every Cloudflare Pages
 * deployment, so a regression here would break SEO crawl behavior on
 * every published site at once.
 */

describe("buildRobotsTxt", () => {
  it("emits Allow + Sitemap pointer when site is visible", () => {
    const txt = buildRobotsTxt({
      siteUrl: "https://acme.2dni.sk",
      noIndex: false,
    });
    expect(txt).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://acme.2dni.sk/sitemap.xml\n",
    );
  });

  it("strips trailing slash from siteUrl before joining", () => {
    const txt = buildRobotsTxt({ siteUrl: "https://x.2dni.sk/" });
    expect(txt).toContain("Sitemap: https://x.2dni.sk/sitemap.xml");
    expect(txt).not.toContain("//sitemap");
  });

  it("emits global Disallow when noIndex is true (overrides everything)", () => {
    const txt = buildRobotsTxt({
      siteUrl: "https://acme.2dni.sk",
      noIndex: true,
    });
    expect(txt).toBe("User-agent: *\nDisallow: /\n");
    // Sitemap line MUST NOT appear when blocked — would defeat the purpose.
    expect(txt).not.toContain("Sitemap:");
  });

  it("works without siteUrl (sitemap line omitted)", () => {
    const txt = buildRobotsTxt({});
    expect(txt).toBe("User-agent: *\nAllow: /\n");
  });

  it("always ends with a trailing newline (some crawlers require it)", () => {
    expect(buildRobotsTxt({ siteUrl: "https://x.2dni.sk" })).toMatch(/\n$/);
    expect(buildRobotsTxt({ noIndex: true })).toMatch(/\n$/);
    expect(buildRobotsTxt({})).toMatch(/\n$/);
  });
});

describe("buildSitemapXml", () => {
  it("emits a single-page sitemap with priority 1.0 + weekly", () => {
    const xml = buildSitemapXml({
      siteUrl: "https://acme.2dni.sk",
      pages: [{ path: "/" }],
      lastmod: "2026-05-09",
    });
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml).toContain("<loc>https://acme.2dni.sk/</loc>");
    expect(xml).toContain("<lastmod>2026-05-09</lastmod>");
    expect(xml).toContain("<changefreq>weekly</changefreq>");
    expect(xml).toContain("<priority>1.0</priority>");
    expect(xml).toContain("</urlset>");
  });

  it("home gets priority 1.0/weekly, inner pages get 0.8/monthly", () => {
    const xml = buildSitemapXml({
      siteUrl: "https://x.2dni.sk",
      pages: [{ path: "/" }, { path: "/sluzby" }, { path: "/kontakt" }],
      lastmod: "2026-05-09",
    });
    // Home
    expect(xml).toContain("<loc>https://x.2dni.sk/</loc>");
    // Inner pages — both must be present with the inner priority
    expect(xml).toContain("<loc>https://x.2dni.sk/sluzby</loc>");
    expect(xml).toContain("<loc>https://x.2dni.sk/kontakt</loc>");
    // Inner-page priority appears twice (sluzby + kontakt)
    expect((xml.match(/<priority>0\.8<\/priority>/g) ?? []).length).toBe(2);
    expect((xml.match(/<priority>1\.0<\/priority>/g) ?? []).length).toBe(1);
    expect((xml.match(/<changefreq>monthly<\/changefreq>/g) ?? []).length).toBe(
      2,
    );
  });

  it("normalizes paths missing the leading slash", () => {
    const xml = buildSitemapXml({
      siteUrl: "https://x.2dni.sk",
      pages: [{ path: "kontakt" }],
    });
    expect(xml).toContain("<loc>https://x.2dni.sk/kontakt</loc>");
  });

  it("strips trailing slash from siteUrl (no double-slash in <loc>)", () => {
    const xml = buildSitemapXml({
      siteUrl: "https://x.2dni.sk/",
      pages: [{ path: "/o-nas" }],
    });
    expect(xml).toContain("<loc>https://x.2dni.sk/o-nas</loc>");
    // The malformed pattern would be a double slash AFTER the host
    expect(xml).not.toMatch(/sk\/\/o-nas/);
  });

  it("omits <lastmod> when not provided", () => {
    const xml = buildSitemapXml({
      siteUrl: "https://x.2dni.sk",
      pages: [{ path: "/" }],
    });
    expect(xml).not.toContain("<lastmod>");
  });

  it("escapes XML special chars in URLs (defensive)", () => {
    // Real-world paths shouldn't contain these, but a malformed
    // composition mustn't break sitemap parsing.
    const xml = buildSitemapXml({
      siteUrl: "https://x.2dni.sk",
      pages: [{ path: "/path?q=a&b=c" }],
    });
    expect(xml).toContain("&amp;");
    expect(xml).not.toMatch(/=a&b=/); // unescaped & would be invalid XML
  });

  it("emits a valid empty <urlset> when pages is empty", () => {
    const xml = buildSitemapXml({
      siteUrl: "https://x.2dni.sk",
      pages: [],
    });
    expect(xml).toContain("<urlset");
    expect(xml).toContain("</urlset>");
    expect(xml).not.toContain("<url>");
  });
});

describe("buildNotFoundHtml", () => {
  it("includes site name + Slovak 404 messaging", () => {
    const html = buildNotFoundHtml({ siteName: "Acme s.r.o." });
    expect(html).toContain("Acme s.r.o.");
    expect(html).toContain("<title>Stránka nenájdená — Acme s.r.o.</title>");
    expect(html).toContain(">404</h1>");
    expect(html).toContain("Stránka nenájdená");
    expect(html).toContain("Späť na úvod");
    expect(html).toContain('href="/"');
  });

  it("emits its own noindex meta so the 404 page never gets indexed", () => {
    const html = buildNotFoundHtml({ siteName: "X" });
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it("declares lang=sk on <html> so screen readers + Google know it's Slovak", () => {
    const html = buildNotFoundHtml({ siteName: "X" });
    expect(html).toContain('<html lang="sk">');
  });

  it("inlines theme primary + bg into the styles", () => {
    const html = buildNotFoundHtml({
      siteName: "X",
      theme: { primary: "#ff6b00", bg: "#0b0b0b" },
    });
    expect(html).toContain("#ff6b00");
    expect(html).toContain("#0b0b0b");
  });

  it("falls back to neutral defaults when theme is unset", () => {
    const html = buildNotFoundHtml({ siteName: "X" });
    // Default primary
    expect(html).toContain("#0f172a");
    // Default bg
    expect(html).toContain("#ffffff");
  });

  it("picks white text on a dark primary (luminance heuristic)", () => {
    const html = buildNotFoundHtml({
      siteName: "X",
      theme: { primary: "#0a0a0a" },
    });
    // Button uses primary as bg + readable text on top. White on near-black.
    expect(html).toContain("color: #ffffff");
  });

  it("picks dark text on a light primary", () => {
    const html = buildNotFoundHtml({
      siteName: "X",
      theme: { primary: "#fef3c7" }, // light cream
    });
    // Slate-900-ish dark color on a pale primary
    expect(html).toContain("color: #0f172a");
  });

  it("escapes HTML special chars in siteName", () => {
    const html = buildNotFoundHtml({ siteName: '<script>alert("xss")</script>' });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;xss&quot;");
  });
});
