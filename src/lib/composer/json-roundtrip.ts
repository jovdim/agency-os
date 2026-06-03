/**
 * Manual AI Fill — JSON round-trip helpers.
 *
 * A bring-your-own-AI alternative to the in-app AI Fill button. Tech
 * exports a JSON snapshot of every editable text field in the current
 * composition, pastes it (with instructions) into ChatGPT/Claude/etc.,
 * and re-imports the filled JSON. Composer applies the values through
 * the SAME field-update path the existing AI Fill uses
 * (`applyAiOverrides` in composer-client.tsx) — zero new render paths,
 * zero new persistence quirks.
 *
 * Why this exists alongside the in-app AI Fill:
 *   - The in-app button burns paid API tokens (Groq/OpenAI/Gemini).
 *   - This flow costs €0 — ChatGPT's free tier does the work.
 *   - Same field-walk, same output shape, same apply path → behaviour
 *     of the two flows is otherwise identical.
 *
 * Module is pure: no React, no DOM, no Supabase. Safe to import from
 * both server and client code. The only side effect happens later when
 * the caller passes a validated snapshot back to `applyAiOverrides`.
 *
 * Design principle locked in 2026-05-13 (memory: project-json-ai-fill-2026-05-13):
 *   - Schema is read from each template's `placeholder_schema` at run
 *     time, never hardcoded. New templates / new section categories /
 *     new field keys auto-work without touching this file.
 *   - Field-type eligibility mirrors `prompt-builder.ts` exactly:
 *     text / longtext / richtext / link → included; image / video /
 *     map / contact_* / phone / email / address → skipped.
 *   - Repeaters walk `item_schema` and emit one nested object per item
 *     currently in composition.
 *   - Strict import: unknown sections, unknown fields, wrong types,
 *     out-of-range repeater rows all fail validation. No partial /
 *     silent half-apply.
 */

import type { SiteComposition } from "@/lib/templates/render";
import type {
  FieldSchema,
  FieldValue,
  PlaceholderSchema,
} from "@/lib/templates/parser";

/* ─────────────────────────────────────────────────────────────
   Public types
   ───────────────────────────────────────────────────────────── */

/**
 * What a single field carries in the snapshot. Mirrors the subset of
 * FieldValue the round-trip cares about — image/video URLs and map
 * coordinates are skipped at the walker level, so they never appear
 * here.
 */
export type RoundtripValue =
  | string
  | { label?: string }
  | Array<Record<string, string | { label?: string }>>;

/**
 * Snapshot shape — nested by section id, matching the
 * `AiOverrides` shape `applyAiOverrides` already consumes. Reusing
 * the same shape means import = call the existing applier; no new
 * apply path to test.
 */
export type RoundtripSnapshot = Record<string, Record<string, RoundtripValue>>;

/**
 * Minimal template shape the walker needs. The composer already passes
 * around a richer object (id, category, name, html_path, …) — this
 * narrows to the two fields that matter so callers can hand us
 * whatever they have without ceremony.
 */
export interface JsonRoundtripTemplate {
  id: string;
  placeholder_schema: PlaceholderSchema;
}

/* ─────────────────────────────────────────────────────────────
   Field-type eligibility — mirrors prompt-builder.ts
   ───────────────────────────────────────────────────────────── */

/**
 * Reserved keys that live inside `content_overrides` but are anchor
 * slugs, not user-facing content. Excluded from both export and
 * import — AI doesn't generate URL fragments.
 */
const RESERVED_OVERRIDE_KEYS = new Set(["__section_id", "__item_id"]);

/**
 * Reserved virtual-section id for site-level SEO. Lives alongside the
 * real content sections in the snapshot but doesn't correspond to any
 * template. The walker emits it from `composition.seo`; the importer
 * detects this exact id and routes the values to `updateSeo` instead
 * of looking up a template.
 *
 * Two-underscore prefix matches the convention for other reserved
 * keys (RESERVED_OVERRIDE_KEYS) — easy to spot in JSON, unlikely to
 * collide with a real section id (those are uuid-shaped).
 */
export const SEO_VIRTUAL_SECTION_ID = "__seo";

/**
 * Reserved virtual-section ids for the shared nav + footer slots.
 * Same pattern as SEO_VIRTUAL_SECTION_ID — emitted by the walker
 * from `composition.shared.{nav,footer}_overrides`, detected by the
 * importer and routed through the slot-specific update path
 * (`updateSharedContent`) instead of looking up a section by uuid.
 *
 * Why these had to be added (Peter 2026-05-15): footer description
 * and any other refillable footer/nav text were invisible to the
 * JSON workflow because the walker only touched `pages[0].sections`.
 * Tech-admins exporting and re-importing thought ChatGPT had skipped
 * those fields — actually they were never sent in the first place.
 */
export const NAV_VIRTUAL_SECTION_ID = "__nav";
export const FOOTER_VIRTUAL_SECTION_ID = "__footer";

/**
 * The only SiteSeo fields we let ChatGPT touch. Everything else on
 * SiteSeo is a URL (og_image_url, favicon_url) or a boolean
 * (no_index) — same rule as everywhere in this file: AI fills text,
 * never URLs or config flags. Hardcoded rather than schema-derived
 * because SiteSeo isn't a placeholder_schema, it's a TS interface
 * with a fixed shape.
 */
const SEO_FILLABLE_KEYS = ["title", "description"] as const;

/**
 * Field-type predicate — true iff a top-level (non-repeater) field of
 * this type should be included in the export. Stays in sync with
 * `mapFieldKindForFill` in src/lib/ai/prompt-builder.ts — only text-
 * shaped types pass.
 */
