#!/usr/bin/env node
/**
 * Converts an "old" client website (content.json + script.js renders DOM at runtime)
 * into a "static HTML" site where content lives directly in the HTML.
 *
 * Why: our inline editor works by editing HTML directly. If script.js re-renders
 * from content.json on every load, client edits get overwritten.
 *
 * How: spins up JSDOM, runs the site's own script.js against content.json,
 * snapshots the rendered DOM, strips the JSON-loading code, writes static HTML.
 *
 * Usage:
 *   node scripts/convert-old-site.mjs <site-folder>
 *   node scripts/convert-old-site.mjs "C:/Users/lorem/Desktop/client proposals/rendaw-4-3-2026-converted"
 */

import jsdom from "jsdom";
const { JSDOM } = jsdom;
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const siteDir = process.argv[2];
if (!siteDir) {
  console.error("Usage: node scripts/convert-old-site.mjs <site-folder>");
  process.exit(1);
}

const ABS_DIR = path.resolve(siteDir);

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function findHtmlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter(e => e.isFile() && e.name.endsWith(".html")).map(e => e.name);
}

async function convertPage(htmlFile) {
  const htmlPath = path.join(ABS_DIR, htmlFile);
  let html = await fs.readFile(htmlPath, "utf8");

  // Capture CDN script tags so we can restore them after conversion
  // (JSDOM would try to fetch them during parse, so we strip first, restore later)
  const cdnScripts = [];
  html = html.replace(/<script[^>]*src=["']https?:\/\/[^"']+["'][^>]*><\/script>/gi, (match) => {
    cdnScripts.push(match);
    return "";
  });

  // Inline the local script.js so JSDOM runs it during initial parse
  // (otherwise DOMContentLoaded fires before we can append it manually)
  const scriptPath = path.join(ABS_DIR, "script.js");
  if (await fileExists(scriptPath)) {
    const scriptCode = await fs.readFile(scriptPath, "utf8");
    // Wrap in a marker so we can identify and remove it after rendering
    const wrapped = `<script>/*__CONVERTER_INJECTED__*/\n${scriptCode}\n/*__CONVERTER_END__*/</script>`;
    html = html.replace(/<script[^>]*src=["'][^"']*script\.js[^"']*["'][^>]*><\/script>/g, wrapped);
  }

  console.log(`\n[Converting] ${htmlFile}`);

  // Pre-load content.json so we can shim fetch from beforeParse
  const contentPath = path.join(ABS_DIR, "content.json");
  let contentRaw = "";
  if (await fileExists(contentPath)) {
    contentRaw = await fs.readFile(contentPath, "utf8");
  }

  const dom = new JSDOM(html, {
    url: pathToFileURL(htmlPath).href,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      // Install fetch shim BEFORE the inline script runs
      window.fetch = (url) => {
        const u = String(url);
        if (u.includes("content.json") && contentRaw) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(JSON.parse(contentRaw)),
            text: () => Promise.resolve(contentRaw),
          });
        }
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}), text: () => Promise.resolve("") });
      };

      // Install stubs for browser APIs
      window.IntersectionObserver = class {
        observe() {} unobserve() {} disconnect() {}
        constructor(cb) { this._cb = cb; }
      };
      window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });

      // Stubs for external libs
      window.gsap = {
        registerPlugin() {}, to() {}, from() {}, fromTo() {}, set() {},
        timeline: () => ({ to() { return this; }, from() { return this; }, fromTo() { return this; }, set() { return this; } }),
        utils: { toArray: (x) => Array.from(typeof x === "string" ? window.document.querySelectorAll(x) : x) },
      };
      window.ScrollTrigger = { create() {}, refresh() {} };
      // Leave <i data-lucide="X"> tags untouched — real lucide script runs on live site
      window.lucide = { createIcons() { /* no-op during conversion */ } };
      window.GLightbox = () => ({ destroy() {}, on() {} });

      // Patch Image constructor so onload fires immediately (JSDOM doesn't fetch)
      // This is critical — script.js uses `new Image()` + onload to lazy-set background-image
      const OriginalImage = window.Image;
      window.Image = function ImageShim() {
        const img = new OriginalImage();
        Object.defineProperty(img, "src", {
          set(v) {
            this._src = v;
            // Fire onload synchronously on next tick
            Promise.resolve().then(() => {
              if (typeof this.onload === "function") this.onload();
            });
          },
          get() { return this._src; },
        });
        return img;
      };
    },
  });

  // Wait for fetch().then() chain + DOMContentLoaded handler to finish rendering
  await new Promise((r) => setTimeout(r, 2000));

  // Verify content actually rendered (sanity check)
  const renderedText = dom.window.document.body.textContent || "";
  if (renderedText.length < 500) {
    console.warn(`  ⚠ Body text only ${renderedText.length} chars — content may not have rendered`);
  }

  // Serialize back to HTML
  let serialized = dom.serialize();

  // Remove the inline injected script.js (content is now baked in)
  // Restore CDN scripts + reference to script.js (they were stripped before parsing)
  const restoredScripts = [...cdnScripts, `<script src="script.js?v=6"></script>`].join("\n");
  serialized = serialized.replace(
    /<script>\/\*__CONVERTER_INJECTED__\*\/[\s\S]*?\/\*__CONVERTER_END__\*\/<\/script>/g,
    restoredScripts
  );

  await fs.writeFile(htmlPath, serialized, "utf8");
  console.log(`  ✓ Wrote ${serialized.length} bytes (body text: ${renderedText.length} chars)`);

  dom.window.close();
}

