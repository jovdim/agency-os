/**
 * Enumerate every anchor target across ALL composer pages — section ids
 * and per-item ids — so the link-href autocomplete can suggest them when
 * the user types `#`.
 *
 * The IDs returned here MUST match what the renderer (parser.ts /
 * render-browser.ts) actually puts in the rendered HTML, byte-for-byte.
 * That means the same slugify rules + the same collision-suffix
 * algorithm, applied PER PAGE (the renderer resets its dedup Set for
 * every page — see render.ts:467). Drift here = broken deep-links in the
 * editor (autocomplete suggests `#sluzba-2` but published HTML uses
 * `#sluzba` because two were collapsed).
 *
 * Cross-page model (2026-05-28):
 *   The composer edits one page at a time (`activePagePath`) but the nav
 *   is a SHARED slot rendered on every page. So an anchor's stored href
 *   depends on where it lives relative to the page being edited:
 *     - Same page  → bare `#id` (pure in-page scroll, no reload).
 *     - Other page → `o-nas.html#id` (qualified so it resolves from
 *                    anywhere — essential for nav links, which appear on
 *                    every page).
 *   `buildAnchorHref` is the single place that decision is made.
 */
import { slugifyAnchorId, dedupeAnchorId } from "@/lib/templates/slugify";
import type { SiteComposition, CompositionSection } from "@/lib/templates/render";
import type { FieldValue } from "@/lib/templates/parser";

export interface AnchorEntry {
  /** For "section" / "item": the slug id (no `#`) — used for filtering
   *  and dedup display. For "page": the page PATH ("o-nas.html"). */
  id: string;
  /** The exact string written into the link href when this entry is
   *  picked from the autocomplete. Encodes the cross-page decision:
   *    - "page"            → the path verbatim ("o-nas.html")
   *    - same-page anchor  → "#id"
   *    - other-page anchor → "o-nas.html#id"
   *  Display rows show this too, so the operator sees exactly what gets
   *  stored. */
  href: string;
  /** Human-readable label for the dropdown row (e.g. "Excavation work",
   *  or for pages the page title like "About us"). */
  label: string;
  /** "section" / "item" → in-page anchor jump. "page" → whole-page link.
   *  Kept so the dropdown can pick the right icon; the write strategy is
   *  now carried entirely by `href`. */
  kind: "section" | "item" | "page";
  /** Section/anchor group label (e.g. "Services" for a service item).
   *  For "page" entries this is the localized "Page" tag. */
  sectionLabel: string;
  /** Label of the page this anchor lives on. Shown in the dropdown to
   *  disambiguate cross-page targets ("Contact · About us"). Empty for
   *  same-page anchors and for "page" entries. */
  pageLabel?: string;
}

/** Schema-ish shape we read. Loosely typed so we don't fight the
 *  SectionTemplate cast in composer-client. Exported so callers can name
 *  the type when adapting their own SectionTemplate shape. */
export interface AnchorSchemaEntry {
  type?: string;
  item_id_source?: string;
  default?: string;
  // Self-reference deliberately broadened to `unknown` so callers can
  // pass a Record<string, X> where X is a wider shape (we only ever read
  // .type / .item_id_source / .item_schema, never the leaf shape).
  item_schema?: Record<string, unknown>;
}

export interface TemplateLookup {
  /** Resolve a template id to its name + schema. */
  getTemplate: (id: string) => {
    name: string;
    placeholder_schema: Record<string, AnchorSchemaEntry>;
  } | undefined;
  /** Resolve a template id to its default section id (the `id="..."`
   *  attribute on the section root in the template HTML). */
  getDefaultSectionId: (id: string) => string | null;
}

/**
 * Build the stored href for an anchor, encoding the cross-page decision.
 * Same page as the one being edited → bare `#slug` (pure scroll). Any
 * other page → `pagePath#slug` so the link resolves from anywhere (the
 * shared nav renders on every page, so its links must be page-qualified
 * to reach a section that isn't on the current page).
 */
function buildAnchorHref(
  slug: string,
  pagePath: string,
  activePagePath: string,
): string {
  if (!slug) return "";
  return pagePath === activePagePath ? `#${slug}` : `${pagePath}#${slug}`;
}

/**
 * Compute the FINAL anchor id that the renderer will emit for every
 * section on a single page. Mirrors the dedup pass in render.ts /
 * render-browser.ts: pre-seed the used-id Set with the footer's
 * default, then walk page sections in order applying `dedupeAnchorId`
 * to each (override → defaultSectionId → "").
 *
 * Returns a Map keyed by `section.id` (the composition section's
 * UUID, not its anchor id). Sections with no resolvable anchor get
 * an empty string. Used by the SectionCard's #id chip to show the
 * arrow "→ #sluzby-2" when a section was auto-renumbered.
 *
 * Computes for `activePagePath` (the page currently shown in the
 * composer middle column), so subpage section chips register correctly.
 * Falls back to the first page when the active path isn't found.
 *
 * Single source of truth for the section dedup state — keep this in
 * lockstep with the same algorithm in the two renderers, or the chip
 * hint will lie about what the published HTML contains.
 */
