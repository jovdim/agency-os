import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { UploadForm } from "./upload-form";
import { TemplateCard } from "./template-card";
import { loadTemplateBodies, loadBaseCss } from "@/lib/templates/load-bodies";
import type { TemplateBody } from "@/lib/templates/render-browser";
import { StackSimple as Layers, TreeStructure as FolderTree, WarningCircle as AlertCircle, Tray as Inbox } from "@phosphor-icons/react/ssr";

// Cache-busting trio (Peter 2026-05-16): force-dynamic alone leaves
// Next.js caching Supabase Storage fetches inside loadTemplateBodies
// so this gallery serves stale template HTML after a push. See
// feedback_publish_route_cache_busting.md.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const CATEGORY_LABELS: Record<string, string> = {
  nav: "Navigation",
  hero: "Hero",
  about: "About",
  services: "Services",
  gallery: "Gallery",
  reviews: "Reviews",
  faq: "FAQ",
  cta: "Call to action",
  contact: "Contact",
  footer: "Footer",
  map: "Map",
};

const CATEGORY_ORDER = [
  "nav",
  "hero",
  "about",
  "services",
  "gallery",
  "reviews",
  "faq",
  "cta",
  "contact",
  "footer",
  "map",
];

// Categories that look right as full-width strips (wide+short) instead of 16:9 grid tiles
const STRIP_CATEGORIES = new Set(["nav", "footer", "cta"]);

export default async function SectionTemplatesPage() {
  // tech_admin is the primary user (they upload + maintain templates).
  // super_admin gets in via role hierarchy.
  await requireRole("tech_admin");
  const admin = createAdminClient();

  const { data: templates, error } = await admin
    .from("section_templates")
    .select(
      "id, category, name, html_path, css_path, preview_image, placeholder_schema, tags, industry_hints, is_published, version, updated_at",
    )
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return (
      <div className="dash-panel flex items-start gap-3 border-destructive/40 p-5 text-sm">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 text-destructive">
          <AlertCircle className="h-4 w-4" />
        </span>
        <div className="space-y-1">
          <p className="font-medium">Failed to load templates</p>
          <p className="text-muted-foreground">{error.message}</p>
          <p className="text-xs text-muted-foreground">
            Did you apply migration <code>00042_template_library.sql</code>?
          </p>
        </div>
      </div>
    );
  }

  const grouped = (templates ?? []).reduce<Record<string, typeof templates>>(
    (acc, t) => {
      if (!acc[t.category]) acc[t.category] = [];
      acc[t.category]!.push(t);
      return acc;
    },
    {},
  );

  const total = templates?.length ?? 0;

  // Live preview bodies — same source the composer's VariantPicker uses.
  // We render each template in an iframe via PreviewFrame so the library
  // page shows the actual section, not a stale static thumbnail.
  // Includes BOTH published and draft templates so tech can preview drafts
  // before flipping them live (the composer-side query filters by
  // is_published=true; we want everything visible here for maintenance).
  const templateBodies = await loadTemplateBodies(admin, templates ?? []);
  const baseCss = loadBaseCss();

  const categoryCount = Object.keys(grouped).length;

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Clean page header — icon chip + eyebrow + title, with at-a-glance
          counts on the right. No gradient: this is a maintenance surface. */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="dash-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
            <Layers className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Template library
            </p>
            <h1 className="text-2xl font-bold tracking-tight">Section templates</h1>
            <p className="text-sm text-muted-foreground">
              Reusable sections used by the proposal composer.
            </p>
          </div>
        </div>

        {total > 0 && (
          <div className="flex shrink-0 gap-3">
            <div className="dash-card flex items-center gap-3 px-4 py-3">
              <span className="dash-chip inline-flex h-9 w-9 items-center justify-center rounded-lg">
                <Layers className="h-4 w-4" />
              </span>
              <div>
                <p className="text-2xl font-bold leading-none tabular-nums">
                  {total}
                </p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Template{total === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <div className="dash-card flex items-center gap-3 px-4 py-3">
              <span className="dash-chip inline-flex h-9 w-9 items-center justify-center rounded-lg">
                <FolderTree className="h-4 w-4" />
              </span>
              <div>
                <p className="text-2xl font-bold leading-none tabular-nums">
                  {categoryCount}
                </p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {categoryCount === 1 ? "Category" : "Categories"}
                </p>
              </div>
            </div>
          </div>
        )}
      </header>

      <UploadForm />

      <div className="space-y-10">
        {CATEGORY_ORDER.map((category) => {
          const items = grouped[category];
          if (!items || items.length === 0) return null;

          return (
            <section key={category} className="space-y-4">
              <div className="dash-hairline flex items-baseline justify-between border-b pb-2.5">
                <h2 className="text-sm font-semibold uppercase tracking-wider">
                  {CATEGORY_LABELS[category] ?? category}
                </h2>
                <span className="dash-chip inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums">
                  {items.length}
                </span>
              </div>
              <div
                className={
                  STRIP_CATEGORIES.has(category)
                    ? "flex flex-col gap-2"
                    : "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
                }
              >
                {items.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    layout={STRIP_CATEGORIES.has(category) ? "strip" : "tile"}
                    body={
                      (templateBodies as Record<string, TemplateBody>)[t.id]
                    }
                    baseCss={baseCss}
                  />
                ))}
              </div>
            </section>
          );
        })}

        {total === 0 && (
          <div className="dash-panel flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="dash-chip inline-flex h-12 w-12 items-center justify-center rounded-xl">
              <Inbox className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium">No templates yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Upload your first template using the form above. The HTML can be a
              full preview file (with{" "}
              <code>SECTION:&lt;category&gt;:start</code> markers) or a section
              fragment.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
