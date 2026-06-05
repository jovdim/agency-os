import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { UserCog } from "lucide-react";
import { LegacyWorkspace } from "./legacy-workspace";
import { ProposalTimeline } from "@/components/proposal-timeline/proposal-timeline";
import { ClientDetailClient } from "@/components/live-clients/client-detail-client";
import { loadClientDetail } from "@/components/live-clients/load-client-detail";
// deriveSteps + types come from a NON-client module so the server
// component is allowed to call them. Importing deriveSteps from
// proposal-timeline.tsx (which has "use client") would cross a
// boundary Next.js refuses at runtime.
//
// Both modules moved 2026-05-10 to src/components/proposal-timeline/
// so the sales /sales/proposals/[id] page can render the same UI.
// Behavior here is unchanged — only the import paths shifted.
import {
  deriveSteps,
  extractCreditBalance,
  type TimelineProposal,
  type TimelineSite,
} from "@/components/proposal-timeline/timeline-steps";
import { MarkAsPaidLauncher } from "@/components/proposal-timeline/mark-as-paid-launcher";
import { PublishRequestCard } from "@/components/proposal-timeline/publish-request-card";

export const dynamic = "force-dynamic";

// Per-publish charge in $. Source of truth is PUBLISH_COST_EUR in
// src/app/api/sites/[id]/credit-balance/route.ts; mirrored here for the
// approval card's "will charge X $" line.
const PUBLISH_COST_EUR = 12.5;

