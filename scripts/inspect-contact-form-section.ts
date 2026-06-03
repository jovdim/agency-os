/**
 * Look up a composition section by its id (the UUID shown in publish-
 * error messages) and dump what's stored for form_recipient_email +
 * form_enabled — both override + schema default + resolved value.
 *
 * Usage: npx tsx scripts/inspect-contact-form-section.ts <section-id>
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const sectionId = process.argv[2];
  if (!sectionId) {
    console.error("usage: <section-id>");
    process.exit(1);
  }
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: sites } = await s
    .from("sites")
    .select("id, name, composition")
    .not("composition", "is", null);

  for (const site of sites ?? []) {
    const comp = site.composition as {
      pages?: Array<{
        label?: string;
        path?: string;
        sections?: Array<{
          id?: string;
          template_id?: string;
          content_overrides?: Record<string, unknown>;
        }>;
      }>;
    };
    for (const page of comp?.pages ?? []) {
      for (const sec of page.sections ?? []) {
        if (sec.id !== sectionId) continue;
        console.log("FOUND in site:", site.name, "(", site.id, ")");
        console.log("page:", page.label, page.path);
        console.log("template_id:", sec.template_id);
        const ov = sec.content_overrides ?? {};
        console.log("\n── overrides ──");
        console.log("form_recipient_email:", JSON.stringify(ov.form_recipient_email));
        console.log("form_enabled        :", JSON.stringify(ov.form_enabled));
        // Pull template schema
        const { data: tpl } = await s
          .from("templates")
          .select("placeholder_schema")
          .eq("id", sec.template_id)
          .maybeSingle();
        const schema = tpl?.placeholder_schema as Record<
          string,
          { type?: string; default?: string }
        > | null;
        console.log("\n── schema (relevant) ──");
        console.log(
          "form_recipient_email:",
          schema?.form_recipient_email
            ? {
                type: schema.form_recipient_email.type,
                default: schema.form_recipient_email.default,
              }
            : "(absent)",
        );
        console.log(
          "form_enabled        :",
          schema?.form_enabled
            ? {
                type: schema.form_enabled.type,
                default: schema.form_enabled.default,
              }
            : "(absent)",
        );
        // Resolved values like the validator does
        const emailRaw =
          typeof ov.form_recipient_email === "string"
            ? ov.form_recipient_email
            : (schema?.form_recipient_email?.default ?? "");
        const enabledRaw =
          typeof ov.form_enabled === "string"
            ? (ov.form_enabled as string)
            : (schema?.form_enabled?.default ?? "false");
        const enabled = enabledRaw.trim().toLowerCase() === "true";
        const email = emailRaw.trim();
        console.log("\n── resolved (validator's view) ──");
        console.log("emailRaw            :", JSON.stringify(emailRaw));
        console.log("email (trimmed)     :", JSON.stringify(email));
        console.log("email.length        :", email.length);
        console.log("enabled             :", enabled);
        console.log("validator verdict   :", enabled && !email ? "FAIL (broken)" : "ok");
        return;
      }
    }
  }
  console.log("section not found in any composition");
}
main();
