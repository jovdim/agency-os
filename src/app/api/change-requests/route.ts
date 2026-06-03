import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * POST /api/change-requests — Submit a new change request
 * Client role. Requires sufficient credits (checked before insert; trigger deducts).
 *
 * Body: { site_id: string, changes: FieldChange[] }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { site_id, changes } = body as {
    site_id: string;
    changes: Record<string, unknown>[];
  };

  if (!site_id || !changes || !Array.isArray(changes) || changes.length === 0) {
    return NextResponse.json(
      { error: "site_id and changes array are required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Verify the site belongs to this user
  const { data: site, error: siteErr } = await admin
    .from("sites")
    .select("id, owner_id, is_paid")
    .eq("id", site_id)
    .single();

  if (siteErr || !site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  if (site.owner_id !== user.id) {
    return NextResponse.json(
      { error: "You don't own this site" },
      { status: 403 },
    );
  }

  // ── Detect message-type change requests ──────────────────────
  // "Contact support" messages from /client/messages take the same
  // change_requests pipeline (they show up in /tech/queue alongside
  // real edits) but are FREE — no credit charge, no paywall, no
  // draft-while-unpaid limbo. Peter 2026-05-11: the support channel
  // should always be open so clients can reach us even before
  // payment goes through.
  const isMessage =
    Array.isArray(changes) &&
    changes.length === 1 &&
    (changes[0] as { action?: string })?.action === "message";

  const isPaid = site.is_paid ?? true;

  // Credit gate — applied only to real edit requests, never to messages.
  let requestStatus: "pending" | "draft" = "pending";

  if (!isMessage) {
    const { data: balance } = await admin
      .from("credit_balances")
      .select("balance")
      .eq("site_id", site_id)
      .single();

    const hasCredits = balance && balance.balance >= 12.5;

    // Unpaid clients can save edits as draft (no credits needed);
    // paid clients need sufficient credits to submit. Messages skip
    // this whole block.
    if (isPaid && !hasCredits) {
      return NextResponse.json(
        {
          error: "Not enough credits. Buy more credits to submit changes.",
        },
        { status: 402 },
      );
    }

    requestStatus = isPaid && hasCredits ? "pending" : "draft";
  }

  // Create the change request (trigger deducts credit only for 'pending')
  const { data: request, error: insertErr } = await admin
    .from("change_requests")
    .insert({
      site_id,
      user_id: user.id,
      status: requestStatus,
      changes,
    })
    .select()
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    action: requestStatus === "draft" ? "save_draft_changes" : "create_change_request",
    entityType: "change_request",
    entityId: request.id,
    details: { site_id, changes_count: changes.length, status: requestStatus },
  });

  return NextResponse.json({
    request,
    isDraft: requestStatus === "draft",
    isMessage,
    message: isMessage
      ? "Your message has been sent. We'll get back to you as soon as possible."
      : requestStatus === "draft"
        ? "Your changes have been saved. They'll be submitted once payment is complete."
        : "Your changes have been submitted for approval.",
  }, { status: 201 });
}

/**
 * GET /api/change-requests — List change requests for the current user
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = user.app_metadata?.role as string;
  const url = new URL(req.url);
  const siteId = url.searchParams.get("site_id");

  let query = supabase
    .from("change_requests")
    .select("*")
    .order("created_at", { ascending: false });

  // Clients only see their own; tech/admin see all
  if (role === "client") {
    query = query.eq("user_id", user.id);
  }

  if (siteId) {
    query = query.eq("site_id", siteId);
  }

  const { data, error } = await query.limit(100);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ requests: data || [] });
}