function isExportableTopLevelType(type: FieldSchema["type"]): boolean {
  switch (type) {
    case "text":
    case "longtext":
    case "richtext":
    case "link":
      return true;
    case "image":
    case "video":
    case "map":
    case "repeater":
      return false;
    case "boolean":
      // Boolean carriers are config (form recipient toggle, etc.), never
      // user-facing copy. AI Fill should never read or rewrite them, so
      // they're skipped in JSON export just like images/video/map.
      return false;
  }
}

/**
 * Field-key predicate — contact fields are auto-filled from
 * proposal/contact data and AI should never touch them. Same rule
 * the in-app AI Fill applies (prompt-builder.ts → isContactField).
 */
function isContactKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.includes("phone") ||
    k.includes("email") ||
    k.includes("address") ||
    k.includes("street") ||
    k.includes("city") ||
    k.includes("zip")
  );
}

/* ─────────────────────────────────────────────────────────────
   Export — composition → snapshot
   ───────────────────────────────────────────────────────────── */

export interface BuildSnapshotArgs {
  composition: SiteComposition;
  /** Map keyed by template id. Composer already maintains this. */
  templates: Map<string, JsonRoundtripTemplate>;
  /** Which page to export (Peter 2026-05-30 — page-aware so subpage
   *  round-trips work). Defaults to the home page (composition.pages[0])
   *  for backward compat. The shared nav/footer/SEO virtual sections
   *  are only emitted when exporting the home page; subpage exports
   *  carry only that subpage's body sections (the shared slots were
   *  filled during the home round-trip and shouldn't be re-touched
   *  per subpage). */
  targetPagePath?: string;
}

/**
 * Walk the target page's body sections and produce a snapshot of every
 * text-shaped field, keyed by section id → field key.
 *
 * Page selection (Peter 2026-05-30): when `targetPagePath` is set, that
 * page's sections are walked; otherwise the home page (pages[0]) is
 * used. The shared nav/footer/SEO virtual sections are only attached
 * for the HOME export — subpage exports return only the subpage's own
 * sections, since nav/footer/SEO are filled once during the home pass
 * and apply site-wide.
 *
 * Reads the CURRENT values from `content_overrides`; falls back to
 * the template's default (`field.default` / `link.label`) when no
 * override is set, so ChatGPT sees the same starter text the human
 * sees in the composer instead of mysterious empties.
 *
 * Repeaters emit as arrays of item objects. Item count matches what's
 * currently in composition — either the user's override array, or
 * the template's `default_items` when nothing's been customised yet.
 * This means the IMPORT side must check that the LLM didn't add or
 * remove rows (covered by `validateImportedJson`).
 *
 * Sections whose template isn't in the templates map are silently
 * skipped — defensive against a stale templates prop. Same for
 * sections that produce zero eligible fields after filtering.
 */
export function buildExportSnapshot(args: BuildSnapshotArgs): RoundtripSnapshot {
  const homePath = args.composition.pages[0]?.path ?? "index.html";
  const targetPath = args.targetPagePath ?? homePath;
  const targetPage =
    args.composition.pages.find((p) => p.path === targetPath) ??
    args.composition.pages[0];
  const isHomePage = (targetPage?.path ?? homePath) === homePath;
  const sections = targetPage?.sections ?? [];
  const out: RoundtripSnapshot = {};

  for (const section of sections) {
    const tpl = args.templates.get(section.template_id);
    if (!tpl) continue;
    const sectionEntry = walkTemplateFields(
      tpl.placeholder_schema,
      section.content_overrides ?? {},
    );
    if (Object.keys(sectionEntry).length > 0) {
      out[section.id] = sectionEntry;
    }
  }

  // ── Shared slots + site SEO: HOME PAGE EXPORTS ONLY ──
  // The nav, footer, and site-level SEO apply to the whole site, so
  // they get filled once during the HOME round-trip. Subpage exports
  // skip them — re-emitting them would let ChatGPT accidentally
  // rewrite a menu / footer description the tech-admin already
  // approved. The validator's "expected" build runs through this
  // same function so the strict-shape check stays in sync.
  if (isHomePage) {
    // ── Shared nav slot ──
    // Looked up via the same templates map as page sections so the
    // walker uses the actual schema the renderer would. Skip when the
    // nav template id isn't set or its template isn't in the map.
    const navTplId = args.composition.shared?.nav_template_id;
    if (navTplId) {
      const navTpl = args.templates.get(navTplId);
      if (navTpl) {
        const navEntry = walkTemplateFields(
          navTpl.placeholder_schema,
          args.composition.shared?.nav_overrides ?? {},
        );
        if (Object.keys(navEntry).length > 0) {
          out[NAV_VIRTUAL_SECTION_ID] = navEntry;
        }
      }
    }

    // ── Shared footer slot ──
    const footerTplId = args.composition.shared?.footer_template_id;
    if (footerTplId) {
      const footerTpl = args.templates.get(footerTplId);
      if (footerTpl) {
        const footerEntry = walkTemplateFields(
          footerTpl.placeholder_schema,
          args.composition.shared?.footer_overrides ?? {},
        );
        if (Object.keys(footerEntry).length > 0) {
          out[FOOTER_VIRTUAL_SECTION_ID] = footerEntry;
        }
      }
    }
  }

  // ── Site-level SEO as a virtual section ──
  // HOME ONLY (Peter 2026-05-30) — site-level SEO is shared, so re-
  // emitting it on a subpage round-trip would let ChatGPT rewrite the
  // title/description that already shipped with home.
  if (isHomePage) {
    const seoEntry: Record<string, RoundtripValue> = {};
    const currentSeo = (args.composition.seo ?? {}) as Record<string, unknown>;
    for (const key of SEO_FILLABLE_KEYS) {
      const v = currentSeo[key];
      seoEntry[key] = typeof v === "string" ? v : "";
    }
    out[SEO_VIRTUAL_SECTION_ID] = seoEntry;
  }

  return out;
}

