import type { SiteComposition } from "@/lib/templates/render";
import type { FieldValue, FieldSchema } from "@/components/composer/placeholder-field";
import type { SectionTemplate } from "@/components/composer/variant-picker";
import { slugifyAnchorId } from "@/lib/templates/slugify";
import { htmlToPlainText } from "@/lib/templates/sanitize";

/**
 * Mirror the first services section's items into every nav menu item
 * that already carries a non-empty `dropdown_items` repeater.
 *
 * Why this exists:
 *   Peter's brief is "Sluzby dropdown should auto-populate from the
 *   services section — add a service, get a dropdown row; rename a
 *   service, get the row's label updated; delete a service, the row
 *   disappears." Without this sync the dropdown was a free-form
 *   editable list that drifted from the actual services on the page,
 *   and click-to-scroll broke whenever a service was renamed (the
 *   anchor moves but the dropdown's stored href doesn't).
 *
 * Source-of-truth:
 *   The FIRST section whose template category is "services" (top-to-
 *   bottom on page 1). If a site has multiple services sections, only
 *   the first one feeds the nav — keeping the rule predictable. The
 *   alternative ("merge all services") was rejected as confusing for
 *   the typical small-business site that only has one section anyway.
 *
 * What counts as a "linked menu item":
 *   ANY nav_links item whose `dropdown_items` is a non-empty array.
 *   In current templates that's just Sluzby; future templates that add
 *   a second dropdown (e.g. a Gallery mega-menu) would also get
 *   synced, which is the wrong behaviour for them. When such a
 *   template lands, add an explicit opt-OUT marker per menu item
 *   (e.g. `__no_services_sync`) rather than retrofitting opt-IN here.
 *
 * Returns:
 *   - The same composition reference when nothing changed (no services
 *     section, no nav, no linked menu item, or already in sync). The
 *     reference equality lets React skip re-renders.
 *   - A new composition with `shared.nav_overrides.nav_links` updated
 *     otherwise. Sections + page structure are untouched.
 *
 * NON-goals:
 *   - Does NOT add a Sluzby menu item if none exists. The client must
 *     have at least one menu item with `dropdown_items` populated as
 *     the linkage anchor — typically the template's default.
 *   - Does NOT remove the linked menu item when services is empty —
 *     the menu item stays, its dropdown becomes empty. CSS gates
 *     empty dropdowns to invisible via `:has(> li)`.
 *   - Does NOT touch dropdown items whose href doesn't look like a
 *     services anchor — well, actually it replaces the WHOLE
 *     dropdown_items array, so any manual customizations get wiped.
 *     That's intentional per Peter's "no custom items" decision.
 *
 * Per-row override (2026-05-19):
 *   Each dropdown row now carries a hidden `__auto: { label, href }`
 *   snapshot of what THIS sync function last wrote into the row.
 *   On every sync we compare the row's CURRENT label/href to its
 *   __auto snapshot:
 *
 *     - Match  → row is still in "auto" mode → safely overwrite with
 *                the freshly-computed values, refresh the snapshot.
 *     - Differ → user has edited that field in the composer → leave
 *                the field alone, still refresh the snapshot to track
 *                what the auto value would be NOW (so a later revert
 *                to the current auto value re-enters auto mode).
 *
 *   Label and href are tracked independently — you can rename a row
 *   without losing the auto-generated href, or repoint an href to a
 *   custom URL without losing the auto-generated label.
 *
 *   Migration from rows that have no __auto yet: treat as auto on
 *   first sync (use computed, seed snapshot). Safe because the
 *   pre-change code wiped manual edits on every render anyway — no
 *   pre-existing manual overrides could have survived to be lost.
 */
