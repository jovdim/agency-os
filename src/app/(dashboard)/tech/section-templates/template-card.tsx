"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Eye, EyeSlash as EyeOff, Trash as Trash2, Tag } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { PreviewFrame } from "@/components/composer/preview-frame";
import {
  renderInBrowser,
  type TemplateBody,
} from "@/lib/templates/render-browser";
import type { SiteComposition } from "@/lib/templates/render";

interface Template {
  id: string;
  category: string;
  name: string;
  preview_image: string | null;
  placeholder_schema: Record<string, unknown>;
  tags: string[];
  is_published: boolean;
  version: number;
  updated_at: string;
}

// ─── Live-preview wiring ─────────────────────────────────────────────────────
// Mirrors the composer's VariantPicker so this management page shows the same
// preview that techs see when picking templates in the composer. The
// virtual-height table and the single-template composition builder are kept
// in sync with variant-picker.tsx.

const CATEGORY_VIRTUAL_HEIGHT: Record<string, number> = {
  nav: 100,
  footer: 380,
  cta: 380,
  contact: 720,
  map: 480,
};
const DEFAULT_VIRTUAL_HEIGHT = 720;

// Force fade-up + nav-fixed classes visible in chrome-off previews where the
// scroll/intersection JS doesn't run. Same override variant-picker uses.
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

// ─── Card ────────────────────────────────────────────────────────────────────

export function TemplateCard({
  template,
  layout = "tile",
  body,
  baseCss,
}: {
  template: Template;
  layout?: "tile" | "strip";
  body?: TemplateBody;
  baseCss?: string;
}) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const fieldCount = Object.keys(template.placeholder_schema ?? {}).length;
  const virtualHeight =
    CATEGORY_VIRTUAL_HEIGHT[template.category] ?? DEFAULT_VIRTUAL_HEIGHT;

  // Live preview HTML — same engine as the composer's VariantPicker.
  // Returns null when we don't have a body+baseCss; the card falls back to
  // the saved preview_image in that case.
  const previewSrcDoc = useMemo(() => {
    if (!body || !baseCss) return null;
    const raw = renderInBrowser(
      buildSinglePreviewComposition(template.category, body.id),
      new Map<string, TemplateBody>([[body.id, body]]),
      { baseCss, pagePath: "index.html", chrome: false },
    );
    return withPreviewOverrides(raw);
  }, [body, baseCss, template.category]);

  async function togglePublished() {
    setWorking(true);
    try {
      const res = await fetch(`/api/section-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_published: !template.is_published }),
      });
      if (!res.ok) {
        toast.error("Failed to toggle publish");
        return;
      }
      toast.success(!template.is_published ? "Published" : "Unpublished");
      router.refresh();
    } finally {
      setWorking(false);
    }
  }

  async function deleteTemplate() {
    if (
      !confirm(`Delete ${template.category}/${template.name}? This cannot be undone.`)
    ) {
      return;
    }
    setWorking(true);
    try {
      const res = await fetch(`/api/section-templates/${template.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Delete failed");
        return;
      }
      toast.success("Deleted");
      router.refresh();
    } finally {
      setWorking(false);
    }
  }

  const fieldless = fieldCount === 0;

  // ── Preview block (shared between layouts) ─────────────────────────────────
  function Preview({ stripClasses }: { stripClasses: boolean }) {
    if (previewSrcDoc) {
      return (
        <div
          className={
            stripClasses
              ? "relative flex-1 min-h-20 max-h-35 bg-muted overflow-hidden"
              : "relative bg-muted overflow-hidden"
          }
        >
          <PreviewFrame
            srcDoc={previewSrcDoc}
            virtualHeight={virtualHeight}
            className={
              stripClasses
                ? "relative w-full h-full overflow-hidden bg-background"
                : "relative w-full overflow-hidden bg-background"
            }
          />
          <Badges
            isPublished={template.is_published}
            fieldless={fieldless}
          />
        </div>
      );
    }
    // Fallback to saved preview_image (or empty state) — only used when
    // template body / baseCss couldn't be loaded.
    return (
      <div
        className={
          stripClasses
            ? "relative bg-muted overflow-hidden flex-1 min-h-20 max-h-35"
            : "aspect-video bg-muted relative overflow-hidden"
        }
      >
        {template.preview_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={template.preview_image}
            alt={`${template.category}/${template.name}`}
            className={
              stripClasses
                ? "w-full h-full object-cover object-left"
                : "w-full h-full object-cover"
            }
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-1">
            <span>no thumbnail</span>
            {!stripClasses && (
              <span className="text-[10px]">re-upload with image</span>
            )}
          </div>
        )}
        <Badges
          isPublished={template.is_published}
          fieldless={fieldless}
        />
      </div>
    );
  }

  if (layout === "strip") {
    return (
      <div className="rounded-lg border bg-card overflow-hidden flex items-stretch">
        <Preview stripClasses />

        <div className="px-3 py-2 flex flex-col justify-center gap-1 shrink-0 w-56 border-l border-border/60">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium truncate">{template.name}</p>
            <span className="text-[10px] text-muted-foreground shrink-0">
              v{template.version}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {fieldCount} field{fieldCount === 1 ? "" : "s"}
            {template.tags.length > 0 && ` · ${template.tags.join(", ")}`}
          </p>
          <div className="flex items-center gap-1 pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs flex-1"
              disabled={working}
              onClick={togglePublished}
            >
              {template.is_published ? (
                <>
                  <EyeOff className="h-3 w-3" /> Unpublish
                </>
              ) : (
                <>
                  <Eye className="h-3 w-3" /> Publish
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
              disabled={working}
              onClick={deleteTemplate}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden flex flex-col">
      <Preview stripClasses={false} />

      <div className="p-3 space-y-2 flex-1 flex flex-col">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium truncate">{template.name}</p>
          <span className="text-[10px] text-muted-foreground shrink-0">
            v{template.version}
          </span>
        </div>

        <div className="text-[11px] text-muted-foreground">
          {fieldCount} field{fieldCount === 1 ? "" : "s"}
        </div>

        {template.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <Tag className="h-3 w-3 text-muted-foreground shrink-0" />
            {template.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] rounded bg-muted px-1.5 py-0.5"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1 mt-auto pt-2 border-t border-border/60">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs flex-1"
            disabled={working}
            onClick={togglePublished}
          >
            {template.is_published ? (
              <>
                <EyeOff className="h-3 w-3" />
                Unpublish
              </>
            ) : (
              <>
                <Eye className="h-3 w-3" />
                Publish
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
            disabled={working}
            onClick={deleteTemplate}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Badges (draft / no-fields) ──────────────────────────────────────────────

function Badges({
  isPublished,
  fieldless,
}: {
  isPublished: boolean;
  fieldless: boolean;
}) {
  return (
    <>
      {!isPublished && (
        <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wide rounded bg-amber-500/90 text-white px-1.5 py-0.5 font-medium z-10">
          draft
        </span>
      )}
      {fieldless && (
        <span
          className="absolute top-2 right-2 text-[10px] uppercase tracking-wide rounded bg-destructive/90 text-white px-1.5 py-0.5 font-medium z-10"
          title="No data-field attributes detected — nothing will be editable on this template"
        >
          no fields
        </span>
      )}
    </>
  );
}
