import { describe, it, expect } from "vitest";
import { localizeComposition } from "@/lib/i18n/localize";
import { syncNavDropdownFromServices } from "@/lib/composer/nav-dropdown-sync";
import type { SiteComposition } from "@/lib/templates/render";

/**
 * Regression: the Services nav dropdown rows are auto-synced copies of the
 * services section titles (nav-dropdown-sync.ts). The i18n overlay
 * translates the services section but leaves those stored dropdown copies
 * in the default language — so a /es/ menu showed English dropdown items
 * even though the page itself was Spanish.
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
        label: "Home",
        sections: [
          {
            id: "sec-services",
            template_id: "tpl-services",
            order: 0,
            content_overrides: {
              services_items: [
                { title: "Fences", desc: "Quality fences" },
                { title: "Gates", desc: "Custom gates" },
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
          { label: { label: "Home", href: "/" } },
          {
            // Services menu item: dropdown rows are in "auto" mode (visible
            // label === __auto snapshot), so the sync is allowed to
            // overwrite them with freshly-computed values.
            label: { label: "Services", href: "/#sluzby" },
            dropdown_items: [
              {
                label: { label: "Fences", href: "/#ploty" },
                __auto: { label: "Fences", href: "/#ploty" },
              },
              {
                label: { label: "Gates", href: "/#brany" },
                __auto: { label: "Gates", href: "/#brany" },
              },
            ],
          },
        ],
      },
    },
    seo: {},
    i18n: {
      default_locale: "en",
      enabled_locales: ["en", "es"],
      translations: {
        es: {
          "sec-services": {
            services_items: [
              { title: "Vallas", desc: "Vallas de calidad" },
              { title: "Puertas", desc: "Puertas a medida" },
            ],
          },
          // Realistic snapshot: the JSON round-trip exports nav link labels
          // but NOT nested dropdown_items (exportRepeater skips nested
          // repeaters), so the es __nav carries only the two top-level
          // labels — which is exactly why the dropdown needed re-syncing.
          __nav: {
            nav_links: [
              { label: { label: "Inicio" } },
              { label: { label: "Servicios" } },
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
    const es = localizeComposition(comp(), "es");
    // The services section itself IS translated…
    const svc = es.pages[0].sections[0].content_overrides!
      .services_items as Array<{ title: string }>;
    expect(svc.map((s) => s.title)).toEqual(["Vallas", "Puertas"]);
    // …but the stored dropdown copies are still English (the bug).
    expect(dropdownLabels(es)).toEqual(["Fences", "Gates"]);
  });

  it("re-syncing the localized composition translates the dropdown labels", () => {
    const es = syncNavDropdownFromServices(
      localizeComposition(comp(), "es"),
      templateMap(),
    );
    expect(dropdownLabels(es)).toEqual(["Vallas", "Puertas"]);
  });

  it("preserves the top-level nav link translation while fixing the dropdown", () => {
    const es = syncNavDropdownFromServices(
      localizeComposition(comp(), "es"),
      templateMap(),
    );
    const navLinks = es.shared!.nav_overrides!.nav_links as Array<
      Record<string, unknown>
    >;
    const topLabels = navLinks.map(
      (l) => (l.label as { label?: string }).label,
    );
    expect(topLabels).toEqual(["Inicio", "Servicios"]);
  });

  it("does not mutate the base composition", () => {
    const base = comp();
    syncNavDropdownFromServices(localizeComposition(base, "es"), templateMap());
    expect(dropdownLabels(base)).toEqual(["Fences", "Gates"]);
  });
});
