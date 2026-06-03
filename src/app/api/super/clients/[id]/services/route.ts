import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: profileId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { site_id, type, name, price, starts_at, expires_at } = body;

  if (!site_id || !name) {
    return NextResponse.json({ error: "site_id and name required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("services")
    .insert({
      site_id,
      type: type || "other",
      name,
      price: price ? Number(price) : null,
      starts_at: starts_at || new Date().toISOString().split("T")[0],
      expires_at: expires_at || null,
      is_active: true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ service: data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { service_id, ...updates } = body;
  if (!service_id) {
    return NextResponse.json({ error: "service_id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("services").update(updates).eq("id", service_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { service_id } = await req.json();
  if (!service_id) {
    return NextResponse.json({ error: "service_id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("services").delete().eq("id", service_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
