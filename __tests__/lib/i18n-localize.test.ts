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
 */

function baseComp(): SiteComposition {
  return {
    pages: [
      {
        path: "index.html",
        label: "Domov",
        sections: [
          {
            id: "sec-hero",
            template_id: "tpl-hero",
            order: 0,
            content_overrides: {
              hero_headline: "Staviame ploty na mieru",
              hero_image: "https://img/hero.jpg",
              hero_cta: { label: "Kontakt", href: "#kontakt" },
            },
          },
          {
            id: "sec-services",
            template_id: "tpl-services",
            order: 1,
            content_overrides: {
              services_title: "Naše služby",
              services_items: [
                {
                  title: "Ploty",
                  desc: "Kvalitné ploty",
                  image: "https://img/1.jpg",
                  link: { label: "Viac", href: "#ploty" },
                },
                {
                  title: "Brány",
                  desc: "Brány na mieru",
                  image: "https://img/2.jpg",
                  link: { label: "Viac", href: "#brany" },
                },
              ],
            },
          },
        ],
      },
      {
        path: "o-nas.html",
        label: "O nás",
        sections: [
          {
            id: "sec-about",
            template_id: "tpl-about",
            order: 0,
            content_overrides: {
              about_headline: "O nás",
              about_body: "Sme firma.",
            },
          },
        ],
      },
    ],
    shared: {
      nav_template_id: "tpl-nav",
      nav_overrides: {
        nav_links: [{ label: { label: "Domov", href: "#domov" } }],
      },
      footer_template_id: "tpl-footer",
      footer_overrides: { footer_about: "Sme firma z Popradu." },
    },
    seo: {
      title: "Ploty Poprad",
      description: "Staviame ploty",
      favicon_url: "https://img/fav.ico",
    },
    i18n: {
      default_locale: "sk",
      enabled_locales: ["sk", "de", "en"],
      translations: {
        de: {
          "sec-hero": {
            hero_headline: "Wir bauen Zäune nach Maß",
            hero_cta: { label: "Kontakt DE" },
          },
          "sec-services": {
            services_title: "Unsere Leistungen",
            services_items: [
              { title: "Zäune", desc: "Hochwertige Zäune", link: { label: "Mehr" } },
              { title: "Tore", desc: "Tore nach Maß", link: { label: "Mehr" } },
            ],
          },
          "sec-about": {
            about_headline: "Über uns",
            about_body: "Wir sind eine Firma.",
          },
          __seo: { title: "Zäune Poprad", description: "Wir bauen Zäune" },
          __nav: { nav_links: [{ label: { label: "Startseite" } }] },
          __footer: { footer_about: "Wir sind eine Firma aus Poprad." },
        },
      },
    },
  };
}

describe("config helpers", () => {
  it("getDefaultLocale returns the configured default", () => {
    expect(getDefaultLocale(baseComp())).toBe("sk");
  });

  it("getDefaultLocale is undefined for a single-language site", () => {
    const c = baseComp();
    delete c.i18n;
    expect(getDefaultLocale(c)).toBeUndefined();
  });

  it("isMultiLocale true when >1 enabled locale, false otherwise", () => {
    expect(isMultiLocale(baseComp())).toBe(true);
    const c = baseComp();
    c.i18n!.enabled_locales = ["sk"];
    expect(isMultiLocale(c)).toBe(false);
    const d = baseComp();
    delete d.i18n;
    expect(isMultiLocale(d)).toBe(false);
  });

  it("hasTranslation: default always true, translated true, untranslated/empty false", () => {
    const c = baseComp();
    expect(hasTranslation(c, "sk")).toBe(true); // default
    expect(hasTranslation(c, "de")).toBe(true); // has snapshot
    expect(hasTranslation(c, "en")).toBe(false); // enabled but no snapshot
    c.i18n!.translations!.en = {}; // empty snapshot still counts as untranslated
    expect(hasTranslation(c, "en")).toBe(false);
  });

  it("localePrefix: empty for default, '<loc>/' for others", () => {
    const c = baseComp();
    expect(localePrefix(c, "sk")).toBe("");
    expect(localePrefix(c, "de")).toBe("de/");
    expect(localePrefix(c, "en")).toBe("en/");
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
      { locale: "sk", prefix: "", isDefault: true },
      { locale: "de", prefix: "de/", isDefault: false },
      { locale: "en", prefix: "en/", isDefault: false },
    ]);
  });

  it("getLocaleRenderTargets onlyPublishable drops untranslated locales but keeps default", () => {
    const targets = getLocaleRenderTargets(baseComp(), { onlyPublishable: true });
    // en has no snapshot → dropped; sk (default) + de (translated) remain
    expect(targets.map((t) => t.locale)).toEqual(["sk", "de"]);
  });
});

