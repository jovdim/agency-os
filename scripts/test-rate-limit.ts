/**
 * Shared rate-limiter smoke test. Proves migration 00081's rate_limit_touch
 * RPC blocks after the cap, against the real (shared) Postgres — so the
 * protection actually holds across serverless instances.
 *
 *   npx tsx scripts/test-rate-limit.ts
 *
 * Apply supabase/migrations/00081_rate_limits.sql first (Supabase SQL editor).
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Unique key so reruns don't collide. Small window + cap to test fast.
  const key = `__test-rl:${Date.now()}`;
  const windowSeconds = 60;
  const max = 5;

  let firstBlockedAt = -1;
  for (let i = 1; i <= 8; i++) {
    const { data, error } = await sb.rpc("rate_limit_touch", {
      p_key: key,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (error) {
      console.error(
        `RPC error on attempt ${i}: ${error.message}\n` +
          "Has migration 00081_rate_limits.sql been applied in Supabase?",
      );
      process.exit(1);
    }
    const row = Array.isArray(data) ? data[0] : data;
    const blocked = Boolean(row?.blocked);
    console.log(
      `attempt ${i}: count=${row?.current_count} blocked=${blocked}`,
    );
    if (blocked && firstBlockedAt < 0) firstBlockedAt = i;
  }

  // Expectation: allowed for the first `max`, blocked from attempt max+1 on.
  const expected = max + 1;
  if (firstBlockedAt === expected) {
    console.log(
      `\n✅ Shared rate limiter works: ${max} allowed, blocked from attempt ${firstBlockedAt}.`,
    );
  } else {
    console.error(
      `\n❌ Unexpected: first blocked at attempt ${firstBlockedAt}, expected ${expected}.`,
    );
    await sb.from("rate_limit_hits").delete().eq("bucket", key);
    process.exit(1);
  }

  // Clean up the test rows.
  await sb.from("rate_limit_hits").delete().eq("bucket", key);
  console.log("   (test rows cleaned up)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
