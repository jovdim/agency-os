import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

function replaceInFile(rel, pairs) {
  const p = join(ROOT, rel);
  let s = readFileSync(p, "utf8");
  let hits = 0;
  for (const [from, to] of pairs) {
    const c = s.split(from).length - 1;
    if (c) { s = s.split(from).join(to); hits += c; }
  }
  writeFileSync(p, s, "utf8");
  return hits;
}

// ── Templates: footer credit + reviews-07 Slovak placeholder ──
const TPL = join(ROOT, "public", "sample-templates");
let tpl = 0;
for (const f of readdirSync(TPL).filter((x) => x.endsWith(".html"))) {
  const p = join(TPL, f);
  let s = readFileSync(p, "utf8");
  const before = s;
  s = s.split("sharkmedia.sk").join("agencyname.com"); // "created by" footer credit
  s = s.split("text=Projekt").join("text=Project"); // reviews-07 Slovak placeholder
  if (s !== before) { writeFileSync(p, s, "utf8"); tpl++; console.log("  tpl:", f); }
}
console.log(`templates updated: ${tpl}`);

// ── src Shark-Media refs ──
console.log(
  "render.ts:",
  replaceInFile("src/lib/templates/render.ts", [
    ["https://sharkmedia-zone.vercel.app", "https://your-app.vercel.app"],
  ]),
);
console.log(
  "bysquare.ts:",
  replaceInFile("src/lib/payments/bysquare.ts", [
    ["Shark Media Consulting s. r. o.", "Your Agency Ltd"],
    ["Webstranka - Shark Media", "Website - Your Agency"],
  ]),
);
console.log(
  "alerts-demo:",
  replaceInFile("src/app/(dashboard)/super/dev/alerts/alerts-demo-client.tsx", [
    ["Sharkstav s.r.o.", "Acme Construction"],
    ["Sharkstav", "Acme Construction"],
  ]),
);
