/**
 * One-shot maintenance script: deletes hero-04 + hero-05, then renumbers
 * every category so the lowest-numbered template in each category is -01.
 *
 * Renames preserve the row UUID (never recreate the row) so any sites
 * already referencing a template by id keep working — only the `name`,
 * `html_path`, and `css_path` columns change. Storage objects are copied
 * to the new path before the old ones are deleted, so a half-failed run
 * leaves the template still resolvable from the old path.
 *
 * Run: node scripts/rename-templates.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Supabase setup ──────────────────────────────────────────────────────────

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

const BUCKET = "section-templates";
const SAMPLES_DIR = path.join(__dirname, "..", "public", "sample-templates");

// ── Plan ────────────────────────────────────────────────────────────────────

const DELETIONS = ["hero-04", "hero-05"];

// Each rename is { oldName, newName } — both within the same category.
// Order matters: lowest-numbered target first so renames never collide
// with a name that hasn't been moved yet (e.g. rename hero-02→hero-01
// BEFORE hero-03→hero-02).
const RENAMES = [
  // Heroes (after deletes: 02, 03, 06 → 01, 02, 03)
  { old: "hero-02", new: "hero-01" },
  { old: "hero-03", new: "hero-02" },
  { old: "hero-06", new: "hero-03" },
  // About (03..09 → 01..07)
  { old: "about-03", new: "about-01" },
  { old: "about-04", new: "about-02" },
  { old: "about-05", new: "about-03" },
  { old: "about-06", new: "about-04" },
  { old: "about-07", new: "about-05" },
  { old: "about-08", new: "about-06" },
  { old: "about-09", new: "about-07" },
  // Services (02..08 → 01..07)
  { old: "services-02", new: "services-01" },
  { old: "services-03", new: "services-02" },
  { old: "services-04", new: "services-03" },
  { old: "services-05", new: "services-04" },
  { old: "services-06", new: "services-05" },
  { old: "services-07", new: "services-06" },
  { old: "services-08", new: "services-07" },
  // CTA (02 → 01)
  { old: "cta-02", new: "cta-01" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getRow(name) {
  const { data, error } = await admin
    .from("section_templates")
    .select("id, category, name, html_path, css_path, version")
    .eq("name", name)
    .maybeSingle();
  if (error) throw new Error(`DB lookup ${name}: ${error.message}`);
  return data;
}

async function downloadStorage(storagePath) {
  const { data, error } = await admin.storage.from(BUCKET).download(storagePath);
  if (error) throw new Error(`Download ${storagePath}: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

async function uploadStorage(storagePath, bytes, contentType) {
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Upload ${storagePath}: ${error.message}`);
}

async function deleteStorage(storagePath) {
  const { error } = await admin.storage.from(BUCKET).remove([storagePath]);
  if (error && !error.message.toLowerCase().includes("not found")) {
    throw new Error(`Delete ${storagePath}: ${error.message}`);
  }
}

async function deleteRow(id) {
  const { error } = await admin
    .from("section_templates")
    .delete()
    .eq("id", id);
  if (error) throw new Error(`DB delete ${id}: ${error.message}`);
}

async function updateRow(id, patch) {
  const { error } = await admin
    .from("section_templates")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(`DB update ${id}: ${error.message}`);
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ── Step 1: deletions ───────────────────────────────────────────────────────

console.log("\n══ DELETE ══");
for (const name of DELETIONS) {
  const row = await getRow(name);
  if (!row) {
    console.log(`  ${name}: not found, skipping`);
    continue;
  }
  console.log(`  ${name} (${row.id})`);
  // Storage first — if DB row goes but storage stays, we have orphans.
  // If storage goes but DB stays, the renderer breaks. We accept the
  // orphan-storage failure mode (cleanup script will handle later).
  if (row.html_path) {
    await deleteStorage(row.html_path);
    console.log(`    × storage ${row.html_path}`);
  }
  if (row.css_path) {
    await deleteStorage(row.css_path);
    console.log(`    × storage ${row.css_path}`);
  }
  await deleteRow(row.id);
  console.log(`    × DB row`);
  // Local file — best effort.
  const localFile = path.join(SAMPLES_DIR, `${name}.html`);
  if (await fileExists(localFile)) {
    await fs.unlink(localFile);
    console.log(`    × local ${name}.html`);
  }
}

// ── Step 2: renames ─────────────────────────────────────────────────────────

console.log("\n══ RENAME ══");
for (const { old: oldName, new: newName } of RENAMES) {
  const row = await getRow(oldName);
  if (!row) {
    console.log(`  ${oldName} → ${newName}: source not found, skipping`);
    continue;
  }
  // Defensive: refuse to overwrite an existing template with the new name.
  // (Shouldn't happen in our planned ordering — caught by this guard.)
  const existingTarget = await getRow(newName);
  if (existingTarget && existingTarget.id !== row.id) {
    throw new Error(
      `Refusing to rename ${oldName} → ${newName}: ${newName} already exists (id=${existingTarget.id}). Plan order must be wrong.`,
    );
  }

  console.log(`  ${oldName} → ${newName} (${row.id})`);

  const newHtmlPath = `${row.category}/${newName}.html`;
  const newCssPath = row.css_path ? `${row.category}/${newName}.css` : null;

  // 1. Copy storage to new paths (parallel — both are independent reads).
  const htmlBytes = await downloadStorage(row.html_path);
  const cssBytes = row.css_path ? await downloadStorage(row.css_path) : null;
  await uploadStorage(newHtmlPath, htmlBytes, "text/html");
  if (cssBytes) await uploadStorage(newCssPath, cssBytes, "text/css");
  console.log(`    + storage ${newHtmlPath}${cssBytes ? " + .css" : ""}`);

  // 2. Update DB row — UUID stays the same, only name + paths change.
  await updateRow(row.id, {
    name: newName,
    html_path: newHtmlPath,
    css_path: newCssPath,
  });
  console.log(`    ↻ DB row → name=${newName}`);

  // 3. Delete old storage paths.
  await deleteStorage(row.html_path);
  if (row.css_path) await deleteStorage(row.css_path);
  console.log(`    × storage ${row.html_path}${row.css_path ? " + .css" : ""}`);

  // 4. Rename local file (best effort).
  const oldLocal = path.join(SAMPLES_DIR, `${oldName}.html`);
  const newLocal = path.join(SAMPLES_DIR, `${newName}.html`);
  if (await fileExists(oldLocal)) {
    await fs.rename(oldLocal, newLocal);
    console.log(`    ↻ local ${oldName}.html → ${newName}.html`);
  }
}

console.log("\n✓ Done.");
