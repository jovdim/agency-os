/**
 * One-shot scrub: strip TipTap's `<p>…</p>` wrapper from existing
 * content_overrides on every site, ONLY for fields whose schema type
 * is `text` or `longtext`. Richtext fields stay untouched (legitimate
 * paragraph structure). Repeater item sub-fields walked one level
 * deep with the same rule.
 *
 * Why this exists: after `fix(composer): unwrap TipTap <p> at save
 * time` (commit 5bfbb52), all NEW writes store clean values. Sites
 * already saved before that fix still carry wrapped values; the
 * render-path unwrap handles them at display time, so nothing is
 * broken — this script just heals the at-rest data once.
 *
 * Safety:
 *   - Dry-run by default. Pass `--commit` to actually write.
 *   - Per-site atomic UPDATE — never half-commits.
 *   - Idempotent — unwrapTipTapWrap returns input unchanged when the
 *     value isn't a clean p-wrapped sequence (already cleaned values
 *     pass through). Re-running is a no-op.
 *   - Reads schema BEFORE unwrapping. Only `text` / `longtext` fields
 *     are touched. Richtext is left alone because the render-path
 *     div-gate keeps its multi-<p> structure intact — turning that
 *     into <br>-joined runs would change visible spacing.
 *
 * Usage:
 *   npx tsx scripts/scrub-tiptap-wraps.ts            # dry-run
 *   npx tsx scripts/scrub-tiptap-wraps.ts --commit   # actually write
 *
 * Limited to top-level fields + shared nav/footer + repeater items.
 * `__seo` virtual section / SEO panel are stored separately
 * (composition.seo) and don't go through TipTap, so excluded here.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
import { unwrapTipTapWrap } from "../src/lib/templates/sanitize";

type FieldSchema = {
  type?: string;
  item_schema?: Record<string, FieldSchema>;
};
type Schema = Record<string, FieldSchema>;

const COMMIT = process.argv.includes("--commit");

async function main() {
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Load every template's schema once (a few dozen rows).
  const { data: templates } = await s
    .from("section_templates")
    .select("id, placeholder_schema");
  const schemaById = new Map<string, Schema>();
  for (const t of templates ?? []) {
    schemaById.set(t.id, (t.placeholder_schema as Schema) ?? {});
  }

  const { data: sites } = await s
    .from("sites")
    .select("id, name, composition")
    .not("composition", "is", null);

  let touchedSites = 0;
  let touchedFields = 0;
  let touchedRepeaterFields = 0;

  for (const site of sites ?? []) {
    const comp = site.composition as {
      pages?: Array<{
        label?: string;
        sections?: Array<{
          id?: string;
          template_id?: string;
          content_overrides?: Record<string, unknown>;
        }>;
      }>;
      shared?: {
        nav_template_id?: string;
        nav_overrides?: Record<string, unknown>;
        footer_template_id?: string;
        footer_overrides?: Record<string, unknown>;
      };
    };
    if (!comp) continue;

    let siteChanged = false;
    const changes: string[] = [];

    const scrubOverrides = (
      schema: Schema,
      overrides: Record<string, unknown>,
      label: string,
    ) => {
      for (const [key, value] of Object.entries(overrides)) {
        const field = schema[key];
        if (!field) continue;
        if (field.type === "text" || field.type === "longtext") {
          if (typeof value !== "string") continue;
          const next = unwrapTipTapWrap(value);
          if (next !== value) {
            overrides[key] = next;
            siteChanged = true;
            touchedFields++;
            changes.push(
              `  ${label} · ${key}\n      before: ${JSON.stringify(value).slice(0, 80)}\n      after : ${JSON.stringify(next).slice(0, 80)}`,
            );
          }
        } else if (field.type === "repeater" && Array.isArray(value)) {
          const itemSchema = field.item_schema ?? {};
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (!item || typeof item !== "object" || Array.isArray(item)) continue;
            const itemObj = item as Record<string, unknown>;
            for (const [subKey, subVal] of Object.entries(itemObj)) {
              const subField = itemSchema[subKey];
              if (!subField) continue;
              if (subField.type !== "text" && subField.type !== "longtext") continue;
              if (typeof subVal !== "string") continue;
              const next = unwrapTipTapWrap(subVal);
              if (next !== subVal) {
                itemObj[subKey] = next;
                siteChanged = true;
                touchedRepeaterFields++;
                changes.push(
                  `  ${label} · ${key}[${i}].${subKey}\n      before: ${JSON.stringify(subVal).slice(0, 80)}\n      after : ${JSON.stringify(next).slice(0, 80)}`,
                );
              }
            }
          }
        }
      }
    };

    for (const page of comp.pages ?? []) {
      for (const sec of page.sections ?? []) {
        if (!sec.template_id || !sec.content_overrides) continue;
        const schema = schemaById.get(sec.template_id);
        if (!schema) continue;
        scrubOverrides(
          schema,
          sec.content_overrides,
          `${page.label ?? "?"} · ${sec.template_id.slice(0, 8)}`,
        );
      }
    }

    if (comp.shared?.nav_template_id && comp.shared.nav_overrides) {
      const schema = schemaById.get(comp.shared.nav_template_id);
      if (schema) scrubOverrides(schema, comp.shared.nav_overrides, "shared.nav");
    }
    if (comp.shared?.footer_template_id && comp.shared.footer_overrides) {
      const schema = schemaById.get(comp.shared.footer_template_id);
      if (schema) scrubOverrides(schema, comp.shared.footer_overrides, "shared.footer");
    }

    if (siteChanged) {
      touchedSites++;
      console.log(`\n── ${site.name} (${site.id}) ──`);
      for (const c of changes) console.log(c);
      if (COMMIT) {
        const { error } = await s
          .from("sites")
          .update({ composition: comp })
          .eq("id", site.id);
        if (error) {
          console.error("  ✗ UPDATE FAILED:", error.message);
        } else {
          console.log("  ✓ saved");
        }
      }
    }
  }

  console.log(
    `\n${COMMIT ? "[COMMITTED]" : "[DRY-RUN]"} sites changed: ${touchedSites}, top-level fields: ${touchedFields}, repeater sub-fields: ${touchedRepeaterFields}`,
  );
  if (!COMMIT && touchedSites > 0) {
    console.log("\nRe-run with --commit to apply.");
  }
}

main();
