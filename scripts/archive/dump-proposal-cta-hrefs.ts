/**
 * Walk recent proposals' composition.pages[].sections[].content_overrides
 * and dump every link-field href value, so we can see what's actually
 * being saved in the DB for CTA buttons.
 *
 * Goal: find out why CTAs on the live site show href="#" — is the DB
 * literally storing `#` for those links?
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Get sites linked to recent proposals so we can read the composition
  const { data: sites } = await supabase
    .from("sites")
    .select("id, name, proposal_id, composition, created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  for (const s of sites ?? []) {
    console.log("\n" + "━".repeat(72));
    console.log(`site ${s.id}  name:${s.name}`);
    const comp = s.composition as
      | {
          pages?: Array<{
            sections?: Array<{
              id?: string;
              template_id?: string;
              content_overrides?: Record<string, unknown>;
            }>;
          }>;
        }
      | null;
    if (!comp?.pages) {
      console.log("  (no pages)");
      continue;
    }
    for (const page of comp.pages) {
      for (const sec of page.sections ?? []) {
        const overrides = sec.content_overrides ?? {};
        for (const [k, v] of Object.entries(overrides)) {
          // Look for link-shaped values (object with href)
          if (
            typeof v === "object" &&
            v !== null &&
            !Array.isArray(v) &&
            "href" in (v as Record<string, unknown>)
          ) {
            const link = v as { label?: string; href?: string };
            console.log(
              `  section ${sec.id}  field=${k}  href="${link.href}"  label="${link.label}"`,
            );
          }
        }
      }
    }
  }
}
main();
