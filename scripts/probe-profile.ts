import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const id = (process.argv[2] || "").trim();
if (!id) { console.error("Usage: probe-profile.ts <authUserId>"); process.exit(1); }

const env: Record<string, string> = {};
for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const star = await admin.from("profiles").select("*").eq("id", id).maybeSingle();
  console.log("=== profiles SELECT * for id ===");
  console.log("error:", star.error?.message ?? "none");
  console.log("data:", JSON.stringify(star.data, null, 2));

  const roleOnly = await admin.from("profiles").select("id, role").eq("id", id).maybeSingle();
  console.log("\n=== profiles SELECT id,role for id ===");
  console.log("error:", roleOnly.error?.message ?? "none");
  console.log("data:", JSON.stringify(roleOnly.data, null, 2));

  const emailSel = await admin.from("profiles").select("id, email").eq("id", id).maybeSingle();
  console.log("\n=== profiles SELECT id,email for id ===");
  console.log("error:", emailSel.error?.message ?? "none");
  console.log("data:", JSON.stringify(emailSel.data, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
