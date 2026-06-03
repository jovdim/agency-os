/**
 * Heal client logins stuck on "Email not confirmed". Older account-creation
 * code created some client auth users without email_confirm, so they have
 * email_confirmed_at = NULL and CANNOT log in regardless of password
 * (Supabase rejects with "Email not confirmed" even when the password is
 * correct). All current createUser paths set email_confirm:true, so this is
 * a one-time backfill for the already-broken rows.
 *
 * For every auth user that owns a client-role site and is unconfirmed:
 *   1. mark the email confirmed (admin.updateUserById email_confirm:true)
 *   2. re-verify login with the password stored on the proposal/site mirror
 *
 * Idempotent + read-mostly: already-confirmed users are skipped.
 * Run: npx tsx scripts/confirm-client-emails.ts [--dry]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry");

const env: Record<string, string> = {};
for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function tryLogin(email: string, pw: string): Promise<string | null> {
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await anon.auth.signInWithPassword({ email, password: pw });
  return error ? error.message : null;
}

async function main() {
  // Collect distinct client-owned auth user ids + a login password to test.
  const { data: sites } = await admin
    .from("sites")
    .select("owner_id, client_temp_password, proposal_id, name, subdomain")
    .not("owner_id", "is", null);

  const owners = new Map<string, { name: string; pw: string | null; email: string | null }>();
  for (const s of sites ?? []) {
    if (owners.has(s.owner_id)) continue;
    const { data: prof } = await admin
      .from("profiles")
      .select("role")
      .eq("id", s.owner_id)
      .maybeSingle();
    if (prof?.role !== "client") continue;

    let email: string | null = null;
    let pw: string | null = s.client_temp_password ?? null;
    if (s.proposal_id) {
      const { data: p } = await admin
        .from("proposals")
        .select("client_temp_password, contacts(email)")
        .eq("id", s.proposal_id)
        .maybeSingle();
      pw = pw ?? (p as { client_temp_password?: string | null })?.client_temp_password ?? null;
      const c = (p as { contacts?: { email?: string } | { email?: string }[] })?.contacts;
      email = Array.isArray(c) ? c[0]?.email ?? null : c?.email ?? null;
    }
    owners.set(s.owner_id, { name: s.name ?? s.subdomain ?? s.owner_id, pw, email });
  }

  // Walk auth users, confirm the unconfirmed ones in our owner set.
  const unconfirmed: { id: string; email: string; name: string; pw: string | null }[] = [];
  let page = 1;
  for (;;) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const users = data?.users ?? [];
    for (const u of users) {
      const o = owners.get(u.id);
      if (!o) continue;
      if (u.email_confirmed_at) continue; // already fine
      unconfirmed.push({ id: u.id, email: u.email ?? o.email ?? "", name: o.name, pw: o.pw });
    }
    if (users.length < 1000) break;
    page += 1;
  }

  console.log(`\n=== ${unconfirmed.length} unconfirmed client login(s) ${DRY ? "(DRY RUN)" : ""} ===\n`);
  for (const u of unconfirmed) {
    if (DRY) {
      console.log(`[would confirm] ${u.name} <${u.email}>`);
      continue;
    }
    const { error: confErr } = await admin.auth.admin.updateUserById(u.id, { email_confirm: true });
    if (confErr) {
      console.log(`[FAILED] ${u.name} <${u.email}>: ${confErr.message}`);
      continue;
    }
    let verdict = "no stored pw to verify";
    if (u.pw) {
      const err = await tryLogin(u.email, u.pw);
      verdict = err ? `still failing: ${err}` : `✅ verified with ${u.pw}`;
    }
    console.log(`[confirmed] ${u.name.padEnd(26)} <${u.email}>  ${verdict}`);
  }

  console.log(`\nDone. ${unconfirmed.length} account(s) processed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
