import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * PUT /api/admin/live-clients/[id]/services/[serviceId]
 *
 * Update an existing service row. Edits name / price / starts_at —
 * `type` stays fixed because changing it would orphan reporting.
 * Send only the fields you're changing; omitted fields are left
 * untouched. price + starts_at can be explicitly nulled by passing
 * `null` (clears the value), or omitted (no-op).
 *
 * Auth: tech_admin / super_admin / sales (own organic OR migrated).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> },
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

  const { id: proposalId, serviceId } = await params;
  let body: { name?: string; price?: number | null; starts_at?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json(
        { error: "name cannot be empty" },
        { status: 400 },
      );
    }
    updates.name = trimmed;
  }

  if (body.price !== undefined) {
    if (body.price === null) {
      updates.price = null;
    } else {
      const n = Number(body.price);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { error: "price must be a non-negative number" },
          { status: 400 },
        );
      }
      updates.price = n;
    }
  }

  if (body.starts_at !== undefined) {
    if (body.starts_at === null || body.starts_at === "") {
      updates.starts_at = null;
    } else {
      const d = new Date(body.starts_at);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Invalid starts_at date" },
          { status: 400 },
        );
      }
      updates.starts_at = body.starts_at.slice(0, 10);
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

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
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const { data: service } = await admin
    .from("services")
    .select("id, site_id")
    .eq("id", serviceId)
    .maybeSingle();
  if (!service || service.site_id !== site.id) {
    return NextResponse.json(
      { error: "Service not found for this client" },
      { status: 404 },
    );
  }

  const { data: updated, error: updateErr } = await admin
    .from("services")
    .update(updates)
    .eq("id", serviceId)
    .select("id, type, name, price, starts_at")
    .single();
  if (updateErr || !updated) {
    return NextResponse.json(
      { error: updateErr?.message ?? "Update failed" },
      { status: 500 },
    );
  }

  await logAudit({
    userId: user.id,
    action: "update_service",
    entityType: "service",
    entityId: serviceId,
    details: {
      proposal_id: proposalId,
      site_id: site.id,
      fields_changed: Object.keys(updates),
    },
  });

  return NextResponse.json({
    success: true,
    service: {
      id: updated.id,
      type: updated.type,
      name: updated.name,
      price: updated.price != null ? Number(updated.price) : null,
      starts_at: updated.starts_at ?? null,
    },
  });
}

/**
 * DELETE /api/admin/live-clients/[id]/services/[serviceId]
 *
 * Soft-delete an ongoing service by flipping is_active to false. We
 * preserve the row (instead of a hard delete) so future reporting
 * can show "client used to have X for N months" without losing the
 * history. The dashboard's active-services query already filters on
 * is_active = true, so the row drops off the card immediately.
 *
 * Auth: tech_admin / super_admin / sales (own organic OR any migrated).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> },
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

  const { id: proposalId, serviceId } = await params;

  const admin = createAdminClient();

  // Sales-side ownership check.
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

  // Resolve the site so we can verify the service belongs to this
  // client. Without this check, anyone with role access could pass
  // any serviceId in the URL and deactivate it.
  const { data: site } = await admin
    .from("sites")
    .select("id")
    .eq("proposal_id", proposalId)
    .maybeSingle();
  if (!site?.id) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const { data: service } = await admin
    .from("services")
    .select("id, site_id, type, name")
    .eq("id", serviceId)
    .maybeSingle();
  if (!service || service.site_id !== site.id) {
    return NextResponse.json(
      { error: "Service not found for this client" },
      { status: 404 },
    );
  }

  const { error: updateErr } = await admin
    .from("services")
    .update({ is_active: false })
    .eq("id", serviceId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    action: "remove_service",
    entityType: "service",
    entityId: serviceId,
    details: {
      proposal_id: proposalId,
      site_id: site.id,
      type: service.type,
      name: service.name,
    },
  });

  return NextResponse.json({ success: true });
}
