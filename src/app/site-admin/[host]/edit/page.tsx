import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ComposerClient } from "@/components/composer/composer-client";
import { loadTemplateBodies, loadBaseCss } from "@/lib/templates/load-bodies";
import type { SiteComposition } from "@/lib/templates/render";
import { ArrowLeft } from "@phosphor-icons/react/ssr";
import { resolveSiteAdminContext } from "../auth";
import { LoginForm } from "../login-form";
import { LogoutButton } from "../logout-button";

// Force-dynamic + no-store: the composer must always load the freshest
// templates/composition (mirrors the CRM composer page directives).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const EMPTY_COMPOSITION: SiteComposition = {
  pages: [{ path: "index.html", label: "Home", sections: [] }],
};

/**
 * The per-site editor — reached as theirdomain.com/admin/edit, opened from the
 * /admin overview's "Edit my website" button. Mounts the full composer in
 * siteAdminMode (structural/IT controls hidden). Auth + host resolution is
 * shared with the overview via resolveSiteAdminContext.
 */
export default async function SiteAdminEditPage({
  params,
}: {
  params: Promise<{ host: string }>;
}) {
  const { host: rawHost } = await params;
  const ctx = await resolveSiteAdminContext(rawHost);
  if (!ctx) notFound();
  if (!ctx.authed) return <LoginForm />;

  const admin = createAdminClient();
  const { data: siteFull } = await admin
    .from("sites")
    .select("id, name, composition, is_legacy, site_url, slug")
    .eq("id", ctx.siteId)
    .single();
  if (!siteFull) notFound();
  if (siteFull.is_legacy) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-6 text-center text-sm text-muted-foreground">
        This website isn&apos;t editable in the new editor.
      </div>
    );
  }

  let composition =
    (siteFull.composition as SiteComposition | null) ?? EMPTY_COMPOSITION;
  if (!composition.pages || composition.pages.length === 0) {
    composition = EMPTY_COMPOSITION;
  }

  const { data: templates } = await admin
    .from("section_templates")
    .select(
      "id, category, name, html_path, css_path, preview_image, placeholder_schema",
    )
    .eq("is_published", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  const templateBodies = await loadTemplateBodies(admin, templates ?? []);
  const baseCss = loadBaseCss();
  const clientTemplates = (templates ?? []).map((t) => ({
    id: t.id,
    category: t.category,
    name: t.name,
    preview_image: t.preview_image,
    placeholder_schema: t.placeholder_schema,
  }));

  const hdrs = await headers();
  const hostHeader = hdrs.get("host") || ctx.host;
  const proto = hostHeader.includes("localhost") ? "http" : "https";
  const siteUrl = `${proto}://${hostHeader}`;

  return (
    <>
      <ComposerClient
        siteId={ctx.siteId}
        siteName={siteFull.name}
        initialComposition={composition}
        templates={clientTemplates}
        templateBodies={templateBodies}
        baseCss={baseCss}
        siteUrl={siteUrl}
        pagesUrl={siteUrl}
        backHref="/admin"
        siteAdminMode
      />
      {/* Back-to-dashboard + sign-out — the composer has no chrome of its own
          for a standalone site admin. Full navigation (<a>) so the platform
          host rewrite resolves /admin -> the overview cleanly. */}
      <div className="fixed bottom-3 left-3 z-100 flex items-center gap-2">
        <a
          href="/admin"
          className="inline-flex items-center gap-1.5 rounded-lg border dash-hairline bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-(--dash-shadow) hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Dashboard
        </a>
        <LogoutButton />
      </div>
    </>
  );
}
