/**
 * Mint a per-site /admin session cookie for local testing (no browser login).
 *
 *   npx tsx scripts/mint-site-session.ts <slug|subdomain|id> <email>
 *
 * Prints `sk_site_session=<token>` — pass it to curl as `-b "<that>"`.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";
import {
  createSessionToken,
  SITE_SESSION_COOKIE,
} from "../src/lib/platform/site-session";

async function main() {
  const siteKey = process.argv[2];
  const email = process.argv[3];
  if (!siteKey || !email) {
    console.error("Usage: npx tsx scripts/mint-site-session.ts <slug|subdomain|id> <email>");
    process.exit(1);
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  let siteId = "";
  for (const col of ["slug", "subdomain", "id"] as const) {
    const { data } = await sb.from("sites").select("id").eq(col, siteKey).maybeSingle();
    if (data) {
      siteId = (data as { id: string }).id;
      break;
    }
  }
  if (!siteId) {
    console.error(`No site for ${siteKey}`);
    process.exit(1);
  }
  const { data: sa } = await sb
    .from("site_admins")
    .select("id")
    .eq("site_id", siteId)
    .ilike("email", email)
    .maybeSingle();
  if (!sa) {
    console.error(`No site admin ${email} for site ${siteId}`);
    process.exit(1);
  }
  process.stdout.write(
    `${SITE_SESSION_COOKIE}=${createSessionToken((sa as { id: string }).id, siteId)}`,
  );
}

main();
