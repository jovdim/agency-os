import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "src");

function walk(d) {
  const o = [];
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) o.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(n)) o.push(p);
  }
  return o;
}

let changed = 0;
for (const f of walk(SRC)) {
  let s = readFileSync(f, "utf8");
  const b = s;
  // Slovak comma-decimal formatting -> plain dot decimal (US).
  s = s.split('.replace(".", ",")').join("");
  s = s.split(".replace('.', ',')").join("");
  // Slovak number locale -> US.
  s = s.split('"sk-SK"').join('"en-US"');
  s = s.split("'sk-SK'").join("'en-US'");
  // Slovak banking term on the payment dialog -> generic English.
  s = s.split('label="Variable symbol"').join('label="Reference"');
  if (s !== b) {
    writeFileSync(f, s, "utf8");
    changed++;
  }
}
console.log(`format: updated ${changed} files`);