/**
 * Render the home page's filled content as an English human-readable
 * Markdown block (Peter 2026-05-30). Used as read-only reference in
 * subpage round-trip instructions so ChatGPT can match the home's
 * brand voice when filling a subpage.
 *
 * Why markdown, not JSON: feeding ChatGPT another JSON block alongside
 * the target JSON tends to confuse it ("am I supposed to fill THIS
 * one too?"). A plain prose dump reads as background reading. We also
 * skip section ids + repeater shape — only the human-meaningful values
 * survive (titles, headlines, paragraphs), so the LLM gets voice cues,
 * not structural noise.
 */
export function buildHomeReferenceMarkdown(args: {
  composition: SiteComposition;
  templates: Map<string, JsonRoundtripTemplate>;
}): string {
  const homePage = args.composition.pages[0];
  if (!homePage || homePage.sections.length === 0) return "";

  const lines: string[] = [];
  let sectionIdx = 0;
  for (const section of homePage.sections) {
    const tpl = args.templates.get(section.template_id);
    if (!tpl) continue;
    const fields = walkTemplateFields(
      tpl.placeholder_schema,
      (section.content_overrides ?? {}) as Record<string, FieldValue>,
    );
    const flat = flattenValuesForReference(fields);
    if (flat.length === 0) continue;
    sectionIdx += 1;
    // Use a generic "Section N" header so we don't leak section ids
    // (they're cryptic uuids — useless for an LLM reader).
    lines.push(`### Section ${sectionIdx}`);
    for (const text of flat) lines.push(text);
    lines.push("");
  }

  // SEO is global to the site and a strong voice cue ("how does the
  // tech-admin describe this business in 60 chars?"). Surface it
  // separately so it's not buried in the section dump.
  const seo = (args.composition.seo ?? {}) as Record<string, unknown>;
  const seoTitle = typeof seo.title === "string" ? seo.title.trim() : "";
  const seoDesc =
    typeof seo.description === "string" ? seo.description.trim() : "";
  if (seoTitle || seoDesc) {
    lines.push("### SEO");
    if (seoTitle) lines.push(`- Title: ${seoTitle}`);
    if (seoDesc) lines.push(`- Description: ${seoDesc}`);
  }

  return lines.join("\n").trim();
}

/**
 * Flatten a per-section field entry into plain English bullet lines for
 * the home-reference block. Strips HTML tags from richtext, drops link
 * `href` fields (URLs aren't voice cues), expands repeaters as
 * dash-prefixed lists of their item titles + text fields.
 */
function flattenValuesForReference(
  entry: Record<string, RoundtripValue>,
): string[] {
  const out: string[] = [];
  for (const [, value] of Object.entries(entry)) {
    if (typeof value === "string") {
      const cleaned = stripHtmlForReference(value).trim();
      if (cleaned) out.push(`- ${cleaned}`);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        for (const itemValue of Object.values(item)) {
          if (typeof itemValue === "string") {
            const cleaned = stripHtmlForReference(itemValue).trim();
            if (cleaned) out.push(`  - ${cleaned}`);
          } else if (
            itemValue &&
            typeof itemValue === "object" &&
            !Array.isArray(itemValue) &&
            typeof (itemValue as { label?: unknown }).label === "string"
          ) {
            const label = (itemValue as { label: string }).label.trim();
            if (label) out.push(`  - ${label}`);
          }
        }
      }
    } else if (value && typeof value === "object") {
      const label =
        typeof (value as { label?: unknown }).label === "string"
          ? (value as { label: string }).label.trim()
          : "";
      if (label) out.push(`- ${label}`);
    }
  }
  return out;
}

function stripHtmlForReference(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
}

/**
 * Walk one template's schema + overrides → snapshot entry. Extracted
 * from the per-section loop so the same walk works for page sections,
 * the shared nav slot, and the shared footer slot.
 *
 * Skips reserved keys (anchor-id markers), contact keys (factual
 * data — phone/email/address come from Brand panel, never from AI),
 * and field types AI can't write (image / video / map / boolean).
 * Repeaters get their own per-item walk via `exportRepeater`.
 */
function walkTemplateFields(
  schema: PlaceholderSchema,
  overrides: Record<string, FieldValue>,
): Record<string, RoundtripValue> {
  const entry: Record<string, RoundtripValue> = {};
  for (const [key, field] of Object.entries(schema)) {
    if (RESERVED_OVERRIDE_KEYS.has(key)) continue;
    if (isContactKey(key)) continue;

    // Image fields are skipped (we never export URLs for the AI to
    // rewrite) BUT their companion alt-text key IS exported as a
    // plain string field. Stored under the derived key
    // `<imageKey>_alt` in content_overrides — the same place the
    // composer's image picker + the renderer's alt fallback read it
    // from. Empty string when no override exists so the AI sees a
    // blank slot to fill; non-empty when the user typed alt manually,
    // so the AI can see the existing value and (per the import
    // applier's "preserve user-typed" rule) leave it alone.
    if (field.type === "image") {
      const altKey = `${key}_alt`;
      const altRaw = overrides[altKey];
      entry[altKey] = typeof altRaw === "string" ? altRaw : "";
      continue;
    }

    if (field.type === "repeater") {
      const arr = exportRepeater(field, overrides[key]);
      if (arr.length > 0) entry[key] = arr;
      continue;
    }

    if (!isExportableTopLevelType(field.type)) continue;

    entry[key] = exportScalar(field, overrides[key]);
  }
  return entry;
}

