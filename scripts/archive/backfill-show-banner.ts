/**
 * One-time backfill: flip proposals.show_banner = true → false for
 * proposals that were NEVER sent to a client.
 *
 * Why: migration 00065 changed the COLUMN DEFAULT to FALSE but only
 * affects new inserts. Every proposal created before the migration
 * still has the old TRUE default leftover from when banners shipped
 * by default. Publishing those proposals would inject the banner
 * widget on a site where sales never went through the
 * BannerConfigDialog flow to set discount / base prices — the live
 * page would render the widget with empty / placeholder pricing.
 *
 * Criterion (Peter 2026-05-16):
 *   show_banner = true
 *   AND sent_at IS NULL
 *   AND status NOT IN ('sent', 'viewed', 'paid', 'archived')
 *
 * Anything that's been sent / viewed / paid is left alone — those
 * sites went through the proper BannerConfigDialog flow with real
 * prices and the banner SHOULD stay on.
 *
 * Usage:
 *   npx tsx scripts/backfill-show-banner.ts            # dry-run (default)
 *   npx tsx scripts/backfill-show-banner.ts --confirm  # actually flip
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const CONFIRM = process.argv.includes("--confirm");

// Statuses that mean "the proposal has moved past the build phase, so
// the banner config was a deliberate choice — DO NOT touch it." Only
// statuses BEFORE these get the backfill.
const PRE_SEND_STATUSES = ["draft", "submitted", "building", "review", "revision"];

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log(
    `\n${CONFIRM ? "🔴 BACKFILL MODE" : "🟢 DRY-RUN"} — flipping show_banner=true → false on never-sent proposals\n`,
  );

  // 1. Find affected rows
  const { data: candidates, error } = await supabase
    .from("proposals")
    .select(
      "id, company_name, status, show_banner, sent_at, created_at, discount_price, base_price",
    )
    .eq("show_banner", true)
    .is("sent_at", null)
    .in("status", PRE_SEND_STATUSES)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  if (!candidates || candidates.length === 0) {
    console.log("No rows match the criteria — nothing to do.\n");
    return;
  }

  console.log(`Found ${candidates.length} proposal(s) to flip:\n`);
  console.log(
    "  created_at                       status      | company                            disc/base",
  );
  for (const r of candidates) {
    console.log(
      `  ${r.created_at}  ${String(r.status).padEnd(10)}  ${String(r.company_name).padEnd(36)}  ${r.discount_price}/${r.base_price}`,
    );
  }

  if (!CONFIRM) {
    console.log(
      `\n(dry-run — nothing changed)\nRun with --confirm to actually flip these to show_banner=false.\n`,
    );
    return;
  }

  // 2. Flip. The Supabase JS update().select() builder doesn't accept
  // the `{count, head}` options the from().select() builder does, so
  // we drop the count call and rely on `candidates.length` (which we
  // already computed from the SELECT above — there's no race because
  // the filter would re-match the same rows).
  const ids = candidates.map((r) => r.id);
  const { error: updErr } = await supabase
    .from("proposals")
    .update({ show_banner: false })
    .in("id", ids);

  if (updErr) {
    console.error("\nUpdate failed:", updErr.message);
    process.exit(1);
  }

  console.log(`\n✓ Flipped ${candidates.length} rows to show_banner=false.\n`);
  console.log(
    "Note: existing PUBLISHED sites still have the banner script in their\n" +
      "live HTML on Cloudflare. They'll only stop injecting the banner on the\n" +
      "NEXT publish. If you need the banner off live RIGHT NOW for any of\n" +
      "these, open the proposal and click Publish to re-emit the HTML.\n",
  );
}

main();