export function syncNavDropdownFromServices(
  composition: SiteComposition,
  templateMap: Map<string, SectionTemplate>,
): SiteComposition {
  // Find the first services section across all pages (in page + section
  // order). We start with page 1 since that's where the nav-anchored
  // services section typically lives; if a site somehow puts services
  // on page 2 only, the search still finds it.
  let servicesSection: SiteComposition["pages"][number]["sections"][number] | undefined;
  let servicesTemplate: SectionTemplate | undefined;
  // Track WHICH page the services section lives on. The nav is a shared
  // slot rendered on EVERY page, so its anchor hrefs must be page-
  // qualified — a bare `#sluzba` only scrolls the current page on the
  // live (router-less) static site, so clicking it from a subpage does
  // nothing (Peter 2026-05-28: /second#doplnkova-sluzba-2 stuck on
  // /second instead of jumping to the home-page service).
  let servicesPagePath = composition.pages[0]?.path ?? "index.html";
  outer: for (const page of composition.pages) {
    const ordered = page.sections.slice().sort((a, b) => a.order - b.order);
    for (const section of ordered) {
      const tpl = templateMap.get(section.template_id);
      if (tpl?.category === "services") {
        servicesSection = section;
        servicesTemplate = tpl;
        servicesPagePath = page.path;
        break outer;
      }
    }
  }
  if (!servicesSection || !servicesTemplate) return composition;

  // Root-relative prefix for the dropdown hrefs. Home → "/" (so the
  // link is a same-document fragment on the home page = smooth in-page
  // scroll, AND resolves to home from any subpage). Subpage → "/second"
  // (matches the deployed clean-URL form, so it's a same-document
  // fragment when already on that page and a real navigation from
  // elsewhere). The fragment is appended per item below.
  const homePath = composition.pages[0]?.path ?? "index.html";
  const anchorPrefix =
    servicesPagePath === homePath || servicesPagePath === "index.html"
      ? "/"
      : "/" + servicesPagePath.replace(/\.html$/, "");

  // Pick the services template's repeater. Each services template uses
  // its own repeater key (`services`, `services_steps`, `equipment_items`,
  // `services_pillars`, ...) so we grab the first repeater-typed field
  // in the schema. Templates that have NO repeater (services-08, the
  // fixed 5-card bento) are skipped — there's nothing to sync from.
  const schema = servicesTemplate.placeholder_schema as Record<
    string,
    FieldSchema
  >;
  const repeaterEntry = Object.entries(schema).find(
    ([, f]) => f.type === "repeater",
  );
  if (!repeaterEntry) return composition;
  const [repeaterKey, repeaterSchema] = repeaterEntry;

  // `item_id_source` names which item-local field drives both the
  // dropdown label AND the anchor id. Templates that don't declare it
  // can't be linked — bailing here is safer than guessing a field.
  const idSourceKey = repeaterSchema.item_id_source;
  if (!idSourceKey) return composition;

  // Current items: override array wins, fall back to template defaults
  // (a freshly-added services section that the user hasn't touched yet
  // still has its default services available for sync).
  const items =
    (servicesSection.content_overrides?.[repeaterKey] as
      | Array<Record<string, FieldValue>>
      | undefined) ??
    (repeaterSchema.default_items as
      | Array<Record<string, FieldValue>>
      | undefined) ??
    [];

  // Build the computed dropdown row list. Each row = { label: <link> }
  // where the link's label is the service title and the href is the
  // service's anchor (`#sluzba-1`, `#vykopove-prace`, etc.). Anchor ids
  // mirror render-browser.ts / parser.ts exactly — same slugify, same
  // collision suffixing (`-2`, `-3`) — so click-to-scroll works on the
  // live site without a separate routing layer.
  const usedIds = new Set<string>();
  const computedDropdown: Array<Record<string, FieldValue>> = items.map(
    (item, idx) => {
      const explicit =
        typeof item.__item_id === "string" ? (item.__item_id as string).trim() : "";
      let id: string;
      if (explicit) {
        id = slugifyAnchorId(explicit);
      } else {
        // text + longtext titles now store HTML (per 2026-05-16). Strip
        // wrappers before slugify so a rich-edited title like
        // `<p><strong>Excavation work</strong></p>` slugifies as
        // `excavation-work` (the visible text) instead of leaking the tag
        // names into the anchor.
        id = slugifyAnchorId(htmlToPlainText(readTextField(item, idSourceKey)));
      }
      if (!id) id = `polozka-${idx + 1}`; // Slovak fallback, matches parser
      let final = id;
      let n = 2;
      while (usedIds.has(final)) {
        final = `${id}-${n}`;
        n++;
      }
      usedIds.add(final);

      // Dropdown label sits inside an <a> tag — keep it plain text only
      // (no inline marks). Block-level wrappers like <p> nested in <a>
      // produce invalid HTML and the browser breaks them up at parse
      // time, splitting the dropdown row visually.
      const labelText = htmlToPlainText(readTextField(item, idSourceKey));
      return {
        label: {
          label: labelText,
          // Page-qualified (root-relative) so the shared nav's dropdown
          // works from EVERY page, not just the one the services
          // section sits on. e.g. "/#sluzba" or "/second#sluzba".
          href: `${anchorPrefix}#${final}`,
        } as unknown as FieldValue,
      };
    },
  );

  // Locate nav_links. The override wins if present, otherwise we
  // materialize the nav template's default_items so the very first
  // services mutation on a fresh site still patches the dropdown.
  // Earlier versions of this function bailed when no override existed,
  // which meant adding a 5th service on a brand-new site silently did
  // nothing (the dropdown only had 4 default rows in the template, not
  // in the composition — sync had no `navLinks` to patch).
  const navOverrides = composition.shared?.nav_overrides as
    | Record<string, FieldValue>
    | undefined;
  let navLinks =
    (navOverrides?.nav_links as
      | Array<Record<string, FieldValue>>
      | undefined) ?? null;
  if (!navLinks || navLinks.length === 0) {
    const navTplId = composition.shared?.nav_template_id;
    const navTemplate = navTplId ? templateMap.get(navTplId) : undefined;
    if (!navTemplate) return composition;
    const navSchema = navTemplate.placeholder_schema as Record<
      string,
      FieldSchema
    >;
    const navLinksField = navSchema.nav_links;
    if (!navLinksField || navLinksField.type !== "repeater") return composition;
    const defaultsArray = navLinksField.default_items as
      | Array<Record<string, FieldValue>>
      | undefined;
    if (!defaultsArray || defaultsArray.length === 0) return composition;
    // Clone so subsequent mutations don't mutate the template's shared
    // default_items reference.
    navLinks = defaultsArray.map((item) => ({ ...item }));
  }

  // Replace dropdown_items on every menu item that currently has any —
  // that's the linkage gate. Per-row override merge (see the file-level
  // comment block): each row keeps an __auto snapshot we compare
  // against to decide whether the user has edited a label/href.
  let touched = false;
  const newNavLinks = navLinks.map((menuItem) => {
    const dropItems = menuItem.dropdown_items as
      | Array<Record<string, FieldValue>>
      | undefined;
    if (!Array.isArray(dropItems) || dropItems.length === 0) {
      return menuItem;
    }
    const merged = mergeDropdownWithOverrides(dropItems, computedDropdown);
    if (areDropdownsEqual(dropItems, merged)) {
      return menuItem;
    }
    touched = true;
    return {
      ...menuItem,
      dropdown_items: merged as unknown as FieldValue,
    };
  });

  if (!touched) return composition;

  return {
    ...composition,
    shared: {
      ...(composition.shared ?? {}),
      nav_overrides: {
        ...(navOverrides ?? {}),
        nav_links: newNavLinks as unknown as FieldValue,
      },
    },
  };
}