/**
 * Snapshot one non-repeater field. `link` flattens to its label only
 * — the href is structural (user clicks the link button to set it,
 * or it follows from the template default). ChatGPT only writes
 * link TEXT, never URLs.
 */
function exportScalar(field: FieldSchema, current: FieldValue | undefined): RoundtripValue {
  if (field.type === "link") {
    // Resolve current label or fall back to default label.
    if (typeof current === "object" && current !== null && !Array.isArray(current)) {
      const lbl = (current as { label?: unknown }).label;
      if (typeof lbl === "string") return { label: lbl };
    }
    const dflt = field.default;
    if (typeof dflt === "string") return { label: dflt };
    return { label: "" };
  }

  // text / longtext / richtext
  if (typeof current === "string") return current;
  if (typeof field.default === "string") return field.default;
  return "";
}

/**
 * Snapshot a repeater. Uses the user's override array when present,
 * otherwise the template's `default_items` (so the LLM sees the same
 * starter rows the composer renders by default). Each item is walked
 * field-by-field via the item_schema — same filters as the top-level
 * walk, no nested repeaters (consistent with prompt-builder.ts).
 */
function exportRepeater(
  field: FieldSchema,
  current: FieldValue | undefined,
): Array<Record<string, string | { label?: string }>> {
  const itemSchema = field.item_schema ?? {};
  const baseItems: Array<Record<string, FieldValue>> = Array.isArray(current)
    ? (current as Array<Record<string, FieldValue>>)
    : (field.default_items as Array<Record<string, FieldValue>> | undefined) ?? [];

  const out: Array<Record<string, string | { label?: string }>> = [];
  for (const item of baseItems) {
    const itemOut: Record<string, string | { label?: string }> = {};
    for (const [subKey, subField] of Object.entries(itemSchema)) {
      if (RESERVED_OVERRIDE_KEYS.has(subKey)) continue;
      if (isContactKey(subKey)) continue;
      if (subField.type === "repeater") continue; // no nested repeaters

      // Item-image fields → emit the alt companion key. Same rule as
      // the top-level walker above; the image URL itself stays out
      // of the snapshot, only the `_alt` text rides along so the AI
      // can describe each photo.
      if (subField.type === "image") {
        const altKey = `${subKey}_alt`;
        const altRaw = item[altKey];
        itemOut[altKey] = typeof altRaw === "string" ? altRaw : "";
        continue;
      }

      if (!isExportableTopLevelType(subField.type)) continue;
      // exportScalar returns RoundtripValue (string | {label} | array);
      // for non-repeater non-link types it's always a string, so the
      // narrower per-item value-type is safe here.
      const v = exportScalar(subField, item[subKey]);
      if (typeof v === "string" || (typeof v === "object" && v !== null && !Array.isArray(v))) {
        itemOut[subKey] = v as string | { label?: string };
      }
    }
    out.push(itemOut);
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────
   Import — snapshot → validate against current composition
   ───────────────────────────────────────────────────────────── */

export interface ValidateImportArgs {
  /** Raw text the user pasted. May be wrapped in ```json fences or
   *  prefixed with a "Sure! Here's the JSON:" preamble. The parser
   *  is tolerant about wrapping noise but strict about the JSON's
   *  internal shape. */
  raw: string;
  composition: SiteComposition;
  templates: Map<string, JsonRoundtripTemplate>;
  /** Which page this import targets (Peter 2026-05-30 — page-aware so
   *  subpage round-trips work). Defaults to the home page. The validator
   *  feeds this straight to buildExportSnapshot to compute the expected
   *  shape, so the export and validate sides agree on which sections
   *  must be present. */
  targetPagePath?: string;
}

export interface ValidateImportResult {
  ok: boolean;
  /** Human-readable error lines. Empty when ok=true. */
  errors: string[];
  /** Cleaned snapshot ready to feed into the apply path. Set only
   *  when ok=true; never partial. */
  parsed?: RoundtripSnapshot;
  /** Summary counts for the diff preview. */
  stats?: {
    sectionsChanged: number;
    fieldsChanged: number;
  };
}

/**
 * Validate user-pasted JSON against the current composition. Returns
 * an ok=true result with the cleaned snapshot when every key in the
 * paste matches a real section + field in the composition, and every
 * value's type matches the field's schema. Otherwise returns ok=false
 * with a list of specific problems the user can fix in ChatGPT and
 * re-paste.
 *
 * All-or-nothing — never returns a partial snapshot. The atomic-ops
 * rule (memory: feedback-atomic-operations) says multi-step ops must
 * be all-valid-or-nothing.
 */
export function validateImportedJson(args: ValidateImportArgs): ValidateImportResult {
  const errors: string[] = [];

  // ── Stage 1: tolerant parse — strip code fences and preamble ──
  const stripped = stripLlmWrapping(args.raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      errors: [`JSON is not valid: ${msg}. Make sure ChatGPT returned only the JSON — no commentary, no markdown fences.`],
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      errors: ["Top-level JSON must be an object keyed by section id."],
    };
  }

  const incoming = parsed as Record<string, unknown>;

  // ── Stage 2: build the expected key set from current composition ──
  // Same walker as export — the expected shape IS exactly what we'd
  // export. This guarantees export → ChatGPT → import is round-trip
  // safe by construction. Pass through targetPagePath so the validator
  // expects the SUBPAGE's sections (not always home's) when importing
  // a subpage round-trip.
  const expected = buildExportSnapshot({
    composition: args.composition,
    templates: args.templates,
    targetPagePath: args.targetPagePath,
  });

  const expectedSectionIds = new Set(Object.keys(expected));
  const incomingSectionIds = new Set(Object.keys(incoming));

  // Unknown / missing sections (full-strict — LLM must echo every section)
  for (const id of incomingSectionIds) {
    if (!expectedSectionIds.has(id)) {
      errors.push(`Unknown section id in JSON: "${id}". Did ChatGPT invent one or rename?`);
    }
  }
  for (const id of expectedSectionIds) {
    if (!incomingSectionIds.has(id)) {
      errors.push(`Missing section in JSON: "${id}". Don't remove sections between export and import.`);
    }
  }

  // ── Stage 3: per-section field validation ──
  const cleaned: RoundtripSnapshot = {};
  let totalFields = 0;

  for (const [sectionId, expectedFields] of Object.entries(expected)) {
    const incomingFields = incoming[sectionId];
    if (typeof incomingFields !== "object" || incomingFields === null || Array.isArray(incomingFields)) {
      errors.push(`Section "${sectionId}" must be an object of field-key → value.`);
      continue;
    }
    const incomingObj = incomingFields as Record<string, unknown>;
    const cleanedSection: Record<string, RoundtripValue> = {};

    const expectedFieldKeys = new Set(Object.keys(expectedFields));
    const incomingFieldKeys = new Set(Object.keys(incomingObj));

    for (const k of incomingFieldKeys) {
      if (!expectedFieldKeys.has(k)) {
        errors.push(`Unknown field "${k}" in section "${sectionId}".`);
      }
    }
    for (const k of expectedFieldKeys) {
      if (!incomingFieldKeys.has(k)) {
        errors.push(`Missing field "${k}" in section "${sectionId}".`);
      }
    }

    for (const [key, expectedValue] of Object.entries(expectedFields)) {
      if (!(key in incomingObj)) continue; // already reported missing
      const raw = incomingObj[key];

      // Repeater value
      if (Array.isArray(expectedValue)) {
        if (!Array.isArray(raw)) {
          errors.push(`Field "${sectionId}.${key}" must be an array (it's a repeater).`);
          continue;
        }
        if (raw.length !== expectedValue.length) {
          errors.push(
            `Repeater "${sectionId}.${key}" must have exactly ${expectedValue.length} items (got ${raw.length}). Don't add or remove rows in ChatGPT — adjust them in the composer first.`,
          );
          continue;
        }
        const cleanedItems: Array<Record<string, string | { label?: string }>> = [];
        let itemOk = true;
        for (let i = 0; i < raw.length; i++) {
          const expItem = expectedValue[i];
          const incItem = raw[i];
          if (typeof incItem !== "object" || incItem === null || Array.isArray(incItem)) {
            errors.push(`Repeater item "${sectionId}.${key}[${i}]" must be an object.`);
            itemOk = false;
            continue;
          }
          const incItemObj = incItem as Record<string, unknown>;
          const cleanedItem: Record<string, string | { label?: string }> = {};
          for (const [subKey, expSubValue] of Object.entries(expItem)) {
            if (!(subKey in incItemObj)) {
              errors.push(`Missing item field "${sectionId}.${key}[${i}].${subKey}".`);
              itemOk = false;
              continue;
            }
            const incSubValue = incItemObj[subKey];
            const cleaned = coerceLeafValue(incSubValue, expSubValue, `${sectionId}.${key}[${i}].${subKey}`, errors);
            if (cleaned === undefined) {
              itemOk = false;
              continue;
            }
            if (typeof cleaned === "string" || (typeof cleaned === "object" && cleaned !== null && !Array.isArray(cleaned))) {
              cleanedItem[subKey] = cleaned as string | { label?: string };
            }
          }
          // Check for unknown sub-keys
          for (const k of Object.keys(incItemObj)) {
            if (!(k in expItem)) {
              errors.push(`Unknown item field "${sectionId}.${key}[${i}].${k}".`);
              itemOk = false;
            }
          }
          cleanedItems.push(cleanedItem);
        }
        if (itemOk) {
          cleanedSection[key] = cleanedItems;
          totalFields += cleanedItems.length;
        }
        continue;
      }

      // Scalar value (string or { label })
      const cleanedLeaf = coerceLeafValue(raw, expectedValue, `${sectionId}.${key}`, errors);
      if (cleanedLeaf !== undefined) {
        cleanedSection[key] = cleanedLeaf;
        totalFields += 1;
      }
    }

    if (Object.keys(cleanedSection).length > 0) {
      cleaned[sectionId] = cleanedSection;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    parsed: cleaned,
    stats: {
      sectionsChanged: Object.keys(cleaned).length,
      fieldsChanged: totalFields,
    },
  };
}

/**
 * Coerce one leaf value against the expected shape (string or
 * `{ label }`). Pushes a specific error into `errors` and returns
 * `undefined` on mismatch. Otherwise returns the cleaned value.
 */
function coerceLeafValue(
  incoming: unknown,
  expected: RoundtripValue,
  path: string,
  errors: string[],
): RoundtripValue | undefined {
  // Expected: link → object with label
  if (typeof expected === "object" && expected !== null && !Array.isArray(expected)) {
    if (typeof incoming === "object" && incoming !== null && !Array.isArray(incoming)) {
      const inc = incoming as Record<string, unknown>;
      if (typeof inc.label === "string") {
        return { label: inc.label };
      }
      errors.push(`Field "${path}" must be a { "label": "..." } object.`);
      return undefined;
    }
    errors.push(`Field "${path}" must be a { "label": "..." } object (got ${typeof incoming}).`);
    return undefined;
  }

  // Expected: string (text / longtext / richtext)
  if (typeof expected === "string") {
    if (typeof incoming === "string") return incoming;
    errors.push(`Field "${path}" must be a string (got ${typeof incoming}).`);
    return undefined;
  }

  // Repeater handled by caller — shouldn't reach here.
  errors.push(`Field "${path}": internal validator confusion. Report this bug.`);
  return undefined;
}

/**
 * Strip the common ways LLMs wrap raw JSON:
 *   - Markdown code fences (```json ... ``` or ``` ... ```)
 *   - Leading "Sure! Here's the filled JSON:" preamble
 *   - Trailing commentary after the closing brace
 *
 * We don't try to be exhaustive — we just shave the noise that
 * appears in 90 % of free-tier ChatGPT outputs. If a paste is too
 * mangled to fix here, the JSON parser will fail with a clear error.
 */
function stripLlmWrapping(raw: string): string {
  let s = raw.trim();

  // Code fences: strip if the body starts with ``` and ends with ```
  if (s.startsWith("```")) {
    // Drop opening fence (and optional language tag like ```json)
    s = s.replace(/^```[a-zA-Z0-9]*\s*\n?/, "");
    // Drop closing fence
    s = s.replace(/\n?```\s*$/, "");
  }

  // Trim again after fence removal
  s = s.trim();

  // If there's preamble text before the first `{`, drop it; if there's
  // commentary after the last `}`, drop it. This catches the typical
  // "Sure! Here's…" prefix and the "Hope this helps!" suffix.
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace > 0 || (lastBrace >= 0 && lastBrace < s.length - 1)) {
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      s = s.slice(firstBrace, lastBrace + 1);
    }
  }

  return s;
}

