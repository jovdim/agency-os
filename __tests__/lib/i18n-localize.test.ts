import { describe, it, expect } from "vitest";
import {
  localizeComposition,
  getDefaultLocale,
  isMultiLocale,
  hasTranslation,
  localePrefix,
  getLocaleRenderTargets,
} from "@/lib/i18n/localize";
import type { SiteComposition } from "@/lib/templates/render";

/**
 * Tests for the i18n overlay core. This module is the load-bearing piece of
 * multi-language: it deep-clones the default-language composition and merges
 * a locale's translation snapshot on top. Everything else (renderer, publish,
 * composer) sits on this, so it's tested from every angle: passthrough,
 * text / link / repeater merges, the __seo/__nav/__footer virtual sections,
 * subpages, immutability of the base, and malformed input.
 *
 * The platform serves two locales: English (default, renders at "/") and
 * Spanish (renders at "/es/"). The base composition holds the English
 * content; the Spanish snapshot is overlaid on top.
 */

function baseComp(): SiteComposition {
  return {
    pages: [
      {
        path: "index.html",
        label: "Home",
        sections: [
          {
            id: "sec-hero",
            template_id: "tpl-hero",
            order: 0,
            content_overrides: {
              hero_headline: "We build custom fences",
              hero_image: "https://img/hero.jpg",
              hero_cta: { label: "Contact", href: "#kontakt" },
            },
          },
          {
            id: "sec-services",
            template_id: "tpl-services",
            order: 1,
            content_overrides: {
              services_title: "Our services",
              services_items: [
                {
                  title: "Fences",
                  desc: "Quality fences",
                  image: "https://img/1.jpg",
                  link: { label: "More", href: "#ploty" },
                },
                {
                  title: "Gates",
                  desc: "Custom gates",
                  image: "https://img/2.jpg",
                  link: { label: "More", href: "#brany" },
                },
              ],
            },
          },
        ],
      },
      {
        path: "o-nas.html",
        label: "About",
        sections: [
          {
            id: "sec-about",
            template_id: "tpl-about",
            order: 0,
            content_overrides: {
              about_headline: "About us",
              about_body: "We are a company.",
            },
          },
        ],
      },
    ],
    shared: {
      nav_template_id: "tpl-nav",
      nav_overrides: {
        nav_links: [{ label: { label: "Home", href: "#domov" } }],
      },
      footer_template_id: "tpl-footer",
      footer_overrides: { footer_about: "We are a company from Poprad." },
    },
    seo: {
      title: "Fences Poprad",
      description: "We build fences",
      favicon_url: "https://img/fav.ico",
    },
    i18n: {
      default_locale: "en",
      enabled_locales: ["en", "es"],
      translations: {
        es: {
          "sec-hero": {
            hero_headline: "Construimos vallas a medida",
            hero_cta: { label: "Contacto" },
          },
          "sec-services": {
            services_title: "Nuestros servicios",
            services_items: [
              { title: "Vallas", desc: "Vallas de calidad", link: { label: "Más" } },
              { title: "Puertas", desc: "Puertas a medida", link: { label: "Más" } },
            ],
          },
          "sec-about": {
            about_headline: "Sobre nosotros",
            about_body: "Somos una empresa.",
          },
          __seo: { title: "Vallas Poprad", description: "Construimos vallas" },
          __nav: { nav_links: [{ label: { label: "Inicio" } }] },
          __footer: { footer_about: "Somos una empresa de Poprad." },
        },
      },
    },
  };
}

