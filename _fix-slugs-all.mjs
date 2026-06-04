import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const TPL = join(ROOT, "public", "sample-templates");
const env = {};
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Complete Slovak -> English anchor-slug map. Targets MATCH the English
// ids the templates already use (about/home/services/gallery/contact/faq)
// so nav hrefs stay aligned to their sections after the fix.
const SLUG_MAP = {
  "uvod-detail": "intro-detail",
  "co-je-v-cene": "whats-included",
  "kontaktujte-nas": "contact-us",
  "ako-pracujeme": "how-it-works",
  "bezplatna-obhliadka": "free-quote",
  "lanove-pilenie-stromov": "service-one",
  "rizikovy-vyrub-stromov": "service-two",
  "tazko-pristupne-miesta": "service-three",
  "referencie": "references",
  "recenzie": "reviews",
  "posobnost": "coverage",
  "domov": "home",
  "o-nas": "about",
  "o_nas": "about",
  "sluzby": "services",
  "sluzba": "service",
  "galeria": "gallery",
  "kontakt": "contact",
  "cennik": "pricing",
  "otazky": "faq",
  "paticka": "footer",
  "postup": "process",
  "stroje": "equipment",
  "vybava": "gear",
  "vyhody": "benefits",
  "vyzva": "cta",
  "mapa": "map",
  "uvod": "intro",
  "cena": "pricing",
};

// longest-first so multi-word slugs win over their prefixes
const ALT = Object.keys(SLUG_MAP).sort((a, b) => b.length - a.length).join("|");

// ── 1. TEMPLATES ──────────────────────────────────────────────────
// Only rewrite an attribute value that is EXACTLY a slug, #slug, or
// slug.html (id=, href=, aria-controls=, for=, data-target=, ...).
// Full value-between-quotes match => never touches class="cena-box",
// JS, or visible text. Keeps ARIA/anchor wiring internally consistent.
const TPL_RE = new RegExp(`=(["'])(#?)(${ALT})(\\.html)?\\1`, "g");
let tChanged = 0;
const tFiles = [];
for (const f of readdirSync(TPL)) {
  if (!f.endsWith(".html")) continue;
  const p = join(TPL, f);
  const orig = readFileSync(p, "utf8");
  const next = orig.replace(
    TPL_RE,
    (_, q, hash, slug, html) => `=${q}${hash}${SLUG_MAP[slug]}${html || ""}${q}`,
  );
  if (next !== orig) {
    writeFileSync(p, next, "utf8");
    tChanged++;
    tFiles.push(f);
  }
}
console.log(`templates: ${tChanged} files updated`);
if (tFiles.length) console.log("  " + tFiles.join(", "));

// ── 2. COMPOSITIONS ───────────────────────────────────────────────
// Only rewrite strings that are anchor hrefs (#slug), __section_id
// overrides, or .html subpage links — full-value match, optional -N
// duplicate suffix preserved. Same map => nav href stays matched to
// its section id, so in-page auto-scroll keeps working.
const VAL_RE = new RegExp(`^(#?)(${ALT})(-\\d+)?(\\.html)?$`);
function fixStr(val, key) {
  if (typeof val !== "string") return val;
  if (!val.startsWith("#") && key !== "__section_id" && !val.endsWith(".html")) return val;
  const m = val.match(VAL_RE);
  if (!m || !SLUG_MAP[m[2]]) return val;
  return `${m[1] || ""}${SLUG_MAP[m[2]]}${m[3] || ""}${m[4] || ""}`;
}
function walk(node, key) {
  if (typeof node === "string") return fixStr(node, key);
  if (Array.isArray(node)) return node.map((v) => walk(v, key));
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = walk(v, k);
    return out;
  }
  return node;
}

async function main() {
  const { data: sites } = await admin.from("sites").select("id, slug, composition");
  let cChanged = 0;
  for (const s of sites ?? []) {
    if (!s.composition) continue;
    const before = JSON.stringify(s.composition);
    const after = walk(s.composition, null);
    if (JSON.stringify(after) !== before) {
      const { error } = await admin.from("sites").update({ composition: after }).eq("id", s.id);
      if (error) { console.error(`  FAIL ${s.slug}: ${error.message}`); continue; }
      cChanged++;
      console.log(`  composition fixed: ${s.slug}`);
    }
  }
  console.log(`compositions: ${cChanged} sites updated`);
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
