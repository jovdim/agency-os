import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data } = await s
    .from("sites")
    .select("id, name, composition")
    .not("last_published_at", "is", null);
  let count = 0;
  for (const site of data ?? []) {
    const comp = site.composition as {
      pages?: Array<{
        sections?: Array<{
          template_id?: string;
          content_overrides?: Record<string, unknown>;
        }>;
      }>;
    } | null;
    if (!comp?.pages) continue;
    for (const page of comp.pages) {
      for (const sec of page.sections ?? []) {
        const ov = sec.content_overrides;
        if (ov && (ov.footer_ico || ov.footer_dic)) {
          count++;
          console.log(
            site.name,
            "| ico:",
            ov.footer_ico,
            "| dic:",
            ov.footer_dic,
          );
        }
      }
    }
  }
  console.log(
    "\ntotal live sites with footer_ico OR footer_dic content:",
    count,
  );
}
main();
