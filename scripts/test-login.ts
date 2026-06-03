/**
 * Definitive login test: actually call signInWithPassword with the ANON
 * key (exactly what the browser login form does). Prints success or the
 * real error. Also prints the profile row (via select * so the missing
 * `email` column doesn't null the query).
 *
 * Run: npx tsx scripts/test-login.ts info@pilimestromy.sk 169014
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const email = (process.argv[2] || "").trim();
const password = (process.argv[3] || "").trim();
if (!email || !password) {
  console.error("Usage: npx tsx scripts/test-login.ts <email> <password>");
  process.exit(1);
}

const env: Record<string, string> = {};
for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log(`Attempting signInWithPassword: ${email} / ${password}`);
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) {
    console.log(`\n❌ LOGIN FAILED: ${error.message} (status ${error.status})`);
  } else {
    console.log(`\n✅ LOGIN OK — user id ${data.user?.id}`);
    console.log(`   app_metadata.role: ${data.user?.app_metadata?.role}`);
    console.log(`   user_metadata.role: ${data.user?.user_metadata?.role}`);
  }

  // Profile via select * (avoids the missing-email-column trap).
  if (data?.user?.id || true) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const u = list?.users?.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    if (u) {
      const { data: prof, error: pErr } = await admin
        .from("profiles")
        .select("*")
        .eq("id", u.id)
        .maybeSingle();
      console.log(`\n=== profile (select *) — error: ${pErr?.message ?? "none"} ===`);
      console.log(prof ? JSON.stringify({ id: prof.id, role: prof.role, is_active: prof.is_active, full_name: prof.full_name }, null, 2) : "NULL (no profile row)");
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
