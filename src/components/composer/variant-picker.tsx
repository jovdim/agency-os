"use client";

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CheckCircle2 } from "lucide-react";
import {
  renderInBrowser,
  type TemplateBody,
} from "@/lib/templates/render-browser";
import type { SiteComposition } from "@/lib/templates/render";
import { PreviewFrame } from "./preview-frame";

export interface SectionTemplate {
  id: string;
  category: string;
  name: string;
  preview_image: string | null;
  placeholder_schema: Record<string, { type: string; default?: string; default_src?: string }>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: string;
  templates: SectionTemplate[];
  currentTemplateId?: string;
  /** Pre-loaded HTML/CSS bodies — keyed by template id. Same map the
   *  composer threads to the SectionsRail. */
  templateBodies?: Record<string, TemplateBody>;
  /** Base stylesheet shared by all templates (passed from composer). */
  baseCss?: string;
  onPick: (templateId: string) => void;
}

const STRIP_CATEGORIES = new Set(["nav", "footer", "cta"]);

/**
 * Per-template human descriptions shown in the variant picker. Optional —
 * unmapped templates fall back to the field count line.
 *
 * Mainly populated for widget templates where the picker thumbnail can't
 * carry the meaning (an iframe with `sandbox="allow-same-origin"` doesn't
 * run their JS, so a scroll-to-top arrow looks identical to a tap-to-call
 * button at preview size). The descriptions answer "what does this do?"
 * at a glance without needing the user to add it to see what it is.
 *
 * Long-term path is a `description` column on `section_templates` so any
 * template author can ship a description without code changes — but until
 * then, this map gives us the visible affordance widgets need.
 */
const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  // ── Widgets ──
  whatsapp: "Floating WhatsApp button — bottom-right, opens wa.me in a new tab",
  "phone-call":
    "Floating tap-to-call button — bottom-right, opens the dialler with a tel: link",
  "scroll-toggle":
    "Floating arrow that flips between scroll-down (over hero) and scroll-up (after scrolling past)",
  "cookie-bar":
    "Bottom-pinned consent bar with Accept button, dismiss saved to localStorage",
};

/** Per-category virtual heights — same values used in the rail thumbnails so
 *  the variant picker matches the rail visually. */
const CATEGORY_VIRTUAL_HEIGHT: Record<string, number> = {
  nav: 100,
  footer: 380,
  cta: 380,
  contact: 720,
  map: 480,
};
const DEFAULT_VIRTUAL_HEIGHT = 720;

/** Force fade-up classes visible in chrome-off previews where scripts don't run. */
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
          { id: "preview", template_id: templateId, order: 0, content_overrides: {} },
        ],
      },
    ],
  };
}

