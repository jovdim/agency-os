/**
 * Brand-contact override layer.
 *
 * Site-wide phone/email/address from `composition.brand` are stamped
 * onto every section field whose key matches the contact convention.
 * Same pattern as `composition.brand.company_text` propagating to
 * nav + footer logos via `withBrandLogo` in render.ts — type once in
 * the Brand panel, shows everywhere.
 *
 * Why this exists: tech-admin's pain was filling phone/email into the
 * navbar CTA, the footer, AND the contact section by hand on every
 * site. Same number, three retypes. Now: type once on Brand, every
 * section's contact field auto-resolves to that value at render time.
 *
 * Pure module — no DOM, no Node, no Supabase. Safe to import from
 * the server renderer (render.ts) and the in-browser preview renderer
 * (render-browser.ts) so both surfaces show identical output.
 *
 * Schema-driven: walks `placeholder_schema` looking for keys that
 * match the contact-key heuristic (same regexes the parser already
 * uses for the auto-`tel:` rewrite). Repeaters walk one level deep
 * via `item_schema` — covers footer column lists / contact card
 * grids that ship a phone/email per row.
 */

import type { SiteBrand } from "@/lib/composer/brand";

/* ─────────────────────────────────────────────────────────────
   Types — minimal subset of the placeholder_schema shape we need.
   Looser than parser.ts FieldSchema so this module stays decoupled
   from the parser's full type surface. Both renderers pass their
   PlaceholderSchema in; structural typing makes them compatible.
   ───────────────────────────────────────────────────────────── */

export interface BrandContactFieldShape {
  type: string;
  item_schema?: Record<string, BrandContactFieldShape>;
  default_items?: ReadonlyArray<Record<string, unknown>>;
  /** Link-field default — `default` carries the visible text (button
   *  label), `default_href` carries the link destination. We need
   *  default_href to detect "this CTA button is a phone/email
   *  call-to-action" by inspecting the template author's intent
   *  (e.g. `<a href="0900000000">` or `<a href="mailto:info@…">`)
   *  even when the field key (`hero_cta_primary`) doesn't say so. */
  default?: unknown;
  default_href?: string;
}

export type BrandContactSchema = Record<string, BrandContactFieldShape>;

/* ─────────────────────────────────────────────────────────────
   Field-key heuristics — match the parser's existing convention.
   Phone matches first so `tel*` keys win before `mail*` (no overlap
   today, but ordered defensively). Address is the loosest because
   templates use varied wording (`address`, `street`, `addr_line`).
   ───────────────────────────────────────────────────────────── */

/** Same regex as parser.ts:PHONE_FIELD_KEY_RE — keeps the auto-tel:
 *  rewrite and the brand-injection in lockstep. */
const PHONE_KEY_RE = /phone|tel(?!evisi)/i;
const EMAIL_KEY_RE = /email|mail(?!ing)/i;
const ADDRESS_KEY_RE = /address|street/i;

export type ContactKind = "phone" | "email" | "address";

/**
 * Classify a field key as a contact kind, or null if unrelated.
 * Exported in case future surfaces (badges, hints, JSON-workflow
 * filters) need to ask "is this a contact field?" with the same
 * regex set the parser + renderer use. Currently only used inside
 * this module after the lock-UI removal 2026-05-15.
 */
export function matchContactKind(key: string): ContactKind | null {
  if (PHONE_KEY_RE.test(key)) return "phone";
  if (EMAIL_KEY_RE.test(key)) return "email";
  if (ADDRESS_KEY_RE.test(key)) return "address";
  return null;
}

/**
 * Resolve the brand's value for a given contact kind. Returns the
 * trimmed string, or empty when the brand doesn't have it set yet.
 * Exported alongside matchContactKind for the same speculative
 * "future caller" reason — currently only used inside this module.
 */
export function brandValueFor(
  kind: ContactKind,
  brand: SiteBrand | null | undefined,
): string {
  if (!brand) return "";
  const raw =
    kind === "phone"
      ? brand.phone
      : kind === "email"
        ? brand.email
        : brand.address;
  return (raw ?? "").trim();
}

/**
 * Build the override value for one contact field. Returns `undefined`
 * when the field type isn't text-shaped (e.g. image, video) — the
 * caller skips those fields rather than corrupting them with a string.
 *
 * Link fields get a `{ label, href }` object so the parser's existing
 * link handler updates both. Phone hrefs use the raw number — the
 * parser auto-prepends `tel:` via `buildPhoneHref` for any field key
 * matching PHONE_FIELD_KEY_RE. Email hrefs are built explicitly here
 * (no parser-side helper for `mailto:`).
 */
