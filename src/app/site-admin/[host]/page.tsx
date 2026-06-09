import { headers, cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSiteByHost } from "@/lib/platform/resolve-site";
import { isPlatformHost } from "@/lib/platform/hosts";
import {
  verifySessionToken,
  SITE_SESSION_COOKIE,
} from "@/lib/platform/site-session";
import { ComposerClient } from "@/components/composer/composer-client";
import { loadTemplateBodies, loadBaseCss } from "@/lib/templates/load-bodies";
import type { SiteComposition } from "@/lib/templates/render";
import { LoginForm } from "./login-form";
import { LogoutButton } from "./logout-button";

// Force-dynamic + no-store: the composer must always load the freshest
// templates/composition (mirrors the CRM composer page directives).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const EMPTY_COMPOSITION: SiteComposition = {
  pages: [{ path: "index.html", label: "Home", sections: [] }],
};

/**
 * Per-site CMS admin (reached as theirdomain.com/admin, rewritten here by
 * src/proxy.ts). Shows a login form until the visitor has a valid session for
 * THIS site; then mounts the full composer editor (mode="client").
 */
export default async function SiteAdminPage({
  params,
}: {
  params: Promise<{ host: string }>;
}) {
  const { host: rawHost } = await params;
  const host = decodeURIComponent(rawHost);

  // Only reachable for genuine platform hosts (never the CRM origin directly).
  const hdrs = await headers();
  if (!isPlatformHost(hdrs.get("host"))) notFound();

  const site = await resolveSiteByHost(host);
  if (!site) notFound();

  const cookieStore = await cookies();
  const token = cookieStore.get(SITE_SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);

  const admin = createAdminClient();

  // Re-validate the account on every load so a deactivated/deleted admin loses
  // access immediately — the signed token alone stays valid for its 7-day TTL.
  let authed = false;
  if (session && session.site_id === site.id) {
    const { data: adminRow } = await admin
      .from("site_admins")
      .select("id, is_active")
      .eq("id", session.sid)
      .eq("site_id", site.id)
      .maybeSingle();
    authed =
      !!adminRow &&
      (adminRow as { is_active?: boolean | null }).is_active !== false;
  }

  const { data: siteFull } = await admin
    .from("sites")
    .select("id, name, composition, is_legacy, site_url, slug")
    .eq("id", site.id)
    .single();
  const siteName = (siteFull as { name?: string } | null)?.name || host;

  if (!authed) {
    return <LoginForm siteName={siteName} />;
  }
  if (!siteFull) notFound();
  if (siteFull.is_legacy) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center text-sm text-slate-500">
        This website isn&apos;t editable in the new editor.
      </div>
    );
  }

  // Load exactly what the CRM composer page loads.
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

  // The editor previews + resolves relative assets against the site's own host.
  const hostHeader = hdrs.get("host") || host;
  const proto = hostHeader.includes("localhost") ? "http" : "https";
  const siteUrl = `${proto}://${hostHeader}`;

  return (
    <>
      <ComposerClient
        siteId={site.id}
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
      {/* Sign-out — the composer has no exit for a standalone site admin. */}
      <div className="fixed bottom-3 left-3 z-100">
        <LogoutButton />
      </div>
    </>
  );
}