/* ─────────────────────────────────────────────────────────────
   Instructions block — what the user pastes ABOVE the JSON
   ───────────────────────────────────────────────────────────── */

export interface JsonRoundtripBusinessService {
  title: string;
  description?: string;
}

export interface BuildInstructionsArgs {
  /** Company / brand name. Loaded from /api/composer/ai-inputs
   *  (which prefers proposal.company_name) with a fallback to
   *  composition.brand.company_text. */
  companyName: string;
  /** Industry / segment (e.g. "PVC windows", "excavators", "hair salon").
   *  Loaded from proposal.industry. Optional — empty string acceptable
   *  for standalone sites with no proposal. */
  industry?: string;
  /** Town / region where the business operates (e.g. "London").
   *  Loaded from proposal.town. Tells the LLM where the audience is
   *  so generated copy can mention local context naturally. */
  town?: string;
  /** Services the business offers. Loaded from proposal.services
   *  (titles only, descriptions added in the modal). Empty array for
   *  no-proposal sites — the LLM falls back to inferring services
   *  from the JSON's existing content. */
  services?: JsonRoundtripBusinessService[];
  /** Optional verbatim copywriting guide. Loaded lazily by the modal
   *  from composer_ai_settings.copywriting_guide so the JSON workflow
   *  follows the same voice rules the in-app AI Fill does. */
  copywritingGuide?: string;
  /** Which page the round-trip targets (Peter 2026-05-30). When set
   *  to a non-home subpage, the instructions get an extra "this is
   *  page X about service Y" section + word-count targets + the
   *  home content as read-only reference so ChatGPT keeps the brand
   *  voice consistent across pages. Omit (or pass "home") for the
   *  home page round-trip — behaviour stays identical to pre-2026-05-30. */
  pageContext?: JsonRoundtripPageContext;
}