function buildBrandContactValue(
  kind: ContactKind,
  fieldType: string,
  value: string,
): unknown | undefined {
  if (!value) return undefined;
  switch (fieldType) {
    case "text":
    case "longtext":
    case "richtext":
      return value;
    case "link":
      if (kind === "phone") {
        // Pass the raw number as href; parser's PHONE_FIELD_KEY_RE
        // matches the field key and runs buildPhoneHref → `tel:`.
        return { label: value, href: value };
      }
      if (kind === "email") {
        return { label: value, href: `mailto:${value}` };
      }
      // Address-as-link is unusual but possible (e.g. "View on map"
      // anchor). Leave href untouched — caller's existing default
      // wins via parser's no-href-update path.
      return { label: value };
    default:
      // image / video / map / boolean / repeater fall through; brand
      // contact never overwrites those.
      return undefined;
  }
}

/* ─────────────────────────────────────────────────────────────
   Public entry point — used by both renderers.
   ───────────────────────────────────────────────────────────── */

/**
 * Layer brand-contact values on top of a section's content_overrides.
 * Returns a NEW overrides map — never mutates the input — so callers
 * can pipe through other override layers (`withBrandLogo`, dedup
 * `__section_id`) without ordering hazards.
 *
 * Behavior (FALL-BACK semantics, changed 2026-05-15 per Peter):
 *   - For every TOP-LEVEL field whose key matches the contact
 *     heuristic AND has a non-empty brand value: brand value is used
 *     ONLY when the section has no value of its own. A typed section
 *     value always wins. This means tech-admin / client can override
 *     the brand-wide phone for one specific section if a different
 *     number really does belong there (e.g. "emergency line" in a
 *     contact section while footer keeps the main number).
 *   - For every REPEATER: same per-item rule — only fill empty
 *     item-sub-fields, never overwrite typed ones.
 *   - Fields without a matching brand value are left alone.
 *   - Unknown / missing schema → no-op (defensive against a stale
 *     templates map; matches the existing renderer's behavior).
 *
 * Why the change: previous "brand always wins" left users typing into
 * section phone fields and seeing nothing change on the page — the
 * value was discarded silently at render. Fall-back semantics make
 * the field editor's value match the rendered value AND honor user
 * intent when they want a per-section override.
 *
 * Type intentionally widened to `Record<string, unknown>` rather than
 * the parser's `Record<string, FieldValue>` — keeps this module from
 * depending on the parser's full type surface. Callers cast back at
 * the call site.
 */
