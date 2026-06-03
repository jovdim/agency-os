/**
 * Builds the AI prompt + the matching Zod schema from a composition.
 *
 * Two responsibilities:
 *   1. Walk the composition's sections, decide which fields are
 *      eligible for AI filling, and produce a `SectionFillSpec[]`
 *      that the schema builder turns into a Zod shape.
 *   2. Assemble the system prompt (cacheable copywriting guide +
 *      output rules) and the user prompt (company info + JSON
 *      shape the model must return).
 *
 * Field eligibility rules:
 *   - text / longtext / richtext / link → AI fills (link.label only)
 *   - image / color / map → skipped (separate flows handle these)
 *   - contact_*, phone, email, address → SKIPPED. The endpoint
 *     auto-fills these from proposal.contacts directly so AI never
 *     hallucinates a fake number.
 *
 * Smart-regenerate rule (mode=all):
 *   - If a field's current value is non-empty AND differs from the
 *     template's default placeholder, it has been edited (by user
 *     or previous AI run). Skip it. AI only fills truly empty
 *     fields on the global generate. The per-section sparklesbutton is
 *     the explicit "overwrite this section" path , mode=section
 *     bypasses the smart-skip.
 */

import type { SiteComposition, CompositionSection } from "@/lib/templates/render";
import type { FieldSchema, FieldValue } from "@/components/composer/placeholder-field";
import type { FillFieldSpec, SectionFillSpec } from "./schema";

/* ─────────────────────────────────────────────────────────────
   Inputs the tech reviews in the modal
   ───────────────────────────────────────────────────────────── */

export interface AiInputs {
  companyName: string;
  industry: string;
  town: string;
  /**
   * Services as { title, description } pairs. Sales-typed list, tech
   * may have edited in the modal. Title is required, description is
   * a one-line hint to the AI for context.
   */
  services: Array<{ title: string; description?: string }>;
}

/* ─────────────────────────────────────────────────────────────
   Section/template metadata the builder needs
   ───────────────────────────────────────────────────────────── */

export interface TemplateMeta {
  id: string;
  category: string;
  /** placeholder_schema as stored in section_templates DB row. */
  schema: Record<string, FieldSchema>;
}

/* ─────────────────────────────────────────────────────────────
   Configuration knobs
   ───────────────────────────────────────────────────────────── */

/**
 * Default item counts for repeaters when the section is using the
 * default count. Specific numbers Peter chose 2026-05-09:
 *   - faq_items → 5
 *   - services_items → match the user-provided services count (caller
 *     overrides), or 3 if none provided
 *   - everything else → match whatever's in composition currently
 */
const DEFAULT_REPEATER_COUNTS: Record<string, number> = {
  faq_items: 5,
};

/* ─────────────────────────────────────────────────────────────
   Public entry point
   ───────────────────────────────────────────────────────────── */

export interface PromptBuildArgs {
  copywritingGuide: string;
  composition: SiteComposition;
  templates: Map<string, TemplateMeta>;
  inputs: AiInputs;
  mode: "all" | "section";
  /** Required when mode="section". Composition section id. */
  sectionId?: string;
  /** Optional free-form user instruction (per-section regenerate UI). */
  customPrompt?: string;
}

export interface PromptBuildResult {
  systemPrompt: string;
  userPrompt: string;
  /** SectionFillSpec[] used to build the Zod schema in the endpoint. */
  specs: SectionFillSpec[];
}

export function buildPrompt(args: PromptBuildArgs): PromptBuildResult {
  const specs = collectFillSpecs(args);
  const systemPrompt = buildSystemPrompt(args.copywritingGuide);
  const userPrompt = buildUserPrompt({
    inputs: args.inputs,
    specs,
    customPrompt: args.customPrompt,
  });
  return { systemPrompt, userPrompt, specs };
}

/* ─────────────────────────────────────────────────────────────
   Spec collection , what fields does AI need to fill?
   ───────────────────────────────────────────────────────────── */

function collectFillSpecs(args: PromptBuildArgs): SectionFillSpec[] {
  const sections = args.composition.pages[0]?.sections ?? [];

  // mode=section: just one section (the one the sparklesbutton targeted),
  // overwriting all of its fields regardless of edited state.
  if (args.mode === "section") {
    if (!args.sectionId) {
      throw new Error("sectionId required when mode=section");
    }
    const sec = sections.find((s) => s.id === args.sectionId);
    if (!sec) {
      throw new Error(`section ${args.sectionId} not found in composition`);
    }
    const tpl = args.templates.get(sec.template_id);
    if (!tpl) {
      throw new Error(`template ${sec.template_id} not loaded`);
    }
    const fields = collectSectionFields(sec, tpl, {
      smartSkipEdited: false,
      services: args.inputs.services,
    });
    if (fields.length === 0) {
      throw new Error(
        `section ${sec.id} has no AI-eligible fields , nothing to generate`,
      );
    }
    return [{ sectionId: sec.id, category: tpl.category, fields }];
  }

  // mode=all: walk every body section, plus the shared nav/footer.
  // Smart-skip , only fill fields that are still on the template's
  // default placeholder (i.e. untouched).
  const out: SectionFillSpec[] = [];
  for (const sec of sections) {
    const tpl = args.templates.get(sec.template_id);
    if (!tpl) continue;
    const fields = collectSectionFields(sec, tpl, {
      smartSkipEdited: true,
      services: args.inputs.services,
    });
    if (fields.length > 0) {
      out.push({ sectionId: sec.id, category: tpl.category, fields });
    }
  }
  return out;
}

