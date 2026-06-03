/**
 * Pull the CSS for every nav template from Supabase Storage and check
 * whether the new "canonical logo pattern" (height: 100%; width: auto)
 * is actually there. Run after push-template.ts to confirm the upload
 * landed and the composer/publish will see the right CSS.
 *
 * Usage: npx tsx scripts/check-nav-storage.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const env: Record<string, string> = {};
for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  const navs = ["nav-01", "nav-02", "nav-03", "nav-04", "nav-05", "nav-06"];
  for (const name of navs) {
    const { data, error } = await admin.storage
      .from("section-templates")
      .download(`nav/${name}.css`);
    if (error || !data) {
      console.log(`✗ ${name}.css — DOWNLOAD FAILED: ${error?.message}`);
      continue;
    }
    const css = await data.text();
    // Check for canonical-pattern markers
    const hasHeight100 = /\.logo img\s*\{[^}]*height:\s*100%/.test(css);
    const hasAutoWidth = /\.logo img\s*\{[^}]*width:\s*auto/.test(css);
    const hasOldEnvelope = /\.logo\s*\{[^}]*width:\s*180px[^}]*height:\s*44px/.test(css);
    const hasOldEnvelopeSmall = /\.logo\s*\{[^}]*width:\s*150px[^}]*height:\s*38px/.test(css);
    const hasObjectFit = /object-fit:\s*contain/.test(css);
    const status = hasHeight100 && hasAutoWidth && !hasOldEnvelope && !hasOldEnvelopeSmall
      ? "✓ NEW CANONICAL"
      : (hasOldEnvelope || hasOldEnvelopeSmall)
        ? "✗ STILL OLD ENVELOPE"
        : "? UNKNOWN";
    console.log(`${status}  ${name}.css  (${css.length} bytes)`);
    if (hasObjectFit) console.log(`    └─ still has object-fit: contain rule (leftover)`);

    // Also compare against on-disk source
    const sourcePath = join(process.cwd(), "public", "sample-templates", `${name}.html`);
    const source = readFileSync(sourcePath, "utf8");
    const sourceHasHeight100 = /\.logo img\s*\{[^}]*height:\s*100%/.test(source);
    if (hasHeight100 !== sourceHasHeight100) {
      console.log(`    └─ DRIFT: source has=${sourceHasHeight100}, storage has=${hasHeight100}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
