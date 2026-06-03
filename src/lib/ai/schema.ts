import { z } from "zod";

/**
 * Dynamic Zod schema builder for AI responses.
 *
 * The composer's AI feature needs a different output shape every time ,
 * one site has a hero + 3 services + 5 FAQ, the next has a hero +
 * 6 services + a gallery + a CTA. We build the Zod schema on the fly
 * from the actual fields we want filled, then hand it to the provider
 * adapter to validate before any value lands in composition state.
 *
 * This module knows nothing about Gemini/Claude , only about the
 * abstract "what shape should this JSON be" question.
 */

/**
 * One field we want the AI to fill. Comes from walking the section's
 * placeholder_schema and keeping the entries that make sense for an
 * AI to write (text/longtext/richtext/link.label) and skipping the
 * ones it shouldn't touch (image, color, map, contact phone, etc.).
 */
export type FillFieldSpec =
  | { kind: "text"; key: string }
  | { kind: "longtext"; key: string }
  | { kind: "richtext"; key: string }
  | { kind: "link_label"; key: string }
  | {
      kind: "repeater";
      key: string;
      itemCount: number;
      itemFields: Array<
        | { kind: "text"; key: string }
        | { kind: "longtext"; key: string }
        | { kind: "richtext"; key: string }
        | { kind: "link_label"; key: string }
      >;
    };

/**
 * One section the AI is generating content for. The endpoint builds
 * a list of these, one per eligible section, then assembles a Zod
 * shape that the AI must return.
 */
export interface SectionFillSpec {
  /** Section composition id, used as the JSON key in the response. */
  sectionId: string;
  /** For prompt readability , "hero", "services", "faq", etc. */
  category: string;
  fields: FillFieldSpec[];
}

/**
 * Build a Zod object schema matching the requested fields. The
 * resulting schema validates that the AI returned exactly the
 * sections + field keys we asked for, with the right primitive
 * types. Extra keys are stripped (z.object default), missing keys
 * fail validation , we want the loud failure rather than a silent
 * "AI forgot half the site."
 */
export function buildResponseSchema(specs: SectionFillSpec[]): z.ZodTypeAny {
  const sectionShape: Record<string, z.ZodTypeAny> = {};
  for (const spec of specs) {
    sectionShape[spec.sectionId] = buildSectionShape(spec.fields);
  }
  return z.object(sectionShape);
}

function buildSectionShape(fields: FillFieldSpec[]): z.ZodTypeAny {
  const fieldShape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    fieldShape[f.key] = buildFieldShape(f);
  }
  return z.object(fieldShape);
}

function buildFieldShape(f: FillFieldSpec): z.ZodTypeAny {
  switch (f.kind) {
    case "text":
    case "longtext":
    case "richtext":
      // All three are plain strings on the wire; the difference is in
      // length expectation, which we communicate via the prompt rather
      // than a Zod refinement (richtext can be ~2 lines or 20 lines ,
      // hard to lower-bound).
      return z.string().min(1, "AI returned empty string");
    case "link_label":
      // Link fields are { label, href } in composition state. AI only
      // writes label; href stays whatever the template defaulted to.
      return z.object({ label: z.string().min(1) });
    case "repeater": {
      const itemShape: Record<string, z.ZodTypeAny> = {};
      for (const sub of f.itemFields) {
        itemShape[sub.key] = buildFieldShape(sub);
      }
      // Length is enforced server-side in the prompt + a soft check
      // here: AI must return AT LEAST one item. We'll trim to
      // f.itemCount on the consumer side rather than failing if they
      // returned more.
      return z.array(z.object(itemShape)).min(1);
    }
  }
}
