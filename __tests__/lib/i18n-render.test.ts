import { describe, it, expect } from "vitest";
import {
  pageAnchorPrefix,
  buildHreflangTags,
  qualifyCrossPageAnchors,
  localePageHref,
  injectLanguageSwitcher,
  type RenderedPage,
} from "@/lib/templates/render";
import type { LocaleRenderTarget } from "@/lib/i18n/localize";

/**
 * Render-side i18n integration tests: the locale-aware URL helpers that
 * make multi-language output correct. The deep merge is covered in
 * i18n-localize.test.ts; here we verify the bits that turn a localized
 * composition into correctly-linked, SEO-tagged HTML — locale anchor
 * prefixes, hreflang alternates, and cross-page anchor qualification
 * scoped to a locale folder.
 */

const TARGETS: LocaleRenderTarget[] = [
  { locale: "sk", prefix: "", isDefault: true },
  { locale: "de", prefix: "de/", isDefault: false },
  { locale: "en", prefix: "en/", isDefault: false },
];

describe("pageAnchorPrefix", () => {
  it("default locale: '/' for home, '/<page>' for a subpage", () => {
    expect(pageAnchorPrefix("index.html", "index.html")).toBe("/");
    expect(pageAnchorPrefix("o-nas.html", "index.html")).toBe("/o-nas");
  });

  it("sub-locale: prefixes the locale folder", () => {
    expect(pageAnchorPrefix("index.html", "index.html", "/de")).toBe("/de/");
    expect(pageAnchorPrefix("o-nas.html", "index.html", "/de")).toBe("/de/o-nas");
  });

  it("treats a non-index home path as home", () => {
    expect(pageAnchorPrefix("home.html", "home.html", "/en")).toBe("/en/");
  });
});

describe("buildHreflangTags", () => {
  it("emits one alternate per locale + x-default, all absolute", () => {
    const tags = buildHreflangTags(
      "index.html",
      "index.html",
      TARGETS,
      "https://acme.sk",
    );
    expect(tags).toContain('hreflang="sk" href="https://acme.sk"');
    expect(tags).toContain('hreflang="de" href="https://acme.sk/de"');
    expect(tags).toContain('hreflang="en" href="https://acme.sk/en"');
    // x-default points at the default locale (sk → root)
    expect(tags).toContain('hreflang="x-default" href="https://acme.sk"');
  });

  it("builds subpage URLs with locale folder + clean path", () => {
    const tags = buildHreflangTags(
      "o-nas.html",
      "index.html",
      TARGETS,
      "https://acme.sk",
    );
    expect(tags).toContain('hreflang="sk" href="https://acme.sk/o-nas"');
    expect(tags).toContain('hreflang="de" href="https://acme.sk/de/o-nas"');
    expect(tags).toContain('hreflang="en" href="https://acme.sk/en/o-nas"');
    expect(tags).toContain('hreflang="x-default" href="https://acme.sk/o-nas"');
  });

  it("returns empty string when no siteUrl (preview/edit)", () => {
    expect(buildHreflangTags("index.html", "index.html", TARGETS, undefined)).toBe(
      "",
    );
  });

  it("strips a trailing slash on siteUrl so URLs aren't doubled", () => {
    const tags = buildHreflangTags(
      "index.html",
      "index.html",
      TARGETS,
      "https://acme.sk/",
    );
    expect(tags).toContain('href="https://acme.sk"');
    expect(tags).not.toContain("https://acme.sk//");
  });
});

describe("qualifyCrossPageAnchors — locale scoping", () => {
  function page(path: string, body: string): RenderedPage {
    return {
      path,
      label: path,
      html: `<!DOCTYPE html><html><body>${body}</body></html>`,
    };
  }

  it("rewrites a bare cross-page anchor to the locale-prefixed page URL", () => {
    // Home links to #kontakt which lives on the contact subpage.
    const pages = [
      page("index.html", `<nav><a href="#kontakt">Kontakt</a></nav>`),
      page("kontakt.html", `<section id="kontakt">Kontakt</section>`),
    ];
    qualifyCrossPageAnchors(pages, "index.html", "/de");
    expect(pages[0].html).toContain('href="/de/kontakt#kontakt"');
  });

  it("leaves a same-page anchor bare (keeps in-page smooth scroll)", () => {
    const pages = [
      page(
        "index.html",
        `<a href="#kontakt">Kontakt</a><section id="kontakt">x</section>`,
      ),
    ];
    qualifyCrossPageAnchors(pages, "index.html", "/de");
    expect(pages[0].html).toContain('href="#kontakt"');
    expect(pages[0].html).not.toContain("/de/");
  });

  it("default locale (no prefix) keeps the historical root-relative form", () => {
    const pages = [
      page("index.html", `<nav><a href="#kontakt">Kontakt</a></nav>`),
      page("kontakt.html", `<section id="kontakt">Kontakt</section>`),
    ];
    qualifyCrossPageAnchors(pages, "index.html");
    expect(pages[0].html).toContain('href="/kontakt#kontakt"');
  });

  it("leaves an unknown anchor (no hosting page) untouched", () => {
    const pages = [page("index.html", `<a href="#ghost">x</a>`)];
    qualifyCrossPageAnchors(pages, "index.html", "/de");
    expect(pages[0].html).toContain('href="#ghost"');
  });
});

describe("localePageHref", () => {
  it("home: '/' for default, '/de' for sub-locale", () => {
    expect(localePageHref(TARGETS[0], "index.html", "index.html")).toBe("/");
    expect(localePageHref(TARGETS[1], "index.html", "index.html")).toBe("/de");
  });

  it("subpage: '/o-nas' default, '/de/o-nas' sub-locale", () => {
    expect(localePageHref(TARGETS[0], "o-nas.html", "index.html")).toBe("/o-nas");
    expect(localePageHref(TARGETS[1], "o-nas.html", "index.html")).toBe("/de/o-nas");
  });
});

