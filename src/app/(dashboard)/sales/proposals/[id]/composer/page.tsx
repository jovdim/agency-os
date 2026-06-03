/**
 * Sales-side composer mirror.
 *
 * Mirrors src/app/(dashboard)/tech/proposals/[id]/composer/page.tsx —
 * same template loading, same lock acquisition, same ComposerClient.
 * The only meaningful differences:
 *
 *   1. requireRole("sales") instead of "tech_admin", so middleware
 *      (proxy.ts → canAccessRoute) actually lets sales reach the
 *      page. Both /sales and /tech are role-gated subtrees, so the
 *      composer can't live in only one of them without unlocking the
 *      whole tree for the other role.
 *   2. Sales-own-proposal guard — a sales user can only open the
 *      composer for proposals they own.
 *   3. back-href + legacy redirect both point at /sales/proposals/[id]
 *      so the composer's "back" exits to the sales-side timeline,
 *      not the tech-side one.
 *
 * Behavior is otherwise identical: the composer creates the site if
 * none exists, claims the edit lock (so two people can't smash saves
 * concurrently), and renders the same ComposerClient with the same
 * template library + base CSS.
 *
 * Future cleanup: extract the shared loader so the two routes don't
 * diverge accidentally. Phase 1 keeps them parallel for blast-radius.
 */
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

// Cache-busting trio (Peter 2026-05-16): same as the tech composer —
// force-dynamic alone leaves Next.js caching Supabase Storage fetches
// inside loadTemplateBodies, so after a template push the composer
// serves stale HTML. See feedback_publish_route_cache_busting.md.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const EMPTY_COMPOSITION: SiteComposition = {
  pages: [{ path: "index.html", label: "Home", sections: [] }],
};

export default async function SalesProposalComposerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireRole("sales");
  const { id: proposalId } = await params;
  const admin = createAdminClient();

  // Load proposal — also enforces the sales-access guard.
  const { data: proposal } = await admin
    .from("proposals")
    .select(
      "id, company_name, sales_person_id, status, is_migrated, contacts(business_email)",
    )
    .eq("id", proposalId)
    .single();

  if (!proposal) notFound();

  // Sales access: OWN organic proposals OR any MIGRATED row. A migrated
  // proposal carries the importing tech/super as sales_person_id purely to
  // satisfy the NOT NULL FK — it isn't really "owned" by anyone, so every
  // salesperson may open it (same as the tech/super side and
  // salesCanViewProposal). Without the is_migrated exception, sales hit a
  // 404 on every live/migrated client. Super_admin (passes
  // requireRole("sales") via hierarchy) sees everything.
  if (
    profile.role === "sales" &&
    proposal.sales_person_id !== profile.id &&
    proposal.is_migrated !== true
  ) {
    notFound();
  }

  // Find or create the site for this proposal
  const { data: existingSite } = await admin
    .from("sites")
    .select("id, name, slug, composition, is_legacy, site_url, updated_at")
    .eq("proposal_id", proposalId)
    .maybeSingle();

  let siteId: string;
  let siteName: string;
  let composition: SiteComposition;
  let siteUrl: string | null = null;

  if (existingSite) {
    if (existingSite.is_legacy) {
      // Legacy site — composer can't render it. Send the salesperson
      // back to the timeline; the legacy upload-and-deploy workspace
      // is tech-only territory.
      redirect(`/sales/proposals/${proposalId}`);
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
            href="/sales/proposals"
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

  // Resolve always-working pages.dev URL for iframe <base href> — see
  // resolvePagesUrl for the propagation-window rationale.
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

  // Concurrent-edit guard. Sales clicking "Open composer" while tech is
  // already editing the same site would otherwise race on save; the lock
  // RPC blocks the second tab from mounting the composer at all. Each
  // role labels its hold via roleToTeam() so the locked screen tells the
  // other person *who* is editing without leaking personal names.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const role = (user.app_metadata?.role as string | undefined) ?? "sales";
    const lockResult = await acquireOrCheckLock(admin, siteId, user.id, role);
    if (lockResult.status === "held_by_other") {
      return (
        <SiteLockedScreen
          team={roleToTeam(lockResult.team)}
          since={lockResult.since}
          backHref={`/sales/proposals/${proposalId}`}
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
      backHref={`/sales/proposals/${proposalId}`}
      siteUrl={siteUrl}
      pagesUrl={pagesUrl}
    />
  );
}
