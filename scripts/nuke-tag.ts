/**
 * Nuke a single tag from proposal_tags by id, bypassing auth checks.
 *
 * Run with:
 *   npx tsx scripts/nuke-tag.ts <tag_id>
 *   npx tsx scripts/nuke-tag.ts 7a60ced6-cb1e-4db0-a91a-9a1f7326022c
 *
 * Cascade via the join-table FK removes any proposal_tag_assignments
 * automatically. Use this for stuck tags whose creator no longer matches
 * any logged-in user and the UI can't authorize the delete.
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

const tagId = process.argv[2]?.trim();
if (!tagId) {
  console.error("Usage: npx tsx scripts/nuke-tag.ts <tag_id>");
  process.exit(1);
}

async function main() {
  const { data: tag, error: lookupErr } = await supabase
    .from("proposal_tags")
    .select("id, name, slug, created_by")
    .eq("id", tagId)
    .maybeSingle();

  if (lookupErr) {
    console.error("Lookup failed:", lookupErr.message);
    process.exit(1);
  }
  if (!tag) {
    console.log(`No tag with id "${tagId}" — already gone or wrong id.`);
    return;
  }

  console.log("Tag found:", tag);

  const { count } = await supabase
    .from("proposal_tag_assignments")
    .select("*", { count: "exact", head: true })
    .eq("tag_id", tag.id);
  console.log(`Attached to ${count ?? 0} proposal(s) — will cascade.`);

  const { error: delErr } = await supabase
    .from("proposal_tags")
    .delete()
    .eq("id", tag.id);
  if (delErr) {
    console.error("Delete failed:", delErr.message);
    process.exit(1);
  }
  console.log(`✓ Deleted tag "${tag.name}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
