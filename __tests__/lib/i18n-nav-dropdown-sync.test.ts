import { describe, it, expect } from "vitest";
import { localizeComposition } from "@/lib/i18n/localize";
import { syncNavDropdownFromServices } from "@/lib/composer/nav-dropdown-sync";
import type { SiteComposition } from "@/lib/templates/render";

/**
 * Regression: the Sluzby nav dropdown rows are auto-synced copies of the
 * services section titles (nav-dropdown-sync.ts). The i18n overlay
 * translates the services section but leaves those stored dropdown copies
 * in the default language — so a /de/ (or /en/) menu showed Slovak dropdown
 * items even though the page itself was German.
 *
 * The fix: both the server renderer (render.ts) and the in-composer preview
 * re-run syncNavDropdownFromServices on the LOCALIZED composition, pulling
 * the translated titles into the dropdown. This test locks that behaviour at
 * the data level — the renderer itself needs Supabase, but `localize + sync`
 * are both pure.
 */

type TemplateMapArg = Parameters<typeof syncNavDropdownFromServices>[1];

function templateMap(): TemplateMapArg {
  const map = new Map<string, unknown>([
    [
      "tpl-services",
      {
        id: "tpl-services",
        category: "services",
        placeholder_schema: {
          services_items: {
            type: "repeater",
            item_id_source: "title",
            item_schema: {
              title: { type: "text" },
              desc: { type: "longtext" },
            },
          },
        },
      },
    ],
    [
      "tpl-nav",
      {
        id: "tpl-nav",
        category: "nav",
        placeholder_schema: {
          nav_links: {
            type: "repeater",
            item_schema: {
              label: { type: "link" },
              dropdown_items: {
                type: "repeater",
                item_schema: { label: { type: "link" } },
              },
            },
          },
        },
      },
    ],
  ]);
  return map as unknown as TemplateMapArg;
}

function comp(): SiteComposition {
  return {
    pages: [
      {
        path: "index.html",
        label: "Domov",
        sections: [
          {
            id: "sec-services",
            template_id: "tpl-services",
            order: 0,
            content_overrides: {
              services_items: [
                { title: "Ploty", desc: "Kvalitné ploty" },
                { title: "Brány", desc: "Brány na mieru" },
              ],
            },
          },
        ],
      },
    ],
    shared: {
      nav_template_id: "tpl-nav",
      nav_overrides: {
        nav_links: [
          { label: { label: "Domov", href: "/" } },
          {
            // Sluzby menu item: dropdown rows are in "auto" mode (visible
            // label === __auto snapshot), so the sync is allowed to
            // overwrite them with freshly-computed values.
            label: { label: "Služby", href: "/#sluzby" },
            dropdown_items: [
              {
                label: { label: "Ploty", href: "/#ploty" },
                __auto: { label: "Ploty", href: "/#ploty" },
              },
              {
                label: { label: "Brány", href: "/#brany" },
                __auto: { label: "Brány", href: "/#brany" },
              },
            ],
          },
        ],
      },
    },
    seo: {},
    i18n: {
      default_locale: "sk",
      enabled_locales: ["sk", "de"],
      translations: {
        de: {
          "sec-services": {
            services_items: [
              { title: "Zäune", desc: "Hochwertige Zäune" },
              { title: "Tore", desc: "Tore nach Maß" },
            ],
          },
          // Realistic snapshot: the JSON round-trip exports nav link labels
          // but NOT nested dropdown_items (exportRepeater skips nested
          // repeaters), so the de __nav carries only the two top-level
          // labels — which is exactly why the dropdown needed re-syncing.
          __nav: {
            nav_links: [
              { label: { label: "Startseite" } },
              { label: { label: "Leistungen" } },
            ],
          },
        },
      },
    },
  } as SiteComposition;
}

function dropdownLabels(c: SiteComposition): string[] {
  const navLinks = c.shared?.nav_overrides?.nav_links as
    | Array<Record<string, unknown>>
    | undefined;
  const sluzby = navLinks?.find((it) => Array.isArray(it.dropdown_items));
  const items = (sluzby?.dropdown_items as Array<Record<string, unknown>>) ?? [];
  return items.map((row) => (row.label as { label?: string })?.label ?? "");
}

describe("i18n nav dropdown re-sync", () => {
  it("localize alone leaves the dropdown in the default language (documents the bug)", () => {
    const de = localizeComposition(comp(), "de");
    // The services section itself IS translated…
    const svc = de.pages[0].sections[0].content_overrides!
      .services_items as Array<{ title: string }>;
    expect(svc.map((s) => s.title)).toEqual(["Zäune", "Tore"]);
    // …but the stored dropdown copies are still Slovak (the bug).
    expect(dropdownLabels(de)).toEqual(["Ploty", "Brány"]);
  });

  it("re-syncing the localized composition translates the dropdown labels", () => {
    const de = syncNavDropdownFromServices(
      localizeComposition(comp(), "de"),
      templateMap(),
    );
    expect(dropdownLabels(de)).toEqual(["Zäune", "Tore"]);
  });

  it("preserves the top-level nav link translation while fixing the dropdown", () => {
    const de = syncNavDropdownFromServices(
      localizeComposition(comp(), "de"),
      templateMap(),
    );
    const navLinks = de.shared!.nav_overrides!.nav_links as Array<
      Record<string, unknown>
    >;
    const topLabels = navLinks.map(
      (l) => (l.label as { label?: string }).label,
    );
    expect(topLabels).toEqual(["Startseite", "Leistungen"]);
  });

  it("does not mutate the base composition", () => {
    const base = comp();
    syncNavDropdownFromServices(localizeComposition(base, "de"), templateMap());
    expect(dropdownLabels(base)).toEqual(["Ploty", "Brány"]);
  });
});