/**
 * Page-specific context for the instructions block (Peter 2026-05-30).
 * The composer resolves this from the active page + composition and
 * hands it to buildInstructionsBlock. Subpage round-trips need this
 * so ChatGPT knows (a) which page it's filling and (b) what the home
 * page already says — without it, every subpage would be written in
 * isolation and brand voice would drift across pages.
 */
export interface JsonRoundtripPageContext {
  /** "home" → existing behaviour, no extra context block. Subpage kinds
   *  add a header telling ChatGPT this is a focused subpage round-trip. */
  kind: "home" | "service_subpage" | "custom_subpage";
  /** Page's display label (the chip in the composer page tabs). */
  pageLabel: string;
  /** Page's URL path (e.g. "tree-rope-cutting.html"). */
  pagePath: string;
  /** When kind === "service_subpage", the title of the home-page
   *  services-section item this subpage represents. ChatGPT is told
   *  to keep all the subpage's copy laser-focused on this one service. */
  linkedServiceTitle?: string | null;
  /** Pre-formatted dump of the home page's filled content, used as
   *  read-only reference for subpage round-trips. The composer builds
   *  this by walking the home composition (same walker the export uses)
   *  and rendering it as an English human-readable block — NOT raw JSON,
   *  to avoid confusing ChatGPT into thinking it should fill those keys.
   *  Empty / undefined for home or when no home content exists. */
  homeReferenceMarkdown?: string;
}

/**
 * Build the English-language prompt the user pastes into ChatGPT
 * BEFORE the JSON.
 *
 * Bakes in everything the LLM needs to write specific, on-brand copy:
 *   - Company name, industry, town (REAL business context — without
 *     this the LLM invents generic services and locations)
 *   - The salesperson's services list with descriptions, so the LLM
 *     writes about WHAT the company actually does instead of guessing
 *   - The verbatim copywriting guide (same one the paid AI Fill uses),
 *     so style/tone is consistent across both flows
 *   - Format rules so the JSON round-trip survives ChatGPT's helpful
 *     reformatting habits (no markdown, no commentary, exact same keys)
 *
 * Sections marked optional only render when there's something to say —
 * an empty `services` array drops the whole Services section instead of
 * emitting "## Services the company provides\n\n(none)" noise.
 */
