import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Attach / detach tags on a single proposal.
 *
 * Permissions:
 *   - The salesperson who owns the proposal can attach/detach.
 *   - tech_admin / administrator / super_admin can attach/detach on any
 *     proposal (matches the RLS policy in 00046).
 *
 * Endpoints:
 *   - POST   /api/proposals/[id]/tags  body: { tag_id }       → attach
 *   - DELETE /api/proposals/[id]/tags  body: { tag_id }       → detach
 *
 * The single-tag-per-call shape matches a chip-toggle UX: click a tag in
 * the picker and one round-trip happens. We deliberately don't expose a
 * "replace all" endpoint — it's destructive (no audit trail of what
 * specifically was removed), and chip-toggle is more legible.
 *
 * Idempotency:
 *   - POST is idempotent thanks to the join-table primary key
 *     (proposal_id, tag_id). Inserting an existing pair is a no-op (we
 *     swallow the unique-violation error and return success). This means
 *     the picker doesn't need to track which tags are already attached.
 */

async function getOwnedProposal(
  proposalId: string,
  userId: string,
  role: string,
) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("proposals")
    .select("id, sales_person_id")
    .eq("id", proposalId)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 as const };
  if (!data) return { error: "Proposal not found", status: 404 as const };

  const elevated = ["tech_admin", "administrator", "super_admin"].includes(role);
  if (!elevated && data.sales_person_id !== userId) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { proposal: data };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const role = (user.app_metadata?.role as string | undefined) ?? "";
  const access = await getOwnedProposal(id, user.id, role);
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: { tag_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const tagId = typeof body.tag_id === "string" ? body.tag_id : "";
  if (!tagId) return NextResponse.json({ error: "tag_id required" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("proposal_tag_assignments")
    .insert({
      proposal_id: id,
      tag_id: tagId,
      assigned_by: user.id,
    });

  if (error) {
    // Postgres unique_violation = 23505. Already attached → no-op success.
    // (Keeps the chip-toggle UI simple — no need to pre-check state.)
    if (error.code === "23505") {
      return NextResponse.json({ success: true, alreadyAttached: true });
    }
    // Foreign-key violation (e.g. tag_id doesn't exist) → 404.
    if (error.code === "23503") {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const role = (user.app_metadata?.role as string | undefined) ?? "";
  const access = await getOwnedProposal(id, user.id, role);
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // tag_id can come from the body (DELETE-with-body, allowed by Next) or
  // a query param (some clients strip DELETE bodies). Accept either.
  let tagId = "";
  try {
    const body = await req.json();
    if (typeof body?.tag_id === "string") tagId = body.tag_id;
  } catch {
    // No body or invalid JSON — fall through to query param.
  }
  if (!tagId) {
    tagId = req.nextUrl.searchParams.get("tag_id") || "";
  }
  if (!tagId) return NextResponse.json({ error: "tag_id required" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("proposal_tag_assignments")
    .delete()
    .eq("proposal_id", id)
    .eq("tag_id", tagId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
