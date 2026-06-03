import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/notifications — list undismissed staff_notifications for
 * the current user. Banner component on the dashboard layouts polls
 * (or fetches once on page load) and renders one row per notification
 * with a dismiss button.
 *
 * RLS policy already scopes the select to recipient_id = auth.uid()
 * so we use the user-scoped client (not admin) — the row-level filter
 * is the source of truth, and using the admin client here would
 * accidentally leak other users' notifications if a future bug skipped
 * the WHERE clause.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("staff_notifications")
    .select("id, kind, site_id, payload, created_at")
    .is("dismissed_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ notifications: data ?? [] });
}
