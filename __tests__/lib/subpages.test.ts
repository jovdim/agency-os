import { describe, it, expect } from "vitest";
import { mergePageSeo, buildHeadMeta, type SiteSeo, type PageSeo } from "@/lib/templates/seo";
import { buildSitemapXml } from "@/lib/templates/crawl-files";
import { clearLinksToPage } from "@/lib/composer/page-anchors";
import type { SiteComposition } from "@/lib/templates/render";

// ─────────────────────────────────────────────────────────────────────
// Per-page SEO: mergePageSeo
// ─────────────────────────────────────────────────────────────────────
describe("mergePageSeo", () => {
  const site: SiteSeo = {
    title: "Site Title",
    description: "Site description",
    og_image_url: "/site-og.png",
    og_image_width: 1200,
    og_image_height: 630,
    favicon_url: "/fav.ico",
    ga4_measurement_id: "G-ABC123",
    google_site_verification: "tok_0123456789abcdef",
    no_index: false,
  };

  it("returns the site SEO unchanged when the page has no overrides", () => {
    expect(mergePageSeo(site, undefined)).toEqual(site);
    expect(mergePageSeo(site, {})).toEqual(site);
  });

  it("lets a page override title + description", () => {
    const page: PageSeo = { title: "O nás", description: "About us page" };
    const merged = mergePageSeo(site, page);
    expect(merged.title).toBe("O nás");
    expect(merged.description).toBe("About us page");
  });

  it("preserves site-only fields (favicon, GA4, GSC) that pages can't set", () => {
    const merged = mergePageSeo(site, { title: "X" });
    expect(merged.favicon_url).toBe("/fav.ico");
    expect(merged.ga4_measurement_id).toBe("G-ABC123");
    expect(merged.google_site_verification).toBe("tok_0123456789abcdef");
  });

  it("ignores empty page strings (inherits site instead)", () => {
    const merged = mergePageSeo(site, { title: "   ", description: "" });
    expect(merged.title).toBe("Site Title");
    expect(merged.description).toBe("Site description");
  });

  it("takes the page's og image dimensions WITH its image (never mismatched)", () => {
    const merged = mergePageSeo(site, {
      og_image_url: "/page-og.png",
      og_image_width: 800,
      og_image_height: 418,
    });
    expect(merged.og_image_url).toBe("/page-og.png");
    expect(merged.og_image_width).toBe(800);
    expect(merged.og_image_height).toBe(418);
  });

  it("honors a per-page no_index=true while site stays indexable", () => {
    const merged = mergePageSeo(site, { no_index: true });
    expect(merged.no_index).toBe(true);
  });

  it("does not mutate the inputs", () => {
    const siteCopy = { ...site };
    mergePageSeo(site, { title: "X" });
    expect(site).toEqual(siteCopy);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Per-page canonical / og:url + home-only LocalBusiness
// ─────────────────────────────────────────────────────────────────────
describe("buildHeadMeta — per-page canonical + JSON-LD gating", () => {
  it("uses pageUrl for canonical + og:url (subpage points at itself)", () => {
    const html = buildHeadMeta(
      { title: "O nás" },
      {
        siteName: "Acme",
        siteUrl: "https://acme.2dni.sk",
        pageUrl: "https://acme.2dni.sk/o-nas",
      },
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://acme.2dni.sk/o-nas">',
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://acme.2dni.sk/o-nas">',
    );
  });

  it("falls back to siteUrl for canonical when no pageUrl given", () => {
    const html = buildHeadMeta(
      { title: "Home" },
      { siteName: "Acme", siteUrl: "https://acme.2dni.sk" },
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://acme.2dni.sk">',
    );
  });

  it("emits LocalBusiness JSON-LD on the home page", () => {
    const html = buildHeadMeta(
      { title: "Home" },
      {
        siteName: "Acme",
        siteUrl: "https://acme.2dni.sk",
        pageUrl: "https://acme.2dni.sk",
        emitLocalBusiness: true,
        brand: { company_text: "Acme s.r.o.", phone: "0900111222" } as never,
      },
    );
    expect(html).toContain("application/ld+json");
    expect(html).toContain("LocalBusiness");
  });

  it("does NOT emit LocalBusiness JSON-LD on a subpage", () => {
    const html = buildHeadMeta(
      { title: "O nás" },
      {
        siteName: "Acme",
        siteUrl: "https://acme.2dni.sk",
        pageUrl: "https://acme.2dni.sk/o-nas",
        emitLocalBusiness: false,
        brand: { company_text: "Acme s.r.o.", phone: "0900111222" } as never,
      },
    );
    expect(html).not.toContain("LocalBusiness");
  });

  it("per-page no_index emits the robots noindex meta", () => {
    const html = buildHeadMeta(
      { title: "Thank you", no_index: true },
      { siteName: "Acme", siteUrl: "https://acme.2dni.sk", pageUrl: "https://acme.2dni.sk/dakujeme" },
    );
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Sitemap clean URLs
// ─────────────────────────────────────────────────────────────────────
describe("buildSitemapXml — clean URLs + home priority", () => {
  it("emits clean home + subpage URLs with correct priority", () => {
    const xml = buildSitemapXml({
      siteUrl: "https://acme.2dni.sk",
      pages: [{ path: "/" }, { path: "/o-nas" }],
      lastmod: "2026-05-28",
    });
    // Home → bare origin + slash, priority 1.0
    expect(xml).toContain("<loc>https://acme.2dni.sk/</loc>");
    expect(xml).toContain("<priority>1.0</priority>");
    // Subpage → /o-nas (no .html), priority 0.8
    expect(xml).toContain("<loc>https://acme.2dni.sk/o-nas</loc>");
    expect(xml).toContain("<priority>0.8</priority>");
    // No ".html" leaks into any loc
    expect(xml).not.toContain(".html");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Dangling-link cleanup: clearLinksToPage
// ─────────────────────────────────────────────────────────────────────
describe("clearLinksToPage", () => {
  function comp(navLinks: Array<Record<string, unknown>>): SiteComposition {
    return {
      pages: [{ path: "index.html", label: "Home", sections: [] }],
      shared: {
        nav_template_id: "nav-01",
        nav_overrides: { nav_links: navLinks },
      },
    } as unknown as SiteComposition;
  }

  it("clears a nav link pointing at the deleted page (.html form)", () => {
    const c = comp([{ label: { label: "O nás", href: "o-nas.html" } }]);
    const next = clearLinksToPage(c, "o-nas.html");
    const link = (next.shared!.nav_overrides!.nav_links as Array<Record<string, { href: string }>>)[0]
      .label;
    expect(link.href).toBe("");
  });

  it("clears the clean-URL form and the cross-page-anchor form", () => {
    const c = comp([
      { label: { label: "A", href: "/o-nas" } },
      { label: { label: "B", href: "/o-nas#kontakt" } },
      { label: { label: "C", href: "o-nas.html#tim" } },
    ]);
    const next = clearLinksToPage(c, "o-nas.html");
    const links = next.shared!.nav_overrides!.nav_links as Array<
      Record<string, { href: string }>
    >;
    expect(links[0].label.href).toBe("");
    expect(links[1].label.href).toBe("");
    expect(links[2].label.href).toBe("");
  });

  it("leaves links to OTHER pages + same-page anchors + external alone", () => {
    const c = comp([
      { label: { label: "Sluzby", href: "sluzby.html" } },
      { label: { label: "Kontakt", href: "#kontakt" } },
      { label: { label: "FB", href: "https://facebook.com/x" } },
    ]);
    const next = clearLinksToPage(c, "o-nas.html");
    // No matches → same reference returned (lets React skip work).
    expect(next).toBe(c);
  });

  it("does not match a different page with a shared prefix", () => {
    const c = comp([{ label: { label: "X", href: "o-nas-2.html" } }]);
    const next = clearLinksToPage(c, "o-nas.html");
    expect(next).toBe(c);
  });
});
