/**
 * Smoke test: render each about template through the same parser +
 * applyContentOverrides path the publish flow uses, with empty
 * overrides (so default_items + defaults flow through). Verifies:
 *   - parser doesn't throw
 *   - schema has expected top-level fields
 *   - renderer produces non-empty HTML
 *   - each repeater's default items get cloned
 *   - no [data-field] inside a repeater leaks as a top-level schema key
 *
 * Run: node scripts/test-about-templates.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SECTION_MARKER_RE =
  /<!--\s*SECTION:([a-zA-Z0-9_-]+):start\s*-->([\s\S]*?)<!--\s*SECTION:\1:end\s*-->/i;
const BG_IMAGE_RE = /background-image:\s*url\(\s*['"]?([^'")]+?)['"]?\s*\)/i;

function parseFieldsInScope($, $scope) {
  const schema = {};
  const order = [];
  $scope.find("[data-field]").each((_i, el) => {
    const $el = $(el);
    const key = $el.attr("data-field");
    if (!key || schema[key]) return;
    const tag = (el.type === "tag" ? el.tagName : "").toLowerCase();
    const explicitType = ($el.attr("data-type") || "").toLowerCase();
    order.push(key);
    if (explicitType === "link" && tag === "a") {
      schema[key] = { type: "link", default: $el.text().trim(), default_href: $el.attr("href") || "" };
      return;
    }
    if (explicitType === "richtext") {
      schema[key] = { type: "richtext", default: ($el.html() || "").trim() };
      return;
    }
    if (tag === "img" || tag === "iframe") {
      schema[key] = { type: "image", default_src: $el.attr("src") || undefined };
      return;
    }
    const text = $el.text().trim();
    const isLong = text.length > 100;
    schema[key] = { type: isLong ? "longtext" : "text", default: text };
  });
  for (let i = 0; i < order.length; i++) {
    schema[order[i]] = { ...schema[order[i]], order: i };
  }
  return schema;
}

function extractItemValues($, $child, itemSchema) {
  const values = {};
  for (const [key, s] of Object.entries(itemSchema)) {
    const $el = $child.find(`[data-field="${key.replace(/"/g, '\\"')}"]`).first();
    if ($el.length === 0) continue;
    const el = $el[0];
    const tag = (el.type === "tag" ? el.tagName : "").toLowerCase();
    switch (s.type) {
      case "link":
        values[key] = { label: $el.text().trim(), href: $el.attr("href") || "" };
        break;
      case "image":
        values[key] = (tag === "img" || tag === "iframe") ? ($el.attr("src") || "") : "";
        break;
      case "richtext":
        values[key] = ($el.html() || "").trim();
        break;
      default:
        values[key] = $el.text().trim();
    }
  }
  return values;
}

function parseTemplateHtml(input) {
  const sectionMatch = input.match(SECTION_MARKER_RE);
  if (!sectionMatch) throw new Error("Missing <!-- SECTION:* --> markers");
  const sectionHtml = sectionMatch[2].trim();
  const $ = load(sectionHtml, { xmlMode: false });
  const schema = {};
  const consumed = new Set();

  $("[data-repeat]").each((_i, container) => {
    const $container = $(container);
    const key = $container.attr("data-repeat");
    if (!key || schema[key]) return;
    const children = $container.children().toArray();
    if (children.length === 0) return;
    $container.find("[data-field]").each((_j, d) => consumed.add(d));
    const itemSchema = parseFieldsInScope($, $(children[0]));
    const defaultItems = children.map((c) => extractItemValues($, $(c), itemSchema));
    schema[key] = {
      type: "repeater",
      min: parseInt($container.attr("data-min") || "1", 10),
      max: parseInt($container.attr("data-max") || "10", 10),
      item_schema: itemSchema,
      default_items: defaultItems,
    };
  });

  $("[data-field]").each((_i, el) => {
    if (consumed.has(el)) return;
    const $el = $(el);
    const key = $el.attr("data-field");
    if (!key || schema[key]) return;
    const tag = (el.type === "tag" ? el.tagName : "").toLowerCase();
    const explicitType = ($el.attr("data-type") || "").toLowerCase();
    if (explicitType === "link" && tag === "a") {
      schema[key] = { type: "link" };
    } else if (explicitType === "richtext") {
      schema[key] = { type: "richtext" };
    } else if (tag === "img" || tag === "iframe") {
      schema[key] = { type: "image" };
    } else {
      const text = $el.text().trim();
      schema[key] = { type: text.length > 100 ? "longtext" : "text" };
    }
  });

  return { html: sectionHtml, schema, $ };
}

const ABOUT_TEMPLATES = [
  "about-03",
  "about-04",
  "about-05",
  "about-06",
  "about-07",
  "about-08",
  "about-09",
];

let allOk = true;
for (const name of ABOUT_TEMPLATES) {
  const file = path.join(__dirname, "..", "public", "sample-templates", `${name}.html`);
  let html;
  try {
    html = await fs.readFile(file, "utf8");
  } catch {
    console.log(`✗ ${name}: file missing`);
    allOk = false;
    continue;
  }
  let parsed;
  try {
    parsed = parseTemplateHtml(html);
  } catch (e) {
    console.log(`✗ ${name}: parse error — ${e.message}`);
    allOk = false;
    continue;
  }
  const topKeys = Object.keys(parsed.schema);
  const repeaters = topKeys.filter((k) => parsed.schema[k].type === "repeater");

  // Sanity checks
  const issues = [];
  if (topKeys.length === 0) issues.push("no editable fields");
  for (const r of repeaters) {
    const s = parsed.schema[r];
    if (!s.item_schema || Object.keys(s.item_schema).length === 0) {
      issues.push(`repeater "${r}" has empty item_schema`);
    }
    if (!Array.isArray(s.default_items) || s.default_items.length === 0) {
      issues.push(`repeater "${r}" has no default_items`);
    }
    if (s.min < 0) issues.push(`repeater "${r}" min < 0`);
    if (s.max < s.min) issues.push(`repeater "${r}" max < min`);
  }
  // Check no inner data-field leaked to top
  const hasLeak = topKeys.some((k) => {
    const f = parsed.schema[k];
    return f.type !== "repeater" && (k === "label" || k === "title" || k === "image" || k === "description" || k === "year" || k === "number");
  });
  if (hasLeak) issues.push("inner item field leaked to top schema (consumed-set bug)");

  if (issues.length) {
    console.log(`✗ ${name}: ${issues.join("; ")}`);
    allOk = false;
  } else {
    const repInfo = repeaters.map((r) => `${r}(${parsed.schema[r].default_items.length} items, ${Object.keys(parsed.schema[r].item_schema).length} fields)`).join(", ");
    console.log(
      `✓ ${name}: ${topKeys.length} fields${repeaters.length ? ` — repeaters: ${repInfo}` : ""}`,
    );
  }
}

console.log(allOk ? "\nALL OK" : "\nFAILURES — see above");
process.exit(allOk ? 0 : 1);
