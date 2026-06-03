/**
 * Template Rendering Engine
 *
 * Merges HTML design templates with content data to produce rendered pages.
 * Pure function — no framework dependencies. Works server-side only.
 *
 * Directive syntax (in HTML template files):
 *
 *   {{section_type.field_name}}                    — Insert field value
 *
 *   <!-- repeater:section_type.array_field -->
 *     <div>{{field_name}}</div>                    — Scoped to current item
 *   <!-- /repeater:section_type.array_field -->    — Repeater block
 *
 *   <!-- if:section_type.field -->
 *     ...content shown when field is truthy...
 *   <!-- /if:section_type.field -->                — Conditional block
 */

export interface RenderSection {
  type: string;
  label?: string;
  order?: number;
  fields?: Record<string, unknown>;
}

export interface RenderContent {
  sections: RenderSection[];
}

type SectionMap = Record<string, Record<string, unknown>>;

/**
 * Render an HTML template with content data.
 *
 * @param html         Raw HTML with placeholder directives
 * @param content      Content data (sections array)
 * @param assetsBase   Public URL base for resolving relative assets (CSS, JS, images)
 * @returns            Fully rendered HTML string
 */
export function renderTemplate(
  html: string,
  content: RenderContent,
  assetsBase: string,
): string {
  const map = buildSectionMap(content.sections);

  let result = html;

  // 1. Inject <base> for relative asset resolution (CSS, JS, images)
  result = injectBase(result, assetsBase);

  // 2. Process conditional blocks (must run before repeaters — conditionals may wrap repeaters)
  result = processConditionals(result, map);

  // 3. Expand repeater blocks
  result = processRepeaters(result, map);

  // 4. Replace simple placeholders
  result = replacePlaceholders(result, map);

  // 5. Strip any unresolved placeholders
  result = result.replace(/\{\{[a-zA-Z_][\w.]*\}\}/g, "");

  return result;
}

// ── Internals ──────────────────────────────────────────────────────────

function buildSectionMap(sections: RenderSection[]): SectionMap {
  const map: SectionMap = {};
  for (const s of sections) {
    map[s.type] = s.fields || {};
  }
  return map;
}

function injectBase(html: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  const match = html.match(/<head([^>]*)>/i);
  if (!match || match.index === undefined) return html;
  const pos = match.index + match[0].length;
  return html.slice(0, pos) + `\n  <base href="${base}">` + html.slice(pos);
}

function processConditionals(html: string, map: SectionMap): string {
  // Pattern: <!-- if:section.field --> ... <!-- /if:section.field -->
  return html.replace(
    /<!--\s*if:(\w+)\.(\w+)\s*-->([\s\S]*?)<!--\s*\/if:\1\.\2\s*-->/g,
    (_, section, field, inner) => {
      const val = map[section]?.[field];
      return val !== undefined && val !== null && val !== "" && val !== false
        ? inner
        : "";
    },
  );
}

function processRepeaters(html: string, map: SectionMap): string {
  // Pattern: <!-- repeater:section.field --> ... <!-- /repeater:section.field -->
  return html.replace(
    /<!--\s*repeater:(\w+)\.(\w+)\s*-->([\s\S]*?)<!--\s*\/repeater:\1\.\2\s*-->/g,
    (_, section, field, template) => {
      const items = map[section]?.[field];
      if (!Array.isArray(items) || items.length === 0) return "";

      return items
        .map((item: Record<string, unknown>, idx: number) => {
          let rendered = template;
          // Replace {{field}} placeholders scoped to this item
          rendered = rendered.replace(
            /\{\{(\w+)\}\}/g,
            (_match: string, key: string) => {
              if (key === "_index") return String(idx + 1);
              if (key === "_total") return String(items.length);
              const v = item[key];
              return v !== undefined && v !== null ? String(v) : "";
            },
          );
          return rendered;
        })
        .join("\n");
    },
  );
}

function replacePlaceholders(html: string, map: SectionMap): string {
  // Pattern: {{section_type.field_name}}
  return html.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_, section, field) => {
    const val = map[section]?.[field];
    if (val === undefined || val === null) return "";
    if (typeof val === "object") return ""; // Don't stringify arrays/objects
    return String(val);
  });
}

/**
 * Generate a styled fallback page when no HTML template file exists.
 * Shows the content data in a clean, presentable layout.
 */
export function renderFallbackPage(
  content: RenderContent | null,
  companyName: string,
): string {
  const sections = content?.sections || [];

  const sectionHtml = sections
    .map((s) => {
      const fields = s.fields || {};
      const entries = Object.entries(fields);
      if (entries.length === 0) return "";

      const heading =
        (fields.heading as string) ||
        (fields.title as string) ||
        s.label ||
        s.type.replace(/_/g, " ");

      const fieldsHtml = entries
        .filter(([k]) => k !== "heading" && k !== "title")
        .map(([key, value]) => {
          if (Array.isArray(value)) {
            const itemsHtml = value
              .map((item: Record<string, unknown>) => {
                if (typeof item !== "object" || !item)
                  return `<li>${String(item)}</li>`;
                const parts = Object.entries(item)
                  .filter(([k]) => k !== "id")
                  .map(([k, v]) => {
                    if (
                      /image|url|src|photo/i.test(k) &&
                      typeof v === "string" &&
                      v.startsWith("http")
                    ) {
                      return `<img src="${v}" alt="${k}" style="max-width:200px;border-radius:8px;margin:4px 0">`;
                    }
                    return `<strong>${k}:</strong> ${String(v || "")}`;
                  })
                  .join(" &middot; ");
                return `<li style="margin-bottom:8px">${parts}</li>`;
              })
              .join("");
            return `<div style="margin:12px 0"><strong style="text-transform:capitalize">${key.replace(/_/g, " ")}:</strong><ul style="list-style:none;padding-left:12px;margin-top:4px">${itemsHtml}</ul></div>`;
          }
          const str = String(value || "");
          if (!str) return "";
          if (
            /image|url|src|photo|background/i.test(key) &&
            str.startsWith("http")
          ) {
            return `<div style="margin:12px 0"><img src="${str}" alt="${key}" style="max-width:100%;border-radius:8px"></div>`;
          }
          return `<div style="margin:8px 0"><span style="color:#888;text-transform:capitalize">${key.replace(/_/g, " ")}:</span> ${str}</div>`;
        })
        .filter(Boolean)
        .join("");

      return `<section style="padding:32px 0;border-bottom:1px solid #eee"><h2 style="text-transform:capitalize;margin-bottom:16px">${heading}</h2>${fieldsHtml}</section>`;
    })
    .filter(Boolean)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${companyName} — Website Proposal</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1a1a1a;line-height:1.6;max-width:800px;margin:0 auto;padding:24px 20px}
    h1{font-size:2em;margin-bottom:8px}
    h2{font-size:1.3em;color:#333}
    img{display:block}
    .header{text-align:center;padding:48px 0 32px;border-bottom:2px solid #333}
    .subtitle{color:#666;font-size:0.95em}
    .footer{text-align:center;padding:32px 0;color:#999;font-size:0.8em}
  </style>
</head>
<body>
  <div class="header">
    <h1>${companyName}</h1>
    <p class="subtitle">Website Proposal Preview</p>
  </div>
  ${sectionHtml}
  <div class="footer">
    <p>This is a content preview. The final website will use a professional design template.</p>
  </div>
</body>
</html>`;
}
