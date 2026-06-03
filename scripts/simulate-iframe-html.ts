/**
 * Simulate what the composer iframe will actually contain for a given
 * site's services section. Tells us definitively whether the chevron
 * button HTML survives the render pipeline.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { renderInBrowser, type TemplateBody } from "../src/lib/templates/render-browser";
import { loadBaseCss, loadTemplateBodies } from "../src/lib/templates/load-bodies";

config({ path: ".env.local" });

async function main() {
  const siteId = process.argv[2];
  if (!siteId) {
    console.error("usage: npx tsx scripts/simulate-iframe-html.ts <site-id>");
    process.exit(1);
  }

  // Simulate the browser DOMParser in Node
  // @ts-expect-error jsdom isn't typed for this use, fine for diagnostic
  const { JSDOM } = await import("jsdom").catch(() => ({ JSDOM: null }));
  if (!JSDOM) {
    console.error("Install jsdom: npm i -D jsdom");
    process.exit(1);
  }
  const dom = new JSDOM();
  (global as { DOMParser?: typeof DOMParser }).DOMParser = dom.window.DOMParser;

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: site } = await sb
    .from("sites")
    .select("composition")
    .eq("id", siteId)
    .single();
  if (!site?.composition) {
    console.error("no composition");
    process.exit(1);
  }

  // Get the template rows for templates used by this site
  const composition = site.composition as { pages?: Array<{ sections?: Array<{ template_id: string }> }> };
  const usedIds = new Set<string>();
  for (const p of composition.pages ?? []) {
    for (const s of p.sections ?? []) usedIds.add(s.template_id);
  }
  const { data: tpls } = await sb
    .from("section_templates")
    .select("id, category, name, html_path, css_path, placeholder_schema")
    .in("id", Array.from(usedIds));

  const templateBodies = await loadTemplateBodies(sb, (tpls ?? []) as Parameters<typeof loadTemplateBodies>[1]);
  const baseCss = loadBaseCss();

  const templateBodyMap = new Map<string, TemplateBody>();
  for (const id in templateBodies) templateBodyMap.set(id, templateBodies[id]);

  const html = renderInBrowser(site.composition as Parameters<typeof renderInBrowser>[0], templateBodyMap, { baseCss });

  // Dump full HTML to disk so we can grep it (stdout redirect on Windows tsx misbehaves)
  const fs = await import("fs");
  const outPath = "iframe-dump.html";
  fs.writeFileSync(outPath, html);
  console.log(`Wrote full iframe HTML to ${outPath} (${html.length} chars)`);

  // Search for the chevron button
  const buttonMatches = (html.match(/class="services-09__more"/g) ?? []).length;
  const scriptMatches = (html.match(/document\.currentScript\.closest\(".services-09"\)/g) ?? []).length;
  const viacMatches = (html.match(/Viac informácií/g) ?? []).length;

  console.log("=".repeat(60));
  console.log("iframe HTML simulation for site", siteId);
  console.log("=".repeat(60));
  console.log("Total HTML length:", html.length, "chars");
  console.log(".services-09__more button class occurrences:", buttonMatches);
  console.log("script-with-currentScript-closest occurrences:", scriptMatches);
  console.log("'Viac informácií' label occurrences:", viacMatches);

  // Dump a slice of the services-09 section if present
  const sIdx = html.indexOf("services-09__grid");
  if (sIdx >= 0) {
    console.log("\n--- Slice of services-09 section in iframe HTML: ---");
    console.log(html.slice(sIdx, sIdx + 3000));
  } else {
    console.log("\nservices-09__grid not found in iframe HTML at all");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