describe("localizeComposition — passthrough (returns base unchanged)", () => {
  it("returns the same reference for the default locale", () => {
    const c = baseComp();
    expect(localizeComposition(c, "sk")).toBe(c);
  });

  it("returns the same reference when no i18n block", () => {
    const c = baseComp();
    delete c.i18n;
    expect(localizeComposition(c, "de")).toBe(c);
  });

  it("returns the same reference when the locale has no snapshot", () => {
    const c = baseComp();
    expect(localizeComposition(c, "en")).toBe(c); // en enabled but untranslated
  });

  it("returns the same reference when the snapshot is empty", () => {
    const c = baseComp();
    c.i18n!.translations!.en = {};
    expect(localizeComposition(c, "en")).toBe(c);
  });
});

describe("localizeComposition — text fields", () => {
  it("translates a top-level text field", () => {
    const de = localizeComposition(baseComp(), "de");
    const hero = de.pages[0].sections[0];
    expect(hero.content_overrides.hero_headline).toBe("Wir bauen Zäune nach Maß");
  });

  it("preserves base-only fields the snapshot doesn't carry (image url)", () => {
    const de = localizeComposition(baseComp(), "de");
    const hero = de.pages[0].sections[0];
    expect(hero.content_overrides.hero_image).toBe("https://img/hero.jpg");
  });

  it("leaves sections absent from the snapshot untouched", () => {
    const c = baseComp();
    // Remove the about translation → that section stays Slovak in the clone.
    delete c.i18n!.translations!.de!["sec-about"];
    const de = localizeComposition(c, "de");
    expect(de.pages[1].sections[0].content_overrides.about_headline).toBe("O nás");
  });
});

describe("localizeComposition — link fields", () => {
  it("translates the label and preserves the base href", () => {
    const de = localizeComposition(baseComp(), "de");
    const cta = de.pages[0].sections[0].content_overrides.hero_cta as {
      label: string;
      href: string;
    };
    expect(cta).toEqual({ label: "Kontakt DE", href: "#kontakt" });
  });

  it("emits label-only when the base link had no href", () => {
    const c = baseComp();
    c.pages[0].sections[0].content_overrides.hero_cta = { label: "Kontakt" }; // no href
    const de = localizeComposition(c, "de");
    expect(de.pages[0].sections[0].content_overrides.hero_cta).toEqual({
      label: "Kontakt DE",
    });
  });

  it("skips a malformed link value with no label (leaves base value)", () => {
    const c = baseComp();
    // snapshot link value missing a label entirely
    (c.i18n!.translations!.de!["sec-hero"] as Record<string, unknown>).hero_cta = {};
    const de = localizeComposition(c, "de");
    expect(de.pages[0].sections[0].content_overrides.hero_cta).toEqual({
      label: "Kontakt",
      href: "#kontakt",
    });
  });
});

describe("localizeComposition — repeaters", () => {
  it("translates each item's text fields by index", () => {
    const de = localizeComposition(baseComp(), "de");
    const items = de.pages[0].sections[1].content_overrides
      .services_items as Array<Record<string, unknown>>;
    expect(items[0].title).toBe("Zäune");
    expect(items[0].desc).toBe("Hochwertige Zäune");
    expect(items[1].title).toBe("Tore");
    expect(items[1].desc).toBe("Tore nach Maß");
  });

  it("preserves each item's non-text fields (image url)", () => {
    const de = localizeComposition(baseComp(), "de");
    const items = de.pages[0].sections[1].content_overrides
      .services_items as Array<Record<string, unknown>>;
    expect(items[0].image).toBe("https://img/1.jpg");
    expect(items[1].image).toBe("https://img/2.jpg");
  });

  it("translates item link labels keeping each item's href", () => {
    const de = localizeComposition(baseComp(), "de");
    const items = de.pages[0].sections[1].content_overrides
      .services_items as Array<Record<string, { label: string; href: string }>>;
    expect(items[0].link).toEqual({ label: "Mehr", href: "#ploty" });
    expect(items[1].link).toEqual({ label: "Mehr", href: "#brany" });
  });

  it("creates text-only items when the base override is absent (template defaults)", () => {
    const c = baseComp();
    delete c.pages[0].sections[1].content_overrides.services_items; // no override
    const de = localizeComposition(c, "de");
    const items = de.pages[0].sections[1].content_overrides
      .services_items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Zäune");
    expect(items[0].image).toBeUndefined(); // no base image to preserve
  });
});

