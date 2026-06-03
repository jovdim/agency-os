"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  HelpCircle,
  Images,
  Info,
  Mail,
  MapPin,
  Megaphone,
  Menu,
  MousePointer,
  PanelBottom,
  Sparkles,
  Star,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { SectionTemplate } from "./variant-picker";
import {
  renderInBrowser,
  type TemplateBody,
} from "@/lib/templates/render-browser";
import type { SiteComposition } from "@/lib/templates/render";
import { PreviewFrame } from "./preview-frame";

/* ─────────────────────────────────────────────────────────────────────────
 *  Categories — single source of truth for icon, label, virtual height.
 *  Order here is the order shown in the rail (top → bottom).
 * ──────────────────────────────────────────────────────────────────────── */

// Internal rail category. `dividerAfter` paints a thicker bar under
// the button so the rail reads as two distinct groups — used for the
// Subpage slot at the top so it visually splits from the "regular
// page section" categories below it.
interface CategoryDef {
  id: string;
  label: string;
  icon: LucideIcon;
  /** virtual render height passed to PreviewFrame, in px */
  virtualHeight: number;
  /** "shared" templates (nav, footer) replace the slot rather than appending */
  shared?: boolean;
  /** Render a thicker bar under this button so the rail reads as two
   *  distinct groups. Used on Subpage so it visually splits from the
   *  page-section categories that follow. */
  dividerAfter?: boolean;
  /** Render a "WIP" badge so operators see that the slot exists but
   *  is still being built out. Used on Subpage while the dedicated
   *  subpage templates are in development. */
  workInProgress?: boolean;
}

const CATEGORIES: CategoryDef[] = [
  // Subpage — slot reserved for templates tailored to inner pages
  // (blog-post layouts, article shells, landing pages). Pinned to
  // the top so it reads as a distinct page-shaped concept, separate
  // from the per-section building blocks below (Peter 2026-05-23).
  // `dividerAfter` paints a thicker bar so the visual split between
  // "page templates" and "section templates" is unmistakable.
  { id: "subpage",      label: "Subpage",        icon: FileText,     virtualHeight: 720, dividerAfter: true },
  { id: "nav",          label: "Navigation",     icon: Menu,         virtualHeight: 100, shared: true },
  { id: "hero",         label: "Hero",           icon: Sparkles,     virtualHeight: 720 },
  { id: "how-it-works", label: "How it works",   icon: Workflow,     virtualHeight: 720 },
  { id: "about",        label: "About",          icon: Info,         virtualHeight: 720 },
  { id: "services",     label: "Services",       icon: Wrench,       virtualHeight: 720 },
  { id: "gallery",      label: "Gallery",        icon: Images,       virtualHeight: 720 },
  { id: "reviews",      label: "Reviews",        icon: Star,         virtualHeight: 720 },
  { id: "faq",          label: "FAQ",            icon: HelpCircle,   virtualHeight: 720 },
  { id: "cta",          label: "Call to action", icon: Megaphone,    virtualHeight: 380 },
  { id: "contact",      label: "Contact",        icon: Mail,         virtualHeight: 720 },
  { id: "map",          label: "Map",            icon: MapPin,       virtualHeight: 480 },
  { id: "footer",       label: "Footer",         icon: PanelBottom,  virtualHeight: 380, shared: true },
  { id: "widgets",      label: "Widgets",        icon: MousePointer, virtualHeight: 200 },
];

/**
 * Templates use fade-up classes that start invisible and are revealed by an
 * IntersectionObserver script. Our preview iframes run with scripts disabled
 * so without this override the content stays invisible. Same trick we use
 * elsewhere in the rail.
 */
const PREVIEW_FADE_OVERRIDE_CSS = `<style>
  .fade-up, .fade-left, .fade-right {
    opacity: 1 !important;
    transform: none !important;
  }
  .site-nav { transform: none !important; }
</style>`;

function withPreviewOverrides(html: string): string {
  return html.replace("</head>", `${PREVIEW_FADE_OVERRIDE_CSS}</head>`);
}

/* ─────────────────────────────────────────────────────────────────────────
 *  Props
 * ──────────────────────────────────────────────────────────────────────── */

interface Props {
  templates: SectionTemplate[];
  templateBodies: Record<string, TemplateBody>;
  baseCss: string;
  /**
   * Composer dispatcher — for shared categories (nav/footer) it replaces the
   * slot, for everything else it appends a new section.
   */
  onPick: (category: string, templateId: string) => void;
}

/* ─────────────────────────────────────────────────────────────────────────
 *  Main component
 * ──────────────────────────────────────────────────────────────────────── */

