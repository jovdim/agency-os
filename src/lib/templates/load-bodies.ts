import { readFileSync, statSync } from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { load as loadCheerio } from "cheerio";
import type { TemplateBody } from "./render-browser";
import type { PlaceholderSchema } from "./parser";

/**
 * Server-side: download every template's HTML body + CSS from storage in parallel.
 * Returns a record keyed by template id, ready to pass as a serializable prop.
 *
 * The composer page calls this once at load time, then the client uses the
 * pre-loaded bodies to re-render the preview locally on every edit (no server
 * round-trip per change).
 */
export async function loadTemplateBodies(
  admin: SupabaseClient,
  templates: Array<{
    id: string;
    category: string;
    name: string;
    html_path: string;
    css_path: string | null;
    placeholder_schema: PlaceholderSchema;
  }>,
): Promise<Record<string, TemplateBody>> {
  const result: Record<string, TemplateBody> = {};

  await Promise.all(
    templates.map(async (t) => {
      const { data: htmlBlob } = await admin.storage
        .from("section-templates")
        .download(t.html_path);
      const html = htmlBlob ? await htmlBlob.text() : "";

      let css = "";
      if (t.css_path) {
        const { data: cssBlob } = await admin.storage
          .from("section-templates")
          .download(t.css_path);
        if (cssBlob) css = await cssBlob.text();
      }

      // Extract the section root's `id` attribute for the composer's
      // "this section's anchor is #X" display + the renderer's default
      // when no override exists. The stored HTML is the inner section
      // body (parser already stripped SECTION markers), so cheerio's
      // auto-wrap puts the section root as the first body child.
      let defaultSectionId: string | null = null;
      try {
        const $ = loadCheerio(html, { xmlMode: false });
        defaultSectionId =
          $("body").children().first().attr("id")?.trim() || null;
      } catch {
        defaultSectionId = null;
      }

      result[t.id] = {
        id: t.id,
        category: t.category,
        name: t.name,
        html,
        css,
        schema: t.placeholder_schema ?? {},
        defaultSectionId,
      };
    }),
  );

  return result;
}

let cachedBaseCss: string | null = null;
let cachedBaseCssMtimeMs: number | null = null;
export function loadBaseCss(): string {
  const baseCssPath = path.join(process.cwd(), "public", "template-base.css");
  try {
    const mtimeMs = statSync(baseCssPath).mtimeMs;
    if (cachedBaseCss !== null && cachedBaseCssMtimeMs === mtimeMs) {
      return cachedBaseCss;
    }
    cachedBaseCss = readFileSync(baseCssPath, "utf8");
    cachedBaseCssMtimeMs = mtimeMs;
  } catch {
    cachedBaseCss = "";
    cachedBaseCssMtimeMs = null;
  }
  return cachedBaseCss;
}
