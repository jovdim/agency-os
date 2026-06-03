// @ts-check
/**
 * One-shot: move the existing `.nav-socials` block from AFTER the
 * hamburger to BEFORE the `.nav-cta` button in every nav template.
 *
 * Why: Peter wants the socials to sit between the menu and the phone
 * CTA on desktop (visual order: Logo · Menu · FB · IG · 📞). On mobile
 * the CTA is hidden and the hamburger appears, and Peter wants socials
 * to appear AFTER the hamburger (Logo · 🍔 · FB · IG). Both layouts
 * come from ONE DOM order:
 *
 *     <Logo> <Menu> <Socials> <CTA> <Hamburger>
 *
 * with a single CSS rule (in template-base.css) flipping `.nav-socials`
 * to `order: 99` on mobile so the socials visually follow the hamburger
 * (which stays at default order 0) once the CTA + menu have disappeared.
 *
 * Idempotent — runs once, leaves the file alone if the socials block
 * is already in the right position.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(HERE, "..", "public", "sample-templates");

// Capture the existing socials block, plus surrounding whitespace, so
// we can yank it out cleanly. Multiline + non-greedy so we only grab
// ONE block per file even if a future addition lands.
const SOCIALS_BLOCK_RE =
  /\n+\s*<!-- Socials: FB \+ IG[\s\S]*?<\/a>\s*<\/div>/m;

async function main() {
  const files = (await readdir(TEMPLATES_DIR)).filter((f) =>
    /^nav-\d+\.html$/.test(f),
  );
  let touched = 0;

  for (const file of files) {
    const path = join(TEMPLATES_DIR, file);
    const original = await readFile(path, "utf8");

    // Already in the right spot? Skip.
    if (
      /<div class="nav-socials">[\s\S]*?<a class="nav-cta"/.test(original)
    ) {
      console.log(`✓ skip ${file} (socials already before CTA)`);
      continue;
    }

    const match = original.match(SOCIALS_BLOCK_RE);
    if (!match) {
      console.warn(`! ${file}: no socials block found, skipping`);
      continue;
    }
    const socialsBlock = match[0];

    // Remove the socials from their current location...
    let next = original.replace(SOCIALS_BLOCK_RE, "");

    // ...and inject them right before the `<a class="nav-cta"` opening
    // tag. Preserve the original block's leading whitespace by trimming
    // and re-indenting to match the CTA line.
    const ctaRe = /(\n\s*)(<a class="nav-cta")/;
    if (!ctaRe.test(next)) {
      console.warn(`! ${file}: no <a class="nav-cta"> anchor found`);
      continue;
    }
    next = next.replace(ctaRe, `$1${socialsBlock.trim()}$1$2`);

    if (next !== original) {
      await writeFile(path, next, "utf8");
      console.log(`✓ ${file}`);
      touched++;
    }
  }

  console.log(`\nDone. ${touched} file${touched === 1 ? "" : "s"} moved.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