describe("localizeComposition — virtual sections", () => {
  it("merges __seo title/description into composition.seo, preserving other seo fields", () => {
    const de = localizeComposition(baseComp(), "de");
    expect(de.seo!.title).toBe("Zäune Poprad");
    expect(de.seo!.description).toBe("Wir bauen Zäune");
    expect(de.seo!.favicon_url).toBe("https://img/fav.ico"); // untouched
  });

  it("merges __nav into shared.nav_overrides, translating the link label + keeping href", () => {
    const de = localizeComposition(baseComp(), "de");
    const navLinks = de.shared!.nav_overrides!.nav_links as Array<
      Record<string, { label: string; href: string }>
    >;
    expect(navLinks[0].label).toEqual({ label: "Startseite", href: "#domov" });
  });

  it("merges __footer into shared.footer_overrides", () => {
    const de = localizeComposition(baseComp(), "de");
    expect(de.shared!.footer_overrides!.footer_about).toBe(
      "Wir sind eine Firma aus Poprad.",
    );
  });

  it("skips __nav gracefully when there is no shared block", () => {
    const c = baseComp();
    delete c.shared;
    expect(() => localizeComposition(c, "de")).not.toThrow();
    const de = localizeComposition(c, "de");
    expect(de.shared).toBeUndefined();
  });
});

describe("localizeComposition — subpages", () => {
  it("translates a section that lives on a subpage (keyed by id, not page)", () => {
    const de = localizeComposition(baseComp(), "de");
    expect(de.pages[1].sections[0].content_overrides.about_headline).toBe(
      "Über uns",
    );
    expect(de.pages[1].sections[0].content_overrides.about_body).toBe(
      "Wir sind eine Firma.",
    );
  });
});

describe("localizeComposition — immutability of the base", () => {
  it("does not mutate the base composition", () => {
    const c = baseComp();
    const before = JSON.stringify(c);
    localizeComposition(c, "de");
    expect(JSON.stringify(c)).toBe(before);
  });

  it("returns a deep clone — mutating the result never touches the base", () => {
    const c = baseComp();
    const de = localizeComposition(c, "de");
    (de.pages[0].sections[0].content_overrides as Record<string, unknown>).hero_headline =
      "MUTATED";
    expect(c.pages[0].sections[0].content_overrides.hero_headline).toBe(
      "Staviame ploty na mieru",
    );
    // nested arrays are cloned too
    const deItems = de.pages[0].sections[1].content_overrides
      .services_items as Array<Record<string, unknown>>;
    deItems[0].title = "MUTATED";
    const baseItems = c.pages[0].sections[1].content_overrides
      .services_items as Array<Record<string, unknown>>;
    expect(baseItems[0].title).toBe("Ploty");
  });
});

describe("localizeComposition — defensive", () => {
  it("ignores reserved __section_id keys in a field map", () => {
    const c = baseComp();
    (c.i18n!.translations!.de!["sec-hero"] as Record<string, unknown>).__section_id =
      "hacked";
    const de = localizeComposition(c, "de");
    // __section_id must not be written from a translation snapshot
    expect(
      (de.pages[0].sections[0].content_overrides as Record<string, unknown>).__section_id,
    ).toBeUndefined();
  });

  it("handles a snapshot referencing an unknown section id (no crash, no effect)", () => {
    const c = baseComp();
    c.i18n!.translations!.de!["sec-ghost"] = { whatever: "x" };
    expect(() => localizeComposition(c, "de")).not.toThrow();
    const de = localizeComposition(c, "de");
    // real sections still translated correctly
    expect(de.pages[0].sections[0].content_overrides.hero_headline).toBe(
      "Wir bauen Zäune nach Maß",
    );
  });
});
