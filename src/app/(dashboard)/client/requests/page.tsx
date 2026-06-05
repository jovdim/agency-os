import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDistanceToNow } from "date-fns";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ClipboardText as ClipboardList, Clock, CheckCircle as CheckCircle2, XCircle, NotePencil as FileEdit, ArrowRight, Tray as Inbox } from "@phosphor-icons/react/ssr";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

// One small lucide icon per status — drives the per-row icon chip so the list
// scans by state at a glance (calm single-tone tints, never a gradient).
const STATUS_ICON: Record<string, typeof Clock> = {
  pending: Clock,
  approved: CheckCircle2,
  rejected: XCircle,
};

export const dynamic = "force-dynamic";

export default async function ClientRequestsPage() {
  const { profile } = await requireRole("client");
  const supabase = await createClient();

  // Gate the page on legacy ownership — the sidebar entry and dashboard
  // tiles are already hidden for fully-modern clients, but a stale
  // bookmark or copy-pasted URL shouldn't render an empty list. Send
  // those clients back to their dashboard.
  const { data: legacySites } = await supabase
    .from("sites")
    .select("id")
    .eq("owner_id", profile.id)
    .eq("is_legacy", true)
    .limit(1);
  if (!legacySites?.length) {
    redirect("/client");
  }

  const { data: requests } = await supabase
    .from("change_requests")
    .select("*, sites(name)")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const allRequests = requests || [];
  const pending = allRequests.filter((r) => r.status === "pending");
  const approved = allRequests.filter((r) => r.status === "approved");
  const rejected = allRequests.filter((r) => r.status === "rejected");

  function RequestList({
    items,
    emptyMessage,
  }: {
    items: typeof allRequests;
    emptyMessage: string;
  }) {
    if (items.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
          <span className="dash-chip mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full">
            <Inbox className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium">{emptyMessage}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Edits you submit from your site editor show up here.
          </p>
        </div>
      );
    }

    return (
      <ul className="dash-hairline divide-y">
        {items.map((req) => {
          const siteName =
            (req.sites as { name: string } | null)?.name ?? "Unknown site";
          const changeCount = Array.isArray(req.changes)
            ? req.changes.length
            : 0;
          const StatusIcon = STATUS_ICON[req.status] ?? FileEdit;

          return (
            <li key={req.id}>
              <Link
                href="/client"
                className="dash-row group flex items-center gap-3 px-5 py-3.5"
              >
                <span className="dash-chip inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                  <StatusIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{siteName}</p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_STYLE[req.status] ?? "bg-muted"}`}
                    >
                      {req.status}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {changeCount} change{changeCount !== 1 ? "s" : ""}
                    {req.admin_note && <> · Note: {req.admin_note}</>}
                  </p>
                </div>
                <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
                  {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
                </span>
                <ArrowRight className="dash-accent h-4 w-4 shrink-0 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="dash-root max-w-5xl space-y-8">
      {/* ── Page header — clean title + subtitle, with a quiet running total
          on the right. No gradient needed on this tracker page. ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="dash-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Your edits
            </p>
            <h1 className="text-2xl font-bold tracking-tight">Change Requests</h1>
          </div>
        </div>
        <div className="dash-card flex items-center gap-3 px-4 py-2.5">
          <Clock className="dash-accent h-4 w-4 shrink-0" />
          <div>
            <p className="text-lg font-bold leading-none tabular-nums">
              {pending.length}
            </p>
            <p className="text-[11px] text-muted-foreground">awaiting review</p>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="approved">Approved ({approved.length})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({rejected.length})</TabsTrigger>
          <TabsTrigger value="all">All ({allRequests.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <div className="dash-panel overflow-hidden">
            <RequestList items={pending} emptyMessage="No pending requests." />
          </div>
        </TabsContent>
        <TabsContent value="approved">
          <div className="dash-panel overflow-hidden">
            <RequestList items={approved} emptyMessage="No approved requests." />
          </div>
        </TabsContent>
        <TabsContent value="rejected">
          <div className="dash-panel overflow-hidden">
            <RequestList items={rejected} emptyMessage="No rejected requests." />
          </div>
        </TabsContent>
        <TabsContent value="all">
          <div className="dash-panel overflow-hidden">
            <RequestList items={allRequests} emptyMessage="No requests yet." />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
