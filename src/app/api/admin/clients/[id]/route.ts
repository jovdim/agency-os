import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * PATCH /api/admin/clients/[id]
 * Tech admin can update client profile details, site info, and/or reset password.
 * Body: { password?, full_name?, company_name?, phone?, is_active?, site_url?, codebase_link? }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;
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

  if (!callerProfile || !["tech_admin", "super_admin"].includes(callerProfile.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Verify the target is a client
  const adminClient = createAdminClient();
  const { data: clientProfile, error: fetchErr } = await adminClient
    .from("profiles")
    .select("id, role")
    .eq("id", clientId)
    .single();

  if (fetchErr || !clientProfile) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  if (clientProfile.role !== "client") {
    return NextResponse.json({ error: "User is not a client" }, { status: 400 });
  }

  const body = await request.json();
  const { password, full_name, company_name, phone, is_active, site_url, codebase_link } = body as {
    password?: string;
    full_name?: string;
    company_name?: string;
    phone?: string;
    is_active?: boolean;
    site_url?: string | null;
    codebase_link?: string | null;
  };

  // Update password via auth admin if provided
  if (password) {
    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }
    const { error: pwErr } = await adminClient.auth.admin.updateUserById(
      clientId,
      { password }
    );
    if (pwErr) {
      return NextResponse.json({ error: pwErr.message }, { status: 400 });
    }
  }

  // Update profile fields if any provided
  const profileUpdate: Record<string, unknown> = {};
  if (full_name !== undefined) profileUpdate.full_name = full_name;
  if (company_name !== undefined) profileUpdate.company_name = company_name;
  if (phone !== undefined) profileUpdate.phone = phone;
  if (is_active !== undefined) profileUpdate.is_active = is_active;

  if (Object.keys(profileUpdate).length > 0) {
    const { error: updateErr } = await adminClient
      .from("profiles")
      .update(profileUpdate)
      .eq("id", clientId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
  }

  // Update site fields if provided
  if (site_url !== undefined || codebase_link !== undefined) {
    const siteUpdate: Record<string, unknown> = {};
    if (site_url !== undefined) siteUpdate.site_url = site_url;
    if (codebase_link !== undefined) siteUpdate.codebase_link = codebase_link;

    const { error: siteErr } = await adminClient
      .from("sites")
      .update(siteUpdate)
      .eq("owner_id", clientId);

    if (siteErr) {
      return NextResponse.json({ error: siteErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
