import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Inbox, Clock, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { QueueClient } from "./queue-client";

export const dynamic = "force-dynamic";

export default async function ChangeRequestQueuePage() {
  await requireRole("tech_admin");
  const supabase = await createClient();

  // Cap at the 200 most recent change requests. The table grows over
  // time (every client edit adds a row), and tech only ever acts on the
  // recent ones — anything older is approved/rejected history. If we
  // ever need to surface a "show all" mode, add pagination here.
  const { data: requests } = await supabase
    .from("change_requests")
    .select("id, site_id, user_id, status, changes, admin_note, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const allRequests = (requests || []).map((r) => ({
    ...r,
    changes: (r.changes ?? []) as Record<string, unknown>[],
  }));

  const siteIds = [...new Set(allRequests.map((r) => r.site_id))];
  let siteMap: Record<string, string> = {};
  if (siteIds.length > 0) {
    const { data: sites } = await supabase
      .from("sites")
      .select("id, name")
      .in("id", siteIds);
    siteMap = Object.fromEntries((sites || []).map((s) => [s.id, s.name]));
  }

  // Derived queue counts for the stat tiles — computed from the data
  // already in scope (no extra queries). Pending is the operational
  // focus; approved/rejected are history.
  const pendingCount = allRequests.filter((r) => r.status === "pending").length;
  const approvedCount = allRequests.filter((r) => r.status === "approved").length;
  const rejectedCount = allRequests.filter((r) => r.status === "rejected").length;

  // Operational stat tiles. Pending uses the violet accent chip (it's the
  // work to do); approved uses pink for the "good news" / resolved metric.
  const stats: Array<{
    label: string;
    value: number;
    sublabel: string;
    icon: typeof Inbox;
    chip: string;
  }> = [
    {
      label: "Pending",
      value: pendingCount,
      sublabel: "awaiting your review",
      icon: Clock,
      chip: "dash-chip",
    },
    {
      label: "Approved",
      value: approvedCount,
      sublabel: "changes applied",
      icon: CheckCircle2,
      chip: "dash-chip-pink",
    },
    {
      label: "Rejected",
      value: rejectedCount,
      sublabel: "sent back",
      icon: XCircle,
      chip: "dash-chip",
    },
  ];

  return (
    <div className="dash-root max-w-5xl space-y-8">
      {/* Clean page header — back affordance, eyebrow, title + one-line
          subtitle. No gradient: this is an operational queue, so a quiet
          header reads better than a hero band. */}
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="-ml-2 h-7 px-2 text-muted-foreground"
        >
          <Link href="/tech">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <div className="flex items-start gap-3">
          <span className="dash-chip mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
            <Inbox className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Tech queue
            </p>
            <h1 className="text-2xl font-bold tracking-tight">
              Change Request Queue
            </h1>
            <p className="text-sm text-muted-foreground">
              Review client edits, then approve to apply them or reject to send
              them back.
            </p>
          </div>
        </div>
      </div>

      {/* Operational stat tiles — quick triage at a glance. Quiet violet
          chips; pink marks the resolved "Approved" metric. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="dash-card p-5">
              <span
                className={`${stat.chip} inline-flex h-9 w-9 items-center justify-center rounded-lg`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <p className="mt-4 text-3xl font-bold tabular-nums">
                {stat.value}
              </p>
              <p className="mt-1 text-sm font-medium">{stat.label}</p>
              <p className="text-xs text-muted-foreground">{stat.sublabel}</p>
            </div>
          );
        })}
      </div>

      <QueueClient requests={allRequests} siteMap={siteMap} />
    </div>
  );
}