describe("config helpers", () => {
  it("getDefaultLocale returns the configured default", () => {
    expect(getDefaultLocale(baseComp())).toBe("en");
  });

  it("getDefaultLocale is undefined for a single-language site", () => {
    const c = baseComp();
    delete c.i18n;
    expect(getDefaultLocale(c)).toBeUndefined();
  });

  it("isMultiLocale true when >1 enabled locale, false otherwise", () => {
    expect(isMultiLocale(baseComp())).toBe(true);
    const c = baseComp();
    c.i18n!.enabled_locales = ["en"];
    expect(isMultiLocale(c)).toBe(false);
    const d = baseComp();
    delete d.i18n;
    expect(isMultiLocale(d)).toBe(false);
  });

  it("hasTranslation: default always true, translated true, untranslated/empty false", () => {
    const c = baseComp();
    expect(hasTranslation(c, "en")).toBe(true); // default
    expect(hasTranslation(c, "es")).toBe(true); // has snapshot
    c.i18n!.translations!.es = {}; // empty snapshot still counts as untranslated
    expect(hasTranslation(c, "es")).toBe(false);
    delete c.i18n!.translations!.es; // missing snapshot
    expect(hasTranslation(c, "es")).toBe(false);
  });

  it("localePrefix: empty for default, '<loc>/' for others", () => {
    const c = baseComp();
    expect(localePrefix(c, "en")).toBe("");
    expect(localePrefix(c, "es")).toBe("es/");
  });

  it("getLocaleRenderTargets: single root target for a single-language site", () => {
    const c = baseComp();
    delete c.i18n;
    const targets = getLocaleRenderTargets(c);
    expect(targets).toEqual([{ locale: null, prefix: "", isDefault: true }]);
  });

  it("getLocaleRenderTargets: one target per enabled locale, default at root", () => {
    const targets = getLocaleRenderTargets(baseComp());
    expect(targets).toEqual([
      { locale: "en", prefix: "", isDefault: true },
      { locale: "es", prefix: "es/", isDefault: false },
    ]);
  });

  it("getLocaleRenderTargets onlyPublishable drops untranslated locales but keeps default", () => {
    const c = baseComp();
    delete c.i18n!.translations!.es; // es now enabled but untranslated → dropped
    const targets = getLocaleRenderTargets(c, { onlyPublishable: true });
    expect(targets.map((t) => t.locale)).toEqual(["en"]);
  });
});

describe("localizeComposition — passthrough (returns base unchanged)", () => {
  it("returns the same reference for the default locale", () => {
    const c = baseComp();
    expect(localizeComposition(c, "en")).toBe(c);
  });

  it("returns the same reference when no i18n block", () => {
    const c = baseComp();
    delete c.i18n;
    expect(localizeComposition(c, "es")).toBe(c);
  });

  it("returns the same reference when the locale has no snapshot", () => {
    const c = baseComp();
    delete c.i18n!.translations!.es; // es enabled but untranslated
    expect(localizeComposition(c, "es")).toBe(c);
  });

  it("returns the same reference when the snapshot is empty", () => {
    const c = baseComp();
    c.i18n!.translations!.es = {};
    expect(localizeComposition(c, "es")).toBe(c);
  });
});

describe("localizeComposition — text fields", () => {
  it("translates a top-level text field", () => {
    const es = localizeComposition(baseComp(), "es");
    const hero = es.pages[0].sections[0];
    expect(hero.content_overrides.hero_headline).toBe("Construimos vallas a medida");
  });

  it("preserves base-only fields the snapshot doesn't carry (image url)", () => {
    const es = localizeComposition(baseComp(), "es");
    const hero = es.pages[0].sections[0];
    expect(hero.content_overrides.hero_image).toBe("https://img/hero.jpg");
  });

  it("leaves sections absent from the snapshot untouched", () => {
    const c = baseComp();
    // Remove the about translation → that section stays English in the clone.
    delete c.i18n!.translations!.es!["sec-about"];
    const es = localizeComposition(c, "es");
    expect(es.pages[1].sections[0].content_overrides.about_headline).toBe("About us");
  });
});

describe("localizeComposition — link fields", () => {
  it("translates the label and preserves the base href", () => {
    const es = localizeComposition(baseComp(), "es");
    const cta = es.pages[0].sections[0].content_overrides.hero_cta as {
      label: string;
      href: string;
    };
    expect(cta).toEqual({ label: "Contacto", href: "#kontakt" });
  });

  it("emits label-only when the base link had no href", () => {
    const c = baseComp();
    c.pages[0].sections[0].content_overrides.hero_cta = { label: "Contact" }; // no href
    const es = localizeComposition(c, "es");
    expect(es.pages[0].sections[0].content_overrides.hero_cta).toEqual({
      label: "Contacto",
    });
  });

  it("skips a malformed link value with no label (leaves base value)", () => {
    const c = baseComp();
    // snapshot link value missing a label entirely
    (c.i18n!.translations!.es!["sec-hero"] as Record<string, unknown>).hero_cta = {};
    const es = localizeComposition(c, "es");
    expect(es.pages[0].sections[0].content_overrides.hero_cta).toEqual({
      label: "Contact",
      href: "#kontakt",
    });
  });
});

