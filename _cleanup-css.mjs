import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const p = join(ROOT, "public", "template-base.css");
let s = readFileSync(p, "utf8");

// Slovak example menu names used in CSS comments -> English.
const pairs = [
  ["O nás", "About"],
  ["Domov", "Home"],
  ["Služby", "Services"],
  ["Galéria", "Gallery"],
  ["Kontakt", "Contact"],
  ["Telefón", "Phone"],
];

let total = 0;
for (const [from, to] of pairs) {
  const c = s.split(from).length - 1;
  if (c) {
    s = s.split(from).join(to);
    total += c;
    console.log(`  ${from} -> ${to} (${c})`);
  }
}
writeFileSync(p, s, "utf8");
console.log(`template-base.css: replaced ${total} Slovak words`);
