import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MAP = {
  "o-nas": "about",
  "domov": "home",
  "sluzby": "services",
  "sluzba": "service",
  "galeria": "gallery",
  "kontakt": "contact",
  "referencie": "references",
  "recenzie": "reviews",
  "cennik": "pricing",
};
// Match a Slovak slug only when it's an id/href/anchor/path value (preceded by " or # or /)
// and word-bounded after — so data-field keys like "sluzby_title" are NOT touched.
const RE = /(["#\/])(o-nas|domov|sluzby|sluzba|galeria|kontakt|referencie|recenzie|cennik)\b/g;

const TPL = join(ROOT, "public", "sample-templates");
let n = 0;
for (const f of readdirSync(TPL).filter((x) => x.endsWith(".html"))) {
  const p = join(TPL, f);
  const s = readFileSync(p, "utf8");
  const out = s.replace(RE, (_, pre, slug) => pre + MAP[slug]);
  if (out !== s) {
    writeFileSync(p, out, "utf8");
    n++;
  }
}
console.log(`slugs fixed in ${n} templates`);
