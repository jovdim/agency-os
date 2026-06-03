import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { UploadForm } from "./upload-form";
import { TemplateCard } from "./template-card";
import { loadTemplateBodies, loadBaseCss } from "@/lib/templates/load-bodies";
import type { TemplateBody } from "@/lib/templates/render-browser";

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
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        Failed to load templates: {error.message}
        <p className="text-xs text-muted-foreground mt-2">
          Did you apply migration <code>00042_template_library.sql</code>?
        </p>
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

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Section template library</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reusable sections used by the proposal composer.{" "}
            {total > 0
              ? `${total} template${total === 1 ? "" : "s"} across ${Object.keys(grouped).length} categories.`
              : "No templates uploaded yet."}
          </p>
        </div>
      </div>

      <UploadForm />

      <div className="space-y-8">
        {CATEGORY_ORDER.map((category) => {
          const items = grouped[category];
          if (!items || items.length === 0) return null;

          return (
            <section key={category} className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-semibold">
                  {CATEGORY_LABELS[category] ?? category}{" "}
                  <span className="text-muted-foreground text-xs font-normal ml-1">
                    {items.length}
                  </span>
                </h2>
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
          <div className="rounded-lg border bg-card px-6 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Upload your first template using the form above. The HTML can be
              a full preview file (with <code>SECTION:&lt;category&gt;:start</code> markers)
              or a section fragment.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
