/**
 * GET /api/sales/contacts?status=new|callback&offset=N&limit=N
 *
 * Returns the next page of the salesperson's contacts for a given bucket.
 * Used by the /sales dashboard "Load more" button — the initial page load
 * ships the first 100 of each bucket; this endpoint serves pages 2+.
 *
 * Response: { contacts: CallingContact[] }
 */
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  const { profile } = await requireRole("sales");
  const admin = createAdminClient();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10));
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10)),
  );

  if (status !== "new" && status !== "callback") {
    return NextResponse.json(
      { error: "status must be 'new' or 'callback'" },
      { status: 400 },
    );
  }

  const orderColumn = status === "new" ? "created_at" : "updated_at";

  let query = admin
    .from("contacts")
    .select(
      "id, company_name, contact_person, phone, phones, phone_notes, email, website_url, industry, town, status, notes, source, description, services_offered, total_listings, cities_count, postal_code, source_url, created_at, updated_at",
    )
    .eq("assigned_to", profile.id)
    .eq("status", status)
    .order(orderColumn, { ascending: true })
    .range(offset, offset + limit - 1);

  if (status === "new") {
    query = query.or("client_status.is.null,client_status.neq.client");
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contacts: data ?? [] });
}
