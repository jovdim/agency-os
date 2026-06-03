/**
 * Batch repair for the reset-on-publish bug fallout. Re-detects every
 * client login whose DISPLAYED password no longer works against Supabase
 * Auth (the "DRIFTED" state), then heals each one exactly like
 * scripts/repair-client-auth.ts does for a single account:
 *   1. ensure profiles row (role=client, is_active=true)
 *   2. set a fresh known 6-digit password on the auth user
 *   3. mirror that password onto the linked site + proposal rows
 *
 * Re-detection is live (not a hardcoded list) so a row that someone
 * already healed by hand is skipped automatically. Idempotent: safe to
 * re-run. Prints a final credentials list to hand to clients.
 *
 * Run: npx tsx scripts/repair-drifted-clients.ts
 *   --dry   only report what WOULD be repaired, change nothing
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

function genPw(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function tryLogin(email: string, pw: string): Promise<boolean> {
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await anon.auth.signInWithPassword({ email, password: pw });
  return !error;
}

interface Target {
  company: string;
  email: string;
  ownerId: string;
  siteIds: string[];
  proposalIds: string[];
}

async function main() {
  const { data: sites } = await admin
    .from("sites")
    .select("id, name, subdomain, owner_id, client_temp_password, proposal_id")
    .not("owner_id", "is", null);
  if (!sites?.length) {
    console.log("No owned sites.");
    return;
  }

  // Group by owner so a client with multiple site rows is healed once.
  const byOwner = new Map<string, Target>();
  for (const s of sites) {
    let email: string | null = null;
    let proposalPw: string | null = null;
    if (s.proposal_id) {
      const { data: prop } = await admin
        .from("proposals")
        .select("client_temp_password, contacts(email)")
        .eq("id", s.proposal_id)
        .maybeSingle();
      proposalPw = (prop as { client_temp_password?: string | null })?.client_temp_password ?? null;
      const c = (prop as { contacts?: { email?: string } | { email?: string }[] })?.contacts;
      email = Array.isArray(c) ? c[0]?.email ?? null : c?.email ?? null;
    }

    const { data: prof } = await admin
      .from("profiles")
      .select("id, role")
      .eq("id", s.owner_id)
      .maybeSingle();
    if (prof?.role !== "client" || !email) continue; // only real client logins

    const candidate = proposalPw ?? s.client_temp_password;
    if (!candidate) continue; // NO_PASSWORD handled separately, not here

    // DRIFTED test: does ANY stored password work? If yes, it's fine — skip.
    const okPrimary = await tryLogin(email, candidate);
    let works = okPrimary;
    const other = candidate === proposalPw ? s.client_temp_password : proposalPw;
    if (!works && other && other !== candidate) {
      works = await tryLogin(email, other);
    }
    if (works) continue; // healthy

    // Drifted — queue for repair.
    const key = s.owner_id;
    const existing = byOwner.get(key);
    if (existing) {
      existing.siteIds.push(s.id);
      if (s.proposal_id) existing.proposalIds.push(s.proposal_id);
    } else {
      byOwner.set(key, {
        company: s.name ?? s.subdomain ?? s.id,
        email,
        ownerId: s.owner_id,
        siteIds: [s.id],
        proposalIds: s.proposal_id ? [s.proposal_id] : [],
      });
    }
  }

  const targets = [...byOwner.values()];
  console.log(`\n=== ${targets.length} DRIFTED client login(s) to repair ${DRY ? "(DRY RUN)" : ""} ===\n`);

  const results: { company: string; email: string; password: string; status: string }[] = [];

  for (const t of targets) {
    if (DRY) {
      console.log(`[would repair] ${t.company} <${t.email}>  (${t.siteIds.length} site row(s))`);
      results.push({ company: t.company, email: t.email, password: "(dry)", status: "WOULD_REPAIR" });
      continue;
    }
    try {
      // 1. ensure profile role=client (already true here, but keep is_active).
      await admin.from("profiles").update({ role: "client", is_active: true }).eq("id", t.ownerId);

      // 2. fresh password.
      const password = genPw();
      const { error: pwErr } = await admin.auth.admin.updateUserById(t.ownerId, { password });
      if (pwErr) throw new Error(`set password: ${pwErr.message}`);

      // 3. mirror onto every site + proposal for this owner.
      for (const siteId of t.siteIds) {
        await admin.from("sites").update({ client_temp_password: password }).eq("id", siteId);
      }
      for (const proposalId of t.proposalIds) {
        await admin
          .from("proposals")
          .update({ client_temp_password: password, client_user_id: t.ownerId })
          .eq("id", proposalId);
      }

      // verify
      const ok = await tryLogin(t.email, password);
      console.log(`[repaired] ${t.company} <${t.email}> -> ${password}  ${ok ? "✅ verified" : "⚠️ login still failing"}`);
      results.push({ company: t.company, email: t.email, password, status: ok ? "OK" : "VERIFY_FAILED" });
    } catch (e) {
      console.log(`[FAILED]   ${t.company} <${t.email}>: ${(e as Error).message}`);
      results.push({ company: t.company, email: t.email, password: "—", status: "ERROR" });
    }
  }

  if (!DRY) {
    console.log("\n=== NEW CREDENTIALS (send to clients) ===");
    for (const r of results) {
      console.log(`${r.company.padEnd(28)} ${r.email.padEnd(38)} ${r.password}   [${r.status}]`);
    }
  }
  console.log(`\nDone. ${results.length} processed.`);
}

main().catch((e) => {
  console.error("BATCH REPAIR FAILED:", e);
  process.exit(1);
});
