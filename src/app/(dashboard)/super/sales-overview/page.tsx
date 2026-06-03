import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLastActiveMap, lastActiveLabel } from "@/lib/auth/last-active";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Link from "next/link";
import { ClipboardList } from "lucide-react";

export const dynamic = "force-dynamic";

const TERMINAL_CONTACT_STATUSES = [
  "not_exists",
  "not_interested",
  "archived",
  "client",
  "converted",
];

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default async function SuperSalesOverviewPage() {
  await requireRole("super_admin");
  const supabase = createAdminClient();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    { data: salesPeople },
    { data: todayCallLogs },
    { data: allContacts },
    { data: allProposals },
    { data: publishedSites },
    { data: liveDeployments },
    lastActiveBy,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "sales")
      .eq("is_active", true)
      .order("full_name"),
    supabase
      .from("call_logs")
      .select("sales_person_id")
      .gte("created_at", todayStart.toISOString()),
    supabase
      .from("contacts")
      .select("assigned_to, status"),
    // Pull id + sales_person_id + status. We pair this with the
    // "shipped" set computed below to count per-salesperson pending
    // (= still in build queue) and paid totals from one query.
    supabase
      .from("proposals")
      .select("id, sales_person_id, status"),
    // Same two "did this proposal ship?" signals /tech/proposals and
    // the super overview's Pending Proposals card use. Keeping the
    // definition centralized here means the per-salesperson Pending
    // count never drifts from the system-wide one.
    supabase
      .from("sites")
      .select("proposal_id")
      .not("last_published_at", "is", null),
    supabase
      .from("deployments")
      .select("proposal_id")
      .eq("deploy_status", "live"),
    fetchLastActiveMap(supabase),
  ]);

  // Set of proposal IDs that are NO LONGER in the build queue. Anything
  // in here counts as "shipped" — published or live-deployed.
  const shippedProposalIds = new Set<string>();
  for (const s of publishedSites || []) {
    if (s.proposal_id) shippedProposalIds.add(s.proposal_id);
  }
  for (const d of liveDeployments || []) {
    if (d.proposal_id) shippedProposalIds.add(d.proposal_id);
  }

  const rows = (salesPeople || []).map((person) => {
    const currentLeads = (allContacts || []).filter(
      (c) =>
        c.assigned_to === person.id &&
        !TERMINAL_CONTACT_STATUSES.includes(c.status),
    ).length;
    const callsToday = (todayCallLogs || []).filter(
      (c) => c.sales_person_id === person.id,
    ).length;
    const personProposals = (allProposals || []).filter(
      (p) => p.sales_person_id === person.id,
    );
    // "Pending" mirrors the system-wide build-queue rule: this
    // salesperson's proposals that have NOT shipped yet (no published
    // site + no live deployment). Same source of truth as the
    // overview's Pending Proposals card.
    const pending = personProposals.filter(
      (p) => !shippedProposalIds.has(p.id),
    ).length;
    const paid = personProposals.filter((p) => p.status === "paid").length;

    const active = lastActiveLabel(lastActiveBy.get(person.id) ?? null);

    return {
      id: person.id,
      full_name: person.full_name,
      lastActiveLabel: active.label,
      isActive: active.isActive,
      currentLeads,
      callsToday,
      pending,
      paid,
    };
  });

  const totalProposalRequests = rows.reduce((s, r) => s + r.pending, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Salespeople</h1>

      {/* Team-wide proposal-requests banner — mirrors the IT Team page's
          build-queue banner, but counts proposal requests by salesperson. */}
      <div className="rounded-lg border bg-card p-4 flex items-center gap-3">
        <div className="rounded-md p-2 shrink-0 bg-muted">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold tabular-nums">{totalProposalRequests}</p>
          <p className="text-xs text-muted-foreground">
            proposal requests across all salespeople
          </p>
        </div>
        <Link
          href="/super/proposals"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          See proposals →
        </Link>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="py-3">Name</TableHead>
              <TableHead className="py-3">Last active</TableHead>
              <TableHead className="text-right py-3">Current leads</TableHead>
              <TableHead className="text-right py-3">Calls today</TableHead>
              <TableHead className="text-right py-3">Proposal requests</TableHead>
              <TableHead className="text-right py-3 pr-6">Paid</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-12 text-sm text-muted-foreground"
                >
                  No salespeople yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((person) => (
                <TableRow key={person.id} data-interactive="true" className="hover:bg-muted/30">
                  <TableCell className="py-3">
                    <Link
                      href={`/super/sales-overview/${person.id}`}
                      className="flex items-center gap-3 group"
                    >
                      <div className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 bg-muted text-muted-foreground">
                        {getInitials(person.full_name)}
                      </div>
                      <span className="font-medium group-hover:underline">
                        {person.full_name}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="py-3 text-sm">
                    {person.isActive ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {person.lastActiveLabel}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {person.lastActiveLabel}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right py-3 tabular-nums text-base font-medium">
                    {person.currentLeads.toLocaleString("sk-SK")}
                  </TableCell>
                  <TableCell className="text-right py-3 tabular-nums text-base font-medium">
                    {person.callsToday}
                  </TableCell>
                  <TableCell className="text-right py-3 tabular-nums text-base font-medium">
                    {person.pending}
                  </TableCell>
                  <TableCell className="text-right py-3 pr-6 tabular-nums text-base font-medium">
                    {person.paid}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
