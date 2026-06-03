// scripts/wrap-nav-actions.mjs
//
// One-shot transform: wrap `.nav-socials` + `.nav-cta` + `.hamburger`
// (siblings inside `.nav-inner`) in a single `<div class="nav-actions">`
// cluster across nav-01..06. nav-07 was wrapped manually because its
// .nav-inner is grid not flex.
//
// SAFETY LESSON 2026-05-13: the previous version of this script used
// `(<!--[^]*?-->\s*)?` to allow an optional preceding comment. That
// non-greedy capture extended `[^]*?` across multiple `-->` boundaries
// when the regex engine searched for a successful overall match,
// swallowing the entire `<nav>` element (including the SECTION:nav:start
// marker) in every file. The fix here is:
//
//   1. Anchor the match to LINE START via `^` + multiline flag — the
//      regex can't start matching at arbitrary mid-file positions.
//   2. Match `<div class="nav-socials">` AS THE FIRST CONTENT on the
//      anchor line — no optional preceding comment lookbehind. Any
//      comments above the socials block stay in place.
//   3. Walk forward through CTA + optional inline comments to the
//      hamburger's closing `</button>`. `[\s\S]*?` here is bounded
//      and safe because it ends at the first `</button>` after the
//      socials open.
//
// Idempotent: skips files that already contain `<div class="nav-actions">`.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "public", "sample-templates");

const NAVS = ["nav-01", "nav-02", "nav-03", "nav-04", "nav-05", "nav-06"];

// Line-anchored. Captures:
//   1. leading indent (mandatory — prevents matching at file position 0)
//   2. socials block, CTA block, optional inline comment, hamburger block —
//      all bundled as the SECOND group so we can re-emit them indented
//      one extra level inside `.nav-actions`.
const PATTERN =
  /^([ \t]+)(<div class="nav-socials">[\s\S]*?<\/button>)/m;

const WRAPPER_COMMENT = `<!-- Right-edge action cluster — socials + phone CTA + hamburger
         packed into one tight horizontal group on the right edge of
         the navbar. \`.nav-actions\` base rule lives in
         public/template-base.css. -->`;

function reindent(block, extraIndent) {
  // Add \`extraIndent\` to every line EXCEPT the first (the first line's
  // indent is owned by the caller via the wrapper's own indent).
  return block
    .split("\n")
    .map((line, i) => (i === 0 ? line : extraIndent + line))
    .join("\n");
}

let wrapped = 0;
let skipped = 0;

for (const nav of NAVS) {
  const file = join(ROOT, `${nav}.html`);
  let html = readFileSync(file, "utf8");

  if (html.includes('class="nav-actions"')) {
    console.log(`⊙ ${nav} — already wrapped, skipping`);
    skipped++;
    continue;
  }

  const match = html.match(PATTERN);
  if (!match) {
    console.warn(`✗ ${nav} — pattern not matched, skipping`);
    continue;
  }

  const [, baseIndent, innerBlock] = match;
  const childIndent = baseIndent + "  ";

  // Re-emit: indent line for the wrapper comment + opening div, then
  // the captured inner block (indented one extra level), then closing div.
  const replacement =
    `${baseIndent}${WRAPPER_COMMENT}\n` +
    `${baseIndent}<div class="nav-actions">\n` +
    `${childIndent}${reindent(innerBlock, childIndent)}\n` +
    `${baseIndent}</div>`;

  html = html.replace(PATTERN, replacement);

  // Sanity check: both SECTION markers must still be present, otherwise
  // we damaged the file (the bug we're guarding against).
  const startMarkers = (html.match(/<!-- SECTION:nav:start -->/g) || []).length;
  const endMarkers = (html.match(/<!-- SECTION:nav:end -->/g) || []).length;
  if (startMarkers !== 1 || endMarkers !== 1) {
    console.error(
      `✗ ${nav} — SECTION markers wrong after wrap (start=${startMarkers}, end=${endMarkers}). NOT writing.`
    );
    continue;
  }

  writeFileSync(file, html, "utf8");
  console.log(`✓ ${nav} — wrapped`);
  wrapped++;
}

console.log(`\n${wrapped} wrapped · ${skipped} already done`);
