import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "public", "sample-templates");
let n = 0;
for (const f of readdirSync(DIR).filter((x) => x.endsWith(".html"))) {
  const p = join(DIR, f);
  const s = readFileSync(p, "utf8");
  if (s.includes('lang="sk"')) {
    writeFileSync(p, s.replaceAll('lang="sk"', 'lang="en"'), "utf8");
    n++;
  }
}
console.log(`Fixed lang="sk" -> lang="en" in ${n} files`);