export function VariantPicker({
  open,
  onOpenChange,
  category,
  templates,
  currentTemplateId,
  templateBodies,
  baseCss,
  onPick,
}: Props) {
  const filtered = templates.filter((t) => t.category === category);
  const isStrip = STRIP_CATEGORIES.has(category);
  const virtualHeight =
    CATEGORY_VIRTUAL_HEIGHT[category] ?? DEFAULT_VIRTUAL_HEIGHT;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="capitalize">Pick a {category} variant</DialogTitle>
          <DialogDescription>
            {filtered.length} variant{filtered.length === 1 ? "" : "s"} available.
            Click one to use it. Existing content with matching field names is preserved.
          </DialogDescription>
        </DialogHeader>

        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            No published <strong>{category}</strong> templates yet.{" "}
            <a href="/tech/section-templates" className="text-primary hover:underline">
              Upload one
            </a>
            .
          </div>
        ) : (
          <div
            className={
              isStrip
                ? "flex flex-col gap-2"
                : "grid grid-cols-2 md:grid-cols-3 gap-3"
            }
          >
            {filtered.map((t) => {
              const isCurrent = t.id === currentTemplateId;
              const fieldCount = Object.keys(t.placeholder_schema ?? {}).length;
              return (
                <VariantCard
                  key={t.id}
                  template={t}
                  body={templateBodies?.[t.id]}
                  baseCss={baseCss}
                  virtualHeight={virtualHeight}
                  isStrip={isStrip}
                  isCurrent={isCurrent}
                  fieldCount={fieldCount}
                  onPick={() => onPick(t.id)}
                />
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────

interface VariantCardProps {
  template: SectionTemplate;
  body: TemplateBody | undefined;
  baseCss: string | undefined;
  virtualHeight: number;
  isStrip: boolean;
  isCurrent: boolean;
  fieldCount: number;
  onPick: () => void;
}

function VariantCard({
  template,
  body,
  baseCss,
  virtualHeight,
  isStrip,
  isCurrent,
  fieldCount,
  onPick,
}: VariantCardProps) {
  // Live preview HTML — same engine as the rail. Skipped if we don't have
  // both body and baseCss (older callers may not pass them yet).
  const previewSrcDoc = useMemo(() => {
    if (!body || !baseCss) return null;
    const raw = renderInBrowser(
      buildSinglePreviewComposition(template.category, body.id),
      new Map<string, TemplateBody>([[body.id, body]]),
      { baseCss, pagePath: "index.html", chrome: false },
    );
    return withPreviewOverrides(raw);
  }, [body, baseCss, template.category]);

  return (
    <button
      onClick={onPick}
      className={`text-left rounded-lg border overflow-hidden transition-all hover:border-primary/50 hover:shadow-sm ${
        isCurrent ? "border-primary ring-2 ring-primary/20" : ""
      } ${isStrip ? "flex items-stretch" : "flex flex-col"}`}
    >
      {previewSrcDoc ? (
        <div
          className={
            isStrip
              ? "flex-1 min-h-20 max-h-35 bg-muted relative overflow-hidden"
              : "bg-muted relative overflow-hidden"
          }
        >
          <PreviewFrame
            srcDoc={previewSrcDoc}
            virtualHeight={virtualHeight}
            className="relative w-full overflow-hidden bg-background"
          />
          {isCurrent && (
            <span className="absolute top-2 right-2 inline-flex items-center gap-1 text-[10px] uppercase rounded bg-primary text-primary-foreground px-1.5 py-0.5 z-10">
              <CheckCircle2 className="h-3 w-3" /> in use
            </span>
          )}
        </div>
      ) : (
        // Fallback path — used only when the caller didn't pass templateBodies
        // (e.g. legacy callers). Keeps the static-image and "no preview"
        // behavior working.
        <div
          className={
            isStrip
              ? "flex-1 min-h-20 max-h-35 bg-muted relative"
              : "aspect-video bg-muted relative"
          }
        >
          {template.preview_image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={template.preview_image}
              alt={template.name}
              className={
                isStrip
                  ? "w-full h-full object-cover object-left"
                  : "w-full h-full object-cover"
              }
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
              no preview
            </div>
          )}
          {isCurrent && (
            <span className="absolute top-2 right-2 inline-flex items-center gap-1 text-[10px] uppercase rounded bg-primary text-primary-foreground px-1.5 py-0.5">
              <CheckCircle2 className="h-3 w-3" /> in use
            </span>
          )}
        </div>
      )}
      <div className={isStrip ? "px-3 py-2 w-48 shrink-0 border-l" : "p-2"}>
        <p className="text-sm font-medium truncate">{template.name}</p>
        {TEMPLATE_DESCRIPTIONS[template.name] ? (
          // Description wins over the field-count fallback when present —
          // tells the user "what is this?" instead of just "how many fields."
          // line-clamp-2 keeps tall descriptions from blowing out card height.
          <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
            {TEMPLATE_DESCRIPTIONS[template.name]}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {fieldCount} field{fieldCount === 1 ? "" : "s"}
          </p>
        )}
      </div>
    </button>
  );
}