export function SectionsRail({
  templates,
  templateBodies,
  baseCss,
  onPick,
}: Props) {
  // Group templates by category so we can show counts in the rail and feed
  // the popout with the right list.
  const grouped = useMemo(() => {
    const m: Record<string, SectionTemplate[]> = {};
    for (const t of templates) {
      (m[t.category] ??= []).push(t);
    }
    for (const cat in m) m[cat]!.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [templates]);

  // Active = which category's popout is currently shown (null = none open).
  // `pinned` flips to true when the user CLICKS an icon — keeps the popout
  // open while they pick multiple sections. Hover alone doesn't pin.
  const [active, setActive] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openCategory(cat: string) {
    clearCloseTimer();
    setActive(cat);
  }

  function scheduleClose() {
    if (pinned) return; // pinned popouts ignore hover-out
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setActive(null), 180);
  }

  function toggleClick(cat: string) {
    clearCloseTimer();
    if (pinned && active === cat) {
      // Same icon clicked while pinned → close.
      setPinned(false);
      setActive(null);
      return;
    }
    setActive(cat);
    setPinned(true);
  }

  // Click outside the rail (and outside the popout) → close + unpin.
  useEffect(() => {
    if (!active) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (railRef.current?.contains(target)) return;
      setActive(null);
      setPinned(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [active]);

  // Cleanup any hanging timer.
  useEffect(() => {
    return () => clearCloseTimer();
  }, []);

  // Categories with at least one template — empty ones don't even get an icon.
  // EXCEPT: `subpage` always shows (Peter 2026-05-23) so operators see the
  // slot where future subpage-shaped templates will land, even before any
  // are seeded.
  const ALWAYS_VISIBLE = new Set(["subpage"]);
  const visible = useMemo(
    () =>
      CATEGORIES.filter(
        (c) => ALWAYS_VISIBLE.has(c.id) || (grouped[c.id]?.length ?? 0) > 0,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grouped],
  );

  return (
    <div ref={railRef} className="relative shrink-0 flex">
      {/* ── Narrow icon + label column ──
          Icons alone are guess-the-glyph; pairing each with a tiny text
          label below makes the column self-explanatory at a glance for
          new users (and Future-You) without bumping the width past ~72px. */}
      <aside className="w-18 border-r bg-card flex flex-col items-stretch shrink-0 z-20 overflow-y-auto">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-1 py-2 text-center border-b-2 border-border">
          Add
        </div>
        {visible.map((cat) => {
          const count = grouped[cat.id]?.length ?? 0;
          const isActive = active === cat.id;
          const Icon = cat.icon;
          return (
            <div key={cat.id}>
              <button
                type="button"
                onMouseEnter={() => openCategory(cat.id)}
                onMouseLeave={scheduleClose}
                onClick={() => toggleClick(cat.id)}
                onFocus={() => openCategory(cat.id)}
                className={`relative w-full px-1 py-2 flex flex-col items-center gap-1 transition-colors border-b border-border ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
                aria-label={`${cat.label} (${count})${cat.workInProgress ? " — work in progress" : ""}`}
                aria-haspopup="true"
                aria-expanded={isActive}
              >
                <Icon className="h-4 w-4" />
                <span className="text-[10px] font-medium leading-tight truncate max-w-full">
                  {cat.label}
                </span>
                {/* "Soon" badge — top-left, amber pill. Signals to
                    operators that the slot is real but templates are
                    still being authored. Sits opposite the count chip
                    so they don't collide visually. Reads plainly in
                    Slovak + English contexts — avoided "WIP" which
                    Peter flagged as cryptic abbreviation. */}
                {cat.workInProgress && (
                  <span className="absolute top-0.5 left-0.5 px-1 py-px inline-flex items-center justify-center rounded-sm bg-amber-500/90 text-amber-50 text-[9px] font-semibold leading-tight">
                    Soon
                  </span>
                )}
                {/* Count chip — only when 2+ templates exist; otherwise noise */}
                {count > 1 && (
                  <span className="absolute top-1 right-1 h-3.5 min-w-3.5 px-1 inline-flex items-center justify-center rounded-full bg-foreground/80 text-background text-[9px] font-semibold tabular-nums">
                    {count}
                  </span>
                )}
              </button>
              {/* Visual break after categories that mark a group
                  boundary (currently just Subpage → rest). Reads as
                  "page templates above, section templates below."
                  Single thin line with breathing room — no chunky
                  bar (Peter 2026-05-23: previous "h-1 + border-y"
                  combo looked awful). */}
              {cat.dividerAfter && (
                <div className="py-1" aria-hidden="true">
                  <div className="border-t border-border/70" />
                </div>
              )}
            </div>
          );
        })}

        {visible.length === 0 && (
          <p className="text-[9px] text-muted-foreground text-center px-1 mt-2 leading-tight">
            No templates yet
          </p>
        )}
      </aside>

      {/* ── Slide-out popout with template thumbnails ── */}
      {active && (
        <CategoryPopout
          category={CATEGORIES.find((c) => c.id === active)!}
          items={grouped[active] ?? []}
          templateBodies={templateBodies}
          baseCss={baseCss}
          pinned={pinned}
          onPick={(cat, id) => {
            onPick(cat, id);
            // After pick, leave it open if pinned (so user can rapid-add)
            // or close if just hovering.
            if (!pinned) setActive(null);
          }}
          onUnpin={() => {
            setPinned(false);
            setActive(null);
          }}
          onMouseEnter={() => openCategory(active)}
          onMouseLeave={scheduleClose}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 *  Popout
 * ──────────────────────────────────────────────────────────────────────── */

interface PopoutProps {
  category: CategoryDef;
  items: SectionTemplate[];
  templateBodies: Record<string, TemplateBody>;
  baseCss: string;
  pinned: boolean;
  onPick: (category: string, templateId: string) => void;
  onUnpin: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function CategoryPopout({
  category,
  items,
  templateBodies,
  baseCss,
  pinned,
  onPick,
  onUnpin,
  onMouseEnter,
  onMouseLeave,
}: PopoutProps) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="absolute left-full top-0 bottom-0 w-72 border-r bg-card shadow-xl z-30 flex flex-col"
    >
      <div className="px-3 py-2.5 border-b shrink-0 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide truncate">
            {category.label}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {items.length} variant{items.length === 1 ? "" : "s"}
            {category.shared && " · shared"}
          </p>
        </div>
        {pinned && (
          <button
            type="button"
            onClick={onUnpin}
            className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
            title="Close (or click the icon again)"
          >
            Close
          </button>
        )}
      </div>

      <ul className="flex-1 overflow-y-auto p-2 space-y-2.5">
        {items.map((t) => (
          <TemplateCard
            key={t.id}
            template={t}
            body={templateBodies[t.id]}
            baseCss={baseCss}
            virtualHeight={category.virtualHeight}
            onPick={() => onPick(t.category, t.id)}
          />
        ))}
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">
            No templates in this category yet.
          </p>
        )}
      </ul>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 *  Single template card with live preview
 * ──────────────────────────────────────────────────────────────────────── */

interface TemplateCardProps {
  template: SectionTemplate;
  body: TemplateBody | undefined;
  baseCss: string;
  virtualHeight: number;
  onPick: () => void;
}

function TemplateCard({
  template,
  body,
  baseCss,
  virtualHeight,
  onPick,
}: TemplateCardProps) {
  const previewSrcDoc = useMemo(() => {
    if (!body) return null;
    const raw = renderInBrowser(
      buildSinglePreviewComposition(template.category, body.id),
      buildSinglePreviewMap(body),
      { baseCss, pagePath: "index.html", chrome: false },
    );
    return withPreviewOverrides(raw);
  }, [body, template.category, baseCss]);

  return (
    <li>
      <button
        onClick={onPick}
        className="group w-full rounded-lg border border-border bg-background hover:border-primary hover:shadow-md hover:-translate-y-0.5 overflow-hidden transition-all text-left flex flex-col"
        title={`Add ${template.name}`}
      >
        {previewSrcDoc ? (
          <PreviewFrame
            srcDoc={previewSrcDoc}
            virtualHeight={virtualHeight}
            className="relative w-full overflow-hidden bg-background border-b border-border/60"
          />
        ) : (
          <div
            className="relative w-full bg-muted overflow-hidden border-b border-border/60"
            style={{ aspectRatio: `1280 / ${virtualHeight}` }}
          >
            {template.preview_image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={template.preview_image}
                alt=""
                className="w-full h-full object-cover object-top"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground">
                preview unavailable
              </div>
            )}
          </div>
        )}

        <div className="px-2.5 py-1.5 flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium truncate group-hover:text-primary">
            {template.name}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Default section anchor — read-only here (the picker shows
                what anchor the template ships with). Authors can rename
                it per-section after adding via the chip in the section
                card header. Hidden when the template has no root id
                (widgets, footers without anchors). */}
            {body?.defaultSectionId && (
              <span
                className="text-[9px] font-mono text-muted-foreground/80"
                title={`Default anchor: #${body.defaultSectionId}`}
              >
                #{body.defaultSectionId}
              </span>
            )}
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70">
              {template.category}
            </span>
          </div>
        </div>
      </button>
    </li>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 *  Helpers — build a one-section composition for the live preview iframe.
 * ──────────────────────────────────────────────────────────────────────── */

function buildSinglePreviewComposition(
  category: string,
  templateId: string,
): SiteComposition {
  if (category === "nav") {
    return {
      pages: [{ path: "index.html", label: "Home", sections: [] }],
      shared: { nav_template_id: templateId },
    };
  }
  if (category === "footer") {
    return {
      pages: [{ path: "index.html", label: "Home", sections: [] }],
      shared: { footer_template_id: templateId },
    };
  }
  return {
    pages: [
      {
        path: "index.html",
        label: "Home",
        sections: [
          {
            id: "preview",
            template_id: templateId,
            order: 0,
            content_overrides: {},
          },
        ],
      },
    ],
  };
}

function buildSinglePreviewMap(
  body: TemplateBody,
): Map<string, TemplateBody> {
  const m = new Map<string, TemplateBody>();
  m.set(body.id, body);
  return m;
}
