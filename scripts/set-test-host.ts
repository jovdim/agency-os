/**
 * Point a site at a public host (a tunnel URL or a real custom domain) so the
 * dynamic platform serves it there. For testing on the real internet.
 *
 * Usage:
 *   npx tsx scripts/set-test-host.ts --site <slug|subdomain|id> --host <hostname-or-url>
 *
 * Example (after starting a tunnel):
 *   npx tsx scripts/set-test-host.ts --site riverside-cafe-mq3xth3j --host https://brave-cat-12.loca.lt
 *
 * Then visit  https://<host>/admin  (login) and  https://<host>/  (the site).
 * To undo: run again with --host "" (clears it) or set the real domain.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const siteKey = arg("site");
  const rawHost = arg("host");
  if (!siteKey || rawHost === undefined) {
    console.error(
      'Usage: npx tsx scripts/set-test-host.ts --site <slug|subdomain|id> --host <hostname-or-url>',
    );
    process.exit(1);
  }
  // Normalize: strip protocol, any path, trailing slash, lowercase.
  const host = rawHost
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let site: { id: string; name: string } | null = null;
  for (const col of ["slug", "subdomain", "id"] as const) {
    const { data } = await sb
      .from("sites")
      .select("id, name")
      .eq(col, siteKey)
      .maybeSingle();
    if (data) {
      site = data;
      break;
    }
  }
  if (!site) {
    console.error(`No site found for: ${siteKey}`);
    process.exit(1);
  }

  const { error } = await sb
    .from("sites")
    .update({ domain: host || null })
    .eq("id", site.id);
  if (error) {
    console.error("Failed:", error.message);
    process.exit(1);
  }

  if (host) {
    console.log(`\n✓ "${site.name}" is now served at:`);
    console.log(`    site:  https://${host}/`);
    console.log(`    admin: https://${host}/admin\n`);
  } else {
    console.log(`\n✓ Cleared the test host for "${site.name}".\n`);
  }
}

main();
