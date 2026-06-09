/**
 * Create (or reset) a per-site CMS admin login for theirdomain.com/admin.
 *
 * Usage:
 *   npx tsx scripts/create-site-admin.ts --site <slug|subdomain|id> --email client@biz.com [--password <pw>]
 *
 * If --password is omitted a random one is generated and printed. Re-running
 * for the same (site, email) replaces the existing login (idempotent).
 *
 * This is the interim onboarding tool until a "Create site login" button is
 * added to the CRM. It writes directly to the `site_admins` table with the
 * service-role key (the table is service-role-only by RLS).
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { hashPassword } from "../src/lib/platform/site-session";

loadEnvConfig(process.cwd());

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const siteKey = arg("site");
  const email = arg("email")?.trim().toLowerCase();
  let password = arg("password");

  if (!siteKey || !email) {
    console.error(
      "Usage: npx tsx scripts/create-site-admin.ts --site <slug|subdomain|id> --email client@biz.com [--password <pw>]",
    );
    process.exit(1);
  }
  if (!password) password = crypto.randomBytes(9).toString("base64url");

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Resolve the site by slug, then subdomain, then id (id last so a non-UUID
  // key doesn't error first).
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

  await sb.from("site_admins").delete().eq("site_id", site.id).ilike("email", email);
  const { error } = await sb.from("site_admins").insert({
    site_id: site.id,
    email,
    password_hash: hashPassword(password),
    is_active: true,
  });
  if (error) {
    console.error("Failed to create login:", error.message);
    process.exit(1);
  }

  console.log(`\n✓ Login created for "${site.name}"`);
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log(`\nSend these to the client. They sign in at theirdomain.com/admin\n`);
}

main();
