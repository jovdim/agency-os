/**
 * Quick verification that both composer storage buckets exist + are
 * reachable. Used by the smoke-test pass before shipping image/video
 * work — confirms migration 00062 (composer-video) actually applied.
 *
 *   npx tsx scripts/check-buckets.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

(async () => {
  for (const bucket of ["composer-staging", "composer-video"] as const) {
    const { error } = await sb.storage.from(bucket).list("", { limit: 1 });
    if (error) {
      console.log(`✗ ${bucket}: ${error.message}`);
    } else {
      console.log(`✓ ${bucket}: exists and reachable`);
    }
  }
})();