describe("localizeComposition — repeaters", () => {
  it("translates each item's text fields by index", () => {
    const es = localizeComposition(baseComp(), "es");
    const items = es.pages[0].sections[1].content_overrides
      .services_items as Array<Record<string, unknown>>;
    expect(items[0].title).toBe("Vallas");
    expect(items[0].desc).toBe("Vallas de calidad");
    expect(items[1].title).toBe("Puertas");
    expect(items[1].desc).toBe("Puertas a medida");
  });

  it("preserves each item's non-text fields (image url)", () => {
    const es = localizeComposition(baseComp(), "es");
    const items = es.pages[0].sections[1].content_overrides
      .services_items as Array<Record<string, unknown>>;
    expect(items[0].image).toBe("https://img/1.jpg");
    expect(items[1].image).toBe("https://img/2.jpg");
  });

  it("translates item link labels keeping each item's href", () => {
    const es = localizeComposition(baseComp(), "es");
    const items = es.pages[0].sections[1].content_overrides
      .services_items as Array<Record<string, { label: string; href: string }>>;
    expect(items[0].link).toEqual({ label: "Más", href: "#ploty" });
    expect(items[1].link).toEqual({ label: "Más", href: "#brany" });
  });

  it("creates text-only items when the base override is absent (template defaults)", () => {
    const c = baseComp();
    delete c.pages[0].sections[1].content_overrides.services_items; // no override
    const es = localizeComposition(c, "es");
    const items = es.pages[0].sections[1].content_overrides
      .services_items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Vallas");
    expect(items[0].image).toBeUndefined(); // no base image to preserve
  });
});

describe("localizeComposition — virtual sections", () => {
  it("merges __seo title/description into composition.seo, preserving other seo fields", () => {
    const es = localizeComposition(baseComp(), "es");
    expect(es.seo!.title).toBe("Vallas Poprad");
    expect(es.seo!.description).toBe("Construimos vallas");
    expect(es.seo!.favicon_url).toBe("https://img/fav.ico"); // untouched
  });

  it("merges __nav into shared.nav_overrides, translating the link label + keeping href", () => {
    const es = localizeComposition(baseComp(), "es");
    const navLinks = es.shared!.nav_overrides!.nav_links as Array<
      Record<string, { label: string; href: string }>
    >;
    expect(navLinks[0].label).toEqual({ label: "Inicio", href: "#domov" });
  });

  it("merges __footer into shared.footer_overrides", () => {
    const es = localizeComposition(baseComp(), "es");
    expect(es.shared!.footer_overrides!.footer_about).toBe(
      "Somos una empresa de Poprad.",
    );
  });

  it("skips __nav gracefully when there is no shared block", () => {
    const c = baseComp();
    delete c.shared;
    expect(() => localizeComposition(c, "es")).not.toThrow();
    const es = localizeComposition(c, "es");
    expect(es.shared).toBeUndefined();
  });
});

describe("localizeComposition — subpages", () => {
  it("translates a section that lives on a subpage (keyed by id, not page)", () => {
    const es = localizeComposition(baseComp(), "es");
    expect(es.pages[1].sections[0].content_overrides.about_headline).toBe(
      "Sobre nosotros",
    );
    expect(es.pages[1].sections[0].content_overrides.about_body).toBe(
      "Somos una empresa.",
    );
  });
});

describe("localizeComposition — immutability of the base", () => {
  it("does not mutate the base composition", () => {
    const c = baseComp();
    const before = JSON.stringify(c);
    localizeComposition(c, "es");
    expect(JSON.stringify(c)).toBe(before);
  });

  it("returns a deep clone — mutating the result never touches the base", () => {
    const c = baseComp();
    const es = localizeComposition(c, "es");
    (es.pages[0].sections[0].content_overrides as Record<string, unknown>).hero_headline =
      "MUTATED";
    expect(c.pages[0].sections[0].content_overrides.hero_headline).toBe(
      "We build custom fences",
    );
    // nested arrays are cloned too
    const esItems = es.pages[0].sections[1].content_overrides
      .services_items as Array<Record<string, unknown>>;
    esItems[0].title = "MUTATED";
    const baseItems = c.pages[0].sections[1].content_overrides
      .services_items as Array<Record<string, unknown>>;
    expect(baseItems[0].title).toBe("Fences");
  });
});

describe("localizeComposition — defensive", () => {
  it("ignores reserved __section_id keys in a field map", () => {
    const c = baseComp();
    (c.i18n!.translations!.es!["sec-hero"] as Record<string, unknown>).__section_id =
      "hacked";
    const es = localizeComposition(c, "es");
    // __section_id must not be written from a translation snapshot
    expect(
      (es.pages[0].sections[0].content_overrides as Record<string, unknown>).__section_id,
    ).toBeUndefined();
  });

  it("handles a snapshot referencing an unknown section id (no crash, no effect)", () => {
    const c = baseComp();
    c.i18n!.translations!.es!["sec-ghost"] = { whatever: "x" };
    expect(() => localizeComposition(c, "es")).not.toThrow();
    const es = localizeComposition(c, "es");
    // real sections still translated correctly
    expect(es.pages[0].sections[0].content_overrides.hero_headline).toBe(
      "Construimos vallas a medida",
    );
  });
});
