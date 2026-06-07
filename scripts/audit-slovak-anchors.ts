/**
 * READ-ONLY audit: find Slovak anchor ids/hrefs across live data.
 *
 * Inspects two places where Slovak anchors are stored:
 *   1. section_templates → HTML in the `section-templates` Storage bucket
 *      (the root element `id="domov"` becomes each section's anchor).
 *   2. sites.composition (jsonb) → saved nav/footer/section hrefs like
 *      `#domov`, plus Slovak page labels ("Domov").
 *
 * Mutates NOTHING. Just prints a report so we know the migration scope.
 *
 * Run: npx tsx scripts/audit-slovak-anchors.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { load as loadCheerio } from "cheerio";

const SLOVAK = [
  "domov",
  "o-nas",
  "sluzby",
  "kontakt",
  "galeria",
  "otazky",
  "recenzie",
  "referencie",
  "vyzva",
  "mapa",
  "paticka",
  "postup",
];
const SLOVAK_HREF_RE = new RegExp(`#(${SLOVAK.join("|")})(?![a-z0-9-])`, "gi");

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});

async function main(): Promise<void> {
  // ── Env (same loader as push-template.ts) ──
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

  // ── 1. Section templates ──
  console.log("\n=== SECTION TEMPLATES (Storage) ===");
  const { data: templates, error: tErr } = await admin
    .from("section_templates")
    .select("id, category, name, html_path")
    .order("category");
  if (tErr) {
    console.error(`section_templates query failed: ${tErr.message}`);
    process.exit(1);
  }
  let tplSlovak = 0;
  for (const t of templates ?? []) {
    const { data: blob } = await admin.storage
      .from("section-templates")
      .download(t.html_path);
    if (!blob) {
      console.log(`  ?  ${t.category}/${t.name} — could not download ${t.html_path}`);
      continue;
    }
    const html = await blob.text();
    let rootId: string | null = null;
    try {
      const $ = loadCheerio(html, { xmlMode: false });
      rootId = $("body").children().first().attr("id")?.trim() || null;
    } catch {
      rootId = null;
    }
    const hrefHits = [...html.matchAll(SLOVAK_HREF_RE)].map((m) => m[0]);
    const rootSlovak = rootId ? SLOVAK.includes(rootId) : false;
    if (rootSlovak || hrefHits.length > 0) {
      tplSlovak++;
      const uniqHrefs = [...new Set(hrefHits)];
      console.log(
        `  ✗ ${t.category}/${t.name} — root id="${rootId}"` +
          (uniqHrefs.length ? ` · hrefs: ${uniqHrefs.join(", ")}` : ""),
      );
    }
  }
  console.log(
    `\n  ${tplSlovak} of ${templates?.length ?? 0} templates contain Slovak anchors.`,
  );

  // ── 2. Site compositions ──
  console.log("\n=== SITE COMPOSITIONS (sites.composition) ===");
  const { data: sites, error: sErr } = await admin
    .from("sites")
    .select("id, name, slug, composition")
    .order("created_at", { ascending: false });
  if (sErr) {
    console.error(`sites query failed: ${sErr.message}`);
    process.exit(1);
  }
  let siteSlovak = 0;
  for (const s of sites ?? []) {
    if (!s.composition) continue;
    const json = JSON.stringify(s.composition);
    const hrefHits = [...new Set([...json.matchAll(SLOVAK_HREF_RE)].map((m) => m[0]))];
    const hasDomovLabel = /"label"\s*:\s*"Domov"/i.test(json);
    if (hrefHits.length > 0 || hasDomovLabel) {
      siteSlovak++;
      console.log(
        `  ✗ ${s.slug || s.name} (${s.id})` +
          (hrefHits.length ? ` · hrefs: ${hrefHits.join(", ")}` : "") +
          (hasDomovLabel ? ` · page label "Domov"` : ""),
      );
    }
  }
  console.log(
    `\n  ${siteSlovak} of ${sites?.length ?? 0} sites have Slovak anchors/labels.`,
  );
  console.log("\nAudit complete. No data was modified.\n");
}
