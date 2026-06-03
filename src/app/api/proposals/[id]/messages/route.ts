import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/proposals/[id]/messages — List messages for a proposal
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const role = user.app_metadata?.role as string;
  const admin = createAdminClient();

  // Verify access
  if (role === "sales") {
    const { data: proposal } = await admin
      .from("proposals")
      .select("sales_person_id")
      .eq("id", id)
      .single();
    if (!proposal || proposal.sales_person_id !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
  }

  const { data: messages, error } = await admin
    .from("proposal_messages")
    .select("id, proposal_id, sender_id, sender_role, message, message_type, created_at, profiles(full_name)")
    .eq("proposal_id", id)
    .order("created_at", { ascending: true });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ messages: messages || [] });
}

/**
 * POST /api/proposals/[id]/messages — Send a message on a proposal
 * Body: { message: string, message_type?: "message" | "revision_request" | "client_request" | "account_created" }
 *
 * When message_type is "revision_request", the proposal status is automatically set to "revision".
 * When message_type is "client_request", sales is requesting tech admin to create a client account.
 * When message_type is "account_created", tech admin notifies sales that the client account has been created.
 */
export async function POST(
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
  const role = user.app_metadata?.role as string;

  if (!["sales", "tech_admin", "administrator", "super_admin"].includes(role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const body = await req.json();
  const { message, message_type = "message" } = body;

  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const validTypes = ["message", "revision_request", "status_update", "client_request", "account_created"];
  if (!validTypes.includes(message_type)) {
    return NextResponse.json({ error: "Invalid message type" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify proposal exists and user has access
  const { data: proposal } = await admin
    .from("proposals")
    .select("id, sales_person_id, status")
    .eq("id", id)
    .single();

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  if (role === "sales" && proposal.sales_person_id !== user.id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // Insert message
  const { data: msg, error } = await admin
    .from("proposal_messages")
    .insert({
      proposal_id: id,
      sender_id: user.id,
      sender_role: role,
      message: message.trim(),
      message_type,
    })
    .select("id, proposal_id, sender_id, sender_role, message, message_type, created_at, profiles(full_name)")
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-transition: revision_request from sales → set proposal to "revision"
  if (message_type === "revision_request" && role === "sales") {
    const canTransition = ["building", "review", "sent", "viewed"].includes(proposal.status);
    if (canTransition) {
      await admin
        .from("proposals")
        .update({ status: "revision", feedback: message.trim() })
        .eq("id", id);
    }
  }

  return NextResponse.json({ message: msg }, { status: 201 });
}
