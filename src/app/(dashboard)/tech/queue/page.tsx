import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/tech">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Change Request Queue</h1>
      </div>

      <QueueClient requests={allRequests} siteMap={siteMap} />
    </div>
  );
}
