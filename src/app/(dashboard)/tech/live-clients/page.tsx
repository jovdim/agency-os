import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { Users } from "lucide-react";
import {
  LiveClientsTable,
  type LiveClientRow,
} from "@/components/live-clients/live-clients-table";

/**
 * /tech/live-clients — dedicated paying-customer roster, tech surface.
 *
 * Visually mirrors /tech/production (Published Websites) so the two
 * lanes feel like the same product surface:
 *   - /tech/production = sites deployed but not yet paid (Awaiting
 *     Payment lane only)
 *   - /tech/live-clients = paying customers (this page)
 *
 * Click a row → opens /tech/proposals/[id], which now hosts the live-
 * client management cards (Contact / Site / Payment / Credits +
 * journey strip + edit dialogs) inline below the proposal timeline.
 *
 * Tech sees ALL paid proposals (organic + migrated) — same scope as
 * super for this view. The "+ Add migrated client" button is enabled
 * because tech runs the backfill (matches the API route's auth gate
 * which accepts tech_admin + super_admin only).
 */
export const dynamic = "force-dynamic";

export default async function TechLiveClientsPage() {
  await requireRole("tech_admin");
  const admin = createAdminClient();

  const { data: proposals } = await admin
    .from("proposals")
    .select(
      `
        id,
        company_name,
        paid_at,
        created_at,
        base_price,
        discount_price,
        price,
        is_migrated,
        sales_person_id,
        contacts(contact_person, email, phone, company_name),
        sites(id, subdomain, domain, last_published_at, is_paid)
      `,
    )
    .eq("status", "paid")
    .order("paid_at", { ascending: false, nullsFirst: false });

  const rows = proposals ?? [];
  const proposalIds = rows.map((r) => r.id);
  // Site ids — used to look up which clients have a pending publish
  // request (the bell badge + "waiting" count on the table).
  const siteIds = rows
    .map((r) => {
      const s = Array.isArray(r.sites) ? r.sites[0] : r.sites;
      return s?.id ?? null;
    })
    .filter((x): x is string => !!x);
  // Salesperson display names only matter for organic rows — migrated
  // proposals carry the importer's ID in sales_person_id for FK reasons,
  // not a real attribution.
  const salesIds = [
    ...new Set(
      rows
        .filter((r) => !r.is_migrated)
        .map((r) => r.sales_person_id)
        .filter((id): id is string => !!id),
    ),
  ];

  // Payments + sales profiles + pending publish requests in parallel —
  // independent lookups.
  const [{ data: payments }, { data: salesProfiles }, { data: pendingReqs }] =
    await Promise.all([
      proposalIds.length
        ? admin
            .from("payments")
            .select("proposal_id, amount, status")
            .in("proposal_id", proposalIds)
            .eq("status", "confirmed")
        : Promise.resolve({ data: [] as { proposal_id: string; amount: number; status: string }[] }),
      salesIds.length
        ? admin
            .from("profiles")
            .select("id, full_name")
            .in("id", salesIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
      siteIds.length
        ? admin
            .from("publish_requests")
            .select("site_id")
            .eq("status", "pending")
            .in("site_id", siteIds)
        : Promise.resolve({ data: [] as { site_id: string }[] }),
    ]);

  const pendingPublishSiteIds = new Set(
    (pendingReqs ?? []).map((p) => p.site_id),
  );

  const paymentTotalByProposal = new Map<string, number>();
  for (const p of payments ?? []) {
    if (p.proposal_id) {
      paymentTotalByProposal.set(
        p.proposal_id,
        (paymentTotalByProposal.get(p.proposal_id) ?? 0) + (p.amount ?? 0),
      );
    }
  }
  const salesById = new Map(
    (salesProfiles ?? []).map((s) => [s.id, s.full_name] as const),
  );

  const normalized: LiveClientRow[] = rows.map((r) => {
    const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
    const site = Array.isArray(r.sites) ? r.sites[0] : r.sites;
    return {
      proposal_id: r.id,
      site_id: site?.id ?? null,
      company_name: r.company_name ?? "Unknown",
      contact_person: contact?.contact_person ?? null,
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
      paid_at: r.paid_at ?? r.created_at ?? null,
      is_migrated: r.is_migrated ?? false,
      subdomain: site?.subdomain ?? null,
      custom_domain: site?.domain ?? null,
      last_published_at: site?.last_published_at ?? null,
      amount_paid:
        paymentTotalByProposal.get(r.id) ??
        Number(r.price ?? r.discount_price ?? r.base_price ?? 0),
      salesperson: r.is_migrated
        ? null
        : (salesById.get(r.sales_person_id) ?? null),
      has_pending_publish: site?.id
        ? pendingPublishSiteIds.has(site.id)
        : false,
    };
  });

  // Total Sales = number of live clients (paying customers). Shown to
  // tech + super (super's /super/live-clients redirects to this page).
  const totalSales = normalized.length;

  return (
    <div className="space-y-4">
      <div className="flex w-full items-center gap-3 rounded-lg border border-emerald-200/60 bg-emerald-50/40 px-4 py-3 sm:w-fit dark:border-emerald-900/50 dark:bg-emerald-950/20">
        <div className="rounded-md bg-emerald-100 p-2 dark:bg-emerald-900/40">
          <Users className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Total Sales</p>
          <p className="text-2xl font-bold leading-tight tabular-nums">
            {totalSales}
          </p>
          <p className="text-[11px] leading-tight text-muted-foreground">
            {totalSales === 1 ? "live client" : "live clients"}
          </p>
        </div>
      </div>

      <LiveClientsTable
        rows={normalized}
        canAddMigrated
        backHref="/tech"
        // Tech: row click → unified proposal page (timeline + paid
        // cards inline below). Same destination the table component
        // ships as its default, but stated explicitly so the role-
        // routing intent is visible right here in the page.
        rowHrefBase="/tech/proposals"
      />
    </div>
  );
}