async function modifyScriptJs() {
  const scriptPath = path.join(ABS_DIR, "script.js");
  if (!await fileExists(scriptPath)) return;
  let code = await fs.readFile(scriptPath, "utf8");

  // Wrap the entire content.json fetch + render block so it does NOTHING when running on live site.
  // Strategy: comment out the fetch loop. Keep the rest (animations, lucide, scroll handlers).

  // We add a guard at the top: if document already has rendered content, skip JSON loading.
  const guard = `
/* CONVERTER: content is now baked into HTML — skip JSON fetch + render */
window.__SK_STATIC_CONTENT__ = true;
`;

  // Find the fetch('content.json') block and wrap it in a no-op.
  // The original pattern: const path = ...; fetch(path).then(...).catch(...);
  // Our edit: if (window.__SK_STATIC_CONTENT__) return;  — at the top of the IIFE that does the fetch
  if (!code.startsWith(guard)) {
    code = guard + "\n" + code;
  }

  // Replace ANY fetch() call that loads content.json with a no-op resolved promise.
  // Returns ok: true with empty sections — so renderSection loops do nothing,
  // but theme/UI init code (animations, navbar, lightbox, etc.) still runs.
  code = code.replace(
    /fetch\(\s*(?:jsonPath|contentPath|['"][^'"]*content\.json[^'"]*['"])\s*\)/g,
    "Promise.resolve({ ok: true, json: () => Promise.resolve({ sections: [], theme: null, fonts: null }) })"
  );

  await fs.writeFile(scriptPath, code, "utf8");
  console.log(`\n[Modified] script.js — JSON fetch disabled, animations/UI code preserved`);
}

async function main() {
  if (!await fileExists(ABS_DIR)) {
    console.error(`Folder not found: ${ABS_DIR}`);
    process.exit(1);
  }

  const htmlFiles = await findHtmlFiles(ABS_DIR);
  if (htmlFiles.length === 0) {
    console.error("No HTML files found");
    process.exit(1);
  }

  console.log(`Site folder: ${ABS_DIR}`);
  console.log(`HTML files:  ${htmlFiles.join(", ")}`);

  for (const file of htmlFiles) {
    await convertPage(file);
  }

  await modifyScriptJs();

  // Delete content.json — no longer used (content is baked into HTML)
  const contentPath = path.join(ABS_DIR, "content.json");
  if (await fileExists(contentPath)) {
    await fs.unlink(contentPath);
    console.log(`\n[Deleted] content.json — no longer needed`);
  }

  console.log(`\n[Done] Converted site at: ${ABS_DIR}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Open ${path.join(ABS_DIR, "index.html")} in a browser to verify visually`);
  console.log(`  2. Compare with the original folder side-by-side`);
}

main().catch((err) => { console.error(err); process.exit(1); });
