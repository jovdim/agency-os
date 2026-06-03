import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * PUT /api/sites/[id]/sections/[sectionId] — Update a section's fields
 * Tech admin / super admin only.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sectionId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = user.app_metadata?.role as string;
  if (!["tech_admin", "super_admin"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, sectionId } = await params;
  const body = await req.json();
  const admin = createAdminClient();

  // Verify section belongs to the site
  const { data: section, error: fetchErr } = await admin
    .from("sections")
    .select("id, site_id")
    .eq("id", sectionId)
    .eq("site_id", id)
    .single();

  if (fetchErr || !section) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (body.fields !== undefined) updates.fields = body.fields;
  if (body.label !== undefined) updates.label = body.label;
  if (body.order !== undefined) updates.order = body.order;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("sections")
    .update(updates)
    .eq("id", sectionId)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ section: data });
}
