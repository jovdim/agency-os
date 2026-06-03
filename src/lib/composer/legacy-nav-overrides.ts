// Back-compat shim for the nav schema overhaul (2026-05-13).
//
// BEFORE: every nav template surfaced FOUR menu-related fields the
// composer rendered as separate controls:
//   • nav_links_before      (repeater of plain links before Sluzby)
//   • nav_link_services     (link — the Sluzby trigger label/href)
//   • nav_services_dropdown (repeater of dropdown items)
//   • nav_links_after       (repeater of plain links after Sluzby)
//
// AFTER: a single `nav_links` repeater whose items are { label, href,
// dropdown_items? }. Sluzby is just one of the items and the user drags
// it anywhere. The nested `dropdown_items` repeater is empty for plain
// links and populated for the dropdown anchor.
//
// Existing sites in the DB still carry the OLD override keys. This
// module rewrites them into the new shape at composition-load time so:
//   1. The composer's UI sees only `nav_links` and presents the new
//      single-list editor.
//   2. The next autosave persists the new shape.
//   3. The renderer (which now only knows the new schema) finds its
//      keys without falling back to template defaults.
//
// Idempotent — running it on already-normalized data is a no-op.

import type { FieldValue, PlaceholderSchema } from "@/lib/templates/parser";
import type { SiteComposition } from "@/lib/templates/render";
import { ENGLISH_TO_SLOVAK_HREF } from "./slovak-anchor-map";

type LinkValue = { label?: string; href?: string };
type LinkItem = Record<string, FieldValue>;

const LEGACY_NAV_KEYS = [
  "nav_links_before",
  "nav_link_services",
  "nav_services_dropdown",
  "nav_links_after",
] as const;

interface SchemaLike {
  placeholder_schema?: PlaceholderSchema | null;
}

/**
 * Walk the composition once and rewrite any section whose template
 * declares the new `nav_links` field but whose stored overrides still
 * carry the legacy keys. Returns a new composition (does not mutate).
 * If nothing needs migrating, returns the input unchanged so React's
 * referential-equality bailouts keep working.
 *
 * `templatesById` maps template_id → its placeholder_schema. The shim
 * needs the schema to (a) recognize a "new nav" template and (b) read
 * the item_schema of the new `nav_links` field so it can construct
 * properly-shaped items for non-dropdown links.
 */
export function migrateLegacyNavOverrides(
  composition: SiteComposition,
  templatesById: Map<string, SchemaLike>,
): SiteComposition {
  let mutated = false;

  const nextShared = composition.shared
    ? migrateSharedSlot(composition.shared, templatesById, () => {
        mutated = true;
      })
    : composition.shared;

  const nextPages = composition.pages.map((page) => {
    let pageMutated = false;
    const nextSections = page.sections.map((sec) => {
      const tpl = templatesById.get(sec.template_id);
      const overrides = sec.content_overrides as
        | Record<string, FieldValue>
        | undefined;
      let migrated = maybeMigrate(overrides, tpl?.placeholder_schema);
      // Slovak href rewrite — runs on EVERY section (not just nav)
      // because CTAs / hero buttons / inline "contact us" anchors
      // all carry link values whose href might still point at the old
      // English ids. Idempotent: only touches strings that match.
      const afterHrefRewrite = rewriteEnglishHrefs(migrated ?? overrides);
      if (afterHrefRewrite !== (migrated ?? overrides)) {
        migrated = afterHrefRewrite as Record<string, FieldValue>;
      }
      if (migrated === overrides) return sec;
      pageMutated = true;
      mutated = true;
      return {
        ...sec,
        content_overrides: (migrated ?? {}) as Record<string, FieldValue>,
      };
    });
    if (!pageMutated) return page;
    return { ...page, sections: nextSections };
  });

  if (!mutated) return composition;
  return { ...composition, shared: nextShared, pages: nextPages };
}

