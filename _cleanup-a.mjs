import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

function replaceInFile(rel, pairs) {
  const p = join(ROOT, rel);
  let s = readFileSync(p, "utf8");
  let hits = 0;
  for (const [from, to] of pairs) {
    if (s.includes(from)) { s = s.split(from).join(to); hits++; }
  }
  writeFileSync(p, s, "utf8");
  console.log(`${rel}: ${hits}/${pairs.length} replacements`);
}

// ── A. Slovak in baked-into-output source ──
replaceInFile("src/lib/templates/render-browser.ts", [
  ['"Webová stránka"', '"Website"'],
  ['clicking "Služby" in nav-01', 'clicking "Services" in nav-01'],
  ["Domov → O nás → Sluzby → Galéria → Kontakt", "Home → About → Services → Gallery → Contact"],
]);
replaceInFile("src/lib/templates/parser.ts", [
  ["Hlavná 12, Žilina", "Main St 12, City"],
]);
replaceInFile("src/components/dashboard/site-preview.tsx", [
  ["your-site.2dni.sk", "your-site.pages.dev"],
]);
replaceInFile("src/components/layouts/sidebar.tsx", [
  ['import Image from "next/image";\n', ""],
]);

// ── B. Slovak-format phone placeholders across templates ──
const TPL = join(ROOT, "public", "sample-templates");
const DISP = "+1 (555) 000-0000";
const TEL = "tel:+15550000000";
let n = 0;
for (const f of readdirSync(TPL).filter((x) => x.endsWith(".html"))) {
  const p = join(TPL, f);
  let s = readFileSync(p, "utf8");
  const before = s;
  s = s.replace(/tel:\+421[\d ]*/g, TEL);
  s = s.replace(/href="0900000000"/g, `href="${TEL}"`);
  s = s.replace(/href="tel:"/g, `href="${TEL}"`);
  s = s.replace(/\+421[ \dxX…]*/g, DISP);
  s = s.replace(/0900 ?000 ?000/g, DISP);
  s = s.replace(/0907 339 732/g, DISP);
  if (s !== before) { writeFileSync(p, s, "utf8"); n++; }
}
console.log(`phones: updated ${n} template files`);
