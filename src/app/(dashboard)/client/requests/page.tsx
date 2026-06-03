import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDistanceToNow } from "date-fns";
import { redirect } from "next/navigation";
import Link from "next/link";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
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
        <div className="px-4 py-8 text-center text-xs text-muted-foreground">
          {emptyMessage}
        </div>
      );
    }

    return (
      <div className="divide-y">
        {items.map((req) => {
          const siteName =
            (req.sites as { name: string } | null)?.name ?? "Unknown site";
          const changeCount = Array.isArray(req.changes)
            ? req.changes.length
            : 0;

          return (
            <Link
              key={req.id}
              href="/client"
              className="flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={`text-xs rounded px-1.5 py-0.5 font-medium shrink-0 ${STATUS_STYLE[req.status] ?? "bg-muted"}`}>
                  {req.status}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{siteName}</p>
                  <p className="text-xs text-muted-foreground">
                    {changeCount} change{changeCount !== 1 ? "s" : ""}
                    {req.admin_note && <> · Note: {req.admin_note}</>}
                  </p>
                </div>
              </div>
              <span className="text-xs text-muted-foreground shrink-0 ml-3">
                {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
              </span>
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ── Header ── */}
      <div>
        <h1 className="text-xl font-semibold">Change Requests</h1>
        <p className="text-sm text-muted-foreground">Track all your change requests</p>
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
          <div className="rounded-lg border bg-card overflow-hidden">
            <RequestList items={pending} emptyMessage="No pending requests." />
          </div>
        </TabsContent>
        <TabsContent value="approved">
          <div className="rounded-lg border bg-card overflow-hidden">
            <RequestList items={approved} emptyMessage="No approved requests." />
          </div>
        </TabsContent>
        <TabsContent value="rejected">
          <div className="rounded-lg border bg-card overflow-hidden">
            <RequestList items={rejected} emptyMessage="No rejected requests." />
          </div>
        </TabsContent>
        <TabsContent value="all">
          <div className="rounded-lg border bg-card overflow-hidden">
            <RequestList items={allRequests} emptyMessage="No requests yet." />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
