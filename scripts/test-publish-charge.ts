/**
 * Non-destructive smoke test for platform_publish_charge (migration 00082).
 * Calls it with a non-existent site id, which trips the SITE_NOT_PAID gate —
 * proving the function is installed and the paid-gate fires, WITHOUT charging
 * any real balance.
 *
 *   npx tsx scripts/test-publish-charge.ts
 *
 * Apply supabase/migrations/00082_platform_publish_charge.sql first.
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

  // Nil UUID — no such site, so the is_paid gate raises SITE_NOT_PAID.
  const { data, error } = await sb.rpc("platform_publish_charge", {
    p_site_id: "00000000-0000-0000-0000-000000000000",
    p_user_id: null,
    p_publish_cost: 12.5,
  });

  if (error && /SITE_NOT_PAID/.test(error.message)) {
    console.log("✅ platform_publish_charge installed; paid-gate fires (SITE_NOT_PAID).");
    return;
  }
  if (error && /could not find the function/i.test(error.message)) {
    console.error("❌ Function missing — apply migration 00082 in Supabase first.");
    process.exit(1);
  }
  if (error) {
    console.error(`❌ Unexpected error: ${error.message}`);
    process.exit(1);
  }
  console.error(
    `❌ Expected SITE_NOT_PAID for a non-existent site, but it returned: ${JSON.stringify(data)}`,
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