function migrateSharedSlot(
  shared: NonNullable<SiteComposition["shared"]>,
  templatesById: Map<string, SchemaLike>,
  markMutated: () => void,
): NonNullable<SiteComposition["shared"]> {
  let nextShared = shared;

  // ── Nav slot: shape migration + Slovak href rewrite ──
  if (shared.nav_template_id && shared.nav_overrides) {
    const tpl = templatesById.get(shared.nav_template_id);
    let migrated = maybeMigrate(
      shared.nav_overrides as Record<string, FieldValue>,
      tpl?.placeholder_schema,
    );
    const afterHref = rewriteEnglishHrefs(migrated ?? shared.nav_overrides);
    if (afterHref !== (migrated ?? shared.nav_overrides)) {
      migrated = afterHref as Record<string, FieldValue>;
    }
    if (migrated !== shared.nav_overrides) {
      markMutated();
      nextShared = { ...nextShared, nav_overrides: migrated };
    }
  }

  // ── Footer slot: only the Slovak href rewrite (footers never had
  // the four-key legacy nav shape). Footer link lists are the second
  // most common place English hrefs end up; rewriting here means a
  // simple footer-link card with `href="#contact"` gets fixed without
  // the user touching it. ──
  if (shared.footer_overrides) {
    const after = rewriteEnglishHrefs(
      shared.footer_overrides as Record<string, FieldValue>,
    );
    if (after !== shared.footer_overrides) {
      markMutated();
      nextShared = {
        ...nextShared,
        footer_overrides: after as Record<string, FieldValue>,
      };
    }
  }

  return nextShared;
}

/**
 * Returns the SAME reference when no migration is needed, so callers
 * can use referential equality to detect a no-op. Otherwise returns a
 * fresh object with the legacy keys removed and `nav_links` populated.
 */
