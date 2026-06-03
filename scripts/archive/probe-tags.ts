/**
 * Diagnostic: simulate what GET /api/proposal-tags would return for a
 * specific user, so you can tell exactly why the "delete tag" affordance
 * isn't showing up.
 *
 * Run with:
 *   npx tsx scripts/probe-tags.ts                 # list tags + creators
 *   npx tsx scripts/probe-tags.ts <user_email>    # show can_delete for that user
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const PROTECTED_SLUGS = new Set(["urgent", "priority", "basic", "premium"]);

async function listAllUsers() {
  // auth.admin.listUsers is the only way to read auth.users via service key.
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw new Error(`listUsers: ${error.message}`);
  return data.users;
}

async function main() {
  const wantedEmail = process.argv[2]?.trim().toLowerCase() ?? null;

  const { data: tags, error: tagsErr } = await supabase
    .from("proposal_tags")
    .select("id, name, slug, color, created_by, created_at")
    .order("created_at", { ascending: true });

  if (tagsErr) {
    console.error("Failed to fetch tags:", tagsErr.message);
    process.exit(1);
  }

  const users = await listAllUsers();
  const userByEmail = new Map(
    users.map(u => [u.email?.toLowerCase() ?? "", u]),
  );
  const userById = new Map(users.map(u => [u.id, u]));

  const { data: assignments } = await supabase
    .from("proposal_tag_assignments")
    .select("tag_id");
  const usageByTag = new Map<string, number>();
  for (const a of assignments ?? []) {
    usageByTag.set(a.tag_id, (usageByTag.get(a.tag_id) ?? 0) + 1);
  }

  if (!wantedEmail) {
    console.log("\n=== TAG LIBRARY ===\n");
    console.log(
      "name".padEnd(20),
      "slug".padEnd(18),
      "uses".padStart(5),
      "creator (email · role)",
    );
    console.log("-".repeat(110));

    for (const t of tags ?? []) {
      const protectedTag = PROTECTED_SLUGS.has(t.slug);
      const creator = t.created_by ? userById.get(t.created_by as string) : null;
      const uses = usageByTag.get(t.id) ?? 0;
      const creatorDisplay = protectedTag
        ? "(seeded — no creator)"
        : creator
          ? `${creator.email ?? "(no email)"} · ${(creator.app_metadata as { role?: string })?.role ?? "?"}`
          : "(null)";

      console.log(
        (t.name as string).slice(0, 19).padEnd(20),
        (t.slug as string).slice(0, 17).padEnd(18),
        String(uses).padStart(5),
        creatorDisplay,
      );
    }

    console.log("\n=== USERS ===\n");
    console.log("email".padEnd(40), "role".padEnd(15), "id");
    console.log("-".repeat(110));
    for (const u of users) {
      const role = (u.app_metadata as { role?: string })?.role ?? "?";
      console.log((u.email ?? "(no email)").padEnd(40), role.padEnd(15), u.id);
    }

    console.log(
      "\nTo simulate the can_delete logic for a specific user, run:" +
        "\n  npx tsx scripts/probe-tags.ts <email>\n",
    );
    return;
  }

  const user = userByEmail.get(wantedEmail);
  if (!user) {
    console.error(`No user found with email "${wantedEmail}"`);
    process.exit(1);
  }

  const role = (user.app_metadata as { role?: string })?.role ?? "";
  const isSuperAdmin = role === "super_admin";

  console.log(`\n=== Simulating GET /api/proposal-tags as ${user.email} ===`);
  console.log(`   user.id        : ${user.id}`);
  console.log(`   role           : ${role}`);
  console.log(`   is super_admin : ${isSuperAdmin}\n`);

  console.log(
    "name".padEnd(20),
    "slug".padEnd(18),
    "can_delete?".padEnd(12),
    "why",
  );
  console.log("-".repeat(110));

  for (const t of tags ?? []) {
    const protectedTag = PROTECTED_SLUGS.has(t.slug);
    const isCreator = t.created_by === user.id;
    const canDelete = !protectedTag && (isSuperAdmin || isCreator);

    let why: string;
    if (protectedTag) {
      why = "protected tier slug";
    } else if (canDelete) {
      why = isSuperAdmin ? "super_admin" : "you created it";
    } else {
      why = `not the creator (created_by=${t.created_by?.slice(0, 8) ?? "null"}…)`;
    }

    console.log(
      (t.name as string).slice(0, 19).padEnd(20),
      (t.slug as string).slice(0, 17).padEnd(18),
      (canDelete ? "✓ YES" : "✗ no").padEnd(12),
      why,
    );
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
