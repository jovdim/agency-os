/**
 * One-shot: clear the edit lock on a single site so the composer page
 * stops loading / showing the locked-screen. Usage:
 *
 *   npx tsx scripts/reset-site-lock.ts <site-id>
 *
 * Reads current lock state first so you can see if/who was holding it
 * before clearing, then unconditionally nulls the four lock columns.
 * Safe to run when no lock is held (no-op).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const siteId = process.argv[2];
  if (!siteId) {
    console.error("usage: npx tsx scripts/reset-site-lock.ts <site-id>");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 1) Probe current lock state so we know what we're clearing.
  const { data: before, error: readErr } = await supabase
    .from("sites")
    .select(
      "id, name, locked_by_user_id, locked_by_role, lock_acquired_at, lock_heartbeat_at",
    )
    .eq("id", siteId)
    .maybeSingle();

  if (readErr) {
    console.error("read failed:", readErr.message);
    process.exit(1);
  }
  if (!before) {
    console.error("site not found:", siteId);
    process.exit(1);
  }

  console.log("BEFORE:");
  console.log("  site            :", before.name, `(${before.id})`);
  console.log("  locked_by_user  :", before.locked_by_user_id ?? "—");
  console.log("  locked_by_role  :", before.locked_by_role ?? "—");
  console.log("  acquired_at     :", before.lock_acquired_at ?? "—");
  console.log("  last_heartbeat  :", before.lock_heartbeat_at ?? "—");

  if (!before.locked_by_user_id) {
    console.log("\nNo active lock — nothing to clear. Loading is probably");
    console.log("from something else (composer fetch, etc.).");
    process.exit(0);
  }

  // 2) Clear all four lock columns.
  const { error: updErr } = await supabase
    .from("sites")
    .update({
      locked_by_user_id: null,
      locked_by_role: null,
      lock_acquired_at: null,
      lock_heartbeat_at: null,
    })
    .eq("id", siteId);

  if (updErr) {
    console.error("clear failed:", updErr.message);
    process.exit(1);
  }

  console.log("\n✓ Lock cleared. Reload the composer page in your browser.");
}

main();