function maybeMigrate(
  overrides: Record<string, FieldValue> | undefined,
  schema: PlaceholderSchema | null | undefined,
): Record<string, FieldValue> | undefined {
  if (!overrides) return overrides;
  // Schema must declare the new field for the rewrite to be safe — if
  // we migrated on every section indiscriminately we'd corrupt sites
  // whose template was rolled back to the old shape.
  if (!schema || schema.nav_links?.type !== "repeater") return overrides;

  // ── Defensive normalization (idempotent) ──
  // Sites saved by older versions of this shim hit two structural
  // problems we must repair before later code reads the data:
  //   (a) Missing `dropdown_items` per item — renderer falls back to
  //       the nested schema's default_items (Sluzby's 4-service list
  //       inherited from the first <li> template), so every plain
  //       menu link grows a chevron + duplicate dropdown in the iframe.
  //   (b) Flat-string `label` — the first toMenuItem produced items
  //       shaped `{ label: "Domov", href: "#hero" }` but the schema
  //       declares `label` as a LINK type whose value is the object
  //       `{ label, href }`. PlaceholderField's `typeof "object"`
  //       guard fails on the string, falls back to schema defaults,
  //       and EVERY menu link in the editor shows "Sluzby / #services"
  //       (the first <li>'s default label/href). reshapeMenuItem
  //       restores the proper object shape.
  const existingRaw = overrides.nav_links;
  if (Array.isArray(existingRaw) && existingRaw.length > 0) {
    const items = existingRaw as LinkItem[];
    const needsRepair = items.some(
      (it) =>
        !Array.isArray(it?.dropdown_items) || typeof it?.label === "string",
    );
    if (needsRepair) {
      const normalized = items.map((it) => reshapeMenuItem(it));
      overrides = { ...overrides, nav_links: normalized as FieldValue };
    }
  }

  // ── Dropdown-href alignment with service anchors ──
  // Until 2026-05-13 every nav template shipped dropdown defaults
  // pointing at `#service-N` (literally). When the services section
  // gained data-item-id-source="title", each service's anchor became
  // slugified from its title ("Service 1" → "sluzba-1") — the nav
  // links no longer matched any element on the page AND the live-
  // linkage code (composer-client.tsx) couldn't find the affected
  // rows to rewrite when the user edited a service title. Templates
  // were updated to ship `#sluzba-N` defaults; this normalization
  // back-fills existing saved overrides so the user doesn't have to
  // hand-fix each dropdown row. Idempotent — only touches items
  // whose href matches the legacy pattern.
  const navItemsForHrefFix = overrides.nav_links;
  if (Array.isArray(navItemsForHrefFix) && navItemsForHrefFix.length > 0) {
    let anyTouched = false;
    const fixed = (navItemsForHrefFix as LinkItem[]).map((menuItem) => {
      const drop = menuItem.dropdown_items;
      if (!Array.isArray(drop) || drop.length === 0) return menuItem;
      let menuTouched = false;
      const newDrop = (drop as LinkItem[]).map((di) => {
        const link = di.label;
        if (!link || typeof link !== "object" || Array.isArray(link)) return di;
        const lv = link as LinkValue;
        const href = lv.href ?? "";
        const m = /^#service-(\d+)$/.exec(href);
        if (!m) return di;
        menuTouched = true;
        return {
          ...di,
          label: {
            label: lv.label ?? "",
            href: `#sluzba-${m[1]}`,
          } as unknown as FieldValue,
        };
      });
      if (!menuTouched) return menuItem;
      anyTouched = true;
      return {
        ...menuItem,
        dropdown_items: newDrop as unknown as FieldValue,
      };
    });
    if (anyTouched) {
      overrides = { ...overrides, nav_links: fixed as unknown as FieldValue };
    }
  }

  // ── Recovery for broken pre-fix migration ──
  // The first version of this shim collapsed sites whose only old-shape
  // customization was Services into a 1-item nav_links containing just
  // the Services anchor — Home / About us / Gallery / Contact disappeared
  // entirely. Detect that exact shape (legacy keys already stripped, 1
  // item, item carries a non-empty dropdown_items) and rehydrate the
  // missing items from the template's canonical 5-item default, keeping
  // the user's Sluzby customization in place.
  const hasLegacy = LEGACY_NAV_KEYS.some((k) => k in overrides);
  const existing = overrides.nav_links as LinkItem[] | undefined;
  if (
    !hasLegacy &&
    Array.isArray(existing) &&
    existing.length === 1 &&
    Array.isArray(existing[0]?.dropdown_items) &&
    (existing[0].dropdown_items as LinkItem[]).length > 0
  ) {
    const baseDefaults =
      ((schema.nav_links as { default_items?: unknown[] }).default_items as
        | LinkItem[]
        | undefined) ?? [];
    if (baseDefaults.length > 1) {
      const recovered = baseDefaults.map((item) => ({ ...item }));
      const sluzbyIdx = recovered.findIndex((item) => {
        const di = item.dropdown_items;
        return Array.isArray(di) && (di as []).length > 0;
      });
      if (sluzbyIdx >= 0) {
        // Replace the default Sluzby with the user's customized one.
        recovered[sluzbyIdx] = { ...existing[0] };
      }
      return { ...overrides, nav_links: recovered as unknown as FieldValue };
    }
  }

  // Nothing to migrate?
  if (!hasLegacy) return overrides;
  // Already has the new key (partial migration was somehow run before)
  // — keep it and just strip any leftover legacy keys.
  const alreadyNew = "nav_links" in overrides;

  const before = asLinkItems(overrides.nav_links_before);
  const sluzby = asLinkValue(overrides.nav_link_services);
  const dropdown = asLinkItems(overrides.nav_services_dropdown);
  const after = asLinkItems(overrides.nav_links_after);

  let merged: LinkItem[];
  if (alreadyNew) {
    // Partial-migration leftover — preserve the new-shape value and
    // just drop the legacy keys.
    merged = overrides.nav_links as LinkItem[];
  } else if (before.length > 0 || after.length > 0) {
    // The site CUSTOMIZED at least one of the flat link lists, so
    // their intent for the menu order is explicit. Honor it verbatim:
    // before-links → Sluzby anchor (if it carries data) → after-links.
    merged = [
      ...before.map(toMenuItem),
      ...(sluzby || dropdown.length > 0
        ? [
            {
              label: sluzby?.label ?? "",
              href: sluzby?.href ?? "",
              dropdown_items: dropdown.map(toMenuItem),
            },
          ]
        : []),
      ...after.map(toMenuItem),
    ];
  } else {
    // The user didn't customize the flat lists — they were rendering
    // with the OLD template's default_items for before/after on the
    // live site. To preserve what visitors actually saw, start from
    // the NEW template's canonical 5-item menu and overlay only the
    // Sluzby customization (label / href / dropdown_items) on top.
    // Without this step, a site that customized just Services would
    // migrate to a 1-item menu and lose Home / About us / Gallery /
    // Contact entirely.
    const baseDefaults =
      ((schema.nav_links as { default_items?: unknown[] }).default_items as
        | LinkItem[]
        | undefined) ?? [];
    merged = baseDefaults.map((item) => ({ ...item }));
    if (sluzby || dropdown.length > 0) {
      // Heuristic: the Sluzby anchor in defaults is the item that
      // carries a non-empty dropdown_items array. Replace it with the
      // user's data; if dropdown items weren't customized, keep the
      // default service list under the user's relabeled trigger.
      const idx = merged.findIndex((item) => {
        const di = item.dropdown_items;
        return Array.isArray(di) && di.length > 0;
      });
      if (idx >= 0) {
        const existingDropdown =
          (merged[idx].dropdown_items as LinkItem[]) ?? [];
        merged[idx] = {
          ...merged[idx],
          ...(sluzby?.label !== undefined ? { label: sluzby.label } : {}),
          ...(sluzby?.href !== undefined ? { href: sluzby.href } : {}),
          dropdown_items:
            dropdown.length > 0 ? dropdown.map(toMenuItem) : existingDropdown,
        };
      }
    }
  }

  const next: Record<string, FieldValue> = { ...overrides };
  for (const k of LEGACY_NAV_KEYS) delete next[k];
  next.nav_links = merged as unknown as FieldValue;
  return next;
}

