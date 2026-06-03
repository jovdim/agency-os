import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/sites/[id]/publish-request/reject
 *
 * IT/tech (or super) rejects a client's pending publish request from
 * the proposal pipeline page. Nothing publishes. The 12.50 € that was
 * charged at submit time is REFUNDED to the client's credit balance
 * (Peter 2026-05-30 — reject = full refund; the only forfeit case is
 * when the client overrides their own pending request).
 *
 * All of it — mark rejected, refund balance, log refund tx — runs in
 * one transaction inside the `reject_publish_request` RPC.
 *
 * Body (JSON): { review_note?: string } — the reason shown to the
 * client and embedded in the refund tx's note for the audit trail.
 */
export async function POST(
  req: NextRequest,
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
  const role = user.app_metadata?.role as string | undefined;
  if (!["tech_admin", "super_admin"].includes(role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let reviewNote: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.review_note === "string") {
      reviewNote = body.review_note.trim().slice(0, 1000) || null;
    }
  } catch {
    // No / invalid body — reject with no note.
  }

  const admin = createAdminClient();

  const { data, error } = await admin.rpc("reject_publish_request", {
    p_site_id: id,
    p_reviewer_id: user.id,
    p_review_note: reviewNote,
  });

  if (error) {
    const msg = error.message || "";
    if (msg.includes("NO_PENDING_REQUEST")) {
      return NextResponse.json(
        { error: "No pending publish request for this site." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const result = (data ?? {}) as {
    request_id?: string;
    refunded?: number;
  };

  return NextResponse.json({
    success: true,
    refunded_eur: Number(result.refunded ?? 0),
  });
}