/**
 * Default translation guide — used when no custom `translation_guide` is
 * configured in composer_ai_settings. These are the house rules for
 * producing a translated language version of a finished site (Peter
 * 2026-05-28). Distinct from the content copywriting guide: that guide is
 * for WRITING original copy; this one is for TRANSLATING existing copy
 * faithfully into another language.
 */
export const DEFAULT_TRANSLATION_GUIDE = [
  "- natural, accurate translations written the way a native speaker would write them",
  "- simple, clear, human wording",
  '- no overly formal or "AI-sounding" tone',
  "- preserve the original meaning and context",
  "- proper grammar and natural sentence flow",
  "- business / web text: professional but still natural wording",
  "- marketing content: persuasive and easy to read",
].join("\n");

export interface BuildTranslationInstructionsArgs {
  /** Human-readable name of the language to translate INTO (e.g.
   *  "Deutsch", "English"). Comes from LOCALE_LABELS. */
  targetLanguageLabel: string;
  /** Human-readable name of the source language the JSON is currently in
   *  (e.g. "English"). Helps the LLM with direction + tone. Optional. */
  sourceLanguageLabel?: string;
  /** Company / brand name — so the LLM knows NOT to translate it (brand
   *  names stay verbatim across languages). Optional. */
  companyName?: string;
  /** Verbatim translation guide. Falls back to DEFAULT_TRANSLATION_GUIDE
   *  when not provided (no settings row configured yet). */
  translationGuide?: string;
}

/**
 * Build the English-language prompt the user pastes into ChatGPT to
 * TRANSLATE the exported JSON into another language.
 *
 * Reuses the exact same JSON-shape contract as `buildInstructionsBlock`
 * (don't add/remove keys, keep repeater counts, keep `{ label }` link
 * shape, preserve richtext tags, output only JSON) — so the translated
 * result passes `validateImportedJson` unchanged. The ONLY differences
 * from the content-fill block:
 *   1. The task is "translate every value into <target>", not "fill empties".
 *   2. It carries the translation guide instead of the copywriting guide.
 *   3. It explicitly tells the LLM NOT to translate brand names, URLs, or
 *      anything outside the JSON string values.
 */
export function buildTranslationInstructionsBlock(
  args: BuildTranslationInstructionsArgs,
): string {
  const target = args.targetLanguageLabel.trim();
  const source = args.sourceLanguageLabel?.trim();
  const company = args.companyName?.trim();
  const guide = args.translationGuide?.trim() || DEFAULT_TRANSLATION_GUIDE;

  const parts: string[] = [
    "You are a professional translator for a web agency.",
    "",
    source
      ? `Your task is to TRANSLATE the content of the JSON below from "${source}" into "${target}".`
      : `Your task is to TRANSLATE the content of the JSON below into "${target}".`,
  ];

  if (company) {
    parts.push(
      "",
      "## Company name (DO NOT TRANSLATE)",
      `${company} — keep the company and brand name exactly as it is. Do not translate it.`,
    );
  }

  parts.push("", "## Translation rules", "", guide);

  parts.push(
    "",
    "## What to translate and what not to",
    "",
    "- Translate ONLY the text values in the JSON (headings, paragraphs, descriptions, button labels).",
    "- Do NOT translate keys (field names), URLs, emails, phone numbers, or HTML tags.",
    "- For fields shaped like `{ \"label\": \"...\" }`, translate only the text in `label` and keep the structure.",
    "- For richtext fields (they contain HTML tags like `<p>`), keep the tags and translate only the text inside.",
    "- For fields ending in `_alt` (image descriptions), translate the description into the target language.",
    "",
    "## Output format (CRITICAL)",
    "",
    "Return ONLY the same JSON below, with translated values. Rules:",
    "",
    "1. Do NOT add or remove any keys. The structure must stay identical (including the `__seo`, `__nav`, `__footer` sections).",
    "2. Do NOT add or remove items in arrays (repeaters). The count must stay the same.",
    "3. No comments, no markdown fences (```), no explanations. Only clean JSON from { to }.",
    "",
    "## JSON to translate",
    "",
    "",
  );

  return parts.join("\n");
}

