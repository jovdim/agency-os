/**
 * Diagnostic: parse reviews-03 and render it the same way publish.ts would,
 * then check whether the carousel <script> survives + whether the per-template
 * CSS includes `--reviews-03-card-w`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "cheerio";

const src = readFileSync(
  join(process.cwd(), "public", "sample-templates", "reviews-03.html"),
  "utf8",
);

// Replicate parser.ts SECTION marker extraction
const SECTION_RE = /<!--\s*SECTION:([a-zA-Z0-9_-]+):start\s*-->([\s\S]*?)<!--\s*SECTION:\1:end\s*-->/i;
const m = src.match(SECTION_RE);
const sectionHtml = m ? m[2].trim() : src;

console.log("=== sectionHtml length:", sectionHtml.length);
console.log("=== contains <script>:", /<script/i.test(sectionHtml));
console.log("=== contains 'currentScript':", /currentScript/.test(sectionHtml));

// Parse with cheerio + serialize back (mimics what applyContentOverrides does)
const $ = load(sectionHtml, { xmlMode: false });
const reSerialized = $.html();

console.log("\n=== After cheerio round-trip:");
console.log("=== contains <script>:", /<script/i.test(reSerialized));
console.log("=== contains 'currentScript':", /currentScript/.test(reSerialized));
console.log("=== contains 'is-live':", /is-live/.test(reSerialized));

// Check CSS extraction
const STYLE_RE = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const styles = src.match(STYLE_RE);
const styleBlock = styles ? styles[0] : "";
console.log("\n=== CSS block length:", styleBlock.length);
console.log("=== contains '--reviews-03-card-w':", /--reviews-03-card-w/.test(styleBlock));
console.log("=== contains 'flex: 0 0 var(--reviews-03-card-w)':", /flex:\s*0\s+0\s+var\(--reviews-03-card-w\)/.test(styleBlock));

// Print the script tag if present
const scriptMatch = reSerialized.match(/<script[^>]*>[\s\S]*?<\/script>/i);
if (scriptMatch) {
  console.log("\n=== Script tag length:", scriptMatch[0].length, "(", scriptMatch[0].length > 1000 ? "looks intact" : "TOO SHORT", ")");
  console.log("=== First 200 chars:");
  console.log(scriptMatch[0].slice(0, 200));
} else {
  console.log("\n=== NO SCRIPT TAG FOUND IN RENDERED OUTPUT");
}