export function withBrandContact(
  overrides: Record<string, unknown>,
  schema: BrandContactSchema | null | undefined,
  brand: SiteBrand | null | undefined,
): Record<string, unknown> {
  if (!brand) return overrides;
  if (!brand.phone && !brand.email && !brand.address) return overrides;
  if (!schema) return overrides;

  const result: Record<string, unknown> = { ...overrides };

  for (const [key, field] of Object.entries(schema)) {
    if (field.type === "repeater") {
      const itemSchema = field.item_schema ?? {};
      // Pre-compute which sub-keys map to which contact kind so we
      // walk the per-item loop with a tiny lookup, not a regex test
      // per row × per field.
      const subkeyMap: Array<{ key: string; kind: ContactKind; type: string }> = [];
      for (const [subKey, subField] of Object.entries(itemSchema)) {
        const kind = matchContactKind(subKey);
        if (!kind) continue;
        if (!brandValueFor(kind, brand)) continue;
        subkeyMap.push({ key: subKey, kind, type: subField.type });
      }
      if (subkeyMap.length === 0) continue;

      const existing = result[key];
      const baseItems: Array<Record<string, unknown>> = Array.isArray(existing)
        ? (existing as Array<Record<string, unknown>>)
        : (field.default_items as Array<Record<string, unknown>> | undefined) ?? [];

      const newItems = baseItems.map((item) => {
        const newItem: Record<string, unknown> = { ...item };
        for (const { key: subKey, kind, type } of subkeyMap) {
          // Fall-back: only fill when the per-item sub-field is empty.
          // Honors any user-typed value (e.g. emergency phone in row 2).
          if (!isFieldEmpty(newItem[subKey])) continue;
          const v = buildBrandContactValue(
            kind,
            type,
            brandValueFor(kind, brand),
          );
          if (v !== undefined) newItem[subKey] = v;
        }
        return newItem;
      });
      result[key] = newItems;
      continue;
    }

    const kind = matchContactKind(key);
    if (!kind) continue;
    const value = brandValueFor(kind, brand);
    if (!value) continue;
    // Fall-back: skip when the section already has a non-empty value
    // for this field. Typed value wins; brand fills the gap only.
    if (!isFieldEmpty(result[key])) continue;
    const v = buildBrandContactValue(kind, field.type, value);
    if (v !== undefined) result[key] = v;
  }

  // ── Pass 2: link fields detected by default_href shape ──
  // Catches CTA buttons whose field key doesn't match the contact
  // regex (e.g. `hero_cta_primary`) but whose template default href
  // makes the author's intent explicit:
  //   <a href="0900000000">Call us</a>      → phone CTA
  //   <a href="tel:+1...">Call</a>          → phone CTA
  //   <a href="mailto:info@...">Email us</a> → email CTA
  // For these, brand fills only the HREF; the label stays whatever
  // the user / template has (e.g. "Call us" stays "Call us" — we
  // never rewrite the visible button text).
  for (const [key, field] of Object.entries(schema)) {
    if (field.type !== "link") continue;
    if (matchContactKind(key)) continue; // already handled in pass 1
    const inferredKind = inferContactKindFromHref(field.default_href);
    if (!inferredKind) continue;
    const value = brandValueFor(inferredKind, brand);
    if (!value) continue;
    // Build the override merging current label (if any) with brand href.
    const existing = result[key];
    const existingLabel =
      typeof existing === "object" && existing !== null && !Array.isArray(existing)
        ? (existing as { label?: unknown }).label
        : undefined;
    const existingHref =
      typeof existing === "object" && existing !== null && !Array.isArray(existing)
        ? (existing as { href?: unknown }).href
        : undefined;
    // If the user has typed a non-default href, leave the field alone
    // — they explicitly want a different destination than the template
    // suggested. "#", empty, the template default, or undefined all
    // count as "not yet customized" and get the brand-contact href.
    const trimmedHref =
      typeof existingHref === "string" ? existingHref.trim() : "";
    const isUntouchedHref =
      !trimmedHref ||
      trimmedHref === "#" ||
      trimmedHref === (field.default_href ?? "").trim();
    if (!isUntouchedHref) continue;
    // Pick label: keep typed value, else fall back to template default,
    // else empty. (Never rewrite a button label from brand contact data
    // — "Call us" should not become "+1 555 …".)
    const labelStr =
      typeof existingLabel === "string" && existingLabel.trim().length > 0
        ? existingLabel
        : typeof field.default === "string"
          ? field.default
          : "";
    // Store the BARE brand value as href — no `tel:` / `mailto:`
    // prefix. The parser's existing link handler detects bare phone-
    // shaped hrefs via `looksLikePhone` and auto-applies
    // `buildPhoneHref` → `tel:` at render time. Same pattern works
    // for email through schema-driven prefix building. Storing the
    // bare value means:
    //   1. Composer's href input shows `+1 555 123 456`, not the
    //      ugly `tel:+1555123456` (hide the protocol prefix, system
    //      handles it automatically).
    //   2. When the brand phone changes, every dependent CTA picks
    //      up the new value through the same fall-back gate (still
    //      "untouched href" → still re-fills with new value).
    // For email we still emit `mailto:` explicitly because the
    // parser doesn't have a `looksLikeEmail` equivalent yet — adding
    // one is a follow-up task; for now `mailto:info@…` is the
    // honest stored value.
    const newHref =
      inferredKind === "phone" ? value : `mailto:${value}`;
    result[key] = { label: labelStr, href: newHref };
  }

  return result;
}

/**
 * Inspect a link field's template-default href to infer whether the
 * template author meant it as a phone CTA, email CTA, or something
 * else. The inference matches the parser's existing `tel:` rewrite
 * convention (`PHONE_FIELD_KEY_RE` + `buildPhoneHref`) so the
 * "phone-shaped" definition stays consistent across the codebase.
 *
 * Phone shapes:
 *   - "tel:+1…"             explicit
 *   - "0900000000"          starts with 0, all digits (local)
 *   - "+1900000000"         starts with +, all digits + maybe spaces/-
 *
 * Email shapes:
 *   - "mailto:info@…"       explicit
 *
 * Anything else (anchor `#…`, full URL `http(s)://…`, root path `/…`,
 * empty) returns null — the renderer keeps the template default as-is.
 */
function inferContactKindFromHref(
  defHref: string | undefined,
): ContactKind | null {
  if (!defHref) return null;
  const trimmed = defHref.trim();
  if (!trimmed) return null;
  if (/^tel:/i.test(trimmed)) return "phone";
  if (/^mailto:/i.test(trimmed)) return "email";
  // Bare phone-shape: digits with optional + / spaces / dashes, no
  // protocol prefix. Excludes anchors (#…) and URLs (http…/path/…).
  if (/^[+]?[\d\s\-()]{6,}$/.test(trimmed)) return "phone";
  return null;
}

/**
 * Treat a field value as empty when:
 *   - it's missing entirely (undefined / null)
 *   - it's a blank/whitespace-only string
 *   - it's a link object whose `label` is missing or blank
 *
 * This is the gate for "should brand-contact fall back?" — anything
 * the user has actually typed (non-empty string OR link with a
 * label) is preserved.
 */
function isFieldEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "object" && !Array.isArray(value)) {
    const label = (value as { label?: unknown }).label;
    if (typeof label === "string") return label.trim().length === 0;
    if (label === undefined || label === null) return true;
  }
  return false;
}
