/**
 * Audit every client login: does the password we DISPLAY (proposal /
 * site mirror) actually work against Supabase Auth? Surfaces accounts
 * left in the "drifted" state by the pre-2026-05-30 reset-on-publish bug.
 *
 * Read-only except for the sign-in attempts (which create no data).
 * Run: npx tsx scripts/audit-client-logins.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const env: Record<string, string> = {};
for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function tryLogin(email: string, pw: string): Promise<boolean> {
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await anon.auth.signInWithPassword({ email, password: pw });
  return !error;
}

async function main() {
  // Every site that has been provisioned to a client owner, with its
  // proposal + contact. We anchor on sites because that's where ownership
  // (and therefore "is this a live client login") actually lives.
  const { data: sites } = await admin
    .from("sites")
    .select(
      "id, name, subdomain, owner_id, client_temp_password, proposal_id, last_published_at",
    )
    .not("owner_id", "is", null);

  if (!sites?.length) {
    console.log("No sites with an owner found.");
    return;
  }

  type Row = {
    company: string;
    email: string | null;
    proposalPw: string | null;
    sitePw: string | null;
    profileRole: string | null;
    status: "OK" | "DRIFTED" | "NO_PASSWORD" | "NO_EMAIL" | "NOT_CLIENT";
    detail: string;
  };
  const rows: Row[] = [];

  for (const s of sites) {
    // Owner must be a client profile to count as a client login.
    const { data: prof } = await admin
      .from("profiles")
      .select("id, role")
      .eq("id", s.owner_id)
      .maybeSingle();

    // Pull proposal + contact email (the login email).
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

    const base: Omit<Row, "status" | "detail"> = {
      company: s.name ?? s.subdomain ?? s.id,
      email,
      proposalPw,
      sitePw: s.client_temp_password ?? null,
      profileRole: prof?.role ?? null,
    };

    if (prof?.role !== "client") {
      rows.push({ ...base, status: "NOT_CLIENT", detail: "owner is not a client profile (not yet handed over)" });
      continue;
    }
    if (!email) {
      rows.push({ ...base, status: "NO_EMAIL", detail: "no contact email on proposal" });
      continue;
    }
    const candidate = proposalPw ?? s.client_temp_password;
    if (!candidate) {
      rows.push({ ...base, status: "NO_PASSWORD", detail: "no stored password to test" });
      continue;
    }

    const ok = await tryLogin(email, candidate);
    if (ok) {
      rows.push({ ...base, status: "OK", detail: "displayed password logs in" });
    } else {
      // Displayed one failed — try the other mirror before declaring drift.
      const other = candidate === proposalPw ? s.client_temp_password : proposalPw;
      const otherOk = other && other !== candidate ? await tryLogin(email, other) : false;
      rows.push({
        ...base,
        status: "DRIFTED",
        detail: otherOk
          ? `displayed pw fails, but the OTHER mirror (${other}) works → mirrors out of sync`
          : "neither stored password works → needs regenerate",
      });
    }
  }

  const order = { DRIFTED: 0, NO_PASSWORD: 1, NO_EMAIL: 2, OK: 3, NOT_CLIENT: 4 } as const;
  rows.sort((a, b) => order[a.status] - order[b.status]);

  console.log(`\n=== CLIENT LOGIN AUDIT (${rows.length} owned sites) ===\n`);
  for (const r of rows) {
    const tag = r.status.padEnd(11);
    console.log(`[${tag}] ${r.company}`);
    console.log(`             email=${r.email ?? "—"}  proposalPw=${r.proposalPw ?? "—"}  sitePw=${r.sitePw ?? "—"}`);
    console.log(`             ${r.detail}`);
  }

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log("\n=== SUMMARY ===");
  console.log(counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
