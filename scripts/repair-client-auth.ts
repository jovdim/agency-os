/**
 * One-off repair: heal a client-zone auth account whose profile row went
 * missing (migrate path used profiles.update(), which no-ops when the
 * signup trigger didn't insert). Missing profile → idempotency checks
 * failed → password kept getting reset → "login works once then Invalid
 * credentials". Code is now fixed; this repairs the already-broken row.
 *
 * What it does, idempotently, for the given client email:
 *   1. Finds the single auth user for the email (errors if 0 or >1).
 *   2. Upserts a profiles row (role=client, is_active=true).
 *   3. Sets a fresh, known password on the auth user.
 *   4. Mirrors that password onto the linked proposal + site rows so the
 *      timeline / Live-Clients panels display the value that actually works.
 *
 * Run: npx tsx scripts/repair-client-auth.ts info@pilimestromy.sk [password]
 *   - password optional; if omitted a fresh 6-digit one is generated.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const email = (process.argv[2] || "").trim().toLowerCase();
const explicitPw = (process.argv[3] || "").trim();
if (!email) {
  console.error("Usage: npx tsx scripts/repair-client-auth.ts <email> [password]");
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

function genPw(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function main() {
  // 1. Resolve the auth user (must be exactly one).
  const found: { id: string; email: string }[] = [];
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) {
      if (u.email?.toLowerCase() === email) found.push({ id: u.id, email: u.email });
    }
    if (users.length < 1000) break;
    page += 1;
  }
  if (found.length === 0) throw new Error(`No auth user for ${email}`);
  if (found.length > 1) {
    throw new Error(
      `Multiple auth users (${found.length}) for ${email} — manual dedupe needed first.`,
    );
  }
  const authUserId = found[0].id;
  console.log(`auth user: ${authUserId}`);

  // 2. Ensure a profile row exists with role=client. `profiles` has NO
  //    email column and full_name is NOT NULL, so: update first (cheap, no
  //    NOT-NULL issue when the row exists), and only insert (with a
  //    full_name) when there's genuinely no row.
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("id", authUserId)
    .maybeSingle();
  if (existingProfile) {
    const { error: updErr } = await admin
      .from("profiles")
      .update({ role: "client", is_active: true })
      .eq("id", authUserId);
    if (updErr) throw new Error(`profiles update: ${updErr.message}`);
    console.log("profile updated (role=client, is_active=true)");
  } else {
    const { error: insErr } = await admin.from("profiles").insert({
      id: authUserId,
      role: "client",
      full_name: email,
      is_active: true,
    });
    if (insErr) throw new Error(`profiles insert: ${insErr.message}`);
    console.log("profile inserted (role=client, is_active=true)");
  }

  // 3. Set a known password.
  const password = explicitPw || genPw();
  const { error: pwErr } = await admin.auth.admin.updateUserById(authUserId, {
    password,
  });
  if (pwErr) throw new Error(`set password: ${pwErr.message}`);
  console.log(`password set: ${password}`);

  // 4. Mirror onto proposal + site so the panels show the working value.
  const { data: sites } = await admin
    .from("sites")
    .select("id, proposal_id")
    .eq("owner_id", authUserId);
  for (const s of sites ?? []) {
    await admin.from("sites").update({ client_temp_password: password }).eq("id", s.id);
    if (s.proposal_id) {
      await admin
        .from("proposals")
        .update({ client_temp_password: password, client_user_id: authUserId })
        .eq("id", s.proposal_id);
    }
    console.log(`mirrored onto site ${s.id}${s.proposal_id ? ` + proposal ${s.proposal_id}` : ""}`);
  }

  console.log(`\n✅ REPAIRED. Login: ${email} / ${password}`);
}

main().catch((e) => { console.error("REPAIR FAILED:", e.message ?? e); process.exit(1); });
