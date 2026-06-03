import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data } = await admin
    .from("section_templates")
    .select("id, name, version, updated_at")
    .eq("category", "nav")
    .eq("name", "nav-07")
    .single();
  console.log("DB:", JSON.stringify(data, null, 2));
}
main();
