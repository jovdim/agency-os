import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/templates/[id] — Get a single template
 */
export async function GET(
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
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("templates")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data)
    return NextResponse.json({ error: "Template not found" }, { status: 404 });

  return NextResponse.json({ template: data });
}

/**
 * PUT /api/templates/[id] — Update a template
 * Super admin only.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = user.app_metadata?.role as string;
  if (role !== "super_admin") {
    return NextResponse.json(
      { error: "Super admin access required" },
      { status: 403 },
    );
  }

  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) updates.name = body.name;
  if (body.industry !== undefined) updates.industry = body.industry;
  if (body.design_variant !== undefined)
    updates.design_variant = body.design_variant;
  if (body.description !== undefined) updates.description = body.description;
  if (body.is_active !== undefined) updates.is_active = body.is_active;
  if (body.color_scheme !== undefined) updates.color_scheme = body.color_scheme;
  if (body.thumbnail_path !== undefined)
    updates.thumbnail_path = body.thumbnail_path;

  if (body.content_schema !== undefined) {
    const schema = body.content_schema;
    if (!schema.sections || !Array.isArray(schema.sections)) {
      return NextResponse.json(
        { error: "content_schema must have a sections array" },
        { status: 400 },
      );
    }
    updates.content_schema = schema;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("templates")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)
    return NextResponse.json({ error: "Template not found" }, { status: 404 });

  return NextResponse.json({ template: data });
}

/**
 * DELETE /api/templates/[id] — Deactivate a template (soft delete)
 * Super admin only.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = user.app_metadata?.role as string;
  if (role !== "super_admin") {
    return NextResponse.json(
      { error: "Super admin access required" },
      { status: 403 },
    );
  }

  const { id } = await params;
  const admin = createAdminClient();

  // Soft delete — set is_active to false
  const { data, error } = await admin
    .from("templates")
    .update({ is_active: false })
    .eq("id", id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)
    return NextResponse.json({ error: "Template not found" }, { status: 404 });

  return NextResponse.json({ success: true, template: data });
}