function asLinkItems(v: FieldValue | undefined): LinkItem[] {
  return Array.isArray(v) ? (v as LinkItem[]) : [];
}

function asLinkValue(v: FieldValue | undefined): LinkValue | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const lv = v as LinkValue;
  if (!lv.label && !lv.href) return null;
  return lv;
}

/**
 * Convert a legacy `nav_links_before / nav_links_after` item to the new
 * `nav_links` item shape. Both the old and new shapes use a `link`-type
 * `label` field, so the value object IS `{ label, href }` — we keep that
 * structure verbatim and just add the new `dropdown_items: []` slot.
 *
 * Earlier (broken) versions of this function flattened the label to a
 * plain string + sibling `href` key, which the composer's link-field
 * type guard rejects → falls back to schema defaults → every menu
 * item displays as "Sluzby / #services". reshapeMenuItem repairs that
 * legacy data at load time.
 */
function toMenuItem(legacy: LinkItem): LinkItem {
  const labelField = legacy.label;
  // Standard legacy shape: link-typed value object `{ label, href }`.
  if (
    labelField &&
    typeof labelField === "object" &&
    !Array.isArray(labelField)
  ) {
    const lv = labelField as LinkValue;
    return {
      label: { label: lv.label ?? "", href: lv.href ?? "" } as unknown as FieldValue,
      dropdown_items: [],
    };
  }
  // Defensive: an upstream caller passed a string label. Wrap into the
  // expected object, pulling href from the sibling key if present.
  const stringLabel = typeof labelField === "string" ? labelField : "";
  const stringHref = typeof legacy.href === "string" ? legacy.href : "";
  return {
    label: { label: stringLabel, href: stringHref } as unknown as FieldValue,
    dropdown_items: [],
  };
}

