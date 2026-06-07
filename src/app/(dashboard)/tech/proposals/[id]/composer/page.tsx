import { notFound, redirect } from "next/navigation";
import Link from "next/link";
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

// Cache-busting trio (Peter 2026-05-16): force-dynamic alone is NOT
// enough — Next.js still caches Supabase Storage `fetch` calls inside
// loadTemplateBodies, which means after we push an updated template
// (e.g. about-08 v4 with the fixed bullets) the composer continues to
// serve the OLD HTML from cache and authoring affordances vanish.
// `fetchCache = "force-no-store"` + `revalidate = 0` together opt out
// of every layer of Next's fetch cache so every page load downloads
// the latest template HTML/CSS from Storage. Same recipe applied to
// publish/render routes after the May 14 cache-busting incident — see
// feedback_publish_route_cache_busting.md.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const EMPTY_COMPOSITION: SiteComposition = {
  pages: [{ path: "index.html", label: "Home", sections: [] }],
};

export default async function ProposalComposerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("tech_admin");
  const { id: proposalId } = await params;
  const admin = createAdminClient();

  // Load proposal
  const { data: proposal } = await admin
    .from("proposals")
    .select(
      "id, company_name, sales_person_id, status, contacts(business_email)",
    )
    .eq("id", proposalId)
    .single();

  if (!proposal) notFound();

  // Find the existing site for this proposal (create one if none exists).
  //
  // Historical bug: this route used to call .maybeSingle(). When multiple
  // sites somehow existed for the same proposal_id (race condition,
  // manual SQL, etc.), maybeSingle() returned null+error → the code below
  // fell into the "create new" branch and inserted yet another duplicate.
  // Every visit compounded the problem (Peter found one proposal with
  // 69 sites this way).
  //
  // Fix: fetch the full list ordered newest-first, take the first row,
  // and log a warning so any remaining duplicates surface in server logs.
  // Per memory: business rule is "one site per client" — multiple rows
  // here is bad data that should be cleaned up separately.
  const { data: existingSites } = await admin
    .from("sites")
    .select("id, name, slug, composition, is_legacy, site_url, updated_at")
    .eq("proposal_id", proposalId)
    .order("created_at", { ascending: false });

  if (existingSites && existingSites.length > 1) {
    console.warn(
      `[composer] Found ${existingSites.length} sites for proposal ${proposalId}; ` +
        `using most recent (${existingSites[0].id}). Older duplicates should be cleaned up.`,
    );
  }

  const existingSite = existingSites?.[0] ?? null;

  let siteId: string;
  let siteName: string;
  let composition: SiteComposition;
  let siteUrl: string | null = null;

  if (existingSite) {
    if (existingSite.is_legacy) {
      // Legacy site — composer can't handle it, send back to old build workspace
      redirect(`/tech/proposals/${proposalId}`);
    }
    siteId = existingSite.id;
    siteName = existingSite.name;
    siteUrl = existingSite.site_url ?? null;
    composition =
      (existingSite.composition as SiteComposition | null) ?? EMPTY_COMPOSITION;
    // If composition is somehow empty/null on a non-legacy site, hydrate it
    if (!composition.pages || composition.pages.length === 0) {
      composition = EMPTY_COMPOSITION;
    }
  } else {
    // Create a new site for this proposal
    const baseSlug = proposal.company_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const uniqSuffix = Date.now().toString(36);
    const slug = `${baseSlug}-${uniqSuffix}`;

    const { data: newSite, error: siteErr } = await admin
      .from("sites")
      .insert({
        name: proposal.company_name,
        slug,
        owner_id: proposal.sales_person_id,
        proposal_id: proposalId,
        is_legacy: false,
        status: "queued",
        is_paid: false,
        composition: EMPTY_COMPOSITION,
      })
      .select("id, name, updated_at")
      .single();

    if (siteErr || !newSite) {
      return (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <h2 className="font-semibold mb-2">Could not create site</h2>
          <p className="text-sm text-muted-foreground">
            {siteErr?.message || "Unknown error"}
          </p>
          <Link
            href="/tech/proposals"
            className="text-sm text-primary hover:underline mt-3 inline-block"
          >
            ← Back to proposals
          </Link>
        </div>
      );
    }

    siteId = newSite.id;
    siteName = newSite.name;
    composition = EMPTY_COMPOSITION;
  }

  // Load all published section templates (metadata + storage paths)
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
        <p className="text-xs text-muted-foreground mt-2">
          Did you apply migration <code>00042_template_library.sql</code>?
        </p>
      </div>
    );
  }

  // Pre-load every template's HTML + CSS so the composer can render
  // the iframe preview client-side, with zero round-trips per edit.
  const templateBodies = await loadTemplateBodies(admin, templates ?? []);
  const baseCss = loadBaseCss();

  // Resolve the always-working pages.dev URL for the iframe <base href>.
  // siteUrl (the friendly URL) breaks during DNS propagation windows after
  // subdomain rename / custom-domain attach; pages.dev is fronted directly
  // by Cloudflare with no DNS step. The helper falls back through several
  // strategies (site_versions row → slug → CF DNS-record lookup) so it
  // returns a usable URL even when this site has odd data.
  const pagesUrl = await resolvePagesUrl(admin, {
    id: siteId,
    slug: existingSite?.slug ?? null,
    site_url: siteUrl,
  });

  // Strip storage paths from the metadata sent to the client (not needed there)
  const clientTemplates = (templates ?? []).map((t) => ({
    id: t.id,
    category: t.category,
    name: t.name,
    preview_image: t.preview_image,
    placeholder_schema: t.placeholder_schema,
  }));

  // Concurrent-edit guard. Try to claim the site's edit lock; if someone
  // else holds it (and their tab is still alive within the 90s TTL), bail
  // out and render the locked screen instead. The composer never mounts
  // for the second user, so there's zero risk of a save race.
  //
  // We do this *after* the heavy template-loading work so the user gets
  // a fast path through the locked screen — but BEFORE returning the
  // composer so a blocked user never sees even a flash of the editor.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const role = (user.app_metadata?.role as string | undefined) ?? "tech_admin";
    const lockResult = await acquireOrCheckLock(admin, siteId, user.id, role);
    if (lockResult.status === "held_by_other") {
      return (
        <SiteLockedScreen
          team={roleToTeam(lockResult.team)}
          since={lockResult.since}
          backHref={`/tech/proposals/${proposalId}`}
        />
      );
    }
  }

  return (
    <ComposerClient
      siteId={siteId}
      siteName={siteName}
      initialComposition={composition}
      templates={clientTemplates}
      templateBodies={templateBodies}
      baseCss={baseCss}
      proposalId={proposalId}
      backHref={`/tech/proposals/${proposalId}`}
      siteUrl={siteUrl}
      pagesUrl={pagesUrl}
    />
  );
}
