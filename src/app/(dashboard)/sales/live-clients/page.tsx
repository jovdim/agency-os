import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Users,
  CalendarCheck,
  Layers,
} from "lucide-react";
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

  const firstName = profile.full_name?.trim().split(/\s+/)[0] || "there";

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

  // ── Summary metrics (derived from the rows already in hand — no extra
  // queries). These power the hero band + the good-news stat tiles. Pink
  // accents throughout since every figure here is a paying client. ──────
  const totalRevenue = normalized.reduce(
    (sum, r) => sum + (Number.isFinite(r.amount_paid) ? r.amount_paid : 0),
    0,
  );
  const totalRevenueLabel = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(totalRevenue);

  const organicCount = normalized.filter((r) => !r.is_migrated).length;
  const migratedCount = normalized.length - organicCount;

  // Clients that flipped to paid within the trailing 30 days — the
  // freshest "good news" signal for the rep.
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const paidThisMonth = normalized.filter((r) => {
    if (!r.paid_at) return false;
    return new Date(r.paid_at).getTime() >= monthAgo;
  }).length;

  const statTiles: Array<{
    label: string;
    value: string;
    sublabel: string;
    icon: typeof Users;
    chip: string;
  }> = [
    {
      label: "Paying clients",
      value: String(normalized.length),
      sublabel: "live customers",
      icon: Users,
      chip: "dash-chip-pink",
    },
    {
      label: "Won this month",
      value: String(paidThisMonth),
      sublabel: "paid in last 30 days",
      icon: CalendarCheck,
      chip: "dash-chip-pink",
    },
    {
      label: "Organic / Migrated",
      value: `${organicCount} / ${migratedCount}`,
      sublabel: "by acquisition source",
      icon: Layers,
      chip: "dash-chip",
    },
  ];

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Page header — clean title + one-line subtitle on the left, Back on
          the right. Sits above the hero so the gradient stays the only
          accented band on the page. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Sales
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Live Clients</h1>
          <p className="text-sm text-muted-foreground">
            Your paying customers — organic wins and migrated accounts.
          </p>
        </div>
        <Link
          href="/sales"
          className="dash-row inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground dash-hairline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </div>

      {/* Hero band — the page's single gradient surface. Greeting on the
          left, the focal Total revenue metric in a frosted inset on the
          right. The only gradient and the only pink hero chip live here. */}
      <section className="dash-hero relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Your roster
          </p>
          <h2 className="text-3xl font-bold tracking-tight">
            Nice work, {firstName}
          </h2>
          <p className="text-sm text-muted-foreground">
            {normalized.length === 1
              ? "1 paying client and counting."
              : `${normalized.length} paying clients and counting.`}
          </p>
        </div>

        <div className="dash-hero-metric flex items-center gap-4 px-5 py-4">
          <span className="dash-chip-pink inline-flex h-12 w-12 items-center justify-center rounded-xl">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total revenue
            </p>
            <p className="text-3xl font-bold leading-tight tabular-nums">
              {totalRevenueLabel}
            </p>
            <p className="text-xs text-muted-foreground">from paying clients</p>
          </div>
        </div>
      </section>

      {/* Stat tiles — good-news pink chips on the client/recency counts,
          a quiet violet chip on the operational source split. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {statTiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <div key={tile.label} className="dash-card block p-5">
              <div className="flex items-center justify-between">
                <span
                  className={`${tile.chip} inline-flex h-9 w-9 items-center justify-center rounded-lg`}
                >
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-4 text-3xl font-bold tabular-nums">
                {tile.value}
              </p>
              <p className="mt-1 text-sm font-medium">{tile.label}</p>
              <p className="text-xs text-muted-foreground">{tile.sublabel}</p>
            </div>
          );
        })}
      </div>

      {/* Roster panel — wraps the shared Live Clients table (search, filters,
          per-client rows). Embedded so the table renders without its own
          page chrome; this page owns the header + hero above. The table's
          link/data behavior is unchanged. */}
      <div className="dash-panel overflow-hidden">
        <div className="dash-hairline flex items-center justify-between gap-2 border-b px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 dash-accent" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">
              Paying clients
            </h3>
          </div>
          <Link
            href="/sales/proposals"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            View proposals
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="p-4 sm:p-5">
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
            // This page owns its own header + hero; embed the table so it
            // skips its page-level chrome and renders just the card.
            embedded
          />
        </div>
      </div>
    </div>
  );
}