/**
 * Repair a saved nav_links item that suffered one or both of the
 * structural problems documented inline at the call site:
 *   - `label` flattened to a string → rewrap as `{ label, href }`
 *     using the sibling `href` key if present, then drop that key
 *     since it's not part of the new schema.
 *   - `dropdown_items` missing → fill with `[]`.
 * Recursively repairs nested dropdown items (which share the same
 * `{ label, href? }` shape since the inner repeater's item_schema
 * also uses a link-type `label` field).
 * Idempotent: items already in the correct shape are returned
 * unchanged (same reference where possible, fresh-but-equivalent
 * otherwise — equality at the OBJECT level isn't load-bearing here
 * because the consuming maybeMigrate compares the outer overrides
 * reference, not per-item).
 */
/**
 * Recursively walk a FieldValue tree and rewrite any link `href`
 * matching the English → Slovak map (`#contact` → `#kontakt`, etc.).
 *
 * Returns the SAME reference when nothing matched so the caller can
 * use referential equality to detect a no-op. Crawls into:
 *   - Plain object values (`{ ...keys }`) — covers content_overrides,
 *     repeater items, link values.
 *   - Arrays — covers repeater item lists.
 *   - LinkValue `{ label, href }` — the only place we actually mutate.
 *
 * Idempotent: an href already in Slovak is left alone.
 *
 * Why this lives in legacy-nav-overrides.ts: the migration is part of
 * the same "fix saved data at load time" pipeline. Splitting it would
 * mean two passes over the composition; this way it rides along.
 */
function rewriteEnglishHrefs(value: unknown): unknown {
  if (Array.isArray(value)) {
    let touched = false;
    const next = value.map((v) => {
      const rv = rewriteEnglishHrefs(v);
      if (rv !== v) touched = true;
      return rv;
    });
    return touched ? next : value;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // LinkValue shape — `{ label, href }`. We only rewrite `href`; the
    // visible label stays whatever the user typed.
    const href = obj.href;
    if (typeof href === "string" && href in ENGLISH_TO_SLOVAK_HREF) {
      return { ...obj, href: ENGLISH_TO_SLOVAK_HREF[href] };
    }
    // Generic object — recurse into every key.
    let touched = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const rv = rewriteEnglishHrefs(v);
      if (rv !== v) touched = true;
      next[k] = rv;
    }
    return touched ? next : value;
  }
  return value;
}

function reshapeMenuItem(item: LinkItem): LinkItem {
  let next = item;

  // (b) String label → object label.
  if (typeof next.label === "string") {
    const flatLabel = next.label;
    const flatHref = typeof next.href === "string" ? next.href : "";
    next = {
      ...next,
      label: { label: flatLabel, href: flatHref } as unknown as FieldValue,
    };
    // Strip the sibling `href` key — it's not part of the new schema.
    delete (next as Record<string, unknown>).href;
  }

  // (a) Missing dropdown_items → [].
  if (!Array.isArray(next.dropdown_items)) {
    next = { ...next, dropdown_items: [] as unknown as FieldValue };
  } else {
    // Recurse into existing dropdown items so legacy string-label
    // dropdown entries (produced by the same buggy toMenuItem) get
    // repaired too. Inner items don't have their own nested repeater,
    // but the reshape is a no-op for already-good items.
    const inner = next.dropdown_items as LinkItem[];
    const innerNeedsRepair = inner.some(
      (it) => typeof it?.label === "string",
    );
    if (innerNeedsRepair) {
      next = {
        ...next,
        dropdown_items: inner.map((it) =>
          reshapeMenuItem(it),
        ) as unknown as FieldValue,
      };
    }
  }

  return next;
}
