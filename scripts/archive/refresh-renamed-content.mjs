/**
 * After the rename script moved files + DB rows, the file *contents*
 * still reference the old names — in <title>, preview banner, the
 * TEMPLATE: comment block, and CSS class names like `.hero-02` /
 * `class="services-04"`. The HTML comments are harmless (parser
 * ignores them), but the CSS class names matter because they ride
 * along inside the section block + style block uploaded to storage.
 *
 * This script does a careful word-boundary string-replace of each
 * renamed file's old name → new name across its entire content, then
 * re-runs the upload-template logic so storage gets the fresh content.
 *
 * Word-boundary regex (`\b<old>\b`) so "hero-02" doesn't match the
 * tail of "hero-021" or similar. We don't currently have collisions
 * but the discipline costs nothing.
 *
 * Run: node scripts/refresh-renamed-content.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLES_DIR = path.join(__dirname, "..", "public", "sample-templates");

// Mirror of the rename plan — old → new. Local file is already at the
// new path; we open it and rewrite stale internal references.
const RENAMES = [
  { old: "hero-02", new: "hero-01" },
  { old: "hero-03", new: "hero-02" },
  { old: "hero-06", new: "hero-03" },
  { old: "about-03", new: "about-01" },
  { old: "about-04", new: "about-02" },
  { old: "about-05", new: "about-03" },
  { old: "about-06", new: "about-04" },
  { old: "about-07", new: "about-05" },
  { old: "about-08", new: "about-06" },
  { old: "about-09", new: "about-07" },
  { old: "services-02", new: "services-01" },
  { old: "services-03", new: "services-02" },
  { old: "services-04", new: "services-03" },
  { old: "services-05", new: "services-04" },
  { old: "services-06", new: "services-05" },
  { old: "services-07", new: "services-06" },
  { old: "services-08", new: "services-07" },
  { old: "cta-02", new: "cta-01" },
];

console.log("══ REWRITE CONTENT + RE-UPLOAD ══\n");

for (const { old: oldName, new: newName } of RENAMES) {
  const filePath = path.join(SAMPLES_DIR, `${newName}.html`);
  let content;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    console.log(`  ${newName}.html: not found locally, skipping`);
    continue;
  }

  // Word-boundary replace — only matches the exact old name, not its
  // prefixes/suffixes. Escape the hyphen for the regex.
  const re = new RegExp(`\\b${oldName.replace(/-/g, "\\-")}\\b`, "g");
  const before = (content.match(re) ?? []).length;
  if (before === 0) {
    console.log(`  ${newName}.html: 0 stale refs (already clean)`);
    continue;
  }
  content = content.replace(re, newName);
  await fs.writeFile(filePath, content, "utf8");
  console.log(`  ${newName}.html: rewrote ${before} stale ref${before === 1 ? "" : "s"} (${oldName} → ${newName})`);

  // Re-upload via upload-template.mjs. This re-parses the cleaned file
  // and writes both HTML (between SECTION markers) and CSS (style blocks)
  // back to storage at the same path. Bumps the version too.
  try {
    const { stdout } = await execFileP(
      process.execPath,
      [path.join(__dirname, "upload-template.mjs"), newName],
      { cwd: path.join(__dirname, "..") },
    );
    const versionLine = stdout
      .split("\n")
      .find((l) => l.includes("version:"));
    console.log(`    ↻ re-uploaded${versionLine ? " — " + versionLine.trim() : ""}`);
  } catch (err) {
    console.error(
      `    ✗ upload failed: ${err.stderr || err.message}`,
    );
  }
}

console.log("\n✓ Done.");