function collectSectionFields(
  section: CompositionSection,
  tpl: TemplateMeta,
  opts: {
    smartSkipEdited: boolean;
    services: AiInputs["services"];
  },
): FillFieldSpec[] {
  const overrides = section.content_overrides ?? {};
  const out: FillFieldSpec[] = [];

  for (const [key, field] of Object.entries(tpl.schema)) {
    if (isContactField(key)) continue;

    if (field.type === "repeater") {
      const itemFields = collectRepeaterItemFields(field);
      if (itemFields.length === 0) continue;
      const itemCount = computeRepeaterItemCount(key, field, overrides, opts);
      if (itemCount <= 0) continue;
      out.push({ kind: "repeater", key, itemCount, itemFields });
      continue;
    }

    const kind = mapFieldKindForFill(field.type);
    if (!kind) continue; // image, map, etc.
    if (kind === "repeater") continue; // top-level handled above; can't reach here

    if (opts.smartSkipEdited && isFieldEdited(overrides[key], field)) continue;

    // kind is now narrowed to the non-repeater union , matches FillFieldSpec.
    out.push({ kind, key } as FillFieldSpec);
  }

  return out;
}

/**
 * Repeater item fields , narrower type than FillFieldSpec because we
 * deliberately disallow nested repeaters. Returning the narrower type
 * lets the schema builder enforce the no-nested-repeater rule via the
 * type system rather than a runtime check.
 */
type RepeaterItemFieldSpec =
  | { kind: "text"; key: string }
  | { kind: "longtext"; key: string }
  | { kind: "richtext"; key: string }
  | { kind: "link_label"; key: string };

function collectRepeaterItemFields(
  field: FieldSchema,
): RepeaterItemFieldSpec[] {
  const itemSchema = field.item_schema ?? {};
  const out: RepeaterItemFieldSpec[] = [];
  for (const [key, sub] of Object.entries(itemSchema)) {
    if (isContactField(key)) continue;
    const kind = mapFieldKindForFill(sub.type);
    if (!kind || kind === "repeater") continue; // no nested repeaters
    out.push({ kind, key });
  }
  return out;
}

function computeRepeaterItemCount(
  key: string,
  field: FieldSchema,
  overrides: Record<string, FieldValue>,
  opts: { services: AiInputs["services"] },
): number {
  // Special-case: services_items is one item per user-provided service.
  // Falls back to current count if the user didn't list any services.
  if (key === "services_items" && opts.services.length > 0) {
    return opts.services.length;
  }

  // Specific defaults configured at the top of the file.
  if (DEFAULT_REPEATER_COUNTS[key] !== undefined) {
    return DEFAULT_REPEATER_COUNTS[key];
  }

  // Otherwise, match whatever's currently in composition. If empty,
  // fall back to the template's example item count (read from the
  // schema's `default` value if it's an array).
  const current = overrides[key];
  if (Array.isArray(current) && current.length > 0) return current.length;
  const dflt = field.default;
  if (Array.isArray(dflt) && dflt.length > 0) return dflt.length;
  return 3; // sensible floor
}

function mapFieldKindForFill(
  type: FieldSchema["type"],
): "text" | "longtext" | "richtext" | "link_label" | "repeater" | null {
  switch (type) {
    case "text":
      return "text";
    case "longtext":
      return "longtext";
    case "richtext":
      return "richtext";
    case "link":
      return "link_label";
    case "repeater":
      return "repeater";
    case "image":
    case "video":
    case "map":
      // image: AI doesn't generate URLs.
      // video: same — no model in our stack creates video files.
      // map: address comes from contact data, not AI.
      return null;
    default:
      return null;
  }
}

/**
 * Fields whose names look like contact data , phone numbers, emails,
 * physical addresses. The endpoint fills these from proposal.contacts
 * directly so AI never invents a fake phone number.
 */