export function buildInstructionsBlock(args: BuildInstructionsArgs): string {
  const company = args.companyName.trim() || "(not specified)";
  const industry = args.industry?.trim();
  const town = args.town?.trim();
  const services = (args.services ?? []).filter((s) => s.title.trim().length > 0);
  const guide = args.copywritingGuide?.trim();
  const page = args.pageContext;
  // For subpage round-trips we lead with which page is being filled so
  // the tech-admin (and ChatGPT) can't confuse "the JSON I just copied"
  // with another page's JSON. Home round-trips skip this entirely —
  // there's only one home, no ambiguity to resolve.
  const isSubpageRoundtrip =
    page !== undefined && page.kind !== "home";

  const parts: string[] = [
    "You are a professional English copywriter for a web agency.",
  ];

  if (isSubpageRoundtrip && page) {
    // Page identification + focus — placed first so ChatGPT reads it
    // before any other context. Without this, the LLM treats subpage
    // copy as "more home page content" and the brand voice drifts.
    parts.push(
      "",
      "## The page you are filling right now",
      "",
      `This is a standalone subpage: **${page.pageLabel}** (URL: \`/${page.pagePath.replace(/\.html$/, "")}\`).`,
    );
    if (page.kind === "service_subpage" && page.linkedServiceTitle) {
      parts.push(
        "",
        `This entire subpage is dedicated to ONE specific service: **${page.linkedServiceTitle}**.`,
        "All the copy on the subpage must speak exclusively about this service — do not generalize to the company's other services. Avoid phrases like \"everything we do\" or \"our services include…\" — this page is only about this one solution.",
      );
    } else {
      parts.push(
        "",
        "This is a custom subpage (not tied to a specific service from the home page). Keep the content tightly focused on the topic of this subpage.",
      );
    }
    // Word count targets (Peter 2026-05-30) — ideal 1500 / max 1800
    // for a service subpage. Sections subpage-01 (hero) and the closing
    // pieces (subpage-10, subpage-09) are short; the meat is in
    // subpage-02 (intro, ~150–200 words) and subpage-03 (the 7
    // topical_blocks items @ 200–250 words each).
    parts.push(
      "",
      "## Text length (important)",
      "",
      "- Total word count for the subpage: ideally 1500 words, maximum 1800.",
      "- The section with the `topical_blocks` repeater (typically 7 items): each item 200 to 250 words. This is the core of the subpage.",
      "- The intro / description section (typically the second section): 150 to 200 words.",
      "- Hero (first section): a short headline + 1 subheadline, 30 to 50 words combined.",
      "- Closing sections (CTA / summary): short, up to 100 words combined.",
      "- Be specific — facts, numbers, processes, benefits. No marketing fluff.",
    );
    if (page.homeReferenceMarkdown) {
      parts.push(
        "",
        "## Context from the home page (READ-ONLY)",
        "",
        "Below is the already-filled content of the home page. It is FOR REFERENCE ONLY — do not add it to the JSON, do not echo it in your reply. Use it to:",
        "- keep the same tone and brand as the home page,",
        "- refer to the company consistently (same naming, same style),",
        "- avoid inventing services or benefits the company does not offer.",
        "",
        page.homeReferenceMarkdown,
      );
    }
  }

  parts.push("", "## Company", company);

  if (industry) {
    parts.push("", "## Industry", industry);
  }

  if (town) {
    parts.push("", "## Town / region", town);
  }

  if (services.length > 0) {
    parts.push("", "## Services the company provides");
    for (const s of services) {
      const title = s.title.trim();
      const desc = s.description?.trim();
      parts.push(desc ? `- ${title} — ${desc}` : `- ${title}`);
    }
  }

  parts.push(
    "",
    "Write in English, in a natural professional tone. Use the information above as your basis. If a field in the JSON is empty, fill it in. If a field already has meaningful content, keep it (or gently improve it if that helps).",
  );

  if (guide) {
    parts.push("", "## Copywriting rules", "", guide);
  }

  // SEO meta rules ONLY apply on the home round-trip — subpage JSON
  // doesn't carry the __seo block (we drop it in buildExportSnapshot
  // for subpages). Suppressing the SEO rules block on subpages keeps
  // the prompt focused on body content + word-count targets.
  if (!isSubpageRoundtrip) {
    parts.push(
      "",
      "## SEO meta tags (the `__seo` section in the JSON)",
      "",
      "The JSON contains a special `__seo` section with two fields: `title` and `description`. These are the meta tags for Google and social networks. Rules:",
      "",
      "- `title`: 50–60 characters. Start with the company name or the main service. If relevant, mention the town. Example: \"PVC Windows London | XYZ Ltd.\"",
      "- `description`: 150–160 characters. One sentence about what the company does, for whom, and where. No clickbait, no emoji, no exclamation marks. Write for a person searching for the service, not for an algorithm.",
      "- Use the town and industry from the context above, if available.",
      "",
    );
  } else {
    parts.push("");
  }
  parts.push(
    "## Alt text for images (fields ending in `_alt`)",
    "",
    "For every field whose name ends in `_alt` (for example `image_alt`, `nav_logo_alt`, `service_image_alt`):",
    "",
    "- This is a text description of the image for visually impaired visitors (screen readers) and for Google Images.",
    "- Write a SHORT description (5–15 words) of what should be VISIBLE in the image — the subject, the action, the setting.",
    "- DO NOT copy the service name or the section heading. Describe the VISUAL, not the topic.",
    "- Use context (industry, town, service names in surrounding fields) to guess what will be in the photo.",
    "- Examples:",
    "  - For a \"Excavation work\" service → \"Excavator doing groundwork on a construction site\"",
    "  - For a \"Haircuts\" service → \"Close-up of a haircut in a salon\"",
    "  - For a kitchen gallery → \"Modern kitchen with an island and white cabinets\"",
    "- No marketing phrases, exclamation marks, or CTAs. Just a plain image description.",
    "- IF THE FIELD IS ALREADY FILLED (not empty) → keep exactly the same value. Do not fill it again.",
    "- IF THE FIELD IS EMPTY (\"\") → fill it according to the rules above.",
    "",
    "## Output format (CRITICAL)",
    "",
    "Return ONLY the same JSON below, with the values filled in. Rules:",
    "",
    "1. Do NOT add or remove any keys. The structure must stay identical (including the `__seo` section).",
    "2. Do NOT add or remove items in arrays (repeaters). The count must stay the same.",
    "3. For fields shaped like `{ \"label\": \"...\" }` (buttons / links), fill only the label, keep the structure.",
    "4. For richtext fields (they typically contain HTML tags like `<p>`), keep the tags and change only the text inside.",
    "5. No comments, no markdown fences (```), no explanations. Only clean JSON from { to }.",
    "",
    "## JSON to fill in",
    "",
    "",
  );

  return parts.join("\n");
}
