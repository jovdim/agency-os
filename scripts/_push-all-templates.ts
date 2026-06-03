/**
 * One-off bulk pusher for the English clone: uploads every template in
 * public/sample-templates to the section-templates Storage bucket and
 * upserts its section_templates row. Mirrors push-template.ts exactly so
 * the placeholder_schema is identical. Self-locating (cwd-independent).
 *
 * Run: node_modules/.bin/tsx scripts/_push-all-templates.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { parseTemplateHtml } from "../src/lib/templates/parser";

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});

async function main(): Promise<void> {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const TPL_DIR = join(ROOT, "public", "sample-templates");

  const env: Record<string, string> = {};
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const files = readdirSync(TPL_DIR).filter((f) => f.endsWith(".html")).sort();
  let pushed = 0;
  const skipped: string[] = [];
  const failed: string[] = [];

  for (const file of files) {
    const name = file.replace(/\.html$/, "");
    let raw: string;
    try {
      raw = readFileSync(join(TPL_DIR, file), "utf8");
    } catch {
      failed.push(`${name}(read)`);
      continue;
    }
    let parsed: ReturnType<typeof parseTemplateHtml>;
    try {
      parsed = parseTemplateHtml(raw);
    } catch (e) {
      failed.push(`${name}(parse:${e instanceof Error ? e.message : e})`);
      continue;
    }
    if (!parsed.category) {
      skipped.push(name);
      continue;
    }
    const category = parsed.category;
    const htmlPath = `${category}/${name}.html`;
    const cssPath = parsed.css.trim() ? `${category}/${name}.css` : null;

    const { error: hErr } = await admin.storage
      .from("section-templates")
      .upload(htmlPath, parsed.html, { contentType: "text/html", upsert: true, cacheControl: "0" });
    if (hErr) {
      failed.push(`${name}(html:${hErr.message})`);
      continue;
    }
    if (cssPath) {
      const { error: cErr } = await admin.storage
        .from("section-templates")
        .upload(cssPath, parsed.css, { contentType: "text/css", upsert: true, cacheControl: "0" });
      if (cErr) {
        failed.push(`${name}(css:${cErr.message})`);
        continue;
      }
    }

    const { data: existing } = await admin
      .from("section_templates")
      .select("id, version")
      .eq("category", category)
      .eq("name", name)
      .maybeSingle();

    if (existing) {
      const { error } = await admin
        .from("section_templates")
        .update({
          placeholder_schema: parsed.placeholderSchema,
          css_path: cssPath,
          html_path: htmlPath,
          version: existing.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (error) {
        failed.push(`${name}(update:${error.message})`);
        continue;
      }
    } else {
      const { error } = await admin.from("section_templates").insert({
        category,
        name,
        html_path: htmlPath,
        css_path: cssPath,
        preview_image: null,
        placeholder_schema: parsed.placeholderSchema,
        tags: [],
        industry_hints: [],
        is_published: true,
        version: 1,
      });
      if (error) {
        failed.push(`${name}(insert:${error.message})`);
        continue;
      }
    }
    pushed++;
    console.log(`  + ${name} -> ${category}`);
  }

  console.log(`\nPushed ${pushed}/${files.length}.`);
  console.log(`Skipped (no SECTION category marker): ${skipped.length ? skipped.join(", ") : "none"}`);
  if (failed.length) console.log(`FAILED (${failed.length}): ${failed.join(" | ")}`);
}
