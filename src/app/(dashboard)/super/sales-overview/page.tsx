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
import { ClipboardText as ClipboardList, Users, PhoneCall, CheckCircle as CheckCircle2, ArrowRight } from "@phosphor-icons/react/ssr";

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

  // Team-wide roll-ups for the stat tiles. Derived purely from the rows
  // already computed above — no extra queries. Paid is the "good news"
  // metric and gets the pink accent; everything else stays operational.
  const teamLeads = rows.reduce((s, r) => s + r.currentLeads, 0);
  const teamCallsToday = rows.reduce((s, r) => s + r.callsToday, 0);
  const teamPaid = rows.reduce((s, r) => s + r.paid, 0);

  const stats: Array<{
    label: string;
    value: number;
    sublabel: string;
    href: string;
    icon: typeof Users;
    chip: string;
    accent?: boolean;
  }> = [
    {
      label: "Proposal requests",
      value: totalProposalRequests,
      sublabel: "in the build queue",
      href: "/tech/proposals",
      icon: ClipboardList,
      chip: "dash-chip",
    },
    {
      label: "Current leads",
      value: teamLeads,
      sublabel: "active across the team",
      href: "/super/contacts",
      icon: Users,
      chip: "dash-chip",
    },
    {
      label: "Calls today",
      value: teamCallsToday,
      sublabel: "logged since midnight",
      href: "/super/sales-overview",
      icon: PhoneCall,
      chip: "dash-chip",
    },
    {
      label: "Paid proposals",
      value: teamPaid,
      sublabel: "converted to clients",
      href: "/super/payments",
      icon: CheckCircle2,
      chip: "dash-chip-pink",
      accent: true,
    },
  ];

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Clean page header — title + one-line subtitle on the left, no gradient
          needed here. The salespeople roster is the focus of this page. */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Sales overview
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Salespeople</h1>
        <p className="text-sm text-muted-foreground">
          Per-person activity, pipeline, and conversions across the team.
        </p>
      </div>

      {/* Team-wide stat tiles. Quiet violet chips for operational numbers; the
          pink chip + accent value marks Paid proposals as the good-news metric. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className="dash-card group block p-5"
            >
              <div className="flex items-center justify-between">
                <span
                  className={`${stat.chip} inline-flex h-9 w-9 items-center justify-center rounded-lg`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <ArrowRight className="dash-accent h-4 w-4 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
              </div>
              <p
                className={`mt-4 text-3xl font-bold tabular-nums${
                  stat.accent ? " text-(--dash-accent-2)" : ""
                }`}
              >
                {stat.value.toLocaleString("en-US")}
              </p>
              <p className="mt-1 text-sm font-medium">{stat.label}</p>
              <p className="text-xs text-muted-foreground">{stat.sublabel}</p>
            </Link>
          );
        })}
      </div>

      {/* Roster — wrapped in a soft panel with an eyebrow header so it reads as
          a deliberate section rather than a bare table. */}
      <section className="dash-panel overflow-hidden">
        <div className="dash-hairline flex items-center justify-between gap-2 border-b px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Users className="dash-accent h-4 w-4" />
            <h2 className="text-xs font-semibold uppercase tracking-wider">
              Team roster
            </h2>
          </div>
          <span className="dash-chip inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums">
            {rows.length}
          </span>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="dash-hairline border-b hover:bg-transparent">
              <TableHead className="py-3 pl-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Name
              </TableHead>
              <TableHead className="py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Last active
              </TableHead>
              <TableHead className="py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Current leads
              </TableHead>
              <TableHead className="py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Calls today
              </TableHead>
              <TableHead className="py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Proposal requests
              </TableHead>
              <TableHead className="py-3 pr-5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Paid
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-14">
                  <div className="flex flex-col items-center justify-center text-center">
                    <span className="dash-chip mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full">
                      <Users className="h-5 w-5" />
                    </span>
                    <p className="text-sm font-medium">No salespeople yet</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Active sales reps will appear here.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((person) => (
                <TableRow
                  key={person.id}
                  data-interactive="true"
                  className="dash-row"
                >
                  <TableCell className="py-3 pl-5">
                    <Link
                      href={`/super/sales-overview/${person.id}`}
                      className="group flex items-center gap-3"
                    >
                      <div className="dash-chip flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
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
                  <TableCell className="py-3 text-right text-base font-medium tabular-nums">
                    {person.currentLeads.toLocaleString("en-US")}
                  </TableCell>
                  <TableCell className="py-3 text-right text-base font-medium tabular-nums">
                    {person.callsToday}
                  </TableCell>
                  <TableCell className="py-3 text-right text-base font-medium tabular-nums">
                    {person.pending}
                  </TableCell>
                  <TableCell className="py-3 pr-5 text-right text-base font-semibold tabular-nums">
                    {person.paid > 0 ? (
                      <span className="text-(--dash-accent-2)">
                        {person.paid}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
