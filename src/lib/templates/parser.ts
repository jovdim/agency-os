import { load } from "cheerio";
import { sanitizeRichText, unwrapTipTapWrap, htmlToPlainText } from "./sanitize";
import { slugifyAnchorId } from "./slugify";

export type FieldType =
  | "text"
  | "longtext"
  | "image"
  /** Self-hosted video. Stored as a string URL pointing at the
   *  composer-video Supabase bucket. Rendered into `<video>` / `<source>`
   *  tags by setting the `src` attribute — there's no background-video
   *  fallback path (background videos are an anti-pattern for both UX
   *  and bandwidth). publish.ts is taught to leave composer-video URLs
   *  alone so the live site streams straight from Supabase. */
  | "video"
  | "link"
  | "richtext"
  /** Variable-length list of items (e.g. nav links, services, gallery
   *  images). The schema for one item lives in `item_schema`; defaults for
   *  the initial set live in `default_items`. Composition stores an array
   *  of per-item value maps. */
  | "repeater"
  /** Google Maps location — stored as a plain string in three accepted
   *  formats, dispatched at render time by the renderer (parser.ts +
   *  render-browser.ts):
   *    - free-text address ("Main St 12, City")
   *    - "lat,lng" coordinates ("48.1486,17.1077")
   *    - full embed URL pasted from Google Maps "Embed a map" share
   *  The composer's MapField surfaces all three via a single tabbed
   *  input. Backwards-compat with sites stored when this was just
   *  `type: "text"` is automatic — the format-detection logic handles
   *  every legacy string. */
  | "map"
  /** On/off flag. Stored as the string "true" or "false" (uses the
   *  existing string-shaped FieldValue — no new value variant). The
   *  composer renders a toggle switch; the template author marks the
   *  carrier element with `data-type="boolean"` (typically on a hidden
   *  `<span>` whose text content is the default — "true" / "false").
   *  Currently powers the contact-form recipient toggle: when paired
   *  with a `form_recipient_email` field on a contact section, the
   *  renderer's Pass 6 writes `data-sk-form-recipient` on the section's
   *  enclosing <form> so contact-handler.js wires it up on the live
   *  site. Boolean carriers themselves never render visible content —
   *  they're configuration, not copy. */
  | "boolean";

export interface FieldSchema {
  type: FieldType;
  /** Visual grouping name. Fields inside the same repeater item that
   *  share a `group` value get rendered together inside one card in
   *  the composer's right panel (instead of each appearing as a flat
   *  row). Authoring: add `data-group="media"` (or any string) on the
   *  template elements. Currently used by gallery-04 to pair its
   *  `image` thumbnail + `video_url` carrier as one "Media" card so
   *  the editor reads as "upload an image OR a video" rather than two
   *  separate uploaders. Optional — fields without a group render
   *  individually as before. */
  group?: string;
  /** Default text content (for text/longtext) or default label text (for link) */
  default?: string;
  /** Default image src (for image) */
  default_src?: string;
  /** Default href (for link) */
  default_href?: string;
  /** 0-based display order. Stamped at parse time so the composer can sort
   *  fields reliably — Postgres JSONB doesn't preserve key insertion order. */
  order?: number;
  // ── Repeater-only ─────────────────────────────────────────────────────
  /** Minimum number of items (composer disables Remove at min). Default 1. */
  min?: number;
  /** Maximum number of items (composer disables Add at max). Default 10. */
  max?: number;
  /** Per-item field schema (same shape as PlaceholderSchema, but the keys
   *  are item-local — e.g. "label", "image", "title" — not section-wide). */
  item_schema?: PlaceholderSchema;
  /** Initial set of items, derived from the children of the [data-repeat]
   *  container at parse time. Composer uses this when no override exists. */
  default_items?: Array<Record<string, FieldValue>>;
  /** Item-local field key whose value drives each item's auto-generated
   *  anchor id (slugified, accented chars stripped). Set by the parser
   *  from the template's `data-item-id-source="<fieldKey>"` attribute
   *  on the element that should carry the id. The renderer reads this
   *  to compute per-item ids so authors can deep-link to a specific
   *  service / FAQ entry / gallery image. Authors can override the
   *  derived id per item via the reserved `__item_id` key in the item's
   *  value object — same pattern as the section-level `__section_id`. */
  item_id_source?: string;
}

/**
 * Stored value for a single placeholder.
 * - text/longtext/image    → string
 * - link                   → { label?, href? } (either may be omitted to keep template default)
 * - repeater               → Array<{ [itemFieldKey]: FieldValue }>
 */
export type FieldValue =
  | string
  | { label?: string; href?: string }
  | Array<Record<string, unknown>>;

export type PlaceholderSchema = Record<string, FieldSchema>;

export interface ParsedTemplate {
  category: string | null;
  html: string;
  css: string;
  placeholderSchema: PlaceholderSchema;
  fieldOrder: string[];
  /** The section template's root-element `id` attribute, when present
   *  (e.g. <section id="hero"> → "hero"). Used as the default anchor
   *  for in-page links (#hero, #services, etc.) when the user hasn't
   *  customized the id via the composer. Null for templates whose
   *  root element has no id (some widgets, footers without anchors). */
  defaultSectionId: string | null;
}

const SECTION_MARKER_RE =
  /<!--\s*SECTION:([a-zA-Z0-9_-]+):start\s*-->([\s\S]*?)<!--\s*SECTION:\1:end\s*-->/i;

const STYLE_BLOCK_RE = /<style[^>]*>([\s\S]*?)<\/style>/gi;

const BG_IMAGE_RE = /background-image:\s*url\(\s*['"]?([^'")]+?)['"]?\s*\)/i;

/** Recognized prefix patterns for an `<a href>` value that we should
 *  NEVER auto-rewrite (already a full URL, anchor, root path, or
 *  protocol-prefixed special scheme). Used to gate phone auto-tel: and
 *  any other "naked-value → URI" rewrites we add later. */