describe("injectLanguageSwitcher", () => {
  function navPage(path: string): RenderedPage {
    return {
      path,
      label: path,
      html: `<!DOCTYPE html><html><body><nav class="site-nav"><div class="nav-inner"><a class="logo">Logo</a><div class="nav-actions"><div class="nav-socials"><a class="nav-social">FB</a></div><a class="nav-cta">Call</a></div></div></nav><main>x</main></body></html>`,
    };
  }

  // Same shape as a real nav template: a `.nav-links` menu list (which
  // becomes the hamburger overlay on mobile) alongside the action cluster.
  function navPageWithMenu(path: string): RenderedPage {
    return {
      path,
      label: path,
      html: `<!DOCTYPE html><html><body><nav class="site-nav"><div class="nav-inner"><a class="logo">Logo</a><ul class="nav-links"><li><a href="#a">A</a></li><li><a href="#b">B</a></li></ul><div class="nav-actions"><div class="nav-socials"><a class="nav-social">FB</a></div><a class="nav-cta">Call</a></div></div></nav><main>x</main></body></html>`,
    };
  }

  it("adds a dropdown with one link per locale to the equivalent page", () => {
    const pages = [navPage("index.html")];
    injectLanguageSwitcher(pages, TARGETS, TARGETS[1], "index.html");
    const html = pages[0].html;
    expect(html).toContain("sk-lang-switcher");
    expect(html).toContain("<details"); // native no-JS dropdown
    expect(html).toContain("sk-lang-menu");
    expect(html).toContain('href="/"'); // sk home
    expect(html).toContain('href="/de"'); // de home
    expect(html).toContain('href="/en"'); // en home
    // full language names + inline-SVG flag per locale in the menu
    expect(html).toContain("Deutsch");
    expect(html).toContain("English");
    expect(html).toContain("sk-lang-flag");
    // inline SVG flags (real graphics, render on every OS — NOT emoji)
    expect(html).toContain("sk-lang-switcher__flag");
    expect(html).toContain("<svg");
    expect(html).not.toContain("🇩🇪");
    expect(html).not.toContain("🇬🇧");
    // the old translate-icon + text-code markup is gone
    expect(html).not.toContain("sk-lang-switcher__icon");
    expect(html).not.toContain("sk-lang-code");
  });

  it("inserts the switcher between the social icons and the phone CTA", () => {
    const pages = [navPage("index.html")];
    injectLanguageSwitcher(pages, TARGETS, TARGETS[0], "index.html");
    const html = pages[0].html;
    const socialsPos = html.indexOf('class="nav-socials"');
    const switcherPos = html.indexOf('<details class="sk-lang-switcher"');
    const ctaPos = html.indexOf('class="nav-cta"');
    expect(socialsPos).toBeGreaterThan(-1);
    expect(switcherPos).toBeGreaterThan(socialsPos); // after socials
    expect(ctaPos).toBeGreaterThan(switcherPos); // before the CTA
  });

  it("on navs with a menu: hides the bar switcher on mobile + adds a language row per locale into the menu", () => {
    const pages = [navPageWithMenu("index.html")];
    injectLanguageSwitcher(pages, TARGETS, TARGETS[0], "index.html");
    const html = pages[0].html;
    // bar switcher element tagged so the CSS can hide it below 900px
    expect(html).toContain('class="sk-lang-switcher sk-lang-switcher--bar"');
    // one menu row per locale, injected into the .nav-links overlay list
    const rows = html.match(/class="sk-lang-mobile-item"/g) ?? [];
    expect(rows.length).toBe(TARGETS.length);
    // the rows carry the locale links (e.g. the de home href)
    expect(html).toContain('href="/de"');
  });

  it("on navs WITHOUT a menu: the bar switcher is not mobile-gated and no menu rows are added", () => {
    const pages = [navPage("index.html")]; // navPage has no .nav-links
    injectLanguageSwitcher(pages, TARGETS, TARGETS[0], "index.html");
    const html = pages[0].html;
    // plain bar switcher element — no --bar modifier on the element itself
    expect(html).toContain('<details class="sk-lang-switcher">');
    expect(html).not.toContain('class="sk-lang-mobile-item"');
  });

  it("injects the dropdown style block once into <head>", () => {
    const pages = [navPage("index.html")];
    injectLanguageSwitcher(pages, TARGETS, TARGETS[0], "index.html");
    const html = pages[0].html;
    const matches = html.match(/id="sk-lang-switcher-style"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("marks the current locale link with aria-current and shows a flag SVG in the trigger", () => {
    const pages = [navPage("o-nas.html")];
    injectLanguageSwitcher(pages, TARGETS, TARGETS[1], "index.html");
    const html = pages[0].html;
    // current = de → menu link to the subpage gets aria-current
    expect(html).toContain('href="/de/o-nas"');
    expect(html).toMatch(/aria-current="true"/);
    // trigger holds the current language's flag as an inline SVG
    expect(html).toMatch(
      /<summary[^>]*>[\s\S]*sk-lang-switcher__flag[\s\S]*<svg[\s\S]*<\/summary>/,
    );
  });

  it("no-ops gracefully when there is no nav", () => {
    const pages: RenderedPage[] = [
      { path: "index.html", label: "x", html: "<html><body><main>no nav</main></body></html>" },
    ];
    expect(() =>
      injectLanguageSwitcher(pages, TARGETS, TARGETS[0], "index.html"),
    ).not.toThrow();
    expect(pages[0].html).not.toContain("sk-lang-switcher");
  });
});
