import { load, type CheerioAPI } from "cheerio";

export interface HtmlChange {
  css_path: string;
  section?: string | null;
  field?: string | null;
  item_id?: string | null;
  action: "update_text" | "replace_image" | "add_gallery_image" | "remove_gallery_image";
  old_value: string;
  new_value: string;
  gallery_id?: string | null;
}

export interface ApplyResult {
  applied: HtmlChange[];
  conflicts: Array<{
    change: HtmlChange;
    current_value: string;
    reason: string;
  }>;
}

/**
 * Apply approved changes to an HTML string using cheerio.
 * Returns the modified HTML and a result showing which changes applied vs conflicted.
 */
export function applyChangesToHtml(
  html: string,
  changes: HtmlChange[]
): { html: string; result: ApplyResult } {
  const $ = load(html);
  const result: ApplyResult = { applied: [], conflicts: [] };

  for (const change of changes) {
    // ── Gallery add: append a new cell to the gallery grid ──
    // Handles BOTH flat grids (cert-style: <div><img></div>) and nested grids
    // (gallery-style: <div><figure><a><img></a></figure></div>) — clones the last
    // existing cell so the new image inherits the wrapper structure (lightbox attrs etc.)
    if (change.action === "add_gallery_image") {
      let container = $();
      if (change.gallery_id) {
        const matched = $(`[data-gallery="${change.gallery_id}"]`);
        if (matched.length === 1) {
          container = matched;
        } else if (matched.length > 1) {
          // data-gallery is on inner anchors (GLightbox pattern) — find common parent
          const totalCount = matched.length;
          let parent = matched.first().parent();
          while (parent.length > 0 && parent[0].tagName !== "body") {
            if (parent.find(`[data-gallery="${change.gallery_id}"]`).length === totalCount) {
              container = parent;
              break;
            }
            parent = parent.parent();
          }
        }
      }
      if (container.length === 0 && change.css_path) {
        try { container = $(change.css_path); } catch {}
      }
      if (container.length === 0) {
        result.conflicts.push({ change, current_value: "", reason: "Gallery container not found" });
        continue;
      }
      // Resolve the actual grid container (count cells: child is img, or contains img)
      let grid = container.first();
      const cellCount = (node: ReturnType<CheerioAPI>) =>
        node.children().filter((_, c) => $(c).is("img") || $(c).find("img").length > 0).length;
      if (cellCount(grid) < 2) {
        // Drill down
        const inner = grid.find("*").filter((_, el) => cellCount($(el)) >= 2);
        if (inner.length > 0) grid = inner.first();
        else {
          // Walk up
          let cur = grid.parent();
          while (cur.length > 0 && cur[0].tagName !== "body") {
            if (cellCount(cur) >= 2) { grid = cur; break; }
            cur = cur.parent();
          }
        }
      }
      // Clone the last existing cell to preserve wrapper structure (figure/anchor/etc.)
      const lastCell = grid.children()
        .filter((_, c) => $(c).is("img") || $(c).find("img").length > 0)
        .last();
      if (lastCell.length > 0 && !lastCell.is("img")) {
        const $clone = lastCell.clone();
        const innerImg = $clone.find("img").first();
        if (innerImg.length > 0) {
          innerImg.attr("src", change.new_value);
          innerImg.removeAttr("srcset");
          innerImg.removeAttr("width");
          innerImg.removeAttr("height");
          innerImg.attr("alt", "");
        }
        const innerA = $clone.find("a").first();
        if (innerA.length > 0) innerA.attr("href", change.new_value);
        $clone.removeAttr("data-item");
        grid.append($clone);
      } else {
        grid.append(`<img src="${change.new_value}" alt="" loading="lazy">`);
      }
      result.applied.push(change);
      continue;
    }

    // ── Gallery remove: delete the cell (wrapper figure/li/etc. or bare img) ──
    if (change.action === "remove_gallery_image") {
      let target = $();
      if (change.css_path) { try { target = $(change.css_path); } catch {} }
      if (target.length === 0 && change.gallery_id && change.old_value) {
        // Fallback: match by src inside gallery container
        const container = $(`[data-gallery="${change.gallery_id}"]`);
        target = container.find("img").filter((_, el) => {
          const src = $(el).attr("src") || "";
          return normalizeImagePath(src) === normalizeImagePath(change.old_value);
        });
        // If gallery_id is on inner anchors, also search ancestors of those matches
        if (target.length === 0) {
          $(`[data-gallery="${change.gallery_id}"]`).each((_, el) => {
            const $el = $(el);
            const inner = $el.find("img").filter((__, img) => normalizeImagePath($(img).attr("src") || "") === normalizeImagePath(change.old_value));
            if (inner.length > 0) target = target.add(inner);
          });
        }
      }
      if (target.length === 0) {
        result.conflicts.push({ change, current_value: "", reason: "Gallery image not found (may have already been removed)" });
        continue;
      }
      // Remove the wrapping cell (figure/li/[data-item]) if present, else the img itself
      const img = target.first();
      const wrapper = img.closest("figure, li, [data-item]");
      if (wrapper.length > 0) wrapper.remove();
      else img.remove();
      result.applied.push(change);
      continue;
    }

    // Try to find the element — data attributes first, CSS path fallback
    let el: ReturnType<CheerioAPI> | null = null;

    // Priority 1: data-section + data-field + data-item
    if (change.section && change.field) {
      let selector: string;
      if (change.item_id) {
        selector = `[data-section="${change.section}"] [data-item="${change.item_id}"] [data-field="${change.field}"]`;
      } else {
        selector = `[data-section="${change.section}"] [data-field="${change.field}"]`;
      }
      const found = $(selector);
      if (found.length > 0) el = found.first();
    }

    // Priority 2: CSS path
    if (!el || el.length === 0) {
      try {
        const found = $(change.css_path);
        if (found.length > 0) el = found.first();
      } catch {
        // Invalid CSS selector
      }
    }

    // Element not found
    if (!el || el.length === 0) {
      result.conflicts.push({
        change,
        current_value: "",
        reason: "Element not found in current HTML — may have been moved or removed",
      });
      continue;
    }

    // Conflict check: verify old_value matches current content
    const isImage = change.action === "replace_image";
    const currentValue = isImage
      ? (el.attr("src") || el.css("background-image")?.replace(/url\(['"]?|['"]?\)/g, "") || "")
      : (el.text() || "").trim();

    const oldValueTrimmed = (change.old_value || "").trim();

    // For text, compare trimmed. For images, compare normalized paths.
    const matches = isImage
      ? normalizeImagePath(currentValue) === normalizeImagePath(oldValueTrimmed)
      : currentValue === oldValueTrimmed;

    if (!matches) {
      result.conflicts.push({
        change,
        current_value: currentValue,
        reason: "Field was modified since the client's edit",
      });
      continue;
    }

    // Apply the change
    if (isImage) {
      if (el.is("img")) {
        el.attr("src", change.new_value);
      } else {
        // Background image on a div or similar
        const currentStyle = el.attr("style") || "";
        const newStyle = currentStyle.replace(
          /background-image:\s*url\([^)]+\)/i,
          `background-image: url('${change.new_value}')`
        );
        el.attr("style", newStyle || `background-image: url('${change.new_value}')`);
      }
    } else {
      el.text(change.new_value);
    }

    result.applied.push(change);
  }

  return { html: $.html(), result };
}

/** Normalize image paths for comparison (strip protocol, trailing slashes, query params) */
function normalizeImagePath(path: string): string {
  return path
    .replace(/^https?:\/\//, "")
    .replace(/\?.*$/, "")
    .replace(/\/+$/, "")
    .trim();
}
