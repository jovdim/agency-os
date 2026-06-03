/**
 * End-to-end publish test for the English clone.
 * Builds a minimal English site (shared nav + footer, body = hero +
 * services + contact, all using DEFAULT template content) and calls
 * publishSite() to deploy it to Cloudflare pages.dev. Prints the live URL.
 * Self-locating (cwd-independent). Run via node_modules/.bin/tsx.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Load .env.local into process.env BEFORE importing app code (which reads env).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const ADMIN_USER_ID = "8aea2f94-5dc7-4998-9141-2609594645d3";

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});

async function main() {
  const { publishSite } = await import("../src/lib/templates/publish");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // 1. Resolve template IDs by name
  const names = ["nav-01", "hero-01", "services-01", "contact-01", "footer-01"];
  const { data: tplRows, error: tErr } = await admin
    .from("section_templates")
    .select("id, name")
    .in("name", names);
  if (tErr) throw new Error("template lookup: " + tErr.message);
  const tpl: Record<string, string> = {};
  for (const r of tplRows ?? []) tpl[(r as { name: string }).name] = (r as { id: string }).id;
  const missing = names.filter((n) => !tpl[n]);
  if (missing.length) throw new Error("missing templates: " + missing.join(", "));
  console.log("resolved templates:", names.join(", "));

  // 2. Build composition — nav/footer shared, body = hero+services+contact
  let order = 0;
  const sec = (name: string, overrides: Record<string, unknown> = {}) => ({
    id: `sec_${order}_${crypto.randomBytes(3).toString("hex")}`,
    order: order++,
    template_id: tpl[name],
    content_overrides: overrides,
  });
  const composition = {
    pages: [
      {
        path: "index.html",
        label: "Home",
        sections: [
          sec("hero-01"),
          sec("services-01"),
          sec("contact-01", { form_recipient_email: "demo@example.com" }),
        ],
      },
    ],
    shared: {
      nav_template_id: tpl["nav-01"],
      footer_template_id: tpl["footer-01"],
    },
  };

  // 3. Create the site
  const slug = "en-demo-" + crypto.randomBytes(2).toString("hex");
  const { data: siteRow, error: sErr } = await admin
    .from("sites")
    .insert({
      owner_id: ADMIN_USER_ID,
      name: "English Demo",
      slug,
      composition,
      is_legacy: false,
      is_paid: true,
    })
    .select("id")
    .single();
  if (sErr) throw new Error("site insert: " + sErr.message);
  const siteId = (siteRow as { id: string }).id;
  console.log("created site:", siteId, "| slug:", slug);

  // 4. Publish (renders English templates -> uploads to Cloudflare pages.dev)
  console.log("publishing to Cloudflare pages.dev ...");
  const result = await publishSite(siteId, ADMIN_USER_ID, "tech_publish");
  console.log("\n=== PUBLISH RESULT ===");
  console.log(JSON.stringify(result, null, 2));
}