export function computeRenderedSectionIds(
  composition: SiteComposition,
  lookup: TemplateLookup,
  activePagePath?: string,
): Map<string, string> {
  const map = new Map<string, string>();
  const page =
    composition.pages.find((p) => p.path === activePagePath) ??
    composition.pages[0];
  if (!page) return map;

  const shared = composition.shared ?? {};
  const usedIds = new Set<string>();
  if (shared.footer_template_id) {
    const footerDefault =
      lookup.getDefaultSectionId(shared.footer_template_id) ?? "";
    if (footerDefault) usedIds.add(footerDefault);
  }

  for (const section of page.sections) {
    const overrides = (section.content_overrides ?? {}) as Record<string, FieldValue>;
    const overrideRaw = (overrides as Record<string, unknown>).__section_id;
    const overrideId =
      typeof overrideRaw === "string" ? slugifyAnchorId(overrideRaw) : "";
    const defaultId = lookup.getDefaultSectionId(section.template_id) ?? "";
    const intendedId = overrideId || defaultId;
    const finalId = intendedId
      ? dedupeAnchorId(intendedId, usedIds)
      : "";
    map.set(section.id, finalId);
  }

  return map;
}

/**
 * Enumerate every composition page as a link target. Used by the
 * link-href autocomplete so an operator editing a nav-link URL can
 * pick "About us" instead of typing `o-nas.html` from memory.
 *
 * No filtering — every page is included (home + subpages). Path is
 * written verbatim into the link href.
 */
/**
 * Clear any link href that points at a now-deleted page.
 *
 * The nav + footer are SHARED across every page, so a nav/footer link to
 * a deleted subpage would 404 from every page on the live site. Page
 * section CTAs can also link cross-page. This walks the WHOLE composition
 * and resets any `href` (inside a {label, href} link object) that targets
 * `deletedPath` to "" — keeping the label + the menu structure intact (so
 * dropdown sync + nav layout don't shift) while neutralizing the dead
 * destination. The operator then sees an empty href in the editor and can
 * repoint or remove it. Matches both the ".html" form and the deployed
 * clean-URL form ("/second"), with or without a trailing #fragment.
 *
 * Returns the same reference when nothing matched so React can skip work.
 */
