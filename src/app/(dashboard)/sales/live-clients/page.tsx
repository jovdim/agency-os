import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  LiveClientsTable,
  type LiveClientRow,
} from "@/components/live-clients/live-clients-table";

/**
 * /sales/live-clients — customer roster scoped to the salesperson.
 *
 * Sales sees:
 *   - their OWN organic proposals (sales_person_id = me, is_migrated = false)
 *   - PLUS all migrated rows (those have no real salesperson attribution
 *     — sales_person_id is just whoever ran the migration to satisfy the
 *     NOT NULL FK, not a real owner)
 *
 * They get the same row actions as tech (Open composer / View live).
 * The "+ Add migrated client" button is HIDDEN — only tech_admin and
 * super_admin can backfill (matches the migrate-client API auth gate).
 */
export const dynamic = "force-dynamic";

export default async function SalesLiveClientsPage() {
  const { profile } = await requireRole("sales");
  const admin = createAdminClient();

  // Two-bucket query — own organic + all migrated. We can't express the
  // OR with eq() chains alone; use the .or() filter on a comma-separated
  // PostgREST string. Status = 'paid' still applies as a hard gate (this
  // page is for LIVE clients only).
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
    .or(`sales_person_id.eq.${profile.id},is_migrated.eq.true`)
    .order("paid_at", { ascending: false, nullsFirst: false });

  const rows = proposals ?? [];
  const proposalIds = rows.map((r) => r.id);

  const { data: payments } = proposalIds.length
    ? await admin
        .from("payments")
        .select("proposal_id, amount, status")
        .in("proposal_id", proposalIds)
        .eq("status", "confirmed")
    : { data: [] as { proposal_id: string; amount: number; status: string }[] };

  const paymentTotalByProposal = new Map<string, number>();
  for (const p of payments ?? []) {
    if (p.proposal_id) {
      paymentTotalByProposal.set(
        p.proposal_id,
        (paymentTotalByProposal.get(p.proposal_id) ?? 0) + (p.amount ?? 0),
      );
    }
  }

  // For sales view we never need to display "salesperson" since the only
  // organic rows in scope ARE this salesperson's own. The column reads
  // empty on every visible row, which still keeps the table layout
  // consistent with the other two roles.
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
      // Migrated → no real attribution. Own organic → the salesperson
      // looking at this IS the attribution, so empty looks fine.
      salesperson: null,
    };
  });

  return (
    <LiveClientsTable
      rows={normalized}
      // Sales can't backfill migrated clients (gate enforced in
      // /api/admin/migrate-client too — only tech_admin + super_admin).
      canAddMigrated={false}
      backHref="/sales"
      // Rows open /sales/proposals/[id] — the SAME timeline + embedded
      // live-client card tech opens at /tech/proposals/[id] (super just
      // redirects into tech's; sales can't, so it has its own mirror).
      // The old standalone /sales/live-clients/[id] now redirects here.
      rowHrefBase="/sales/proposals"
      // English labels — this clone is English-only. All visible strings
      // flip through the STRINGS dictionary in LiveClientsTable.
      lang="en"
    />
  );
}
