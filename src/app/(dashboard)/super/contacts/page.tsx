import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { SuperContactsClient } from "./super-contacts-client";
import { Users, UserCheck, UserMinus as UserX } from "@phosphor-icons/react/ssr";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function SuperContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sales?: string; page?: string }>;
}) {
  await requireRole("super_admin");
  const admin = createAdminClient();
  const params = await searchParams;

  const q = (params.q ?? "").trim();
  // 'all' | 'unassigned' | UUID. Sales filter doubles as both UI selector
  // and bulk-RPC parameter — keep semantics identical to the SQL function
  // in 00068_contacts_bulk_rpcs.sql or "reassign matching" hits the wrong
  // rows.
  const salesFilter = params.sales ?? "all";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  let listQuery = admin
    .from("contacts")
    .select("*, profiles:assigned_to(id, full_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (q) {
    // PostgREST .or uses commas as separators and parens for grouping,
    // so any of those in user input break the parser. Stripping them is
    // enough for a search box — the trigram index does substring match
    // anyway.
    const safe = q.replace(/[,()]/g, " ").trim();
    const pattern = `%${safe}%`;
    listQuery = listQuery.or(
      `company_name.ilike.${pattern},contact_person.ilike.${pattern},town.ilike.${pattern}`,
    );
  }
  if (salesFilter === "unassigned") {
    listQuery = listQuery.is("assigned_to", null);
  } else if (salesFilter !== "all") {
    listQuery = listQuery.eq("assigned_to", salesFilter);
  }

  const [
    { data: contacts, count: totalMatching },
    { data: salesPeople },
    { data: countsByAssigned },
  ] = await Promise.all([
    listQuery,
    admin
      .from("profiles")
      .select("id, full_name")
      .eq("role", "sales")
      .eq("is_active", true)
      .order("full_name"),
    admin.rpc("contacts_counts_by_sales"),
  ]);

  // Build the per-salesperson totals from the GROUP BY RPC so the dropdown
  // labels ("John (1,234)") and Distribution tab don't depend on the
  // current page being loaded.
  const salesCountsArray: { id: string; count: number }[] = [];
  let unassignedCount = 0;
  let grandTotal = 0;
  for (const row of (countsByAssigned as
    | { assigned_to: string | null; contacts_count: number }[]
    | null) ?? []) {
    const n = Number(row.contacts_count);
    grandTotal += n;
    if (row.assigned_to) salesCountsArray.push({ id: row.assigned_to, count: n });
    else unassignedCount = n;
  }

  // Assigned = everything that already has an owner. Derived from the same
  // RPC totals the dropdown uses, so the header reads in lockstep with the
  // filters below.
  const assignedCount = Math.max(0, grandTotal - unassignedCount);

  // At-a-glance header stats. Quiet violet/neutral icon chips only — none of
  // these are "good news / revenue" metrics, so no pink accent here.
  const headerStats: {
    label: string;
    value: number;
    icon: typeof Users;
    chip: string;
    iconClass: string;
  }[] = [
    {
      label: "Total",
      value: grandTotal,
      icon: Users,
      chip: "dash-chip",
      iconClass: "dash-accent",
    },
    {
      label: "Assigned",
      value: assignedCount,
      icon: UserCheck,
      chip: "dash-chip",
      iconClass: "dash-accent",
    },
    {
      label: "Unassigned",
      value: unassignedCount,
      icon: UserX,
      chip: "bg-muted",
      iconClass: "text-muted-foreground",
    },
  ];

  return (
    <div className="dash-root space-y-8">
      {/* Clean page header — no gradient on a sub-page. Eyebrow + title +
          one-line subtitle on the left; compact context stats on the right so
          the operator sees the size of the database before touching filters. */}
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Super Admin
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Contact Management</h1>
          <p className="text-sm text-muted-foreground">
            Browse the full contacts database and assign leads across your sales team.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:flex sm:items-stretch sm:gap-3">
          {headerStats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="dash-card flex items-center gap-3 px-3.5 py-3 sm:px-4"
              >
                <span
                  className={`${stat.chip} inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg`}
                >
                  <Icon className={`${stat.iconClass} h-4 w-4`} />
                </span>
                <div className="min-w-0">
                  <p className="text-lg font-bold leading-tight tabular-nums">
                    {stat.value.toLocaleString()}
                  </p>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {stat.label}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </header>

      <SuperContactsClient
        contacts={contacts ?? []}
        salesPeople={salesPeople ?? []}
        salesCountsArray={salesCountsArray}
        unassignedCount={unassignedCount}
        grandTotal={grandTotal}
        totalMatching={totalMatching ?? 0}
        page={page}
        pageSize={PAGE_SIZE}
        initialSearch={q}
        initialSalesFilter={salesFilter}
      />
    </div>
  );
}
