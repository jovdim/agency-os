/**
 * Sales-side proposal detail.
 *
 * Renders the SAME shared timeline as /tech/proposals/[id] (see
 * src/components/proposal-timeline/), just with role="sales" so the
 * in-page links (composer + back arrow) point to /sales/... and the
 * "Send to sales" button is hidden (sales doesn't send to themselves).
 *
 * The data shape we hand to the timeline is identical to the tech
 * page's. We could DRY this up by extracting the loader, but for now
 * keeping it explicit on each side keeps role-specific tweaks (auth
 * guards, future filters) easy to add without coupling.
 *
 * Phase 1 ships this UI parity. Phase 2 will layer sales-only
 * timeline rows (Send to client, Welcome client) on top of the
 * shared component — see TODOs.
 */
import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { Buildings as Building2 } from "@phosphor-icons/react/ssr";
import { ProposalTimeline } from "@/components/proposal-timeline/proposal-timeline";
import { ClientDetailClient } from "@/components/live-clients/client-detail-client";
import { loadClientDetail } from "@/components/live-clients/load-client-detail";
import {
  deriveSteps,
  extractCreditBalance,
  type TimelineProposal,
  type TimelineSite,
} from "@/components/proposal-timeline/timeline-steps";
import { MarkAsPaidLauncher } from "@/components/proposal-timeline/mark-as-paid-launcher";

export const dynamic = "force-dynamic";

