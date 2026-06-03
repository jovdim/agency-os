import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const contactTemplateIds = new Set([
    "0b5a9d4e-c128-4b06-8052-f5188a876aef", // contact-01
    "a3b435ce-5538-4717-86cb-befb095d8c1e", // contact-02
    "001522ce-debe-42db-976b-e68f6e51e589", // contact-06
    "dc31c0d1-ba04-42a2-9f8a-82b30289afa7", // contact-04
  ]);
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await s.from("sites").select("id, name, composition").not("composition", "is", null);
  for (const site of data ?? []) {
    const comp = site.composition as any;
    for (const page of comp?.pages ?? []) {
      for (const sec of page.sections ?? []) {
        if (!contactTemplateIds.has(sec.template_id)) continue;
        const ov = sec.content_overrides ?? {};
        const recip = ov.form_recipient_email;
        const enabled = ov.form_enabled;
        console.log("site:", site.name);
        console.log("  template_id         :", sec.template_id);
        console.log("  form_recipient_email:", JSON.stringify(recip));
        console.log("  form_enabled        :", JSON.stringify(enabled));
        console.log("  brand.email         :", JSON.stringify(comp?.brand?.email));
        console.log();
      }
    }
  }
}
main();
