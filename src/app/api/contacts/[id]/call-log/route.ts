import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

const OUTCOME_TO_STATUS: Record<string, string> = {
  no_answer: "callback", // Auto-reschedule for tomorrow
  not_exists: "not_exists",
  interested: "interested",
  not_interested: "not_interested",
  send_proposal: "send_proposal",
  send_email: "send_email",
  send_invoice: "send_invoice",
  callback: "callback",
  needs_ecommerce: "needs_ecommerce",
  local_market: "local_market",
  directory_note: "directory_note",
  never_contact: "never_contact",
  // These don't change contact status:
  handed_over: "",
  whatsapp_sent: "",
  note: "",
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: contactId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["sales", "tech_admin", "administrator", "super_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { outcome, notes, callback_at } = body;

  if (!outcome || !OUTCOME_TO_STATUS.hasOwnProperty(outcome)) {
    return NextResponse.json(
      { error: "Invalid outcome" },
      { status: 400 }
    );
  }

  // For no_answer: auto-schedule callback for tomorrow 9:00 AM
  let effectiveCallbackAt = callback_at || null;
  if (outcome === "no_answer" && !callback_at) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    effectiveCallbackAt = tomorrow.toISOString();
  }

  // Create call log
  const { error: logError } = await supabase.from("call_logs").insert({
    contact_id: contactId,
    sales_person_id: user.id,
    outcome,
    notes: notes || null,
    callback_at: effectiveCallbackAt,
  });

  if (logError) {
    return NextResponse.json({ error: logError.message }, { status: 500 });
  }

  // Update contact status (if outcome maps to a status)
  const newStatus = OUTCOME_TO_STATUS[outcome];
  if (newStatus) {
    const updateData: Record<string, unknown> = { status: newStatus };

    // Set local market flag
    if (outcome === "local_market") {
      updateData.is_local_market = true;
    }

    await supabase
      .from("contacts")
      .update(updateData)
      .eq("id", contactId);
  }

  // Audit
  await logAudit({
    userId: user.id,
    action: "call_logged",
    entityType: "contact",
    entityId: contactId,
    details: { outcome, notes },
  });

  return NextResponse.json({ success: true, outcome, contactId });
}

// GET: fetch call history for a contact
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: contactId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("call_logs")
    .select("*, profiles:sales_person_id(full_name)")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ logs: data });
}
