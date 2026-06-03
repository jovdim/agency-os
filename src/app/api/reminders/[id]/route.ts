import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * PUT /api/reminders/[id] — Dismiss a reminder
 * Sales can dismiss their own reminders.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const admin = createAdminClient();

  // Verify ownership
  const { data: reminder } = await admin
    .from("proposal_reminders")
    .select("id, sales_person_id")
    .eq("id", id)
    .single();

  if (!reminder) {
    return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  }

  const role = user.app_metadata?.role as string;
  if (reminder.sales_person_id !== user.id && !["administrator", "super_admin"].includes(role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  await admin
    .from("proposal_reminders")
    .update({ is_dismissed: true })
    .eq("id", id);

  return NextResponse.json({ success: true });
}
