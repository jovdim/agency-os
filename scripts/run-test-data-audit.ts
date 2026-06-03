/**
 * Read-only audit for likely test data.
 * Mirrors scripts/audit-test-data.sql. Nothing is deleted.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const TEXT_RE =
  /\b(test|demo|asdf|qwer|foo|bar|lorem|ipsum|sample|dummy|fake|placeholder|xxx|aaa|zzz)\b/i;
const EMAIL_DOMAIN_RE = /@(test|example|demo|asdf|foo|localhost)\./i;
const EMAIL_LOCAL_RE = /^(test|demo|asdf|qwer|fake|dummy)[^@]*@/i;

const matchText = (s: string | null | undefined) => !!s && TEXT_RE.test(s);
const matchEmail = (s: string | null | undefined) =>
  !!s && (EMAIL_DOMAIN_RE.test(s) || EMAIL_LOCAL_RE.test(s));

function table(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  console.table(rows);
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // ── 1) Counts ─────────────────────────────────────────────────────────────
  const [contactsCnt, proposalsCnt, sitesCnt, clientCnt] = await Promise.all([
    sb.from("contacts").select("id", { count: "exact", head: true }),
    sb.from("proposals").select("id", { count: "exact", head: true }),
    sb.from("sites").select("id", { count: "exact", head: true }),
    sb.from("profiles").select("id", { count: "exact", head: true }).eq("role", "client"),
  ]);
  console.log("\n=== TOTAL COUNTS ===");
  console.table([
    {
      contacts: contactsCnt.count ?? "?",
      proposals: proposalsCnt.count ?? "?",
      sites: sitesCnt.count ?? "?",
      client_profiles: clientCnt.count ?? "?",
    },
  ]);

  // Auth email lookup (one batched listUsers — supabase admin paginates at 1000)
  const emailById = new Map<string, string>();
  let page = 1;
  while (true) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email) emailById.set(u.id, u.email);
    if (data.users.length < 1000) break;
    page += 1;
  }

  // ── 2) Suspect CONTACTS ───────────────────────────────────────────────────
  const { data: contacts } = await sb
    .from("contacts")
    .select(
      "id, company_name, contact_person, email, phone, industry, status, source, created_at",
    )
    .order("created_at", { ascending: false });
  const suspectContacts = (contacts || []).filter(
    (c) =>
      matchText(c.company_name) ||
      matchText(c.contact_person) ||
      matchEmail(c.email),
  );
  console.log(`\n=== SUSPECT CONTACTS (${suspectContacts.length}) ===`);
  table(suspectContacts);

  // ── 3) Suspect PROPOSALS ──────────────────────────────────────────────────
  const { data: proposals } = await sb
    .from("proposals")
    .select(
      "id, slug, company_name, status, price, created_at, contact_id, sales_person_id",
    )
    .order("created_at", { ascending: false });
  const contactById = new Map((contacts || []).map((c) => [c.id, c]));
  const suspectProposals = (proposals || [])
    .map((p) => {
      const c = p.contact_id ? contactById.get(p.contact_id) : undefined;
      return {
        ...p,
        contact_person: c?.contact_person ?? null,
        contact_email: c?.email ?? null,
      };
    })
    .filter(
      (p) =>
        matchText(p.company_name) ||
        (p.slug && /test|demo|asdf|qwer|fake|dummy/i.test(p.slug)) ||
        matchText(p.contact_person) ||
        matchEmail(p.contact_email),
    );
  console.log(`\n=== SUSPECT PROPOSALS (${suspectProposals.length}) ===`);
  table(
    suspectProposals.map(({ contact_id, sales_person_id, ...rest }) => rest),
  );

  // ── 4) Suspect SITES ──────────────────────────────────────────────────────
  const { data: sites } = await sb
    .from("sites")
    .select(
      "id, name, slug, site_url, domain, status, created_at, owner_id",
    )
    .order("created_at", { ascending: false });
  const { data: profiles } = await sb
    .from("profiles")
    .select("id, full_name, company_name, role, phone, is_active, created_at");
  const profileById = new Map((profiles || []).map((p) => [p.id, p]));
  const suspectSites = (sites || [])
    .map((s) => {
      const pr = profileById.get(s.owner_id);
      const email = emailById.get(s.owner_id) ?? null;
      return {
        ...s,
        owner_name: pr?.full_name ?? null,
        owner_company: pr?.company_name ?? null,
        owner_email: email,
      };
    })
    .filter(
      (s) =>
        matchText(s.name) ||
        (s.slug && /test|demo|asdf|qwer|fake|dummy|xxx|aaa|zzz/i.test(s.slug)) ||
        matchText(s.owner_company) ||
        matchEmail(s.owner_email),
    );
  console.log(`\n=== SUSPECT SITES (${suspectSites.length}) ===`);
  table(suspectSites.map(({ owner_id, ...rest }) => rest));

  // ── 5) Suspect CLIENT PROFILES ────────────────────────────────────────────
  const siteCountByOwner = new Map<string, number>();
  for (const s of sites || []) {
    siteCountByOwner.set(s.owner_id, (siteCountByOwner.get(s.owner_id) ?? 0) + 1);
  }
  const suspectClients = (profiles || [])
    .filter((p) => p.role === "client")
    .map((p) => {
      const email = emailById.get(p.id) ?? null;
      return {
        id: p.id,
        full_name: p.full_name,
        company_name: p.company_name,
        email,
        phone: p.phone,
        is_active: p.is_active,
        created_at: p.created_at,
        site_count: siteCountByOwner.get(p.id) ?? 0,
      };
    })
    .filter(
      (p) =>
        matchText(p.full_name) ||
        matchText(p.company_name) ||
        matchEmail(p.email),
    );
  console.log(`\n=== SUSPECT CLIENT PROFILES (${suspectClients.length}) ===`);
  table(suspectClients);

  console.log("\n(Done — read-only. Mark the IDs you want gone.)\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
