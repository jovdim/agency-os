import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: row } = await admin
    .from("section_templates")
    .select("id, name, version, updated_at")
    .eq("category", "hero")
    .eq("name", "hero-05")
    .single();
  console.log("DB row:", JSON.stringify(row, null, 2));
  const { data: cssBlob } = await admin.storage
    .from("section-templates")
    .download("hero/hero-05.css");
  const css = await cssBlob!.text();
  console.log("CSS length:", css.length);
  console.log(
    "CSS has 'align-items: flex-end'?",
    css.includes("align-items: flex-end"),
  );
  console.log("CSS has 'clamp(640px'?", css.includes("clamp(640px"));
  console.log(
    "CSS has 'min-height: 75vh' (old)?",
    css.includes("min-height: 75vh"),
  );
  console.log(
    "CSS has 'min-height: 100vh' (very old)?",
    css.includes("min-height: 100vh"),
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
