import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/admin/clients/[id]/content
 * Export current sections as content.json format.
 * [id] = client user ID (owner_id on site)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !callerProfile ||
    !["tech_admin", "super_admin"].includes(callerProfile.role)
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { id: clientId } = await params;
  const admin = createAdminClient();

  // Find the client's site
  const { data: site } = await admin
    .from("sites")
    .select("id, name")
    .eq("owner_id", clientId)
    .limit(1)
    .single();

  if (!site) {
    return NextResponse.json({ error: "No site found for this client" }, { status: 404 });
  }

  // Fetch sections
  const { data: sections } = await admin
    .from("sections")
    .select("type, label, order, page, content_id, fields")
    .eq("site_id", site.id)
    .order("order", { ascending: true });

  const contentJson = {
    site_name: site.name,
    sections: (sections || []).map((s) => ({
      type: s.type,
      id: s.content_id || s.type,
      label: s.label || s.type,
      order: s.order,
      ...(s.page ? { page: s.page } : {}),
      fields: s.fields,
    })),
  };

  return NextResponse.json(contentJson);
}

/**
 * PUT /api/admin/clients/[id]/content
 * Re-sync content.json — delete all existing sections, insert new ones.
 * [id] = client user ID (owner_id on site)
 * Body: { sections: [{ type, label?, order?, fields }] }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !callerProfile ||
    !["tech_admin", "super_admin"].includes(callerProfile.role)
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { id: clientId } = await params;
  const body = await req.json();

  // Accept both { sections: [...] } and direct [...]
  let sections = body.sections || body;
  if (!Array.isArray(sections)) {
    return NextResponse.json(
      { error: "Invalid format. Must contain a 'sections' array." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Find the client's site
  const { data: site } = await admin
    .from("sites")
    .select("id")
    .eq("owner_id", clientId)
    .limit(1)
    .single();

  if (!site) {
    return NextResponse.json(
      { error: "No site found for this client" },
      { status: 404 }
    );
  }

  // Delete all existing sections
  const { error: deleteError } = await admin
    .from("sections")
    .delete()
    .eq("site_id", site.id);

  if (deleteError) {
    return NextResponse.json(
      { error: deleteError.message },
      { status: 500 }
    );
  }

  // Insert new sections
  const sectionInserts = sections.map(
    (
      s: {
        type: string;
        id?: string;
        label?: string;
        order?: number;
        page?: string;
        fields?: Record<string, unknown>;
      },
      i: number
    ) => ({
      site_id: site.id,
      type: s.type,
      label: s.label || s.type,
      order: Math.round(s.order ?? i + 1),
      page: s.page || null,
      content_id: s.id || null,
      fields: s.fields || {},
    })
  );

  const { error: insertError } = await admin
    .from("sections")
    .insert(sectionInserts);

  if (insertError) {
    return NextResponse.json(
      { error: insertError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: `Synced ${sectionInserts.length} sections from content.json`,
    sections_count: sectionInserts.length,
  });
}
