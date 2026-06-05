import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLastActiveFor, lastActiveLabel } from "@/lib/auth/last-active";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Hammer, CheckCircle2, Clock, CalendarRange, X } from "lucide-react";

export const dynamic = "force-dynamic";

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Accept "YYYY-MM-DD" and turn it into a UTC midnight boundary. Returns
// null on missing or malformed input so the filter quietly falls back
// to "no range" instead of throwing.
function parseDateInput(raw: string | string[] | undefined): Date | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export default async function TechAdminDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole("super_admin");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = createAdminClient();

  // Date range — both sides required for a "valid" filter. If either
  // is missing or unparseable we render without the range card and
  // count, so the page stays useful on first visit (no filter set).
  const fromInput = sp.from;
  const toInput = sp.to;
  const fromDate = parseDateInput(fromInput);
  const toDate = parseDateInput(toInput);
  // End of "to" day so picking the same day on both sides still
  // includes everything published that day.
  const toEndOfDay = toDate ? new Date(toDate) : null;
  if (toEndOfDay) toEndOfDay.setHours(23, 59, 59, 999);
  const hasRange = !!fromDate && !!toEndOfDay && fromDate <= toEndOfDay;
  const fromIso = fromDate?.toISOString();
  const toIso = toEndOfDay?.toISOString();

  // Resolve the person first. We refuse to render anything if they're
  // not actually a tech_admin — keeps this page focused.
  const { data: person } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", id)
    .eq("role", "tech_admin")
    .maybeSingle();

  if (!person) notFound();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const weekStartIso = weekStart.toISOString();

  // Pull all proposals this tech is the builder on, plus the
  // "shipped" signals so we can split Done vs not-yet-done. We also
  // pull the team-wide build queue count — the operator wants to see
  // the team's pending workload alongside per-tech activity.
  const [
    { data: proposalsRaw },
    { data: publishedSites },
    { data: liveDeployments },
    { data: teamPendingRaw },
    lastActiveIso,
  ] = await Promise.all([
    supabase
      .from("proposals")
      .select("id, company_name, status, created_at, updated_at, sent_at")
      .eq("built_by", id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("sites")
      .select("proposal_id, last_published_at")
      .not("last_published_at", "is", null),
    supabase
      .from("deployments")
      .select("proposal_id")
      .eq("deploy_status", "live"),
    supabase.rpc("proposals_build_queue_count"),
    fetchLastActiveFor(supabase, id),
  ]);

  const proposals = proposalsRaw ?? [];

  // Same "shipped" predicate as /tech/proposals + IT overview.
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

  // Pick out the shipped subset — we use it for Today / This week /
  // Total done. Unshipped proposals owned by this tech aren't shown
  // on this page anymore (team pending is what matters operator-side).
  type ProposalRow = (typeof proposals)[number];
  const shipped: Array<ProposalRow & { publishedAt: string | null }> = [];
  for (const p of proposals) {
    if (shippedProposalIds.has(p.id)) {
      shipped.push({ ...p, publishedAt: publishedAtByProposal.get(p.id) ?? null });
    }
  }
  shipped.sort((a, b) =>
    (b.publishedAt || b.updated_at || "").localeCompare(
      a.publishedAt || a.updated_at || "",
    ),
  );

  const doneTodayCount = shipped.filter(
    (p) => p.publishedAt && p.publishedAt >= todayStartIso,
  ).length;
  const doneThisWeekCount = shipped.filter(
    (p) => p.publishedAt && p.publishedAt >= weekStartIso,
  ).length;
  // Per-person count within the custom range. Only computed when a
  // valid range was given on the query string; without one it stays 0
  // and the banner+result line don't render.
  const doneInRangeCount =
    hasRange && fromIso && toIso
      ? shipped.filter(
          (p) =>
            p.publishedAt &&
            p.publishedAt >= fromIso &&
            p.publishedAt <= toIso,
        ).length
      : 0;
  const teamPending = Number(teamPendingRaw ?? 0);

  // Default values for the date inputs. With no range applied we
  // pre-fill the last 30 days so Apply works with one click.
  const defaultTo = new Date();
  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const fromValue =
    fromInput && parseDateInput(fromInput) ? fromInput : fmt(defaultFrom);
  const toValue =
    toInput && parseDateInput(toInput) ? toInput : fmt(defaultTo);
  const active = lastActiveLabel(lastActiveIso);

  // Per-tech stat tiles. Quiet violet chips for operational counts; the pink
  // chip + accent value marks "Done today" as the good-news metric. The team
  // build queue tile links out to the shared build queue.
  const stats: Array<{
    label: string;
    sublabel: string;
    value: number;
    icon: typeof Hammer;
    chip: string;
    accent?: boolean;
    href?: string;
  }> = [
    {
      label: "Done today",
      sublabel: "published since midnight",
      value: doneTodayCount,
      icon: CheckCircle2,
      chip: "dash-chip-pink",
      accent: true,
    },
    {
      label: "Done this week",
      sublabel: "last 7 days",
      value: doneThisWeekCount,
      icon: Clock,
      chip: "dash-chip",
    },
    {
      label: "Total done",
      sublabel: "live sites all-time",
      value: shipped.length,
      icon: CheckCircle2,
      chip: "dash-chip",
    },
    {
      label: "Team build queue",
      sublabel: "pending to create",
      value: teamPending,
      icon: Hammer,
      chip: "dash-chip",
      href: "/tech/proposals",
    },
  ];

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Clean page header — eyebrow + name + role/activity line, with a Back
          link and avatar chip. No gradient; the per-tech detail is the focus. */}
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="-ml-2 h-8 w-fit gap-1 text-muted-foreground"
        >
          <Link href="/super/it-overview">
            <ArrowLeft className="h-4 w-4" />
            Back to IT overview
          </Link>
        </Button>
        <div className="flex items-center gap-4">
          <div className="dash-chip flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
            {getInitials(person.full_name)}
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              IT overview
            </p>
            <h1 className="text-3xl font-bold tracking-tight">
              {person.full_name}
            </h1>
            <p className="text-sm">
              {active.isActive ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Tech admin · {active.label}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Tech admin · last active {active.label}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Stat tiles — soft cards with icon chips. "Done today" reads pink as the
          good-news metric; the build-queue tile links to the shared queue. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const inner = (
            <>
              <div className="flex items-center justify-between">
                <span
                  className={`${stat.chip} inline-flex h-9 w-9 items-center justify-center rounded-lg`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                {stat.href && (
                  <ArrowRight className="dash-accent h-4 w-4 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                )}
              </div>
              <p
                className={`mt-4 text-3xl font-bold tabular-nums${
                  stat.accent && stat.value > 0 ? " text-(--dash-accent-2)" : ""
                }`}
              >
                {stat.value.toLocaleString("en-US")}
              </p>
              <p className="mt-1 text-sm font-medium">{stat.label}</p>
              <p className="text-xs text-muted-foreground">{stat.sublabel}</p>
            </>
          );
          return stat.href ? (
            <Link
              key={stat.label}
              href={stat.href}
              className="dash-card group block p-5"
            >
              {inner}
            </Link>
          ) : (
            <div key={stat.label} className="dash-card p-5">
              {inner}
            </div>
          );
        })}
      </div>

      {/* Custom range — soft panel with an eyebrow header. Collapsed disclosure
          inside: closed by default so it doesn't compete with the stat tiles,
          auto-opens when a range is already applied. Pure HTML <details>, no JS. */}
      <section className="dash-panel overflow-hidden">
        <div className="dash-hairline flex items-center gap-2 border-b px-5 py-3.5">
          <CalendarRange className="dash-accent h-4 w-4" />
          <h2 className="text-xs font-semibold uppercase tracking-wider">
            Custom range
          </h2>
        </div>
        <div className="p-5">
          <details open={hasRange} className="group text-sm">
            <summary className="inline-flex cursor-pointer select-none list-none items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <CalendarRange className="h-3.5 w-3.5" />
              <span className="group-open:hidden">Filter by date range</span>
              <span className="hidden group-open:inline">Hide range filter</span>
            </summary>
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              action=""
              method="get"
            >
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  From
                </label>
                <input
                  type="date"
                  name="from"
                  defaultValue={fromValue}
                  className="dash-hairline h-9 rounded-md border bg-background px-2.5 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  To
                </label>
                <input
                  type="date"
                  name="to"
                  defaultValue={toValue}
                  className="dash-hairline h-9 rounded-md border bg-background px-2.5 text-xs"
                />
              </div>
              <Button type="submit" size="sm" className="h-9 text-xs">
                Apply
              </Button>
              {hasRange && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  asChild
                  className="h-9 gap-1 text-xs text-muted-foreground"
                >
                  <Link href={`/super/it-overview/${id}`}>
                    <X className="h-3 w-3" />
                    Clear
                  </Link>
                </Button>
              )}
              {hasRange && fromDate && toDate && (
                <span className="self-center text-xs text-muted-foreground">
                  <span className="font-semibold text-(--dash-accent-2) tabular-nums">
                    {doneInRangeCount}
                  </span>{" "}
                  shipped {fromDate.toLocaleDateString("en-US")}–
                  {toDate.toLocaleDateString("en-US")}
                </span>
              )}
            </form>
          </details>
        </div>
      </section>
    </div>
  );
}
