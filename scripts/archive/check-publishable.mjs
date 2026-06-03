/**
 * Pre-flight check for the publish path.
 *
 * Usage:  node scripts/check-publishable.mjs <site_id>
 *
 * Reports:
 *  - Whether the site row exists
 *  - Whether is_legacy is false
 *  - Whether the slug looks publish-safe (turns into a valid CF Pages name)
 *  - Whether the composition has at least one page with sections / shared template
 *  - Whether every template referenced in the composition is published
 *  - Cloudflare credentials reachability (auth check via /user/tokens/verify)
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const SITE_ID = process.argv[2];
if (!SITE_ID) {
  console.error("Usage: node scripts/check-publishable.mjs <site_id>");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const info = (s) => `\x1b[36m·\x1b[0m ${s}`;

let problems = 0;

console.log(`\nChecking site ${SITE_ID}\n`);

// ── Site row ──
const { data: site, error: siteErr } = await admin
  .from("sites")
  .select("id, name, slug, composition, is_legacy, proposal_id, owner_id, last_published_at, site_url")
  .eq("id", SITE_ID)
  .single();

if (siteErr || !site) {
  console.log(bad(`Site not found: ${siteErr?.message ?? "no row"}`));
  process.exit(1);
}
console.log(ok(`Site row exists — name: "${site.name ?? "(unnamed)"}"`));
console.log(info(`  owner_id: ${site.owner_id ?? "(none)"}`));
console.log(info(`  proposal_id: ${site.proposal_id ?? "(none)"}`));
console.log(info(`  last_published_at: ${site.last_published_at ?? "never"}`));
console.log(info(`  site_url: ${site.site_url ?? "(none)"}`));

// ── is_legacy ──
if (site.is_legacy) {
  console.log(bad(`is_legacy = TRUE  → cannot publish via composer path`));
  problems++;
} else {
  console.log(ok(`is_legacy = false`));
}

// ── slug ──
if (!site.slug) {
  console.log(bad(`slug is NULL — required for project name`));
  problems++;
} else {
  const sanitized = site.slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 58);
  console.log(ok(`slug: "${site.slug}"  →  CF project name: "${sanitized}"`));
  if (sanitized.length === 0) {
    console.log(bad(`  sanitized to empty string`));
    problems++;
  }
}

// ── composition ──
const comp = site.composition;
if (!comp || typeof comp !== "object") {
  console.log(bad(`composition is null or not an object`));
  problems++;
} else {
  console.log(ok(`composition present`));
  const pages = Array.isArray(comp.pages) ? comp.pages : [];
  console.log(info(`  pages: ${pages.length}`));
  if (pages.length === 0) {
    console.log(bad(`  no pages — publish will throw "Composition has no pages"`));
    problems++;
  }
  const totalSections = pages.reduce(
    (n, p) => n + (Array.isArray(p?.sections) ? p.sections.length : 0),
    0,
  );
  console.log(info(`  total sections across all pages: ${totalSections}`));
  console.log(info(`  shared.nav_template_id: ${comp.shared?.nav_template_id ?? "(none)"}`));
  console.log(info(`  shared.footer_template_id: ${comp.shared?.footer_template_id ?? "(none)"}`));

  // Collect every template id referenced
  const referenced = new Set();
  if (comp.shared?.nav_template_id) referenced.add(comp.shared.nav_template_id);
  if (comp.shared?.footer_template_id) referenced.add(comp.shared.footer_template_id);
  for (const p of pages) {
    for (const s of p.sections ?? []) {
      if (s.template_id) referenced.add(s.template_id);
    }
  }
  console.log(info(`  unique templates referenced: ${referenced.size}`));

  if (referenced.size > 0) {
    const { data: tpls, error: tplErr } = await admin
      .from("section_templates")
      .select("id, name, category, is_published, version")
      .in("id", [...referenced]);
    if (tplErr) {
      console.log(bad(`Failed to load templates: ${tplErr.message}`));
      problems++;
    } else {
      const found = new Set(tpls.map((t) => t.id));
      const missing = [...referenced].filter((id) => !found.has(id));
      const unpublished = tpls.filter((t) => !t.is_published);
      if (missing.length) {
        console.log(bad(`  missing templates (deleted from DB): ${missing.join(", ")}`));
        problems++;
      } else {
        console.log(ok(`  all referenced templates exist in section_templates`));
      }
      if (unpublished.length) {
        console.log(bad(`  unpublished templates: ${unpublished.map((t) => `${t.name}@v${t.version}`).join(", ")}`));
        problems++;
      } else if (tpls.length > 0) {
        console.log(ok(`  all referenced templates are published`));
      }
    }
  }
}

// ── Cloudflare auth check ──
const cfToken = process.env.CLOUDFLARE_API_TOKEN;
const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!cfToken || !cfAccount) {
  console.log(bad("CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID missing"));
  problems++;
} else {
  const verifyRes = await fetch(
    "https://api.cloudflare.com/client/v4/user/tokens/verify",
    { headers: { Authorization: `Bearer ${cfToken}` } },
  );
  const verifyJson = await verifyRes.json();
  if (verifyJson.success) {
    console.log(ok(`Cloudflare token verified — status: ${verifyJson.result?.status ?? "active"}`));
  } else {
    console.log(bad(`Cloudflare token verify failed: ${JSON.stringify(verifyJson.errors)}`));
    problems++;
  }

  // Account access — try listing Pages projects (limit 1)
  const projRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/pages/projects?per_page=1`,
    { headers: { Authorization: `Bearer ${cfToken}` } },
  );
  const projJson = await projRes.json();
  if (projJson.success) {
    console.log(ok(`Cloudflare Pages access on account — ${projJson.result_info?.total_count ?? "?"} existing project(s)`));
  } else {
    console.log(bad(`Cloudflare Pages access failed: ${JSON.stringify(projJson.errors)}`));
    problems++;
  }
}

console.log();
if (problems === 0) {
  console.log(`\x1b[32mAll green — site is publishable. Click Publish in the composer.\x1b[0m\n`);
  process.exit(0);
} else {
  console.log(`\x1b[31m${problems} problem(s) found — fix above before publishing.\x1b[0m\n`);
  process.exit(2);
}