const HREF_RECOGNIZED_PREFIX_RE = /^(tel:|mailto:|https?:|\/|#)/i;

/** Field key naming convention for phone-type link fields. Composer
 *  (placeholder-field.tsx) uses the same heuristic for phone-mode UI;
 *  keeping both call sites in sync means a `data-field="*phone*"` link
 *  field gets the phone editor AND the auto-tel: rewrite below. */
const PHONE_FIELD_KEY_RE = /phone|tel/i;

/** Phone-shape detection for ANY link field's href value. Matches
 *  values composed only of phone-safe characters (digits, spaces,
 *  `+`, `-`, `(`, `)`) with at least 7 actual digits. Lets templates
 *  + sales type bare numbers like `0900000000` into a generic CTA's
 *  href and have the renderer auto-prefix `tel:` — no special field
 *  key required, no manual `tel:` typing. Already-prefixed values
 *  (anchors, URLs, mailto:, tel:) skip this branch via
 *  HREF_RECOGNIZED_PREFIX_RE inside buildPhoneHref. */
const PHONE_SHAPE_RE = /^[\s+\-()\d]+$/;
export function looksLikePhone(raw: string): boolean {
  if (!raw) return false;
  if (HREF_RECOGNIZED_PREFIX_RE.test(raw)) return false;
  if (!PHONE_SHAPE_RE.test(raw)) return false;
  return raw.replace(/\D/g, "").length >= 7;
}

/** Convert a raw phone value (as the user typed it, or as the template
 *  author wrote it: "0900000000", "+421 900 000 000", etc.) into a
 *  dial-safe `tel:` URI. Strips every non-digit char except a single
 *  leading `+` so the URI is canonical across phone OSes. Returns the
 *  input untouched if it already carries a recognized prefix (legacy
 *  `tel:+421…` data, anchor #, mailto:, http(s):, /). */
export function buildPhoneHref(raw: string): string {
  if (!raw) return raw;
  if (HREF_RECOGNIZED_PREFIX_RE.test(raw)) return raw;
  const digits = raw.replace(/[^\d+]/g, "");
  const normalized = digits.startsWith("+")
    ? "+" + digits.slice(1).replace(/\+/g, "")
    : digits.replace(/\+/g, "");
  return normalized ? `tel:${normalized}` : raw;
}

/** Field key naming convention for WhatsApp-type link fields.
 *  Mirrors the phone detection but routes to wa.me URLs. */
const WHATSAPP_FIELD_KEY_RE = /whatsapp/i;

/** Convert a raw phone value into a `https://wa.me/<intl-digits>` URL.
 *  WhatsApp's wa.me click-to-chat format wants the international number
 *  with NO `+` and NO formatting — just digits. We canonicalize:
 *    "0911234567"        → "https://wa.me/421911234567"  (Slovak local
 *                            format: drop leading 0, prepend country code)
 *    "+421 911 234 567"  → "https://wa.me/421911234567"
 *    "421911234567"      → "https://wa.me/421911234567"
 *
 *  Returns the input untouched if it already carries a recognized prefix
 *  (`https://wa.me/...`, `tel:`, anchor `#`, etc.) so templates with the
 *  full URL form keep working. The leading-0 → 421 fallback is
 *  agency-specific (Slovakia); update when Peter expands geographically.
 */
export function buildWhatsappHref(raw: string): string {
  if (!raw) return raw;
  if (HREF_RECOGNIZED_PREFIX_RE.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  const intlDigits = digits.startsWith("0") ? "421" + digits.slice(1) : digits;
  return `https://wa.me/${intlDigits}`;
}

export function parseTemplateHtml(input: string): ParsedTemplate {
  const sectionMatch = input.match(SECTION_MARKER_RE);
  const category = sectionMatch ? sectionMatch[1].toLowerCase() : null;
  const sectionHtml = sectionMatch ? sectionMatch[2].trim() : input;

  const css = extractStyleBlocks(input);

  const $ = load(sectionHtml, { xmlMode: false });

  // ── Pre-pass: collect repeater containers ──
  // [data-repeat="<key>"] marks a container whose CHILDREN repeat N times.
  // We harvest each repeater's item schema (from the first child's inner
  // [data-field]s) and its default items (from ALL children) up front, then
  // mark every inner data-field as "consumed" so the regular flat walker
  // below doesn't try to register them as section-wide fields.
  const tempSchema: PlaceholderSchema = {};
  const domOrder: string[] = [];
  const consumed = new Set<unknown>();

  $("[data-repeat]").each((_i, container) => {
    const $container = $(container);
    // Skip nested [data-repeat] containers — they belong inside another
    // repeater's item schema and are handled by parseFieldsInScope's
    // own nested-repeater pre-pass. Without this guard the top-level
    // walker would falsely register e.g. `dropdown_items` as a
    // section-wide repeater key alongside `nav_links`.
    if ($container.parents("[data-repeat]").length > 0) return;

    const key = $container.attr("data-repeat");
    if (!key || tempSchema[key]) return;

    const children = $container.children().toArray();
    if (children.length === 0) return;

    // Mark every data-field DOM node inside the container as consumed so
    // the flat walker skips them. We walk the WHOLE subtree, not just the
    // first child, because subsequent children also carry data-field nodes
    // we don't want surfacing as top-level keys.
    $container.find("[data-field]").each((_j, descendant) => {
      consumed.add(descendant);
    });

    // Item schema is derived from the STRUCTURAL TEMPLATE — the first
    // child that carries nested [data-repeat] markup, falling back to
    // the first child when none do. This lets a template author place
    // the structurally-richest item (e.g. nav's Sluzby with its
    // dropdown <ul>) anywhere in the list, while the simpler items
    // (Domov, Kontakt, ...) just inherit the cloned shape and override
    // their own fields. Without this, putting Sluzby in position 3
    // would strip the dropdown markup from every rendered item.
    const templateIdx = children.findIndex(
      (c) => $(c).find("[data-repeat]").length > 0,
    );
    const templateChildIdx = templateIdx >= 0 ? templateIdx : 0;
    const $templateChild = $(children[templateChildIdx]);
    const itemSchema = parseFieldsInScope($, $templateChild);

    // Defaults: each child contributes one item. We extract per-field
    // values from each child using the same item_schema we just derived.
    const defaultItems: Array<Record<string, FieldValue>> = children.map((child) =>
      extractItemValues($, $(child), itemSchema),
    );

    const min = parseIntAttr($container.attr("data-min"), 1);
    const max = parseIntAttr($container.attr("data-max"), 10);

    // Look for `data-item-id-source="<fieldKey>"` on the structural-
    // template child OR any of its descendants — whichever element
    // carries it is the one whose `id` attribute the renderer will
    // write at item-render time. We check the template child itself
    // first via `.attr()` before falling back to `.find()` for
    // descendants. The value (a field key) tells the renderer + composer
    // which item field drives each cloned item's auto-generated anchor
    // id (e.g. <article data-item-id-source="title"> → every rendered
    // service gets its id from the title field).
    const idSourceAttr =
      $templateChild.attr("data-item-id-source")?.trim() ||
      $templateChild
        .find("[data-item-id-source]")
        .first()
        .attr("data-item-id-source")
        ?.trim();
    const itemIdSource =
      idSourceAttr && itemSchema[idSourceAttr] ? idSourceAttr : undefined;

    tempSchema[key] = {
      type: "repeater",
      min,
      max,
      item_schema: itemSchema,
      default_items: defaultItems,
      ...(itemIdSource ? { item_id_source: itemIdSource } : {}),
    };
    domOrder.push(key);
  });

  // ── Map pre-pass ──
  // Some templates (map-02 / map-03) attach `data-field` to BOTH the
  // <iframe data-type="map"> AND a sibling text element (<p>, <span>)
  // that shows the same address as plain text in an info card. The
  // composer should treat the iframe's `data-type="map"` as the source
  // of truth so the right-panel renders the dedicated MapField (with
  // Address / Coordinates tabs), not a generic rich-text editor.
  //
  // Without this pre-pass the flat walker below registers whichever
  // element it hits first in document order — and in map-02 the <p>
  // comes BEFORE the iframe, so the field falls through to type "text"
  // and the composer never shows the map picker UI.
  //
  // Running before the flat walker means every map-typed iframe wins
  // the schema slot. The walker's `tempSchema[key]` short-circuit then
  // correctly skips the sibling <p> on the second pass (the renderer
  // still updates both elements at applyContentOverrides time —
  // map-typed fields drive both the iframe src AND any same-keyed
  // text element).
  $("iframe[data-type='map'][data-field]").each((_i, el) => {
    if (consumed.has(el)) return;
    const $el = $(el);
    const key = $el.attr("data-field");
    if (!key || tempSchema[key]) return;
    const src = $el.attr("src") || "";
    let defaultValue = "";
    try {
      const u = new URL(src, "https://maps.google.com");
      const q = u.searchParams.get("q");
      if (q) defaultValue = q;
      else if (src) defaultValue = src;
    } catch {
      defaultValue = "";
    }
    tempSchema[key] = { type: "map", default: defaultValue };
    domOrder.push(key);
  });

  // ── Flat walker ──
  $("[data-field]").each((_i, el) => {
    if (consumed.has(el)) return; // Inside a repeater — handled above.
    const $el = $(el);
    const key = $el.attr("data-field");
    if (!key || tempSchema[key]) return;

    const tag = (el.type === "tag" ? el.tagName : "").toLowerCase();
    const explicitType = ($el.attr("data-type") || "").toLowerCase();
    domOrder.push(key);

    // Explicit link type — works on <a> elements. Captures BOTH label + href.
    if (explicitType === "link" && tag === "a") {
      tempSchema[key] = {
        type: "link",
        default: $el.text().trim(),
        default_href: $el.attr("href") || "",
      };
      return;
    }

    // Rich-text: HTML content with bold/italic/paragraphs. Default is the
    // element's inner HTML so authors can pre-write placeholder paragraphs.
    if (explicitType === "richtext") {
      tempSchema[key] = {
        type: "richtext",
        default: ($el.html() || "").trim(),
      };
      return;
    }

    // Boolean toggle — composer renders a switch, stored as the string
    // "true" / "false" via the existing string-shaped FieldValue. The
    // carrier element is expected to be hidden (`hidden` attribute /
    // display:none) since booleans are configuration, not visible copy.
    // Default read from the carrier's text content: any case-insensitive
    // "true" wins; everything else (empty, "false", unrelated text) is
    // "false". Currently used by the contact-form recipient toggle —
    // see applyContentOverrides Pass 6 for the form binding.
    if (explicitType === "boolean") {
      const defaultBool =
        $el.text().trim().toLowerCase() === "true" ? "true" : "false";
      tempSchema[key] = { type: "boolean", default: defaultBool };
      return;
    }

    // Explicit video type — works on any element. The value is a URL
    // stored as a string; the composer renders an upload picker that
    // pushes the file to the composer-video Supabase bucket. Templates
    // typically attach data-field to a `<video>` (or its nested
    // `<source>`) for inline players, OR to a hidden carrier (e.g. a
    // `<span style="display:none">` in mixed image+video galleries) when
    // the value is consumed by a runtime script. Both shapes work the
    // same way: the field stores the URL, the composer uploads to it.
    if (explicitType === "video") {
      tempSchema[key] = {
        type: "video",
        default_src: ($el.attr("src") || $el.text().trim() || "") || undefined,
      };
      return;
    }

    // Explicit map type — works on <iframe>. Stored as a plain string so
    // backwards-compat with sites authored before the dedicated `map`
    // field UI is automatic (their value is just a text string and the
    // new UI auto-detects address vs coordinates vs embed URL from format).
    //
    // Default extraction prefers the q= parameter (simple address embed,
    // what map-01 / map-02 use). If the template was authored with a
    // custom Google Maps embed URL (no q=, just a long pb= blob), fall
    // back to the full src so editing starts from a working state and
    // the renderer can pass it through verbatim.
    if (explicitType === "map" && tag === "iframe") {
      const src = $el.attr("src") || "";
      let defaultValue = "";
      try {
        const u = new URL(src, "https://maps.google.com");
        const q = u.searchParams.get("q");
        if (q) {
          defaultValue = q;
        } else if (src) {
          // Custom embed URL — keep the whole thing so MapField's Embed
          // tab opens with it pre-populated and the renderer's URL
          // passthrough renders it identically.
          defaultValue = src;
        }
      } catch {
        defaultValue = "";
      }
      tempSchema[key] = {
        type: "map",
        default: defaultValue,
      };
      return;
    }

    if (tag === "img" || tag === "iframe") {
      tempSchema[key] = {
        type: "image",
        default_src: $el.attr("src") || undefined,
      };
      return;
    }

    const style = $el.attr("style") || "";
    const bgMatch = style.match(BG_IMAGE_RE);
    if (bgMatch) {
      tempSchema[key] = {
        type: "image",
        default_src: bgMatch[1],
      };
      return;
    }

    const text = $el.text().trim();
    const innerHtml = ($el.html() || "").trim();
    const isLong = text.length > 100 || /<br\s*\/?>/.test(innerHtml);

    tempSchema[key] = {
      type: isLong ? "longtext" : "text",
      // text + longtext store HTML since 2026-05-16 (composer routes
      // both through the rich editor). Use the element's innerHTML as
      // the default so any inline formatting on the template's shipped
      // content (e.g. a <strong> inside an eyebrow) becomes part of
      // the default. Pure-text defaults round-trip unchanged.
      default: innerHtml,
    };
  });

  // Determine final order. If any element in the section has `data-field-order`
  // (a comma-separated list of keys), use that. Missing keys get appended at
  // the end so we never lose a field if the author forgets to list one.
  const orderAttr = $("[data-field-order]").first().attr("data-field-order");
  let fieldOrder = domOrder;
  if (orderAttr) {
    const requested = orderAttr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const k of requested) {
      if (tempSchema[k] && !seen.has(k)) {
        ordered.push(k);
        seen.add(k);
      }
    }
    for (const k of domOrder) {
      if (!seen.has(k)) ordered.push(k);
    }
    fieldOrder = ordered;
  }

  // Build placeholderSchema in the final order AND stamp an explicit `order`
  // number on each entry. Postgres JSONB will reorder keys when stored, so the
  // composer must sort by `order` rather than relying on Object.keys() order.
  const placeholderSchema: PlaceholderSchema = {};
  for (let i = 0; i < fieldOrder.length; i++) {
    const k = fieldOrder[i];
    placeholderSchema[k] = { ...tempSchema[k], order: i };
  }

  // ── Extract default section id ──
  // The section template's root element's `id` (e.g. <section id="hero">)
  // is the anchor users reference from in-page links (#hero). Pull it
  // here so the composer can:
  //   1. Display it next to the section in the rail / card header so
  //      authors know which anchor maps to which section.
  //   2. Fall back to it when the user hasn't customized the id via
  //      the new `__section_id` override key.
  // cheerio loads the section HTML inside an auto-wrapped <html><body>,
  // so the first ELEMENT child of <body> is the section root regardless
  // of whether the template opens with <section>, <nav>, <footer>, etc.
  const rootEl = $("body").children().first();
  const defaultSectionId = rootEl.attr("id")?.trim() || null;

  return {
    category,
    html: sectionHtml,
    css,
    placeholderSchema,
    fieldOrder,
    defaultSectionId,
  };
}

// ── Repeater helpers ────────────────────────────────────────────────────────

type Cheerio$ = ReturnType<typeof load>;
type CheerioEl = ReturnType<Cheerio$>;

/**
 * Parse the [data-field] elements WITHIN a given scope (e.g. one repeater
 * item's template element). Mirrors the type-detection logic in the main
 * walker, but produces an item-local schema instead of a section-wide one.
 */
function parseFieldsInScope(
  $: Cheerio$,
  $scope: CheerioEl,
): PlaceholderSchema {
  const schema: PlaceholderSchema = {};
  const order: string[] = [];

  // Track per-key visual grouping (data-group) so the repeater editor
  // can render same-group fields inside one card. Filled in the same
  // walker pass and copied into each schema entry at the end.
  const groupByKey: Record<string, string> = {};

  // ── Nested-repeater pre-pass ──
  // A repeater item can carry its own nested `[data-repeat]` (e.g. nav menu
  // item with an optional dropdown list). For each such nested container
  // INSIDE $scope, register a `repeater`-type field, mark its inner
  // data-fields as consumed so the flat walker below won't double-register
  // them, and recurse to derive the nested item_schema. Limited to one
  // level of nesting per call — deeper nesting works via the recursion
  // chain (each call only processes its direct nested repeaters and
  // delegates further depth to the recursive parseFieldsInScope).
  const consumed = new Set<unknown>();
  $scope.find("[data-repeat]").each((_i, container) => {
    const $container = $(container);
    // Defensive: only process [data-repeat] that sit at the TOP of
    // $scope (no other [data-repeat] BETWEEN this container and
    // $scope, exclusive). Deeper levels are picked up by the
    // recursive call we make on this container's first child.
    //
    // `parentsUntil($scope, "[data-repeat]")` gives us ancestors
    // strictly UNDER $scope that match the selector — without this
    // bounded walk, `parents("[data-repeat]")` reaches all the way up
    // to the section's outer repeater (e.g. `<ul data-repeat="nav_
    // links">` sitting above $scope) and we'd skip every legitimate
    // nested repeater. parseFieldsInScope is always called with
    // $scope = a single repeater item template, so any [data-repeat]
    // ancestor above $scope is structural noise, not relevant
    // nesting.
    // parentsUntil takes either a selector or an Element; the latter
    // satisfies cheerio's narrower Element-only typing better than
    // passing the Cheerio<AnyNode> wrapper. We're guaranteed $scope is
    // an element (parseFieldsInScope is only ever called with one).
    const scopeEl = $scope.get(0);
    if (!scopeEl) return;
    if ($container.parentsUntil(scopeEl as Parameters<typeof $container.parentsUntil>[0], "[data-repeat]").length > 0) return;

    const key = $container.attr("data-repeat");
    if (!key || schema[key]) return;
    order.push(key);

    // Consume every descendant data-field so the flat walker skips them.
    $container.find("[data-field]").each((_j, d) => {
      consumed.add(d);
    });

    const children = $container.children().toArray();
    const min = parseIntAttr($container.attr("data-min"), 0);
    const max = parseIntAttr($container.attr("data-max"), 10);

    if (children.length === 0) {
      // Empty nested container — schema is known (just the parent's
      // wishlist) but there are no children to template from. Authors
      // who want this should still provide at least one default child;
      // we emit an empty schema + empty default_items so nothing breaks.
      schema[key] = {
        type: "repeater",
        min,
        max,
        item_schema: {},
        default_items: [],
      };
      return;
    }

    // Recursive: derive the nested item_schema from the STRUCTURAL
    // template child — the first child carrying its own nested
    // [data-repeat] markup, falling back to the first child when none
    // do. Mirrors the top-level walker's selection criterion so a
    // 3-level-deep template with the richest sub-item not first still
    // registers all fields in the schema.
    const innerTmplIdx = children.findIndex(
      (c) => $(c).find("[data-repeat]").length > 0,
    );
    const innerTmplChild = children[innerTmplIdx >= 0 ? innerTmplIdx : 0];
    const innerItemSchema = parseFieldsInScope($, $(innerTmplChild));
    const innerDefaultItems: Array<Record<string, FieldValue>> = children.map(
      (c) => extractItemValues($, $(c), innerItemSchema),
    );

    schema[key] = {
      type: "repeater",
      min,
      max,
      item_schema: innerItemSchema,
      default_items: innerDefaultItems,
    };
  });

  // Build the walk list: descendants with [data-field] PLUS the scope
  // element itself if it carries one. `.find()` returns descendants only,
  // so without the scope-include here a `data-field` placed on the
  // repeater item's ROOT element gets silently dropped — the schema
  // (and thus the composer panel) never sees it.
  // Real example: how-it-works-01's `<article class="hiw-01__card"
  // data-field="step_image" style="background-image:url(...)">` is BOTH
  // the repeater item and the card's bg-image field. The bg-image was
  // never editable in the composer because `find()` skipped the article.
  // Pre-pending the scope (when applicable) keeps the rest of the walker
  // unchanged and respects field-order (scope element first, then
  // descendants in DOM order — same order the user sees in the panel).
  const scopeEl = $scope.get(0);
  const scopeHasField =
    !!scopeEl && !!($scope.attr("data-field"));
  const walkList = scopeHasField
    ? [scopeEl as never, ...$scope.find("[data-field]").toArray()]
    : $scope.find("[data-field]").toArray();
  walkList.forEach((el) => {
    if (consumed.has(el)) return;
    const $el = $(el);
    const key = $el.attr("data-field");
    if (!key || schema[key]) return;

    const tag = (el.type === "tag" ? el.tagName : "").toLowerCase();
    const explicitType = ($el.attr("data-type") || "").toLowerCase();
    const explicitGroup = ($el.attr("data-group") || "").trim();
    if (explicitGroup) groupByKey[key] = explicitGroup;
    order.push(key);

    if (explicitType === "link" && tag === "a") {
      schema[key] = {
        type: "link",
        default: $el.text().trim(),
        default_href: $el.attr("href") || "",
      };
      return;
    }
    if (explicitType === "richtext") {
      schema[key] = { type: "richtext", default: ($el.html() || "").trim() };
      return;
    }
    if (explicitType === "boolean") {
      // Mirror of the top-level walker — boolean carrier inside a
      // repeater item works the same way. Not currently used by any
      // template but supported for symmetry: future "per-row enabled"
      // toggles inside a repeater would land here.
      const defaultBool =
        $el.text().trim().toLowerCase() === "true" ? "true" : "false";
      schema[key] = { type: "boolean", default: defaultBool };
      return;
    }
    if (explicitType === "video") {
      // See top-level walker for full notes — repeater-item videos
      // work the same way. Reading `src` first, then text content,
      // covers both `<video>` carriers and `<span>` data carriers.
      schema[key] = {
        type: "video",
        default_src: ($el.attr("src") || $el.text().trim() || "") || undefined,
      };
      return;
    }
    if (explicitType === "map" && tag === "iframe") {
      const src = $el.attr("src") || "";
      let defaultAddress = "";
      try {
        defaultAddress =
          new URL(src, "https://maps.google.com").searchParams.get("q") || "";
      } catch {
        defaultAddress = "";
      }
      schema[key] = { type: "text", default: defaultAddress };
      return;
    }
    if (tag === "img" || tag === "iframe") {
      schema[key] = {
        type: "image",
        default_src: $el.attr("src") || undefined,
      };
      return;
    }
    const style = $el.attr("style") || "";
    const bgMatch = style.match(BG_IMAGE_RE);
    if (bgMatch) {
      schema[key] = { type: "image", default_src: bgMatch[1] };
      return;
    }
    const text = $el.text().trim();
    const innerHtml = ($el.html() ?? "").trim();
    const isLong = text.length > 100 || /<br\s*\/?>/.test(innerHtml);
    // text + longtext now store HTML since 2026-05-16 (the composer
    // routes both through the rich editor). Use innerHtml as the schema
    // default so any inline formatting in the template's HTML stays
    // intact when the composer falls back to defaults. For plain-text
    // template content `innerHtml === text`, so existing templates
    // round-trip with no visible difference.
    schema[key] = {
      type: isLong ? "longtext" : "text",
      default: innerHtml,
    };
  });

  // Resort `order` by DOM position. The nested-repeater pre-pass above
  // pushes its keys first, then the flat walker pushes flat-field keys —
  // and now (since 2026-05-14) the scope-element field is pre-pended,
  // so order can drift from DOM. The doc-position resort below normalizes
  // everything regardless of insertion sequence.
  // so the raw order is "all nested repeaters before all flat fields",
  // which is wrong when the template author placed a flat field BEFORE
  // a nested repeater in the DOM (e.g. nav menu item with `<a
  // data-field="label">` before `<ul data-repeat="dropdown_items">`).
  // The composer reads `order` to render fields in the side panel; out-
  // of-DOM-order fields make the editor read backwards.
  {
    const docIndex = new Map<string, number>();
    let i = 0;
    // Include the scope element itself (matches the walk-list above)
    // so a data-field on the scope sorts FIRST instead of last. Without
    // this, how-it-works-01's `step_image` field would land at the
    // bottom of the per-item field panel instead of the top.
    const sortList = scopeHasField
      ? [scopeEl as never, ...$scope.find("[data-field], [data-repeat]").toArray()]
      : $scope.find("[data-field], [data-repeat]").toArray();
    sortList.forEach((el) => {
      const $el = $(el);
      const k = $el.attr("data-repeat") || $el.attr("data-field");
      if (!k || docIndex.has(k)) return;
      docIndex.set(k, i++);
    });
    order.sort(
      (a, b) =>
        (docIndex.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (docIndex.get(b) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  // Stamp explicit order + (optional) group on each entry — JSONB
  // doesn't preserve key order, and the group needs to ride alongside
  // the schema since the composer reads schemas straight from the DB.
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    schema[k] = {
      ...schema[k],
      order: i,
      ...(groupByKey[k] ? { group: groupByKey[k] } : {}),
    };
  }
  return schema;
}

/**
 * Walk a single repeater child and pull out current values for each field
 * defined in the item schema. Returns one item's worth of FieldValues —
 * i.e. one entry of `default_items`.
 */
function extractItemValues(
  $: Cheerio$,
  $child: CheerioEl,
  itemSchema: PlaceholderSchema,
): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const [key, schema] of Object.entries(itemSchema)) {
    // Nested repeater: look up by [data-repeat] (not [data-field]) and
    // recursively extract its children's per-item values. Children
    // without the nested container at all (the common case — e.g. only
    // the "Sluzby" outer item carries a dropdown) get an explicit empty
    // array, not undefined. This way the OUTER default_items always
    // carries an explicit value for the nested key, so the renderer's
    // "fall back to default_items when override missing" branch never
    // accidentally pulls Sluzby's dropdown into a non-dropdown menu item.
    if (schema.type === "repeater") {
      const innerSchema = schema.item_schema ?? {};
      const $nested = $child
        .find(`[data-repeat="${escapeAttrValue(key)}"]`)
        .first();
      if ($nested.length === 0) {
        values[key] = [];
      } else {
        const nestedChildren = $nested.children().toArray();
        values[key] = nestedChildren.map((c) =>
          extractItemValues($, $(c), innerSchema),
        );
      }
      continue;
    }

    // Look up the field on a descendant OR on the child itself. `.find()`
    // alone only walks descendants — so a data-field placed on the item's
    // ROOT element (e.g. how-it-works-01's `<article data-field="step_image"
    // style="background-image:..."`) would be silently skipped, leaving
    // step_image undefined for every default item and the cards would all
    // inherit the first item's photo at render time.
    // $el is narrowed to `Cheerio<Element>` by `.find().first()`,
    // whereas $child is the wider `Cheerio<AnyNode>` from the caller.
    // Cast on assignment because all the methods we call on $el below
    // (attr / text / html / find) work identically on both narrowings.
    // Strict TS in `next build` would otherwise reject this widening.
    let $el = $child.find(`[data-field="${escapeAttrValue(key)}"]`).first();
    if ($el.length === 0 && $child.attr("data-field") === key) {
      $el = $child as typeof $el;
    }
    if ($el.length === 0) continue;
    const el = $el[0] as { type: string; tagName?: string };
    const tag = (el.type === "tag" ? el.tagName ?? "" : "").toLowerCase();

    switch (schema.type) {
      case "link":
        values[key] = { label: $el.text().trim(), href: $el.attr("href") ?? "" };
        break;
      case "image":
        if (tag === "img" || tag === "iframe") {
          values[key] = $el.attr("src") ?? "";
        } else {
          const m = ($el.attr("style") ?? "").match(BG_IMAGE_RE);
          values[key] = m ? m[1] : "";
        }
        break;
      case "video":
        // <video>/<source>: read src. Otherwise (data-carrier <span>):
        // read text. Mirrors the rendering branch above.
        if (tag === "video" || tag === "source") {
          values[key] = $el.attr("src") ?? "";
        } else {
          values[key] = $el.text().trim();
        }
        break;
      case "richtext":
        values[key] = ($el.html() ?? "").trim();
        break;
      case "boolean":
        // Repeater-item booleans aren't used by any template today, but
        // we keep symmetry with the top-level schema. Normalize to the
        // canonical "true"/"false" string so renderer + composer never
        // see free-form values.
        values[key] =
          $el.text().trim().toLowerCase() === "true" ? "true" : "false";
        break;
      case "text":
      case "longtext":
        // text + longtext store HTML since 2026-05-16 (the composer
        // routes both through the rich editor). Extract via .html() so
        // any inline formatting on the template's default content is
        // preserved as the field's default value. Plain-text templates
        // (no inline tags) round-trip unchanged because .html() on a
        // text-only node returns the same string .text() did.
        values[key] = ($el.html() ?? "").trim();
        break;
    }
  }
  return values;
}

function parseIntAttr(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function extractStyleBlocks(input: string): string {
  const matches = input.match(STYLE_BLOCK_RE);
  if (!matches) return "";
  return matches
    .map((block) => block.replace(/<\/?style[^>]*>/gi, "").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Sensible bounds for the per-field font-size override. The composer
 *  clamps user input to this range, and the renderer ignores out-of-range
 *  values defensively (covers legacy data with old XS/S/M/L/XL strings). */
const FIELD_SIZE_MIN_PX = 8;
const FIELD_SIZE_MAX_PX = 200;
/** Bounds for the per-field max-width override. 240px ≈ narrow column,
 *  1400px ≈ full-width hero block on a desktop layout. Out-of-range or
 *  non-numeric values fall through to "no override." */
const FIELD_WIDTH_MIN_PX = 240;
const FIELD_WIDTH_MAX_PX = 1400;

interface FieldStyleInput {
  /** Pixel value — clamped to [8, 200] before rendering. Anything else
   *  (NaN, strings, out-of-range) is treated as "no override." */
  size?: number;
  /** max-width override in CSS pixels — clamped to [240, 1400]. Controls
   *  prose line length for text/longtext/richtext fields. Out-of-range
   *  or non-numeric → treated as "no override." Ignored when fill === true. */
  width?: number;
  /** When true, the matching [data-field] gets `data-fill="true"` so the
   *  template-base.css breakout rule applies. Mutually exclusive with
   *  width at render time (fill wins). */
  fill?: boolean;
}

export function applyContentOverrides(
  html: string,
  overrides: Record<string, FieldValue>,
  schema: PlaceholderSchema,
  /**
   * Per-field style overrides (font size today, more later). Optional —
   * when missing, behaves identically to the pre-styles version. Each
   * entry's `size` (XS/S/L/XL) is translated to an inline `font-size:
   * <em>` on the matching [data-field] element. Size "M" is treated as
   * "no override" and produces no inline style. */
  fieldStyles?: Record<string, FieldStyleInput>,
  /** Composite field keys the author wants HIDDEN from the rendered
   *  HTML. Two shapes:
   *    · "hero_cta"                      — top-level link/button
   *    · "services_items[2].service_cta" — repeater item sub-field
   *  Stripped as the very last pass so the targeted elements exist
   *  in the DOM (after Pass 1 expansion) and can be addressed by
   *  index. Pure removal — published HTML has zero trace of hidden
   *  buttons. Mirrors render-browser.ts:applyOverridesInBrowser. */
  hiddenFields?: string[],
): string {
  const $ = load(html, { xmlMode: false });

  // ── Pass 1: repeater fields ──
  // Process repeaters first so we clone the template-item BEFORE the flat
  // walker tries to match its inner [data-field]s as section-wide keys.
  // We resolve the items array from overrides if present, else fall back
  // to default_items from the schema (so a brand-new site renders with
  // the template's initial set, not just one bare item).
  for (const [key, fieldRaw] of Object.entries(schema)) {
    if (fieldRaw.type !== "repeater") continue;
    const $container = $(`[data-repeat="${escapeAttrValue(key)}"]`).first();
    if ($container.length === 0) continue;
    const children = $container.children().toArray();
    if (children.length === 0) continue;

    // Item shape needed to apply per-item overrides cleanly.
    const itemSchema = fieldRaw.item_schema ?? {};

    // What items to render: explicit override first, else defaults.
    const overrideValue = overrides[key];
    const items: Array<Record<string, FieldValue>> = Array.isArray(overrideValue)
      ? (overrideValue as Array<Record<string, FieldValue>>)
      : (fieldRaw.default_items ?? []);

    // Pick the STRUCTURAL TEMPLATE — the first child that carries
    // nested [data-repeat] markup, falling back to the first child
    // when none do. Mirrors parseTemplateHtml's top-level walker
    // (same `findIndex` criterion), so the cloned shape is always
    // the richest one — e.g. a nav with Sluzby in the middle of the
    // link list still clones Sluzby's <li> (dropdown markup included)
    // for every item, then overrides each item's own field values.
    const tmplIdx = children.findIndex(
      (c) => $(c).find("[data-repeat]").length > 0,
    );
    const $template = $(children[tmplIdx >= 0 ? tmplIdx : 0]).clone();

    // ── Per-item anchor ids ──
    // If the template declared `data-item-id-source="<fieldKey>"` on an
    // element inside the item template, every cloned item gets its OWN
    // id derived from that field's value (slugified), with collision
    // suffixes (-2, -3) when titles repeat. Author can override per
    // item via `__item_id`. Falls back to `item-N` when source is empty.
    const idSourceKey = fieldRaw.item_id_source;
    const usedItemIds = new Set<string>();

    const rendered: string[] = items.map((itemOverride, itemIdx) => {
      const $clone = $template.clone();
      // Apply per-item overrides on a fresh subtree using the item schema.
      // This reuses applyContentOverrides on the clone's HTML so we get
      // identical semantics (image swapping, link label/href, etc.).
      const innerHtml = $.html($clone);
      // Wrap in a marker so applyContentOverrides has a root to walk.
      const wrapped = `<div data-sk-repeater-wrap>${innerHtml}</div>`;
      const applied = applyContentOverrides(wrapped, itemOverride, itemSchema);
      // Extract the wrap's inner HTML via cheerio. The previous regex
      // approach (replace /^<div data-sk-repeater-wrap>/) never actually
      // fired — applyContentOverrides returns a FULL document string
      // starting with `<html><head></head><body>…` so the leading-anchor
      // regex never matched, and the wrap div leaked into every rendered
      // item. CSS in dependent templates worked around it via dual
      // selectors (see `feedback_nth_of_type_repeater_wrap`); the
      // cleaner fix is to actually strip the wrap here so direct-child
      // selectors like `.nav-links > li:has(> .dropdown > li)` work
      // without the wrap-aware companion.
      const $strip = load(applied, { xmlMode: false });

      // Apply per-item id BEFORE extracting innerHTML so the attribute
      // change rides along. Only when the template opted in via
      // `data-item-id-source`; otherwise the original id (if any) is
      // preserved untouched.
      if (idSourceKey) {
        const $idEl = $strip("[data-item-id-source]").first();
        if ($idEl.length > 0) {
          const explicit =
            typeof itemOverride.__item_id === "string"
              ? itemOverride.__item_id.trim()
              : "";
          let id: string;
          if (explicit) {
            id = slugifyAnchorId(explicit);
          } else {
            const raw = itemOverride[idSourceKey];
            const sourceText =
              typeof raw === "string"
                ? raw
                : raw &&
                    typeof raw === "object" &&
                    !Array.isArray(raw) &&
                    typeof (raw as { label?: unknown }).label === "string"
                  ? ((raw as { label: string }).label)
                  : "";
            id = slugifyAnchorId(sourceText);
          }
          // `polozka` (Slovak: "item") matches the rest of the Slovak-
          // anchor convention used across the system. Old sites that
          // saved English `item-N` anchors still work — the renderer
          // never tries to "resolve" the slug, it just emits whatever
          // is stored or derived. New empty-title fallbacks emit
          // Slovak.
          if (!id) id = `polozka-${itemIdx + 1}`;
          // Collision suffix — append -2, -3 until unique within this
          // repeater. Authors get a sensible auto-id even when two
          // items share a title.
          let final = id;
          let n = 2;
          while (usedItemIds.has(final)) {
            final = `${id}-${n}`;
            n++;
          }
          usedItemIds.add(final);
          $idEl.attr("id", final);
        }
      }

      return $strip("[data-sk-repeater-wrap]").html() ?? "";
    });

    $container.empty().html(rendered.join(""));
  }

  // ── Pass 1b: mirror first repeater image into a featured element ──
  // An element with `data-sk-mirror-repeater="<key>"` copies the `src` of
  // the FIRST rendered item's image (field given by `data-sk-mirror-field`,
  // default "image") in that repeater. Lets a "featured photo + thumbnail
  // rail" layout (gallery-05) show the first gallery image in the big stage
  // with ZERO client JS — so it renders identically in the composer (which
  // never runs section scripts) and on the published site, where a
  // click-to-swap script then takes over. Runs after Pass 1 so the
  // repeater's items already exist in the DOM.
  $("[data-sk-mirror-repeater]").each((_i, rawEl) => {
    const $mirror = $(rawEl);
    const repeaterKey = $mirror.attr("data-sk-mirror-repeater");
    if (!repeaterKey) return;
    const fieldKey = $mirror.attr("data-sk-mirror-field") || "image";
    const $container = $(
      `[data-repeat="${escapeAttrValue(repeaterKey)}"]`,
    ).first();
    if ($container.length === 0) return;
    const src = $container
      .find(`[data-field="${escapeAttrValue(fieldKey)}"]`)
      .first()
      .attr("src");
    if (src) $mirror.attr("src", src);
    $mirror.removeAttr("data-sk-mirror-repeater");
    $mirror.removeAttr("data-sk-mirror-field");
  });

  // ── Pass 2: flat fields (existing behavior) ──
  // Iterates EVERY matching [data-field] (not just .first()) so the same
  // field can drive multiple elements at once. Original use case (and the
  // reason this changed from .first() to .each() on 2026-05-12): map-02 /
  // map-03 want one "address" field that simultaneously updates the
  // visible address text in the info card AND the iframe map embed. Each
  // matching element dispatches by its own tag — a <span> gets text, an
  // <iframe data-type="map"> gets a built embed URL.
  for (const [key, value] of Object.entries(overrides)) {
    const field = schema[key];
    if (!field) continue;
    if (field.type === "repeater") continue; // already handled

    // Filter out [data-field] elements that live INSIDE a [data-repeat]
    // container. Those belong to the repeater's items and have already
    // been (or will be) written by the recursive applyContentOverrides
    // call in Pass 1 with the proper per-item overrides. Without this
    // filter, a section-level field key that happens to collide with a
    // repeater-item field key (e.g. both top-level and item-local
    // `label`) would clobber the rendered items with the section value.
    const $els = $(`[data-field="${escapeAttrValue(key)}"]`).filter(
      (_i, rawEl) => $(rawEl).parents("[data-repeat]").length === 0,
    );
    if ($els.length === 0) continue;

    $els.each((_i, rawEl) => {
      const $el = $(rawEl);
      const el = rawEl;
      const tag = el.type === "tag" ? el.tagName.toLowerCase() : "";

    switch (field.type) {
      case "image": {
        const v = typeof value === "string" ? value : "";
        if (!v) break;
        if (tag === "img" || tag === "iframe") {
          $el.attr("src", v);
          if (tag === "img") {
            $el.removeAttr("srcset");
            // Alt text: explicit override wins, sibling `title` is the
            // fallback (item-local for repeater images — the recursive
            // applyContentOverrides call here passes itemOverride as
            // `overrides`, so `overrides.title` = the item's title).
            // Top-level images usually have no `title` sibling so the
            // fallback no-ops and the template-default alt stays.
            //
            // Stored under the derived key `<key>_alt` to avoid a
            // schema-wide FieldValue type change and to keep every
            // image field on every template alt-editable without
            // requiring authors to declare alt sub-fields per image.
            const altKey = `${key}_alt`;
            const explicitAltRaw = overrides[altKey];
            const explicitAlt =
              typeof explicitAltRaw === "string"
                ? explicitAltRaw.trim()
                : "";
            let alt = explicitAlt;
            if (!alt) {
              const titleRaw = overrides.title;
              if (typeof titleRaw === "string") alt = titleRaw.trim();
            }
            if (alt) $el.attr("alt", alt);
          }
        } else {
          const style = $el.attr("style") || "";
          const updated = BG_IMAGE_RE.test(style)
            ? style.replace(BG_IMAGE_RE, `background-image: url('${v}')`)
            : `${style ? style.replace(/;?\s*$/, "; ") : ""}background-image: url('${v}')`;
          $el.attr("style", updated);
        }
        break;
      }
      case "video": {
        // Two valid placements for a video data-field:
        //   - <video> / <source>: set src so the inline player works.
        //   - any other element: write the URL into the text content.
        //     This covers the data-carrier pattern (e.g. gallery-04's
        //     <span class="...video-url"> which a runtime script reads
        //     to decide whether to overlay a play button + open a
        //     lightbox). Hidden carriers stay hidden via CSS — we just
        //     keep the value reachable for the script.
        const v = typeof value === "string" ? value : "";
        if (!v) break;
        if (tag === "video" || tag === "source") {
          $el.attr("src", v);
        } else {
          $el.text(v);
        }
        break;
      }
      case "link": {
        // Structured: { label?, href? }. Arrays satisfy `typeof "object"`
        // so we must explicitly exclude them or TS keeps the wider
        // Record<string, unknown>[] arm and the property reads fail.
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          const linkObj = value as { label?: string; href?: string };
          // Skip the label-as-textContent write when the link element
          // has an SVG child — those are icon-only buttons (phone-call
          // widget, whatsapp widget, nav-social pills) where the SVG
          // IS the visible content. Writing textContent would destroy
          // the SVG and replace it with the label string (which for
          // phone-keyed fields is the dial digits → user sees the
          // number text instead of the phone icon).
          const isIconOnly = $el.children("svg").length > 0;
          if (typeof linkObj.label === "string" && !isIconOnly) {
            $el.text(linkObj.label);
          }
          if (typeof linkObj.href === "string") {
            // Output-time href rewrite. Three branches, checked in
            // order so WhatsApp wins over the phone-shape catch-all:
            //   1. Field key matches WhatsApp (`widget_whatsapp_url`,
            //      etc.) → build `https://wa.me/<intl-digits>` from
            //      the bare number.
            //   2. Field key matches phone/tel OR href value is
            //      phone-shaped → build `tel:+<digits>`.
            //   3. Everything else → pass through unchanged.
            // `buildWhatsappHref` / `buildPhoneHref` both leave
            // already-prefixed values alone (anchors, full URLs,
            // existing tel:/wa.me/mailto:), so templates with the
            // explicit-URL form keep working.
            const isWhatsapp = WHATSAPP_FIELD_KEY_RE.test(key);
            const isPhone =
              !isWhatsapp &&
              (PHONE_FIELD_KEY_RE.test(key) || looksLikePhone(linkObj.href));
            const finalHref = isWhatsapp
              ? buildWhatsappHref(linkObj.href)
              : isPhone
                ? buildPhoneHref(linkObj.href)
                : linkObj.href;
            $el.attr("href", finalHref);
          }
        } else if (typeof value === "string") {
          // Backwards compat: a bare string was used; treat as label
          $el.text(value);
        }
        break;
      }
      case "map":
      case "text":
      case "longtext": {
        const v = typeof value === "string" ? value : "";
        // Map iframe: three accepted value formats, auto-detected here so
        // composer + storage stay schema-simple (just a string).
        //   1. Full URL (https://…) — pasted from Google Maps "Embed a
        //      map" share dialog. Used directly as iframe src so the
        //      richer place-card embed renders unchanged.
        //   2. lat,lng coordinates — wrapped in q= for pin-exact embed.
        //   3. Plain address — wrapped in q= for geocoded embed.
        if (tag === "iframe" && ($el.attr("data-type") || "").toLowerCase() === "map") {
          const isUrl = /^https?:\/\//i.test(v.trim());
          const url = isUrl
            ? v.trim()
            : `https://maps.google.com/maps?q=${encodeURIComponent(v)}&t=&z=15&ie=UTF8&iwloc=B&output=embed`;
          $el.attr("src", url);
        } else {
          // text + longtext now store HTML (the composer routes both
          // through the rich editor since 2026-05-16). Backwards-compat:
          // existing plain-string defaults pass through innerHTML
          // unchanged because `$el.html("Plain text")` just sets the
          // text node. New rich-edited values carry sanitized HTML
          // (allowed: <strong>, <em>, <u>, <a>, <ul>/<ol>/<li>, <p>).
          //
          // Headings / spans / list items / etc. (anything that isn't
          // a <div>) get TipTap's top-level <p> wrapper stripped. See
          // unwrapTipTapWrap for the full reasoning — without it the
          // generic `.ancestor p` rules in template-base.css override
          // the heading's color/size/weight on every edit.
          const sanitized = sanitizeRichText(v);
          $el.html(tag === "div" ? sanitized : unwrapTipTapWrap(sanitized));
        }
        break;
      }
      case "richtext": {
        const v = typeof value === "string" ? value : "";
        const sanitized = sanitizeRichText(v);
        // Same div-gate as text/longtext above. Templates put richtext
        // on <div data-type="richtext"> by convention, so the unwrap
        // doesn't fire on normal richtext fields — but the guard
        // future-proofs us against richtext-on-heading misuses.
        $el.html(tag === "div" ? sanitized : unwrapTipTapWrap(sanitized));
        break;
      }
      case "boolean": {
        // Booleans are config-only — no visible DOM write. The carrier
        // element stays hidden (template ships `hidden` on the <span>);
        // the value is consumed by Pass 6 (form-recipient binding) and
        // by the composition-level "active contact form?" check in
        // renderSite. Intentional fallthrough to nothing.
        break;
      }
    }
    });
  }

  // ── Pass 3: per-field style overrides (font size in px) ──
  // Runs AFTER content overrides so the inline style we add doesn't
  // collide with anything Pass 2 wrote (Pass 2 only touches text /
  // href / src — not style). Only text-shaped fields (text, longtext,
  // richtext) accept size overrides; image/link/repeater/map are
  // ignored even if they appear in fieldStyles, because resizing them
  // visually doesn't make sense in the same way.
  //
  // Uses `!important` because template CSS often defines aggressive
  // font-size rules (e.g., .hero h1 { font-size: 4rem; }) that would
  // out-specificity the inline style. Element-level inline + important
  // is the only thing that reliably wins everywhere.
  if (fieldStyles) {
    for (const [key, style] of Object.entries(fieldStyles)) {
      if (!style) continue;
      const field = schema[key];
      if (!field) continue;
      // Style overrides are only meaningful for prose-shaped fields.
      // image/link/repeater/map values can't be "resized" or "narrowed"
      // in the same way — silently ignored even if they appear in the
      // map (defends against legacy data).
      if (
        field.type !== "text" &&
        field.type !== "longtext" &&
        field.type !== "richtext"
      ) {
        continue;
      }
      // Apply to EVERY matching element, not just the first. In a
      // repeater section (e.g. how-it-works-01's 3 step cards all
      // sharing `data-field="step_description"`), .first() would
      // silently land the override on card 1 only — making card 1
      // visually drift from cards 2-3 even though the composer presented
      // the size cluster as if it edited the currently-selected card.
      // Non-repeater fields are unaffected (single match either way).
      const $els = $(`[data-field="${escapeAttrValue(key)}"]`);
      if ($els.length === 0) continue;
      // Collect declarations to append. Both size and width independently
      // valid → both applied. Either invalid → that one skipped, the
      // other still wins. fill === true takes priority over width (the
      // breakout rule sets its own max-width: 100vw; combining them is
      // contradictory).
      const declarations: string[] = [];
      const sizePx = typeof style.size === "number" ? style.size : NaN;
      if (
        Number.isFinite(sizePx) &&
        sizePx >= FIELD_SIZE_MIN_PX &&
        sizePx <= FIELD_SIZE_MAX_PX
      ) {
        // No !important — inline already wins desktop by specificity
        // (1,0,0,0 vs 0,1,1 class), and dropping !important lets
        // mobile @media rules with their own !important cap the
        // size on phones. Mirror of render-browser.ts. Peter
        // 2026-05-20 (hero h1 stuck at 56px on mobile).
        declarations.push(`font-size: ${sizePx}px`);
      }
      const fillEnabled = style.fill === true;
      const widthPx = typeof style.width === "number" ? style.width : NaN;
      const widthValid =
        !fillEnabled &&
        Number.isFinite(widthPx) &&
        widthPx >= FIELD_WIDTH_MIN_PX &&
        widthPx <= FIELD_WIDTH_MAX_PX;
      if (widthValid) {
        declarations.push(`max-width: ${widthPx}px !important`);
      }
      const joined = declarations.join("; ");
      $els.each((_, raw) => {
        const $el = $(raw);
        if (fillEnabled) {
          // data-fill attribute triggers the breakout rule in
          // template-base.css. Cleaner than inlining four declarations
          // because it can't collide with the template author's own
          // margin/padding rules — those still apply unless `!important`
          // promoted, and the breakout rule has !important to win.
          $el.attr("data-fill", "true");
        } else {
          // Strip it when fill flips off so we don't leave stale state.
          $el.removeAttr("data-fill");
        }
        if (!joined) return;
        // Preserve any existing inline style — we ONLY append our
        // declaration(s) so authors who set inline styles in the
        // template keep their work.
        const existing = $el.attr("style") || "";
        const trimmed = existing.replace(/;\s*$/, "");
        const next = trimmed ? `${trimmed}; ${joined}` : joined;
        $el.attr("style", next);
      });
    }
  }

  // ── Pass 4: section-id override ──
  // The composer surfaces the section root's anchor id as an editable
  // field via the reserved key `__section_id` inside content_overrides
  // (no DB migration: the column was already JSONB). Apply here so
  // visitors land on the right anchor when they follow an in-page link
  // (#hero, #services, etc.) and authors can rename anchors per-section
  // without us touching the template HTML. Empty / missing → keep the
  // template's default id.
  const sectionIdOverride = overrides.__section_id;
  if (typeof sectionIdOverride === "string") {
    const trimmed = sectionIdOverride.trim();
    if (trimmed) {
      const rootEl = $("body").children().first();
      rootEl.attr("id", trimmed);
    }
  }

  // ── Pass 5: hidden fields ──
  // Strip [data-field] elements the author hid via the composer's eye
  // icon. Done AFTER Pass 1 (repeater expansion) so per-item buttons
  // are already in the cheerio tree and addressable by index. Pure
  // removal — published HTML carries zero trace of hidden buttons.
  // Mirrors render-browser.ts.
  if (hiddenFields && hiddenFields.length > 0) {
    for (const key of hiddenFields) {
      stripHiddenFieldCheerio($, key);
    }
  }

  // ── Pass 6: contact-form recipient binding ──
  // Reserved field-name convention: a contact section with both
  // `form_recipient_email` (text, the email address) AND `form_enabled`
  // (boolean, the on/off switch) carriers in its schema gets its first
  // <form> tagged with `data-sk-form-recipient="<email>"` — but ONLY
  // when the toggle resolves to "true" AND the email is non-empty.
  //
  // contact-handler.js on the live site reads that attribute per-form,
  // so multiple contact sections on the same page can route to
  // different recipients (or be selectively disabled) without one
  // global script-tag email. Falling back to template defaults lets a
  // newly-added contact section work the moment the author types an
  // email — no need to also flip the toggle, which ships "true" by
  // default.
  //
  // We never auto-emit the attribute when the boolean is "false" or
  // the email is empty; the form just renders as an inert visual —
  // visitor can fill it, hitting submit does nothing (no listener).
  if (
    schema.form_recipient_email?.type === "text" &&
    schema.form_enabled?.type === "boolean"
  ) {
    const emailRaw =
      typeof overrides.form_recipient_email === "string"
        ? overrides.form_recipient_email
        : (schema.form_recipient_email.default ?? "");
    const enabledRaw =
      typeof overrides.form_enabled === "string"
        ? overrides.form_enabled
        : (schema.form_enabled.default ?? "false");
    // Strip HTML before stamping. TipTap wraps every value in <p>…</p>
    // and may also autolink the email into <a href="mailto:…">, so the
    // raw stored shape can be `<p><a href="mailto:info@x.sk">info@x.sk</a></p>`.
    // Stamping that whole blob into `data-sk-form-recipient` would ship
    // a garbage attribute that contact-handler.js can't parse.
    const email = htmlToPlainText(emailRaw);
    const enabled = enabledRaw.trim().toLowerCase() === "true";
    if (enabled && email) {
      const $form = $("form").first();
      if ($form.length > 0) {
        $form.attr("data-sk-form-recipient", email);
      }
    }
  }

  return $.html({ xmlMode: false });
}

/**
 * Cheerio counterpart to render-browser.ts:stripHiddenFieldDom. Removes
 * the DOM node for one hidden-field key. Handles both shapes:
 *   · "hero_cta"                      — top-level field
 *   · "services_items[2].service_cta" — repeater item sub-field
 * Silently no-ops on malformed keys / missing containers / out-of-range
 * indexes — hidden_fields is best-effort: if the template structure
 * changed underneath, the field just reverts to "shown" instead of
 * crashing the publish.
 *
 * Cascade-removes the immediate parent wrapper too if it became
 * structurally empty after the button left (mirrors render-browser
 * exactly so preview and publish drop the same nodes).
 */
function stripHiddenFieldCheerio(
  $: ReturnType<typeof load>,
  key: string,
): void {
  const match = /^([^[.]+)(?:\[(\d+)\]\.(.+))?$/.exec(key);
  if (!match) return;
  const topKey = match[1];
  const indexStr = match[2];
  const subKey = match[3];

  if (indexStr === undefined || subKey === undefined) {
    // Top-level — first [data-field] that isn't inside a [data-repeat].
    // Same filter shape the Pass 2 flat-field walker uses.
    const $els = $(`[data-field="${escapeAttrValue(topKey)}"]`).filter(
      (_i, el) => $(el).parents("[data-repeat]").length === 0,
    );
    if ($els.length === 0) return;
    removeWithEmptyWrapperCheerio($, $els.first());
    return;
  }

  const index = Number.parseInt(indexStr, 10);
  if (!Number.isFinite(index) || index < 0) return;
  const $container = $(`[data-repeat="${escapeAttrValue(topKey)}"]`).first();
  if ($container.length === 0) return;
  const $item = $container.children().eq(index);
  if ($item.length === 0) return;
  const $sub = $item
    .find(`[data-field="${escapeAttrValue(subKey)}"]`)
    .first();
  if ($sub.length === 0) return;
  removeWithEmptyWrapperCheerio($, $sub);
}

/** Mirrors PROTECTED_WRAPPER_TAGS in render-browser.ts — keep the two
 *  in sync so preview and publish never disagree on which wrappers
 *  survive after a hide. */
const PROTECTED_WRAPPER_TAGS_CHEERIO = new Set([
  "body",
  "html",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "form",
]);

/**
 * Cheerio counterpart to render-browser.ts:removeElementAndEmptyWrapper.
 * Removes `$el`, then drops its immediate parent if the parent is now
 * empty AND not protected. One-level cap — never recurses upward.
 */
function removeWithEmptyWrapperCheerio(
  $: ReturnType<typeof load>,
  $el: ReturnType<ReturnType<typeof load>>,
): void {
  const $parent = $el.parent();
  $el.remove();
  if ($parent.length === 0) return;
  if ($parent.children().length > 0) return;
  if (($parent.text() ?? "").trim().length > 0) return;
  const parentEl = $parent.get(0) as { tagName?: string } | undefined;
  const tag = (parentEl?.tagName ?? "").toLowerCase();
  if (!tag) return;
  if (PROTECTED_WRAPPER_TAGS_CHEERIO.has(tag)) return;
  if ($parent.attr("id")) return;
  if ($parent.attr("data-section") !== undefined) return;
  if ($parent.attr("data-repeat") !== undefined) return;
  if ($parent.attr("data-field") !== undefined) return;
  $parent.remove();
}

function escapeAttrValue(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
