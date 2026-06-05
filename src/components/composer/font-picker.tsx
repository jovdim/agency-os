"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaretDown as ChevronDown, MagnifyingGlass as Search, Check } from "@phosphor-icons/react/ssr";
import type { GoogleFont } from "@/lib/composer/google-fonts";
import { extractFontName } from "@/lib/templates/theme";

/**
 * Cache of which fonts the parent window has already requested a
 * Google Fonts stylesheet for. Module-level so the cache persists
 * across Heading + Body picker mounts and across opens of the same
 * picker — no re-injecting <link> tags for fonts we already loaded.
 */
const loadedPreviewFonts = new Set<string>();

/**
 * Inject a single-weight `<link>` into the parent document for the
 * given font family so the dropdown option can render its name in
 * its own typeface. We use weight 400 only — plenty for a one-line
 * preview, an order of magnitude lighter than loading the full
 * 4-weight set the iframe uses after the user actually picks. */
function loadPreviewFont(family: string): void {
  if (loadedPreviewFonts.has(family)) return;
  loadedPreviewFonts.add(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(
    / /g,
    "+",
  )}:wght@400&display=swap`;
  link.setAttribute("data-font-preview", family);
  document.head.appendChild(link);
}

/**
 * Searchable font picker dropdown. Shows all Google Fonts (fetched
 * from /api/composer/fonts) grouped by category. The selected font's
 * name is rendered in its OWN font as a preview — the rest stay plain
 * so we don't have to load 1600 stylesheets up front.
 *
 * Value contract: stores/emits a full CSS font-family string with
 * fallback (e.g. `"'Montserrat', sans-serif"`) so theme.heading_font /
 * body_font can be dropped directly into a CSS custom property by
 * buildThemeCss.
 */
interface Props {
  label: string;
  /** Current CSS family value (e.g. `"'Montserrat', sans-serif"`). */
  value: string | undefined;
  /** Called with the new full CSS family string. */
  onChange: (cssFamily: string) => void;
  /** Fallback for when value is empty — usually the default for that slot. */
  placeholder: string;
}

/** Build the CSS fallback for a font name based on Google's category.
 *  Serif fonts fall back to serif, display/handwriting to cursive,
 *  monospace to monospace, everything else to sans-serif — so the
 *  page degrades gracefully if the Google CDN is unreachable. */
function categoryFallback(category: string): string {
  switch (category) {
    case "serif":
      return "serif";
    case "monospace":
      return "monospace";
    case "handwriting":
    case "display":
      return "cursive";
    default:
      return "sans-serif";
  }
}

export function FontPicker({ label, value, onChange, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [fonts, setFonts] = useState<GoogleFont[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Forces re-render when a previewed font finishes loading so its
  // option visibly switches from the fallback to its real typeface.
  // (CSS would also do this on its own once the font is available,
  // but a state bump helps in some Firefox versions where the option
  // text doesn't repaint until the next layout pass.)
  const [, forceRerender] = useState(0);

  // Lazy-load a font's preview stylesheet via Google Fonts. Stable
  // identity across renders so the IntersectionObserver below can
  // reference it without resubscribing on every state change.
  const ensurePreview = useCallback((family: string) => {
    if (loadedPreviewFonts.has(family)) return;
    loadPreviewFont(family);
    // Repaint after the network round-trip so the option text shows
    // the real font as soon as it's available. 250ms is generous —
    // a typical Google Fonts CSS+font hit takes ~150ms on warm DNS.
    setTimeout(() => forceRerender((n) => n + 1), 280);
  }, []);

  // Fetch fonts on first open. Cached client-side after that — switching
  // between Heading and Body pickers doesn't refetch.
  useEffect(() => {
    if (!open || fonts.length > 0 || loading) return;
    setLoading(true);
    setError(null);
    fetch("/api/composer/fonts")
      .then((r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return r.json();
      })
      .then((data: { fonts: GoogleFont[] }) => {
        setFonts(data.fonts);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [open, fonts.length, loading]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Lazy-load preview fonts as options scroll into view. Without this,
  // opening the dropdown for the 1600-font catalog would either ship
  // 50MB of font files at once (unacceptable) or show every name in
  // the default UI font (defeats the point of the preview). The
  // IntersectionObserver watches options inside the scroll container
  // and fires `ensurePreview()` for each one as it appears, then
  // unobserves it — so each font is requested at most once per
  // session. Re-attaches whenever fonts list or search query changes.
  useEffect(() => {
    if (!open || fonts.length === 0) return;
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const family = entry.target.getAttribute("data-preview-font");
            if (family) ensurePreview(family);
            observer.unobserve(entry.target);
          }
        }
      },
      { root, rootMargin: "120px 0px" /* prefetch one screen below */ },
    );
    root
      .querySelectorAll<HTMLElement>("[data-preview-font]")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [open, fonts, search, ensurePreview]);

  const currentName = extractFontName(value) || placeholder;

  // Filter + group. Search is case-insensitive substring across the
  // family name. Groups: sans-serif, serif, display, handwriting,
  // monospace — in that pinned order so users find their style fast.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? fonts.filter((f) => f.family.toLowerCase().includes(q))
      : fonts;
    const buckets: Record<string, GoogleFont[]> = {
      "sans-serif": [],
      serif: [],
      display: [],
      handwriting: [],
      monospace: [],
    };
    for (const f of filtered) {
      if (buckets[f.category]) buckets[f.category].push(f);
    }
    return buckets;
  }, [fonts, search]);

  function handlePick(font: GoogleFont) {
    const css = `'${font.family}', ${categoryFallback(font.category)}`;
    onChange(css);
    setOpen(false);
    setSearch("");
  }

  const groupOrder: Array<keyof typeof groups> = [
    "sans-serif",
    "serif",
    "display",
    "handwriting",
    "monospace",
  ];

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-xs dash-hairline border rounded-lg px-3 py-2 bg-background hover:bg-(--dash-subtle) transition-colors"
        style={{ fontFamily: value || undefined }}
      >
        <span className="truncate">{currentName}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1.5 bg-popover dash-hairline border rounded-xl shadow-[0_8px_30px_-12px_rgba(0,0,0,0.25)] overflow-hidden">
          {/* Search bar */}
          <div className="flex items-center gap-2 px-3 py-2.5 dash-hairline border-b">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search fonts…"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Loading / error states */}
          {loading && (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              Loading fonts…
            </div>
          )}
          {error && (
            <div className="px-3 py-3 text-xs text-destructive">
              Couldn&apos;t load fonts: {error}. Falling back to defaults.
            </div>
          )}

          {/* Font list — scrollable, ~9 rows visible at a time */}
          {!loading && !error && (
            <div ref={scrollRef} className="max-h-72 overflow-y-auto">
              {groupOrder.map((cat) => {
                const items = groups[cat];
                if (!items || items.length === 0) return null;
                return (
                  <div key={cat}>
                    <div className="sticky top-0 dash-subhead backdrop-blur px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      {cat.replace("-", " ")}
                    </div>
                    {items.map((f) => {
                      const css = `'${f.family}', ${categoryFallback(f.category)}`;
                      const isCurrent =
                        extractFontName(value).toLowerCase() ===
                        f.family.toLowerCase();
                      return (
                        <button
                          key={f.family}
                          type="button"
                          data-preview-font={f.family}
                          onClick={() => handlePick(f)}
                          onMouseEnter={() => ensurePreview(f.family)}
                          className={`dash-row w-full flex items-center justify-between px-3 py-2 text-sm text-left ${
                            isCurrent ? "bg-(--dash-chip-bg) dash-accent" : ""
                          }`}
                        >
                          {/* Inline font-family so the option renders in
                              its own typeface once the lazy-loaded
                              preview stylesheet has resolved. Browser
                              falls back to the category default until
                              then — names stay readable throughout. */}
                          <span
                            className="truncate"
                            style={{ fontFamily: css }}
                          >
                            {f.family}
                          </span>
                          {isCurrent && (
                            <Check className="h-3.5 w-3.5 dash-accent shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {Object.values(groups).every((arr) => arr.length === 0) && (
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  No fonts match &quot;{search}&quot;.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
