// @ts-check
/**
 * One-shot: inject the Facebook + Instagram social block into every
 * nav template, right after the hamburger button. Idempotent — if the
 * block already exists in a file, that file is skipped.
 *
 * The CSS for `.nav-socials` / `.nav-social` lives in
 * `public/template-base.css` so we only need to add HTML here.
 *
 * Run once with `node scripts/add-nav-socials.mjs`. Then push each
 * touched nav with `npx tsx scripts/push-template.ts <name>`.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(HERE, "..", "public", "sample-templates");

const SOCIAL_BLOCK = `\n\n    <!-- Socials: FB + IG. Each is a link field with hide/restore
         via the composer's hidden_fields toggle. After the hamburger
         in DOM so desktop reads "[Logo] [Menu] [CTA] [FB] [IG]" and
         mobile reads "[Logo] ... [Hamburger] [FB] [IG]". -->
    <div class="nav-socials">
      <a class="nav-social" data-field="nav_facebook" data-type="link" href="https://facebook.com" target="_blank" rel="noopener" aria-label="Facebook">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95z"/></svg>
      </a>
      <a class="nav-social" data-field="nav_instagram" data-type="link" href="https://instagram.com" target="_blank" rel="noopener" aria-label="Instagram">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
      </a>
    </div>`;

async function main() {
  const files = (await readdir(TEMPLATES_DIR)).filter(
    (f) => /^nav-\d+\.html$/.test(f),
  );
  let touched = 0;
  for (const file of files) {
    const path = join(TEMPLATES_DIR, file);
    const original = await readFile(path, "utf8");

    if (original.includes('data-field="nav_facebook"')) {
      console.log(`✓ skip ${file} (already has socials)`);
      continue;
    }

    // Find the hamburger button's closing tag. The standard hamburger
    // markup across every nav-XX is three spans inside a button:
    //     <button class="hamburger" ...>
    //       <span></span><span></span><span></span>
    //     </button>
    // We anchor on the `</button>` line so we can inject the socials
    // immediately after it, before the `.nav-inner` closing div.
    const hamburgerCloseRe = /(<\/button>)(\s*\n\s*<\/div>)/;
    if (!hamburgerCloseRe.test(original)) {
      console.warn(`! ${file}: no hamburger </button> + </div> pattern found, skipping`);
      continue;
    }

    const next = original.replace(
      hamburgerCloseRe,
      `$1${SOCIAL_BLOCK}\n$2`,
    );

    if (next !== original) {
      await writeFile(path, next, "utf8");
      console.log(`✓ ${file}`);
      touched++;
    }
  }
  console.log(`\nDone. ${touched} file${touched === 1 ? "" : "s"} touched.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
