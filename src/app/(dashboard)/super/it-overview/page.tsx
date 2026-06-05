import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLastActiveMap, lastActiveLabel } from "@/lib/auth/last-active";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Hammer, CheckCircle2, Rocket, Users, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default async function SuperItOverviewPage() {
  await requireRole("super_admin");
  const supabase = createAdminClient();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();

  const [
    { data: techPeople },
    { data: builtProposals },
    { data: publishedSites },
    { data: liveDeployments },
    { data: teamPendingRaw },
    lastActiveBy,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "tech_admin")
      .eq("is_active", true)
      .order("full_name"),
    supabase
      .from("proposals")
      .select("id, built_by, updated_at")
      .not("built_by", "is", null),
    supabase
      .from("sites")
      .select("proposal_id, last_published_at")
      .not("last_published_at", "is", null),
    supabase
      .from("deployments")
      .select("proposal_id")
      .eq("deploy_status", "live"),
    supabase.rpc("proposals_build_queue_count"),
    fetchLastActiveMap(supabase),
  ]);

  // "Shipped" set + per-proposal publish-date map (Today column uses it).
  const shippedProposalIds = new Set<string>();
  const publishedAtByProposal = new Map<string, string>();
  for (const s of publishedSites || []) {
    if (!s.proposal_id) continue;
    shippedProposalIds.add(s.proposal_id);
    if (s.last_published_at) publishedAtByProposal.set(s.proposal_id, s.last_published_at);
  }
  for (const d of liveDeployments || []) {
    if (d.proposal_id) shippedProposalIds.add(d.proposal_id);
  }

  const rows = (techPeople || []).map((person) => {
    const personProposals = (builtProposals || []).filter(
      (p) => p.built_by === person.id,
    );

    let done = 0;
    let doneToday = 0;
    for (const p of personProposals) {
      if (shippedProposalIds.has(p.id)) {
        done++;
        const publishedAt = publishedAtByProposal.get(p.id);
        if (publishedAt && publishedAt >= todayStartIso) {
          doneToday++;
        }
      }
    }

    const active = lastActiveLabel(lastActiveBy.get(person.id) ?? null);

    return {
      id: person.id,
      full_name: person.full_name,
      lastActiveLabel: active.label,
      isActive: active.isActive,
      done,
      doneToday,
    };
  });

  const totalDone = rows.reduce((s, r) => s + r.done, 0);
  const totalDoneToday = rows.reduce((s, r) => s + r.doneToday, 0);
  const teamPending = Number(teamPendingRaw ?? 0);

  // Team-wide stat tiles. Quiet violet chips for operational numbers; the pink
  // chip + accent value marks Shipped today as the good-news metric.
  const stats: Array<{
    label: string;
    value: number;
    sublabel: string;
    href: string;
    icon: typeof Hammer;
    chip: string;
    accent?: boolean;
  }> = [
    {
      label: "In build queue",
      value: teamPending,
      sublabel: "proposals pending",
      href: "/tech/proposals",
      icon: Hammer,
      chip: "dash-chip",
    },
    {
      label: "Shipped today",
      value: totalDoneToday,
      sublabel: "published since midnight",
      href: "/super/production",
      icon: Rocket,
      chip: "dash-chip-pink",
      accent: true,
    },
    {
      label: "Total shipped",
      value: totalDone,
      sublabel: "live sites all-time",
      href: "/super/production",
      icon: CheckCircle2,
      chip: "dash-chip",
    },
  ];

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Clean page header — title + one-line subtitle, no gradient needed here.
          The tech-admin roster is the focus of this page. */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          IT overview
        </p>
        <h1 className="text-3xl font-bold tracking-tight">IT Team</h1>
        <p className="text-sm text-muted-foreground">
          Activity overview for the tech-admin team.
        </p>
      </div>

      {/* Team-wide stat tiles. Quiet violet chips for operational numbers; the
          pink chip + accent value marks Shipped today as the good-news metric. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                Today
              </TableHead>
              <TableHead className="py-3 pr-5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Done
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="py-14">
                  <div className="flex flex-col items-center justify-center text-center">
                    <span className="dash-chip mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full">
                      <Users className="h-5 w-5" />
                    </span>
                    <p className="text-sm font-medium">No tech admins yet</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Active tech admins will appear here.
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
                      href={`/super/it-overview/${person.id}`}
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
                    {person.doneToday > 0 ? (
                      <span className="text-(--dash-accent-2)">
                        {person.doneToday}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3 pr-5 text-right text-base font-semibold tabular-nums">
                    {person.done}
                  </TableCell>
                </TableRow>
              ))
            )}

            {rows.length > 0 && (
              <TableRow className="dash-subhead font-medium hover:bg-transparent">
                <TableCell className="py-3 pl-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Total
                </TableCell>
                <TableCell className="py-3" />
                <TableCell className="py-3 text-right tabular-nums">
                  {totalDoneToday}
                </TableCell>
                <TableCell className="py-3 pr-5 text-right tabular-nums">
                  {totalDone}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
