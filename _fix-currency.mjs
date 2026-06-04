import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "src");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

// Convert EUR -> USD. Functions in replacements avoid $-escaping pitfalls.
function fix(s) {
  // Payment/invoice currency code (NOT bysquare's currencyCode — that stays EUR for the SK QR).
  s = s.split('currency: "EUR"').join('currency: "USD"');
  // € before a template interpolation: €${x} -> $${x}  (literal $ + value)
  s = s.replace(/€\$\{/g, () => "$${");
  // € before a JSX expression: €{x} -> ${x}
  s = s.replace(/€\{/g, () => "${");
  // € before a number: €1.00 -> $1.00
  s = s.replace(/€(\d)/g, (_, d) => "$" + d);
  // {expr} € -> ${expr}  (move the symbol before the value)
  s = s.replace(/(\{[^{}]*\})\s*€/g, (_, g) => "$" + g);
  // 12.50 € -> $12.50
  s = s.replace(/(\d[\d.,]*)\s*€/g, (_, g) => "$" + g);
  // labels "(€)" -> "($)"
  s = s.replace(/\(€\)/g, () => "($)");
  // any remaining € (comments, stray) -> $
  s = s.replace(/€/g, () => "$");
  return s;
}

let changed = 0;
const touched = [];
for (const f of walk(SRC)) {
  const s = readFileSync(f, "utf8");
  const out = fix(s);
  if (out !== s) {
    writeFileSync(f, out, "utf8");
    changed++;
    touched.push(f.replace(ROOT + "\\", ""));
  }
}
console.log(`currency: updated ${changed} files`);
for (const t of touched) console.log("  " + t);