export default async function ProposalBuildPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireRole("tech_admin");
  const { id } = await params;
  const admin = createAdminClient();

  // ── Site + proposal lookups in parallel ──
  // Both are keyed by the URL id (one by proposal_id, the other by id)
  // and neither needs the other's result for the query itself. We branch
  // on siteRow.is_legacy after — in the rare legacy case the parallel
  // proposalRow fetch is wasted, but legacy is deprecated and most
  // visits are the new composer flow where both rows are used.
  //
  // The domain_setup_* columns power the Custom Domain timeline step's
  // live progress UI. sent_at / price / discount_price / base_price are
  // read for sales-only timeline branches; tech doesn't render those
  // but the shared TimelineProposal type carries them so we always
  // supply them.
  const [{ data: siteRow }, { data: proposalRow, error }] = await Promise.all([
    admin
      .from("sites")
      .select(
        "id, owner_id, is_legacy, last_published_at, domain, domain_status, site_url, subdomain, requested_domain, domain_setup_status, domain_setup_started_at, domain_setup_error, domain_nameservers, credit_balances(balance)",
      )
      .eq("proposal_id", id)
      .limit(1)
      .maybeSingle(),
    admin
      .from("proposals")
      .select(
        `
          id,
          status,
          company_name,
          industry,
          town,
          services,
          requirements,
          show_banner,
          client_temp_password,
          business_email_sent_at,
          sent_at,
          price,
          discount_price,
          base_price,
          discount_expires_at,
          created_at,
          paid_at,
          sales_person_id,
          contact_id,
          contacts(contact_person, phone, email, business_email),
          profiles!proposals_sales_person_id_fkey(full_name)
        `,
      )
      .eq("id", id)
      .single(),
  ]);

  // Soft branch: proposals whose site is flagged legacy keep using the old
  // upload-and-deploy workspace (preserved verbatim in legacy-workspace.tsx).
  if (siteRow?.is_legacy === true) {
    return (
      <LegacyWorkspace
        proposalId={id}
        currentUserId={profile.id}
        composerAvailable={false}
      />
    );
  }

  if (error || !proposalRow) {
    notFound();
  }

  // Resolve owner role + email for the "client zone" step. We also pull
  // the linked profile's business-email + password so the "Business email"
  // step can prefill the form when re-visiting a proposal where setup
  // already happened. owner_full_name is read for the welcome-email
  // dialog prefill (sales-only timeline branch).
  let ownerRole: string | null = null;
  let ownerEmail: string | null = null;
  let ownerFullName: string | null = null;
  let clientBusinessEmail: string | null = null;
  let clientBusinessEmailPassword: string | null = null;
  if (siteRow?.owner_id) {
    // Profile row + auth row in parallel. Email lives on auth.users
    // (not profiles), so we have to make both calls — previously
    // sequential for no reason.
    const [{ data: ownerProfile }, { data: authUser }] = await Promise.all([
      admin
        .from("profiles")
        .select("role, full_name, business_email, business_email_password")
        .eq("id", siteRow.owner_id)
        .single(),
      admin.auth.admin.getUserById(siteRow.owner_id),
    ]);
    ownerRole = (ownerProfile?.role as string | undefined) ?? null;
    ownerFullName =
      (ownerProfile as { full_name?: string | null } | null)?.full_name ?? null;
    clientBusinessEmail =
      (ownerProfile as { business_email?: string | null } | null)?.business_email ?? null;
    clientBusinessEmailPassword =
      (ownerProfile as { business_email_password?: string | null } | null)
        ?.business_email_password ?? null;
    ownerEmail = authUser?.user?.email ?? null;
  }

  // Normalize embedded relations (Supabase returns array OR single object
  // depending on the inferred relationship).
  type ContactSel = {
    contact_person: string | null;
    phone: string | null;
    email: string | null;
    business_email: string | null;
  };
  type SalesProfileSel = { full_name: string | null };

  const contactsRaw = (proposalRow as { contacts?: ContactSel | ContactSel[] | null })
    .contacts ?? null;
  const contact = Array.isArray(contactsRaw) ? contactsRaw[0] ?? null : contactsRaw;

  const salesRaw = (proposalRow as {
    profiles?: SalesProfileSel | SalesProfileSel[] | null;
  }).profiles ?? null;
  const sales = Array.isArray(salesRaw) ? salesRaw[0] ?? null : salesRaw;

  const proposalForTimeline: TimelineProposal = {
    id: proposalRow.id as string,
    status: proposalRow.status as string,
    company_name: proposalRow.company_name as string,
    industry: (proposalRow.industry as string | null) ?? null,
    town: (proposalRow.town as string | null) ?? null,
    services: (proposalRow.services as string[] | null) ?? null,
    requirements: (proposalRow.requirements as string | null) ?? null,
    show_banner:
      (proposalRow as { show_banner?: boolean | null }).show_banner !== false,
    client_temp_password:
      (proposalRow as { client_temp_password?: string | null })
        .client_temp_password ?? null,
    business_email_sent_at:
      (proposalRow as { business_email_sent_at?: string | null })
        .business_email_sent_at ?? null,
    contact_id:
      (proposalRow as { contact_id?: string | null }).contact_id ?? null,
    sent_at: (proposalRow as { sent_at?: string | null }).sent_at ?? null,
    // Channel-level send timestamps are only used by the sales
    // SendToClientAction; tech doesn't render that step. Pass null
    // to satisfy the shared type without an extra query.
    sent_email_at: null,
    sent_whatsapp_at: null,
    price:
      (proposalRow as { price?: number | null }).price === undefined
        ? null
        : ((proposalRow as { price?: number | null }).price ?? null),
    discount_price:
      (proposalRow as { discount_price?: number | null }).discount_price ?? null,
    base_price:
      (proposalRow as { base_price?: number | null }).base_price ?? null,
    discount_expires_at:
      (proposalRow as { discount_expires_at?: string | null })
        .discount_expires_at ?? null,
    paid_at:
      (proposalRow as { paid_at?: string | null }).paid_at ?? null,
    created_at: proposalRow.created_at as string,
    contact: contact ?? null,
    sales: sales ?? null,
    client_profile: siteRow?.owner_id
      ? {
          business_email: clientBusinessEmail,
          business_email_password: clientBusinessEmailPassword,
        }
      : null,
  };

  const siteForTimeline: TimelineSite | null = siteRow
    ? {
        id: siteRow.id,
        owner_id: siteRow.owner_id ?? null,
        owner_email: ownerEmail,
        owner_full_name: ownerFullName,
        owner_role: ownerRole,
        credit_balance: extractCreditBalance(siteRow),
        last_published_at: siteRow.last_published_at ?? null,
        domain: siteRow.domain ?? null,
        domain_status: siteRow.domain_status ?? null,
        site_url: siteRow.site_url ?? null,
        subdomain: siteRow.subdomain ?? null,
        domain_setup_status:
          (siteRow as { domain_setup_status?: string | null })
            .domain_setup_status ?? null,
        domain_setup_started_at:
          (siteRow as { domain_setup_started_at?: string | null })
            .domain_setup_started_at ?? null,
        domain_setup_error:
          (siteRow as { domain_setup_error?: string | null })
            .domain_setup_error ?? null,
        domain_nameservers:
          (siteRow as { domain_nameservers?: string[] | null })
            .domain_nameservers ?? null,
        requested_domain:
          (siteRow as { requested_domain?: string | null })
            .requested_domain ?? null,
      }
    : null;

  // Tech timeline: 5-step list. role defaults to "tech_admin" but
  // we pass it explicitly to make the intent obvious — and so this
  // file documents the role-aware step list contract for any future
  // grep.
  const steps = deriveSteps(proposalForTimeline, siteForTimeline, "tech_admin");

  // Default-fill the Mark-as-paid dialog with the proposal's most
  // accurate price guess — prefer the explicit price column, fall
  // back to the discount value (still active or expired), then the
  // base price. Salesperson can override in the dialog but this
  // covers the 95% case (invoice paid in full at the agreed price).
  const markPaidDefaultAmount = Number(
    proposalRow.price ??
      proposalRow.discount_price ??
      proposalRow.base_price ??
      299,
  );

  // Welcome-email pre-fill — taken from the same data the proposal
  // pipeline's "Send welcome email" step uses, so the post-mark-paid
  // dialog opens with the right defaults. Owner email wins over
  // contact email when the client account already exists (auth user
  // is the source of truth at that point).
  const welcomeEmailRecipient =
    ownerEmail ?? contact?.email ?? null;
  const welcomeFullName =
    ownerFullName ??
    contact?.contact_person ??
    (proposalRow.company_name as string);
  const liveSiteUrl =
    siteRow?.site_url ??
    (siteRow?.subdomain ? `https://${siteRow.subdomain}.2dni.sk` : null);

  // ── Live-client panel ──
  // Always fetched (gate dropped 2026-05-20) so the Setup section
  // inside the Site card surfaces for non-paid proposals too —
  // tech / sales need to kick off domain + business-email requests
  // before payment too (a client may pay externally; we set up the
  // domain first, mark paid after). Empty payment/credits data is
  // rendered as "—" placeholders on non-paid rows.
  //
  // Returns null only when the proposal doesn't exist (handled above
  // by notFound()), so the conditional render below is purely a
  // safety net.
  const clientDetail = await loadClientDetail(id);

  // ── Pending client publish request ──
  // Surfaces the approval card in the timeline's banner slot. Only the
  // single open ('pending') request matters — approve/reject/cancel move
  // it off 'pending' (one-pending-per-site index). Null = no card shown.
  let pendingPublishRequest: { created_at: string } | null = null;
  if (siteRow?.id) {
    const { data: pr } = await admin
      .from("publish_requests")
      .select("created_at")
      .eq("site_id", siteRow.id)
      .eq("status", "pending")
      .maybeSingle();
    pendingPublishRequest = pr ?? null;
  }

  return (
    <>
      <ProposalTimeline
        proposal={proposalForTimeline}
        site={siteForTimeline}
        steps={steps}
        currentUserId={profile.id}
        role="tech_admin"
        banner={
          pendingPublishRequest && siteRow ? (
            <PublishRequestCard
              siteId={siteRow.id}
              createdAt={pendingPublishRequest.created_at}
              balance={extractCreditBalance(siteRow)}
              publishCost={PUBLISH_COST_EUR}
            />
          ) : undefined
        }
        headerActions={
          <MarkAsPaidLauncher
            proposalId={proposalRow.id}
            companyName={proposalRow.company_name}
            status={proposalRow.status}
            defaultAmount={markPaidDefaultAmount}
            clientEmail={welcomeEmailRecipient}
            clientFullName={welcomeFullName}
            clientSiteUrl={liveSiteUrl}
            currentPassword={proposalRow.client_temp_password ?? null}
            currentMainDomain={siteRow?.domain ?? null}
            currentCreditBalance={extractCreditBalance(siteRow)}
          />
        }
      />

      {/* Live-client management panel — renders for any proposal
          with a site. Setup section (domain + business email request
          buttons) needs to be reachable before payment too, so the
          paid-only gate was dropped. Cards that depend on payment
          data (Payment, Credits, journey) degrade to placeholder
          values for non-paid rows. Embedded mode drops the duplicate
          header + back button so it nests cleanly under the timeline
          above. */}
      {clientDetail && (
        <div className="dash-hairline mt-8 border-t pt-8">
          <div className="mb-5 flex items-center gap-3">
            <span className="dash-chip inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
              <UserCog className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="dash-subhead text-[11px] uppercase tracking-wider text-muted-foreground">
                Client zone
              </p>
              <p className="text-sm text-muted-foreground">
                Domain &amp; business-email setup, payment and credits for this client
              </p>
            </div>
          </div>
          <ClientDetailClient
            data={clientDetail}
            composerPathPrefix="/tech"
            listPathPrefix="/tech"
            embedded
          />
        </div>
      )}
    </>
  );
}
