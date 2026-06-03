import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * POST /api/admin/live-clients/[id]/services
 *
 * Add an ongoing service (hosting, custom domain, business email,
 * SEO, etc.) to a live client. Stored in the `services` table keyed
 * to the proposal's site. is_active defaults to true.
 *
 * Body: { type: string, name: string, price?: number | null, starts_at?: string }
 *   - type: catalog key ("hosting", "domain", …) or "custom"
 *   - name: display label (catalog default OR free-text)
 *   - price: monthly EUR amount (null when not priced)
 *   - starts_at: ISO date (YYYY-MM-DD); defaults to today
 *
 * Auth: tech_admin / super_admin / sales (own organic OR any migrated).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = user.app_metadata?.role as string;
  if (!["tech_admin", "super_admin", "sales"].includes(role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { id: proposalId } = await params;
  let body: { type?: string; name?: string; price?: number | null; starts_at?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const type = (body.type ?? "").trim();
  const name = (body.name ?? "").trim();
  if (!type || !name) {
    return NextResponse.json(
      { error: "type and name are required" },
      { status: 400 },
    );
  }

  let price: number | null = null;
  if (body.price !== undefined && body.price !== null) {
    const n = Number(body.price);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json(
        { error: "price must be a non-negative number" },
        { status: 400 },
      );
    }
    price = n;
  }

  let startsAt: string | null = null;
  if (body.starts_at) {
    const d = new Date(body.starts_at);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(
        { error: "Invalid starts_at date" },
        { status: 400 },
      );
    }
    startsAt = body.starts_at.slice(0, 10);
  }

  const admin = createAdminClient();

  // Sales-side ownership check mirrors the login-email route.
  const { data: proposal } = await admin
    .from("proposals")
    .select("id, sales_person_id, is_migrated")
    .eq("id", proposalId)
    .maybeSingle();
  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }
  if (role === "sales") {
    const owns = proposal.sales_person_id === user.id;
    const isMigrated = proposal.is_migrated === true;
    if (!owns && !isMigrated) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { data: site } = await admin
    .from("sites")
    .select("id")
    .eq("proposal_id", proposalId)
    .maybeSingle();
  if (!site?.id) {
    return NextResponse.json(
      { error: "No site linked to this proposal yet" },
      { status: 404 },
    );
  }

  const { data: inserted, error: insertErr } = await admin
    .from("services")
    .insert({
      site_id: site.id,
      type,
      name,
      price,
      starts_at: startsAt,
      is_active: true,
    })
    .select("id, type, name, price, starts_at")
    .single();
  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Insert failed" },
      { status: 500 },
    );
  }

  await logAudit({
    userId: user.id,
    action: "add_service",
    entityType: "service",
    entityId: inserted.id,
    details: {
      proposal_id: proposalId,
      site_id: site.id,
      type,
      name,
      price,
    },
  });

  return NextResponse.json({
    success: true,
    service: {
      id: inserted.id,
      type: inserted.type,
      name: inserted.name,
      price: inserted.price != null ? Number(inserted.price) : null,
      starts_at: inserted.starts_at ?? null,
    },
  });
}
