import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { SuperContactsClient } from "./super-contacts-client";

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Contact Management (Super Admin)</h1>
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
