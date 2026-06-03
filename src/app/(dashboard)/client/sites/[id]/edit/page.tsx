import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { SiteEditorClient } from "./site-editor-client";
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
// the client editor serves the OLD HTML. See
// feedback_publish_route_cache_busting.md.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

// Empty composition fallback for non-legacy sites whose `composition` JSON
// is null / shaped wrong. The composer always renders a single home page
// (subpages aren't shipped yet) so a single empty page is the right floor.
const EMPTY_COMPOSITION: SiteComposition = {
  pages: [{ path: "index.html", label: "Home", sections: [] }],
};

export default async function ClientSiteEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireRole("client");
  const { id } = await params;
  const supabase = await createClient();

  // Fetch site (must belong to this client). Pull the composer-relevant
  // columns too (composition, is_legacy, site_url) so the branch below
  // can hand them straight to ComposerClient without a second round-trip.
  const { data: site, error } = await supabase
    .from("sites")
    .select(
      "id, name, slug, domain, site_url, status, is_paid, proposal_id, is_legacy, composition, updated_at, credit_balances(*)",
    )
    .eq("id", id)
    .eq("owner_id", profile.id)
    .single();

  if (error || !site) notFound();

  // ────────────────────────────────────────────────────────────────────
  // Non-legacy site → render the locked-down composer (Phase C).
  // Mirrors src/app/(dashboard)/tech/proposals/[id]/composer/page.tsx but
  // without site creation (the site must already exist for a client to
  // be in here) and with mode="client" so the composer hides every
  // structural action — section rail, variant picker, remove buttons,
  // subdomain editor, history/revert, and the regenerate scaffold.
  // ────────────────────────────────────────────────────────────────────
  if (!site.is_legacy) {
    const admin = createAdminClient();

    // Hydrate composition with the empty-page floor if the row is somehow
    // missing one. This keeps the composer from blowing up on activePage
    // access in the very rare case of a non-legacy site with a null/empty
    // composition (data bug or mid-build state).
    let composition: SiteComposition =
      (site.composition as SiteComposition | null) ?? EMPTY_COMPOSITION;
    if (!composition.pages || composition.pages.length === 0) {
      composition = EMPTY_COMPOSITION;
    }

    // Load published section templates + their HTML/CSS bodies so the
    // composer can render the iframe preview locally with zero per-edit
    // server round-trips. Same pattern as the tech composer page.
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
    // Resolved separately from site_url so the composer iframe can use
    // the always-working pages.dev URL as <base href>. Sidesteps the
    // DNS+SSL propagation window on subdomain rename / custom-domain
    // attach where site_url would point at a still-unresolvable host.
    const pagesUrl = await resolvePagesUrl(admin, {
      id: site.id,
      slug: site.slug,
      site_url: site.site_url,
    });

    // Drop storage paths before sending to the client — only the metadata
    // + schema are needed in the browser.
    const clientTemplates = (templates ?? []).map((t) => ({
      id: t.id,
      category: t.category,
      name: t.name,
      preview_image: t.preview_image,
      placeholder_schema: t.placeholder_schema,
    }));

    // Concurrent-edit guard. Same lock as the tech proposals composer —
    // shared per-site, so a tech editing the site here blocks the
    // client and vice-versa. Renders the locked screen instead of the
    // editor when someone else is mid-edit; the editor never mounts so
    // there's no save race.
    const lockResult = await acquireOrCheckLock(
      admin,
      site.id,
      profile.id,
      "client",
    );
    if (lockResult.status === "held_by_other") {
      return (
        <SiteLockedScreen
          team={roleToTeam(lockResult.team)}
          since={lockResult.since}
          backHref="/client/sites"
        />
      );
    }

    return (
      <ComposerClient
        siteId={site.id}
        siteName={site.name}
        initialComposition={composition}
        templates={clientTemplates}
        templateBodies={templateBodies}
        baseCss={baseCss}
        backHref="/client/sites"
        siteUrl={site.site_url}
        pagesUrl={pagesUrl}
        mode="client"
      />
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // Legacy site → existing inline-DOM editor (untouched).
  // ────────────────────────────────────────────────────────────────────

  // Credit balance
  const balance = Array.isArray(site.credit_balances)
    ? (site.credit_balances[0]?.balance ?? 0)
    : ((site.credit_balances as { balance: number } | null)?.balance ?? 0);

  // Fetch proposal info for the top bar
  const { data: proposal } = site.proposal_id
    ? await supabase
        .from("proposals")
        .select("id, company_name, town, base_price, discount_price, discount_expires_at, status, variable_symbol, qr_image_cache, contacts(contact_person)")
        .eq("id", site.proposal_id)
        .single()
    : { data: null };

  const contactPerson = proposal?.contacts && !Array.isArray(proposal.contacts)
    ? (proposal.contacts as { contact_person: string | null }).contact_person
    : null;

  return (
    <SiteEditorClient
      site={{
        id: site.id,
        name: site.name,
        slug: site.slug,
        domain: site.domain,
        site_url: site.site_url,
        status: site.status,
        is_paid: site.is_paid ?? true,
      }}
      proposal={proposal ? {
        company_name: proposal.company_name,
        town: proposal.town ?? null,
        contact_person: contactPerson,
        base_price: proposal.base_price ?? null,
        discount_price: proposal.discount_price ?? null,
        discount_expires_at: proposal.discount_expires_at ?? null,
        status: proposal.status,
        variable_symbol: proposal.variable_symbol ?? null,
        iban: process.env.BYSQUARE_IBAN || null,
        qr_image_url: proposal.qr_image_cache ?? null,
      } : null}
      creditBalance={balance}
    />
  );
}
