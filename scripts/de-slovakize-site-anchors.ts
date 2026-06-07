/**
 * Heal saved site compositions: rewrite Slovak anchor hrefs → English and
 * "Domov" page/link labels → "Home" in sites.composition (jsonb).
 *
 * Templates already emit English section ids (id="home", id="services"…),
 * so a nav href of `#domov` points at nothing. This converts the saved
 * hrefs to the English id the section actually has, and renames the
 * leftover "Domov" labels.
 *
 * Touches ONLY: `href` string values (the fragment after `#`) and `label`
 * values equal to "Domov". Body text, page filenames, and everything else
 * are left untouched. Idempotent.
 *
 * DRY RUN by default — prints what it would change. Pass `--apply` to write.
 *
 * Run: npx tsx scripts/de-slovakize-site-anchors.ts          (preview)
 *      npx tsx scripts/de-slovakize-site-anchors.ts --apply  (write)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { SLOVAK_TO_ENGLISH_HREF } from "../src/lib/composer/slovak-anchor-map";

const APPLY = process.argv.includes("--apply");

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});

/** Rewrite the `#fragment` of an href if it's a known Slovak slug. */
function fixHref(href: string): string {
  const hashIdx = href.indexOf("#");
  if (hashIdx === -1) return href;
  const base = href.slice(0, hashIdx);
  const frag = href.slice(hashIdx); // includes '#'
  const mapped = SLOVAK_TO_ENGLISH_HREF[frag];
  return mapped ? base + mapped : href;
}

/** Deep-walk a composition, fixing hrefs + "Domov" labels. Returns the
 *  transformed value and increments `counts` for reporting. */
function transform(
  node: unknown,
  counts: { href: number; label: number },
): unknown {
  if (Array.isArray(node)) return node.map((v) => transform(v, counts));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "href" && typeof v === "string") {
        const fixed = fixHref(v);
        if (fixed !== v) counts.href++;
        out[k] = fixed;
      } else if (k === "label" && v === "Domov") {
        counts.label++;
        out[k] = "Home";
      } else {
        out[k] = transform(v, counts);
      }
    }
    return out;
  }
  return node;
}

async function main(): Promise<void> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(APPLY ? "\n=== APPLYING ===" : "\n=== DRY RUN (no writes) ===");

  const { data: sites, error } = await admin
    .from("sites")
    .select("id, name, slug, composition");
  if (error) {
    console.error(`sites query failed: ${error.message}`);
    process.exit(1);
  }

  let changedSites = 0;
  for (const s of sites ?? []) {
    if (!s.composition) continue;
    const counts = { href: 0, label: 0 };
    const next = transform(s.composition, counts);
    if (counts.href === 0 && counts.label === 0) continue;
    changedSites++;
    console.log(
      `  ${s.slug || s.name} (${s.id}) — ${counts.href} href(s), ${counts.label} label(s)`,
    );
    if (APPLY) {
      const { error: updErr } = await admin
        .from("sites")
        .update({ composition: next })
        .eq("id", s.id);
      if (updErr) {
        console.error(`    ✗ update failed: ${updErr.message}`);
      } else {
        console.log(`    ✓ updated`);
      }
    }
  }

  console.log(
    `\n${changedSites} site(s) ${APPLY ? "updated" : "would change"}.` +
      (APPLY ? "" : "  Re-run with --apply to write.") +
      "\n",
  );
  if (APPLY && changedSites > 0) {
    console.log(
      "NOTE: these sites must be RE-PUBLISHED for the live deployed HTML to\n" +
        "pick up the English anchors. The DB + editor are fixed now.\n",
    );
  }
}
