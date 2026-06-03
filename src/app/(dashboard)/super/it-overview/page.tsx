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
import { Hammer } from "lucide-react";

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">IT Team</h1>
        <p className="text-sm text-muted-foreground">
          Activity overview for the tech-admin team.
        </p>
      </div>

      {/* Team-wide pending banner */}
      <div className="rounded-lg border bg-card p-4 flex items-center gap-3">
        <div className="rounded-md p-2 shrink-0 bg-muted">
          <Hammer className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold tabular-nums">{teamPending}</p>
          <p className="text-xs text-muted-foreground">
            proposals pending in the build queue
          </p>
        </div>
        <Link
          href="/tech/proposals"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          See queue →
        </Link>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="py-3">Name</TableHead>
              <TableHead className="py-3">Last active</TableHead>
              <TableHead className="text-right py-3">Today</TableHead>
              <TableHead className="text-right py-3 pr-6">Done</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center py-12 text-sm text-muted-foreground"
                >
                  No tech admins yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((person) => (
                <TableRow key={person.id} className="hover:bg-muted/30">
                  <TableCell className="py-3">
                    <Link
                      href={`/super/it-overview/${person.id}`}
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
                    {person.doneToday > 0 ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {person.doneToday}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right py-3 pr-6 tabular-nums text-base font-medium">
                    {person.done}
                  </TableCell>
                </TableRow>
              ))
            )}

            {rows.length > 0 && (
              <TableRow className="bg-muted/30 hover:bg-muted/30 font-medium">
                <TableCell className="py-3 text-sm uppercase tracking-wider text-muted-foreground">
                  Total
                </TableCell>
                <TableCell className="py-3" />
                <TableCell className="text-right py-3 tabular-nums">
                  {totalDoneToday}
                </TableCell>
                <TableCell className="text-right py-3 pr-6 tabular-nums">
                  {totalDone}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