function isContactField(key: string): boolean {
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

/**
 * Has the user/AI already filled this field? Compare against the
 * template's default placeholder. If the override is missing OR
 * matches the default, treat as "still empty , fill me." Anything
 * else is preserved.
 *
 * link fields: compare label only , href is structural and
 * always set by the template, never AI-generated.
 */
function isFieldEdited(value: FieldValue | undefined, field: FieldSchema): boolean {
  if (value === undefined || value === null) return false;
  if (field.type === "link") {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const label = (value as { label?: unknown }).label;
      const dflt = field.default;
      const dfltLabel =
        typeof dflt === "object" && dflt !== null && !Array.isArray(dflt)
          ? (dflt as { label?: unknown }).label
          : undefined;
      return typeof label === "string" && label !== "" && label !== dfltLabel;
    }
    return false;
  }
  if (typeof value === "string") {
    if (value.trim() === "") return false;
    const dflt = field.default;
    return typeof dflt !== "string" || value !== dflt;
  }
  return false;
}

/* ─────────────────────────────────────────────────────────────
   System prompt , VERBATIM from the editable copywriting guide.
   No appendix, no internal rules. Whatever Peter (or any super
   admin) writes at /tech/settings/ai is what the AI sees as its
   system prompt , full transparency, full control.

   The only thing the code adds to the AI's input is dynamic data
   in the user prompt below (company info + JSON schema shape).
   Format/length rules live in the guide where the user can edit
   them.
   ───────────────────────────────────────────────────────────── */

function buildSystemPrompt(copywritingGuide: string): string {
  return copywritingGuide.trim();
}

/* ─────────────────────────────────────────────────────────────
   User prompt , company info + JSON shape
   ───────────────────────────────────────────────────────────── */

function buildUserPrompt(args: {
  inputs: AiInputs;
  specs: SectionFillSpec[];
  customPrompt?: string;
}): string {
  const { inputs, specs, customPrompt } = args;

  const servicesBlock =
    inputs.services.length > 0
      ? inputs.services
          .map((s, i) => {
            const desc = s.description?.trim();
            return `${i + 1}. ${s.title}${desc ? ` , ${desc}` : ""}`;
          })
          .join("\n")
      : "(none provided , invent plausible services for the industry)";

  const customBlock = customPrompt?.trim()
    ? `\nADDITIONAL INSTRUCTION FROM THE USER:\n${customPrompt.trim()}\n`
    : "";

  const jsonShape = buildJsonShapeDescription(specs);

  // Pure data-only user prompt , no rules, no style guidance, no
  // length caps. The system prompt (copywriting guide) is where
  // ALL rules live. This message just supplies:
  //   1. Company facts
  //   2. The exact JSON shape to fill
  //   3. (optional) the user's free-form custom instruction for
  //      per-section regen
  return `Company:
- Name: ${inputs.companyName}
- Industry: ${inputs.industry}
- Town: ${inputs.town}

Services:
${servicesBlock}
${customBlock}
Fill this JSON shape with English content (return only the JSON object):

${jsonShape}`;
}

/**
 * Pretty-prints the expected JSON shape with field-type hints inline,
 * so the AI knows how long each value should be. Example output:
 *
 *   {
 *     "sec_001": {
 *       "hero_headline": "<text, 5-9 words>",
 *       "hero_subheadline": "<longtext, 12-20 words>",
 *       "hero_cta": { "label": "<link label, 2-4 words>" },
 *       "services_items": [
 *         { "title": "<text>", "description": "<longtext, 8-15 words>" }
 *         × 4 items
 *       ]
 *     }
 *   }
 */
function buildJsonShapeDescription(specs: SectionFillSpec[]): string {
  const lines: string[] = ["{"];
  specs.forEach((spec, i) => {
    lines.push(`  "${spec.sectionId}": {  // category: ${spec.category}`);
    spec.fields.forEach((f, j) => {
      const isLast = j === spec.fields.length - 1;
      lines.push(`    ${describeField(f)}${isLast ? "" : ","}`);
    });
    lines.push(`  }${i === specs.length - 1 ? "" : ","}`);
  });
  lines.push("}");
  return lines.join("\n");
}

function describeField(f: FillFieldSpec): string {
  // Neutral type hints only , NO length rules, NO style guidance.
  // All "how long, how detailed, what tone" lives in the
  // copywriting guide (system prompt) where the user controls it.
  // This function only tells the AI what JSON shape to return.
  switch (f.kind) {
    case "text":
      // Single-line plain string.
      return `"${f.key}": "<short text>"`;
    case "longtext":
      // Multi-sentence plain string.
      return `"${f.key}": "<longer text, multiple sentences>"`;
    case "richtext":
      // HTML-allowed string (paragraphs, bold, lists, links).
      return `"${f.key}": "<HTML allowed: <p>, <strong>, <em>, <a>, <ul>, <li>>"`;
    case "link_label":
      return `"${f.key}": { "label": "<button or link text>" }`;
    case "repeater": {
      const inner = f.itemFields.map(describeField).join(", ");
      return `"${f.key}": [ { ${inner} } × ${f.itemCount} items ]`;
    }
  }
}