/**
 * Per-index merge of the computed (auto) dropdown with the existing
 * (possibly user-edited) one. For each computed row, decide what to
 * write back based on the row's __auto snapshot:
 *
 *   - No existing row at this index   → freshly added service,
 *                                       use computed, seed __auto.
 *   - Existing row has no __auto      → legacy row from before this
 *                                       feature shipped. Treat as
 *                                       auto on first sync (safe per
 *                                       the file-level comment).
 *   - Existing label === __auto.label → field still in auto mode →
 *                                       overwrite with computed.
 *                                       (Same rule applies to href
 *                                       independently.)
 *   - Existing label !== __auto.label → user edited that field →
 *                                       preserve their value, but
 *                                       refresh __auto so a future
 *                                       revert-to-current-auto is
 *                                       detected as auto again.
 *
 * Rows beyond computedDropdown.length (extra rows from a since-
 * deleted service) are dropped — matches the pre-2026-05-19 behaviour
 * where the dropdown length always equalled the service count.
 */
function mergeDropdownWithOverrides(
  existing: Array<Record<string, FieldValue>>,
  computed: Array<Record<string, FieldValue>>,
): Array<Record<string, FieldValue>> {
  return computed.map((computedRow, idx) => {
    const computedLink = computedRow.label as {
      label?: string;
      href?: string;
    };
    const computedLabel = computedLink?.label ?? "";
    const computedHref = computedLink?.href ?? "";

    const existingRow = existing[idx];
    if (!existingRow) {
      return {
        label: { label: computedLabel, href: computedHref },
        __auto: { label: computedLabel, href: computedHref },
      } as unknown as Record<string, FieldValue>;
    }

    const existingLink = existingRow.label as
      | { label?: string; href?: string }
      | undefined;
    const existingLabel = existingLink?.label ?? "";
    const existingHref = existingLink?.href ?? "";
    const snap = existingRow.__auto as
      | { label?: string; href?: string }
      | undefined;

    // Migration: row exists from a pre-feature sync — no snapshot to
    // compare against. Treat as auto (matches old behaviour exactly).
    if (!snap) {
      return {
        label: { label: computedLabel, href: computedHref },
        __auto: { label: computedLabel, href: computedHref },
      } as unknown as Record<string, FieldValue>;
    }

    const labelInAutoMode = existingLabel === (snap.label ?? "");
    const hrefInAutoMode = existingHref === (snap.href ?? "");

    return {
      label: {
        label: labelInAutoMode ? computedLabel : existingLabel,
        href: hrefInAutoMode ? computedHref : existingHref,
      },
      // Snapshot ALWAYS tracks the current computed value, even on
      // user-edited rows — so the moment the user reverts back to the
      // current auto value, we recognise it as auto again.
      __auto: { label: computedLabel, href: computedHref },
    } as unknown as Record<string, FieldValue>;
  });
}

