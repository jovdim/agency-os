import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
import { htmlToPlainText } from "../src/lib/templates/sanitize";
import { withBrandContact } from "../src/lib/templates/brand-contact";

async function main() {
  const contactTemplateIds = new Set([
    "0b5a9d4e-c128-4b06-8052-f5188a876aef",
    "a3b435ce-5538-4717-86cb-befb095d8c1e",
    "001522ce-debe-42db-976b-e68f6e51e589",
    "dc31c0d1-ba04-42a2-9f8a-82b30289afa7",
  ]);
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: sites } = await s.from("sites").select("id, name, composition").not("composition", "is", null);
  const { data: tpls } = await s.from("section_templates").select("id, placeholder_schema").in("id", Array.from(contactTemplateIds));
  const schemaById = new Map<string, any>();
  for (const t of tpls ?? []) schemaById.set(t.id, t.placeholder_schema);

  for (const site of sites ?? []) {
    const comp = site.composition as any;
    for (const page of comp?.pages ?? []) {
      for (const sec of page.sections ?? []) {
        if (!contactTemplateIds.has(sec.template_id)) continue;
        const schema = schemaById.get(sec.template_id);
        if (!schema?.form_recipient_email || !schema?.form_enabled) continue;
        const rawOv = sec.content_overrides ?? {};
        const ov = withBrandContact(rawOv, schema, comp?.brand);
        const emailRaw = typeof ov.form_recipient_email === "string" ? ov.form_recipient_email : (schema.form_recipient_email.default ?? "");
        const enabledRaw = typeof ov.form_enabled === "string" ? ov.form_enabled : (schema.form_enabled.default ?? "false");
        const email = htmlToPlainText(emailRaw);
        const enabled = enabledRaw.trim().toLowerCase() === "true";
        const broken = enabled && !email;
        if (broken) {
          console.log("STILL BROKEN:", site.name, "tpl:", sec.template_id);
          console.log("  raw ov.email:", JSON.stringify(rawOv.form_recipient_email));
          console.log("  brand.email :", comp?.brand?.email);
          console.log("  resolved    :", JSON.stringify(emailRaw), "→ plain:", JSON.stringify(email));
        } else {
          console.log("OK:", site.name, "→ recipient:", email);
        }
      }
    }
  }
}
main();
