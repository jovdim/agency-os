import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function corsJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders() });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/**
 * POST /api/public/proposals/[slug] — Public actions on a proposal
 * No auth required. Tracks views.
 * CORS enabled — called from widget on subdomain.pages.dev
 *
 * Body: { action: "view" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const body = await req.json();
  const { action } = body as { action: "view" };

  if (!action || action !== "view") {
    return corsJson({ error: "Invalid action" }, 400);
  }

  const admin = createAdminClient();
  const { data: proposal, error } = await admin
    .from("proposals")
    .select("id, status, viewed_at")
    .eq("slug", slug)
    .single();

  if (error || !proposal) {
    return corsJson({ error: "Proposal not found" }, 404);
  }

  // Track first view — set viewed_at and update status if still 'sent'
  const updates: Record<string, unknown> = {};
  if (!proposal.viewed_at) {
    updates.viewed_at = new Date().toISOString();
  }
  if (proposal.status === "sent") {
    updates.status = "viewed";
  }
  if (Object.keys(updates).length > 0) {
    await admin.from("proposals").update(updates).eq("id", proposal.id);
  }
  return corsJson({
    success: true,
    status: updates.status || proposal.status,
  });
}