/** Read a text-shaped value out of an item map. Handles both the plain-
 *  string and the link-object cases ({label, href}) because some
 *  services templates use a `title` link field instead of a plain text
 *  field for the service name. Strips any HTML tags before returning
 *  (text + longtext fields now store HTML since the rich-editor
 *  unification 2026-05-16), so the dropdown label sits cleanly inside
 *  <a> and the anchor slug derives from the same plain-text source.
 *  Returns "" when the field is missing or carries a non-text shape. */
function readTextField(
  item: Record<string, FieldValue>,
  key: string,
): string {
  const raw = item[key];
  if (typeof raw === "string") return htmlToPlainText(raw);
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    typeof (raw as { label?: unknown }).label === "string"
  ) {
    return htmlToPlainText((raw as { label: string }).label);
  }
  return "";
}

/** Element-wise dropdown equality. Compares the visible link payload
 *  (label + href) AND the __auto snapshot, because a sync that only
 *  refreshed snapshots (e.g. service title changed but the row is
 *  user-edited, so the visible label stays put — but the snapshot
 *  must be updated to track the new auto value) still needs to write
 *  back. Without the snapshot comparison the next sync would loop
 *  forever thinking nothing changed while drifting away from the
 *  current auto value.
 *
 *  Faster than JSON.stringify and produces stable reference equality
 *  for the no-op path. */
function areDropdownsEqual(
  a: Array<Record<string, FieldValue>>,
  b: Array<Record<string, FieldValue>>,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const la = a[i]?.label as { label?: string; href?: string } | undefined;
    const lb = b[i]?.label as { label?: string; href?: string } | undefined;
    if ((la?.label ?? "") !== (lb?.label ?? "")) return false;
    if ((la?.href ?? "") !== (lb?.href ?? "")) return false;
    const sa = a[i]?.__auto as { label?: string; href?: string } | undefined;
    const sb = b[i]?.__auto as { label?: string; href?: string } | undefined;
    if ((sa?.label ?? "") !== (sb?.label ?? "")) return false;
    if ((sa?.href ?? "") !== (sb?.href ?? "")) return false;
  }
  return true;
}