export default async function SalesProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireRole("sales");
  const { id } = await params;
  const admin = createAdminClient();

  // ── Wave 1: three parallel lookups ──
  //   siteRow    — drives the timeline + legacy redirect check
  //   proposalRow — full proposal + embedded contact/sales (includes
  //                 is_migrated so we can drop the old standalone
  //                 migratedCheck query)
  //   emailRows  — per-channel send history for SendToClientAction
  //                ("Sent by email" / "via WhatsApp" cues)
  //
  // Pre-refactor these ran sequentially across the function (+ a
  // separate single-column migratedCheck query that's now folded into
  // proposalRow). For staff opening a proposal this collapses
  // 4 round-trips into 1.
  //
  // Trade-off: in the rare is_migrated case we waste siteRow +
  // emailRows because we redirect immediately. The page is hit
  // constantly by sales — the non-migrated path is the hot one.
  const [{ data: siteRow }, { data: proposalRow, error }, { data: emailRows }] =
    await Promise.all([
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
            is_migrated,
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
      admin
        .from("proposal_emails")
        .select("email_type, sent_at")
        .eq("proposal_id", id)
        .in("email_type", ["proposal", "proposal_whatsapp"])
        .order("sent_at", { ascending: false }),
    ]);

  if (error || !proposalRow) {
    notFound();
  }

  // is_migrated drives the access check below. We do NOT redirect migrated
  // rows to the composer anymore — sales now sees the SAME page tech +
  // super see (ProposalTimeline + embedded live-client card). Super's
  // /super/live-clients/[id] just redirects into /tech/proposals/[id];
  // sales can't enter /tech (middleware), so this page IS the sales-side
  // equivalent of that exact view.
  const isMigrated =
    (proposalRow as { is_migrated?: boolean }).is_migrated === true;

  // Stamp sales_seen_at — this is the "NEW badge clears on click" trigger.
  // Fires on every visit so re-publishes by IT (which move
  // last_published_at forward) re-flag NEW until sales opens it again.
  // Scoped to the assigned salesperson so a sales colleague opening
  // someone else's proposal (rare, but possible) doesn't clear their flag.
  // Fire-and-forget: the user shouldn't wait on this; failure is logged
  // but doesn't block the render.
  if (proposalRow.sales_person_id === profile.id) {
    admin
      .from("proposals")
      .update({ sales_seen_at: new Date().toISOString() })
      .eq("id", id)
      .eq("sales_person_id", profile.id)
      .then(({ error }) => {
        if (error) console.error("mark sales_seen_at failed", error.message);
      });
  }

  // Sales access: OWN organic proposals OR any MIGRATED row. Migrated rows
  // carry the importing tech/super as sales_person_id only to satisfy the
  // NOT NULL FK — every salesperson may open them (same as tech/super and
  // salesCanViewProposal). Without the migrated exception sales 404s on
  // every live/migrated client. Super_admin (passes requireRole("sales")
  // via hierarchy) sees anyone's.
  const ownsProposal =
    (proposalRow as { sales_person_id: string }).sales_person_id === profile.id;
  if (profile.role === "sales" && !ownsProposal && !isMigrated) {
    notFound();
  }

  // ── Owner profile resolution (Client zone + Business email + Welcome) ──
  // Same shape as tech. We need the owner's role to decide if the
  // "Create client zone" step is done, plus their email + saved
  // business-email creds for the BusinessEmailDialog prefill.
  // owner_full_name is read for the welcome-email dialog prefill.
  let ownerRole: string | null = null;
  let ownerEmail: string | null = null;
  let ownerFullName: string | null = null;
  let clientBusinessEmail: string | null = null;
  let clientBusinessEmailPassword: string | null = null;
  if (siteRow?.owner_id) {
    // Profile + auth row in parallel (email lives on auth.users, not
    // profiles, so we have to make both calls).
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
      (ownerProfile as { business_email?: string | null } | null)?.business_email ??
      null;
    clientBusinessEmailPassword =
      (ownerProfile as { business_email_password?: string | null } | null)
        ?.business_email_password ?? null;
    ownerEmail = authUser?.user?.email ?? null;
  }

  // Supabase returns embedded relations as either an array OR a
  // single object depending on the inferred cardinality. Normalize.
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

  // Per-channel send history (emailRows came from Wave 1 above). Drives
  // the "✓ Sent by email" / "✓ Sent via WhatsApp" cues on the
  // SendToClientAction buttons. Both buttons stay clickable post-send
  // (Peter 2026-05-15: sales might want to re-send via the other
  // channel), so this is purely informational. proposal_emails is the
  // single source of truth — `sent_at` on proposals is still the
  // authoritative "ever sent" flag, but doesn't carry channel.
  let sentEmailAt: string | null = null;
  let sentWhatsappAt: string | null = null;
  for (const row of (emailRows ?? []) as Array<{
    email_type: string;
    sent_at: string;
  }>) {
    if (row.email_type === "proposal" && !sentEmailAt) sentEmailAt = row.sent_at;
    if (row.email_type === "proposal_whatsapp" && !sentWhatsappAt)
      sentWhatsappAt = row.sent_at;
    if (sentEmailAt && sentWhatsappAt) break;
  }

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
    sent_email_at: sentEmailAt,
    sent_whatsapp_at: sentWhatsappAt,
    price: (proposalRow as { price?: number | null }).price ?? null,
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

  // Sales timeline. Both roles render the same step list now;
  // the role argument is kept for future role-specific gating.
  const steps = deriveSteps(proposalForTimeline, siteForTimeline, "sales");

  // Default-fill the Mark-as-paid amount with the proposal's current
  // active price (price → discount_price → base_price fallback chain).
  // Sales sees the same launcher as tech — the API enforces own-
  // proposal ownership at submit time.
  const markPaidDefaultAmount = Number(
    proposalRow.price ??
      proposalRow.discount_price ??
      proposalRow.base_price ??
      299,
  );

  // Welcome-email pre-fill — same data the pipeline's "Send welcome
  // email" step uses. Owner-email wins over contact-email when the
  // client account already exists.
  const welcomeEmailRecipient =
    ownerEmail ?? contact?.email ?? null;
  const welcomeFullName =
    ownerFullName ??
    contact?.contact_person ??
    (proposalRow.company_name as string);
  const liveSiteUrl =
    siteRow?.site_url ??
    (siteRow?.subdomain ? `https://${siteRow.subdomain}.pages.dev` : null);

  // Live-client management card (Contact / Site / Payment / Credits /
  // Services) — the SAME card tech embeds under its timeline at
  // /tech/proposals/[id]. Rendering it here makes the sales detail view
  // identical to the tech + super one. Embedded mode drops the card's own
  // header/back button so it nests under the timeline. composerPathPrefix
  // stays "/sales" so the "Open composer" link keeps sales inside its own
  // route tree (sales can't enter /tech).
  const clientDetail = await loadClientDetail(id);

  return (
    <>
      <ProposalTimeline
        proposal={proposalForTimeline}
        site={siteForTimeline}
        steps={steps}
        currentUserId={profile.id}
        role="sales"
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

      {clientDetail && (
        <div className="mt-8 pt-8 border-t dash-hairline">
          <div className="mb-4 flex items-center gap-3">
            <div className="dash-chip">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
                Client zone
              </p>
              <h2 className="text-base font-semibold leading-tight">
                Live client management
              </h2>
            </div>
          </div>
          <ClientDetailClient
            data={clientDetail}
            composerPathPrefix="/sales"
            listPathPrefix="/sales"
            embedded
          />
        </div>
      )}
    </>
  );
}
