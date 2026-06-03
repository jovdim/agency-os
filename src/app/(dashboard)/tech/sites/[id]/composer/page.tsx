import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ComposerClient } from "@/components/composer/composer-client";
import { SiteLockedScreen } from "@/components/composer/site-locked-screen";
import {
  loadTemplateBodies,
  loadBaseCss,
} from "@/lib/templates/load-bodies";
import { acquireOrCheckLock, roleToTeam } from "@/lib/composer/site-lock";
import { resolvePagesUrl } from "@/lib/deployment/pages-url";
import type { SiteComposition } from "@/lib/templates/render";

// Cache-busting trio (Peter 2026-05-16): force-dynamic alone leaves
// Next.js caching the Supabase Storage fetches inside
// loadTemplateBodies, which means after we push an updated template
// the composer serves the OLD HTML. See
// feedback_publish_route_cache_busting.md.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const EMPTY_COMPOSITION: SiteComposition = {
  pages: [{ path: "index.html", label: "Domov", sections: [] }],
};

export default async function SiteComposerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("tech_admin");
  const { id } = await params;
  const admin = createAdminClient();

  const { data: site } = await admin
    .from("sites")
    .select("id, name, composition, is_legacy, site_url, slug")
    .eq("id", id)
    .single();

  if (!site) notFound();
  if (site.is_legacy) {
    // Legacy site — composer can't handle it
    redirect(`/tech/sites/${id}`);
  }

  let composition =
    (site.composition as SiteComposition | null) ?? EMPTY_COMPOSITION;
  if (!composition.pages || composition.pages.length === 0) {
    composition = EMPTY_COMPOSITION;
  }

  const { data: templates, error: tplErr } = await admin
    .from("section_templates")
    .select(
      "id, category, name, html_path, css_path, preview_image, placeholder_schema",
    )
    .eq("is_published", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (tplErr) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <h2 className="font-semibold mb-2">Could not load templates</h2>
        <p className="text-sm text-muted-foreground">{tplErr.message}</p>
      </div>
    );
  }

  const templateBodies = await loadTemplateBodies(admin, templates ?? []);
  const baseCss = loadBaseCss();
  // Resolved separately from site_url so the composer iframe can use
  // the always-working pages.dev URL as <base href> while UI surfaces
  // (LIVE AT pill, Open button) continue to show the friendly URL.
  // See `resolvePagesUrl` for the propagation-window rationale.
  const pagesUrl = await resolvePagesUrl(admin, {
    id: site.id,
    slug: site.slug,
    site_url: site.site_url,
  });

  const clientTemplates = (templates ?? []).map((t) => ({
    id: t.id,
    category: t.category,
    name: t.name,
    preview_image: t.preview_image,
    placeholder_schema: t.placeholder_schema,
  }));

  // Concurrent-edit guard. Same per-site lock as the proposals + client
  // composer pages — opening a site here while a client is editing it
  // (or vice-versa) shows the locked screen instead of mounting the
  // editor, so saves can't race.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const role = (user.app_metadata?.role as string | undefined) ?? "tech_admin";
    const lockResult = await acquireOrCheckLock(admin, site.id, user.id, role);
    if (lockResult.status === "held_by_other") {
      return (
        <SiteLockedScreen
          team={roleToTeam(lockResult.team)}
          since={lockResult.since}
          backHref={`/tech/sites/${site.id}`}
        />
      );
    }
  }

  return (
    <ComposerClient
      siteId={site.id}
      siteName={site.name}
      initialComposition={composition}
      templates={clientTemplates}
      templateBodies={templateBodies}
      baseCss={baseCss}
      backHref={`/tech/sites/${site.id}`}
      siteUrl={site.site_url ?? null}
      pagesUrl={pagesUrl}
    />
  );
}
