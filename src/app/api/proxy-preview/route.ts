import { NextRequest } from "next/server";
import { INLINE_EDITOR_SCRIPT, INLINE_EDITOR_CSS } from "@/lib/inline-editor-script";

/**
 * GET /api/proxy-preview?url=https://site.sk&mode=inline-edit
 *
 * Proxies a website URL and injects scripts based on mode.
 * No link rewriting — all navigation blocked inside iframe.
 * Pages are discovered by the injected script scanning the DOM.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return new Response("Missing url parameter", { status: 400 });
  }

  const mode = req.nextUrl.searchParams.get("mode") || "preview";

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "SK-Dashboard-Preview/1.0" },
    });

    if (!res.ok) {
      return new Response(`Failed to fetch: ${res.status}`, { status: res.status });
    }

    // Read as buffer and decode with correct charset
    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "";
    const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
    const charset = charsetMatch ? charsetMatch[1] : "utf-8";
    let html = new TextDecoder(charset, { fatal: false }).decode(buffer);

    const parsed = new URL(url);
    const siteOrigin = parsed.origin;
    const baseHref = `${siteOrigin}${parsed.pathname.replace(/[^/]*$/, "")}`;

    // Inject <base> AFTER charset meta (so browser parses charset first)
    const charsetMetaRegex = /<meta[^>]*charset[^>]*>/i;
    if (charsetMetaRegex.test(html)) {
      html = html.replace(charsetMetaRegex, (match) => `${match}\n<base href="${baseHref}">`);
    } else {
      html = html.replace(/<head([^>]*)>/i, (match) => `${match}\n<meta charset="UTF-8">\n<base href="${baseHref}">`);
    }

    // Inject mode-specific scripts before </body>
    let injection = "";

    if (mode === "inline-edit") {
      injection = `\n<style>${INLINE_EDITOR_CSS}</style>\n<script>${INLINE_EDITOR_SCRIPT}</script>`;

    } else if (mode === "review") {
      injection = `
<style>
.sk-review-changed { outline: 2px solid rgba(249,115,22,0.7) !important; outline-offset: 2px; position: relative; }
.sk-review-changed::after { content: 'Changed'; position: absolute; top: -18px; left: 0; font-size: 10px; background: #f97316; color: white; padding: 1px 6px; border-radius: 3px; z-index: 9999; font-family: sans-serif; }
.sk-review-flash {
  outline: 3px solid rgba(59, 130, 246, 0.8) !important;
  outline-offset: 3px;
}
img { transition: filter 0.15s, transform 0.3s ease !important; }
img.sk-review-flash {
  outline: none !important;
  transform: scale(1.05) !important;
  z-index: 10 !important;
  position: relative !important;
}
</style>
<script>
(function() {
  function findEl(data) {
    var el = null;
    // Try data-field + data-section + data-item
    if (data.field) {
      var sel = '[data-field="' + data.field + '"]';
      if (data.itemId) sel = '[data-item="' + data.itemId + '"] ' + sel;
      if (data.section) sel = '[data-section="' + data.section + '"] ' + sel;
      el = document.querySelector(sel);
      if (el) return el;
    }
    // Try cssPath
    if (data.cssPath) { try { el = document.querySelector(data.cssPath); } catch(e) {} }
    return el;
  }

  function flashEl(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('sk-review-flash');
    setTimeout(function() { el.classList.remove('sk-review-flash'); }, 2500);
  }

  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data || !data.type) return;
    if (data.type === 'HIGHLIGHT_CHANGES') {
      (data.changes || []).forEach(function(c) {
        var el = findEl(c);
        if (el) el.classList.add('sk-review-changed');
      });
    }
    if (data.type === 'HIGHLIGHT_ELEMENT') {
      flashEl(findEl(data));
    }
    if (data.type === 'SCROLL_TO_SECTION') {
      var id = data.sectionId;
      var s = document.querySelector('[data-section="' + id + '"]') || document.getElementById(id);
      if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  // Block all links except anchors
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href') || '';
    if (!href.startsWith('#')) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  window.parent.postMessage({ type: 'REVIEW_READY' }, '*');
})();
</script>`;

    } else {
      injection = `
<script>
(function() {
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'SCROLL_TO_SECTION') {
      var id = event.data.sectionId;
      var el = document.querySelector('[data-section="' + id + '"]') || document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href') || '';
    if (!href.startsWith('#')) { e.preventDefault(); }
  }, true);
})();
</script>`;
    }

    if (injection) {
      html = html.replace(/<\/body>/i, `${injection}\n</body>`);
    }

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache, no-store",
      },
    });
  } catch (err) {
    return new Response(`Proxy error: ${err}`, { status: 500 });
  }
}
