import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Check every published template's CSS for font-family usage.
  const { data: rows } = await admin
    .from("section_templates")
    .select("name, category, css_path")
    .order("category")
    .order("name");

  if (!rows) {
    console.log("No templates found");
    return;
  }

  console.log("Template fontFAMILY audit:");
  console.log("=".repeat(70));
  for (const row of rows) {
    if (!row.css_path) continue;
    const { data: blob } = await admin.storage
      .from("section-templates")
      .download(row.css_path);
    if (!blob) continue;
    const css = await blob.text();
    const declarations = (css.match(/font-family:[^;]+;/g) || []).map((s) =>
      s.trim(),
    );
    const usesVar = declarations.some((d) => d.includes("var(--font"));
    const hasHardcoded = declarations.some(
      (d) => !d.includes("var(") && !d.includes("inherit"),
    );
    const status = hasHardcoded
      ? "HARDCODED ⚠️"
      : usesVar
        ? "var ✓"
        : "(no font)";
    console.log(
      `${row.category}/${row.name.padEnd(20)} ${status.padEnd(15)} ${declarations.length} decls`,
    );
    if (hasHardcoded) {
      declarations
        .filter((d) => !d.includes("var(") && !d.includes("inherit"))
        .forEach((d) => console.log(`   ⚠️  ${d}`));
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
