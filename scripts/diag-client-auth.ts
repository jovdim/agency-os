/**
 * One-off diagnostic: inspect the auth + ownership state for a client
 * email. Surfaces the "login works once then fails" class of bugs —
 * duplicate auth users, owner mismatch, stale temp password.
 *
 * Run: npx tsx scripts/diag-client-auth.ts info@pilimestromy.sk
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const target = (process.argv[2] || "").trim().toLowerCase();
if (!target) {
  console.error("Usage: npx tsx scripts/diag-client-auth.ts <email>");
  process.exit(1);
}

const env: Record<string, string> = {};
for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  // 1. ALL auth users matching this email (paginate to be safe).
  const matches: Array<{
    id: string;
    email?: string;
    confirmed: boolean;
    created_at?: string;
    last_sign_in_at?: string | null;
    providers: string[];
  }> = [];
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error("listUsers error:", error.message); break; }
    const users = data?.users ?? [];
    for (const u of users) {
      if (u.email?.toLowerCase() === target) {
        matches.push({
          id: u.id,
          email: u.email,
          confirmed: !!u.email_confirmed_at,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          providers: (u.app_metadata?.providers as string[]) ?? [u.app_metadata?.provider as string].filter(Boolean),
        });
      }
    }
    if (users.length < 1000) break;
    page += 1;
  }

  console.log(`\n=== AUTH USERS for ${target}: ${matches.length} found ===`);
  for (const m of matches) {
    console.log(JSON.stringify(m, null, 2));
  }
  if (matches.length > 1) {
    console.log("\n⚠️  DUPLICATE AUTH USERS — this is the bug. signInWithPassword");
    console.log("   resolves the email to ONE of them non-deterministically, so a");
    console.log("   password set on user A works only until a login lands on user B.");
  }

  // 2. profiles rows for those ids + any profile with this email.
  const ids = matches.map((m) => m.id);
  const { data: profById } = await admin
    .from("profiles")
    .select("id, email, role, is_active, username, full_name, company_name")
    .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const { data: profByEmail } = await admin
    .from("profiles")
    .select("id, email, role, is_active, username, full_name, company_name")
    .ilike("email", target);

  console.log(`\n=== PROFILES by auth id (${profById?.length ?? 0}) ===`);
  console.log(JSON.stringify(profById, null, 2));
  console.log(`\n=== PROFILES by email (${profByEmail?.length ?? 0}) ===`);
  console.log(JSON.stringify(profByEmail, null, 2));

  // 3. proposals + sites referencing this client.
  const { data: props } = await admin
    .from("proposals")
    .select("id, company_name, status, client_user_id, client_temp_password, is_migrated, contact_id")
    .or(ids.length ? ids.map((id) => `client_user_id.eq.${id}`).join(",") : "id.eq.00000000-0000-0000-0000-000000000000");
  console.log(`\n=== PROPOSALS linked to these auth ids (${props?.length ?? 0}) ===`);
  console.log(JSON.stringify(props, null, 2));

  const { data: sites } = await admin
    .from("sites")
    .select("id, name, subdomain, owner_id, proposal_id, last_published_at, client_temp_password")
    .in("owner_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  console.log(`\n=== SITES owned by these auth ids (${sites?.length ?? 0}) ===`);
  console.log(JSON.stringify(sites, null, 2));

  console.log("\n=== SUMMARY ===");
  console.log(`auth users:     ${matches.length}`);
  console.log(`unconfirmed:    ${matches.filter((m) => !m.confirmed).length}`);
  console.log(`profiles(id):   ${profById?.length ?? 0}`);
  console.log(`profiles(email):${profByEmail?.length ?? 0}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