export function clearLinksToPage(
  composition: SiteComposition,
  deletedPath: string,
): SiteComposition {
  const stem = deletedPath.replace(/\.html$/, "").replace(/^\//, "");
  if (!stem) return composition;

  function targetsDeleted(href: unknown): boolean {
    if (typeof href !== "string" || !href) return false;
    const base = href.split("#")[0];
    if (!base) return false; // pure "#fragment" — same-page, not a page link
    if (/^(https?:|mailto:|tel:|ftp:|sms:)/i.test(base)) return false; // external
    const norm = base.replace(/^\//, "").replace(/\.html$/, "");
    return norm === stem;
  }

  let changed = false;
  function walk(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === "href" && targetsDeleted(v)) {
          out[k] = "";
          changed = true;
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    return node;
  }

  const next = walk(composition) as SiteComposition;
  return changed ? next : composition;
}

export function collectPageEntries(
  composition: SiteComposition,
): AnchorEntry[] {
  return composition.pages.map((p) => ({
    id: p.path,
    href: p.path,
    label: p.label || p.path,
    kind: "page" as const,
    sectionLabel: "Page",
  }));
}

/**
 * Enumerate every in-page anchor target across ALL pages. Each entry's
 * `href` is resolved relative to `activePagePath` (the page being
 * edited): same-page anchors get a bare `#id`, other-page anchors get a
 * qualified `path#id`.
 *
 * The dedup Set is reset PER PAGE to mirror the renderer (render.ts
 * resets `usedSectionIds` inside its page loop), so the suffixes we
 * suggest match the published HTML on every page independently.
 */
export function collectPageAnchors(
  composition: SiteComposition,
  lookup: TemplateLookup,
  activePagePath?: string,
): AnchorEntry[] {
  const out: AnchorEntry[] = [];
  const shared = composition.shared ?? {};
  const activePath = activePagePath ?? composition.pages[0]?.path ?? "index.html";

  // Walk every page in order. Each page gets its own dedup Set, pre-
  // seeded with the footer's default id — both renderers do the same
  // per page so a page section can't collide with `#paticka`.
  for (const page of composition.pages) {
    const usedSectionIds = new Set<string>();
    if (shared.footer_template_id) {
      const footerDefault =
        lookup.getDefaultSectionId(shared.footer_template_id) ?? "";
      if (footerDefault) usedSectionIds.add(footerDefault);
    }
    for (const section of page.sections) {
      appendSectionAnchors(
        section,
        lookup,
        out,
        usedSectionIds,
        page.path,
        page.label || page.path,
        activePath,
      );
    }
  }

  // Nav + footer are shared slots rendered on every page, so anchors
  // they host (rare — typically just a footer `id="paticka"`) resolve on
  // whatever page the visitor is on. We treat them as same-page (bare
  // `#`) relative to the active page and dedup them in their own Set.
  const sharedUsedIds = new Set<string>();
  if (shared.nav_template_id) {
    appendSectionAnchors(
      {
        id: "__nav",
        template_id: shared.nav_template_id,
        order: -1,
        content_overrides: shared.nav_overrides ?? {},
      },
      lookup,
      out,
      sharedUsedIds,
      activePath,
      "",
      activePath,
    );
  }
  if (shared.footer_template_id) {
    appendSectionAnchors(
      {
        id: "__footer",
        template_id: shared.footer_template_id,
        order: 9999,
        content_overrides: shared.footer_overrides ?? {},
      },
      lookup,
      out,
      sharedUsedIds,
      activePath,
      "",
      activePath,
    );
  }

  return out;
}

function appendSectionAnchors(
  section: CompositionSection,
  lookup: TemplateLookup,
  out: AnchorEntry[],
  usedSectionIds: Set<string>,
  pagePath: string,
  pageLabel: string,
  activePagePath: string,
): void {
  const tpl = lookup.getTemplate(section.template_id);
  if (!tpl) return;

  const overrides = (section.content_overrides ?? {}) as Record<string, FieldValue>;
  const sectionLabel = tpl.name;
  const crossPage = pagePath !== activePagePath;

  // ── Section anchor ──
  // `__section_id` override wins, otherwise the template's default
  // section id, then dedupe against `usedSectionIds`. Empty / missing =
  // no anchor (template that has no id and no override).
  const overrideRaw = (overrides as Record<string, unknown>).__section_id;
  const overrideId =
    typeof overrideRaw === "string" ? slugifyAnchorId(overrideRaw) : "";
  const defaultId = lookup.getDefaultSectionId(section.template_id) ?? "";
  const intendedId = overrideId || defaultId;
  const sectionId = intendedId
    ? dedupeAnchorId(intendedId, usedSectionIds)
    : "";
  if (sectionId) {
    out.push({
      id: sectionId,
      href: buildAnchorHref(sectionId, pagePath, activePagePath),
      label: tpl.name,
      kind: "section",
      sectionLabel,
      pageLabel: crossPage ? pageLabel : undefined,
    });
  }

  // ── Per-item anchors ──
  for (const [fieldKey, fieldSchema] of Object.entries(tpl.placeholder_schema)) {
    if (fieldSchema?.type !== "repeater") continue;
    appendItemAnchors(
      overrides[fieldKey],
      fieldSchema,
      sectionLabel,
      out,
      pagePath,
      pageLabel,
      activePagePath,
    );
  }
}

function appendItemAnchors(
  itemsValue: FieldValue | undefined,
  fieldSchema: AnchorSchemaEntry,
  sectionLabel: string,
  out: AnchorEntry[],
  pagePath: string,
  pageLabel: string,
  activePagePath: string,
): void {
  const idSourceKey = fieldSchema.item_id_source;
  if (!idSourceKey) return;

  const items = Array.isArray(itemsValue)
    ? (itemsValue as Array<Record<string, unknown>>)
    : [];
  if (items.length === 0) return;

  const crossPage = pagePath !== activePagePath;
  const used = new Set<string>();
  items.forEach((item, idx) => {
    // 1) explicit override on the item
    const explicit =
      typeof item.__item_id === "string" ? item.__item_id.trim() : "";

    // 2) derive from source field (string OR {label} link object)
    let derived = "";
    if (!explicit) {
      const raw = item[idSourceKey];
      const sourceText =
        typeof raw === "string"
          ? raw
          : raw &&
              typeof raw === "object" &&
              !Array.isArray(raw) &&
              typeof (raw as { label?: unknown }).label === "string"
            ? ((raw as { label: string }).label)
            : "";
      derived = sourceText;
    }

    const base = explicit
      ? slugifyAnchorId(explicit)
      : slugifyAnchorId(derived) || `polozka-${idx + 1}`;

    // Collision suffix — append -2, -3 until unique within this repeater.
    // MUST match parser.ts:780-790 exactly.
    let final = base;
    let n = 2;
    while (used.has(final)) {
      final = `${base}-${n}`;
      n++;
    }
    used.add(final);

    // Label for the dropdown — prefer the source text the user actually
    // sees in the section so they recognize what they're linking to.
    const rawForLabel = item[idSourceKey];
    const labelText =
      typeof rawForLabel === "string"
        ? rawForLabel
        : rawForLabel &&
            typeof rawForLabel === "object" &&
            !Array.isArray(rawForLabel) &&
            typeof (rawForLabel as { label?: unknown }).label === "string"
          ? ((rawForLabel as { label: string }).label)
          : final;

    out.push({
      id: final,
      href: buildAnchorHref(final, pagePath, activePagePath),
      label: labelText || final,
      kind: "item",
      sectionLabel,
      pageLabel: crossPage ? pageLabel : undefined,
    });
  });
}
