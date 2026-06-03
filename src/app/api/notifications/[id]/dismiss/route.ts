import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/notifications/[id]/dismiss — mark a notification as
 * dismissed. Soft-delete via dismissed_at timestamp; we keep the row
 * so the audit trail for "X was notified that the domain is active"
 * survives.
 *
 * Auth is RLS-enforced: the staff_notifications_self_update policy
 * (migration 00072) only lets a user update their own rows. We
 * still use the user-scoped client (not admin) for safety.
 */
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { error } = await supabase
    .from("staff_notifications")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", id)
    .is("dismissed_at", null); // idempotent: skip already-dismissed

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
