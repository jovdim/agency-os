// Quick read-only listing of section_templates so we can see what's there
// before renaming. No mutations.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, "..", ".env.local");
const envText = await fs.readFile(envPath, "utf8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const eq = l.indexOf("=");
      return [l.slice(0, eq), l.slice(eq + 1).replace(/^"|"$/g, "")];
    }),
);

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data, error } = await admin
  .from("section_templates")
  .select("id, category, name, html_path, css_path, version, is_published")
  .order("category", { ascending: true })
  .order("name", { ascending: true });

if (error) throw error;

const byCat = {};
for (const r of data) {
  byCat[r.category] = byCat[r.category] || [];
  byCat[r.category].push(r);
}

for (const [cat, rows] of Object.entries(byCat)) {
  console.log(`\n${cat.toUpperCase()} (${rows.length})`);
  for (const r of rows) {
    console.log(
      `  ${r.name.padEnd(20)} v${r.version}  ${r.is_published ? "✓ published" : "  draft   "}  ${r.id}`,
    );
  }
}

console.log(`\nTotal: ${data.length} templates`);
