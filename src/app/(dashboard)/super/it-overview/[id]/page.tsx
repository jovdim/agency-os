import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLastActiveFor, lastActiveLabel } from "@/lib/auth/last-active";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Hammer, CheckCircle2, Clock, CalendarRange, X } from "lucide-react";

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/super/it-overview">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 bg-muted text-muted-foreground">
            {getInitials(person.full_name)}
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{person.full_name}</h1>
            <p className="text-xs">
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

      {/* Stat row */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className={`text-2xl font-bold ${
                  doneTodayCount > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground"
                }`}
              >
                {doneTodayCount}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                Done today
              </p>
            </div>
            <div className="rounded-md p-1.5 shrink-0 bg-muted">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-2xl font-bold text-muted-foreground">
                {doneThisWeekCount}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                Done this week
              </p>
            </div>
            <div className="rounded-md p-1.5 shrink-0 bg-muted">
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-2xl font-bold">{shipped.length}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                Total done
              </p>
            </div>
            <div className="rounded-md p-1.5 shrink-0 bg-muted">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
        <Link
          href="/tech/proposals"
          className="rounded-lg border bg-card p-3 hover:border-foreground/15 hover:shadow-sm transition-all"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-2xl font-bold">{teamPending}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                Team build queue
                <span className="block text-[10px] mt-0.5">
                  pending to create
                </span>
              </p>
            </div>
            <div className="rounded-md p-1.5 shrink-0 bg-muted">
              <Hammer className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </Link>
      </div>

      {/* Custom range — collapsed disclosure. Closed by default so it
          doesn't compete with the stat cards for attention. Opens
          inline when clicked; auto-opens if a range is already
          applied (so the operator sees the current filter without
          having to expand it manually). Pure HTML <details>, no JS. */}
      <details open={hasRange} className="text-sm group">
        <summary className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none list-none">
          <CalendarRange className="h-3.5 w-3.5" />
          <span className="group-open:hidden">Custom range</span>
          <span className="hidden group-open:inline">Hide range filter</span>
        </summary>
        <form
          className="mt-2 flex items-end gap-2 flex-wrap"
          action=""
          method="get"
        >
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground">From</label>
            <input
              type="date"
              name="from"
              defaultValue={fromValue}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground">To</label>
            <input
              type="date"
              name="to"
              defaultValue={toValue}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            />
          </div>
          <Button type="submit" size="sm" className="h-8 text-xs">
            Apply
          </Button>
          {hasRange && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              asChild
              className="h-8 gap-1 text-xs text-muted-foreground"
            >
              <Link href={`/super/it-overview/${id}`}>
                <X className="h-3 w-3" />
                Clear
              </Link>
            </Button>
          )}
          {hasRange && fromDate && toDate && (
            <span className="text-xs text-muted-foreground self-center">
              <span className="font-semibold text-foreground">
                {doneInRangeCount}
              </span>{" "}
              shipped {fromDate.toLocaleDateString("en-US")}–
              {toDate.toLocaleDateString("en-US")}
            </span>
          )}
        </form>
      </details>
    </div>
  );
}
