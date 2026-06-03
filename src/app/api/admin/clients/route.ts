import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import crypto from "crypto";

/**
 * POST /api/admin/clients
 * Tech admin or super admin creates a client account + site + credits.
 * Sends welcome email with login credentials.
 * Body: {
 *   email, password?, full_name, company_name?, phone?, business_email?,
 *   site_name, site_url, codebase_link?, initial_credits?,
 *   contact_id?, proposal_id?
 * }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["tech_admin", "super_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json();
  const {
    email,
    password: rawPassword,
    full_name,
    company_name,
    phone,
    business_email,
    site_name,
    site_url,
    codebase_link,
    domain,
    initial_credits,
    contact_id,
    proposal_id,
  } = body as {
    email: string;
    password?: string;
    full_name: string;
    company_name?: string;
    phone?: string;
    business_email?: string;
    site_name: string;
    site_url: string;
    codebase_link?: string;
    domain?: string;
    initial_credits?: number;
    proposal_id?: string;
    contact_id?: string;
  };

  if (!email || !full_name) {
    return NextResponse.json(
      { error: "Email and full name are required" },
      { status: 400 }
    );
  }

  if (!site_name) {
    return NextResponse.json(
      { error: "Site name is required" },
      { status: 400 }
    );
  }

  // Auto-generate password if not provided
  const password = rawPassword || crypto.randomBytes(4).toString("hex");

  const adminClient = createAdminClient();

  // 1. Create Supabase auth user (or find existing)
  let userId: string;
  const { data: newUser, error: createError } =
    await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role: "client" },
    });

  if (createError) {
    if (createError.message?.includes("already") || createError.message?.includes("exists")) {
      const { data: existingUsers } = await adminClient.auth.admin.listUsers();
      const existingUser = existingUsers?.users?.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase()
      );
      if (!existingUser) {
        return NextResponse.json({ error: createError.message }, { status: 400 });
      }
      userId = existingUser.id;
    } else {
      return NextResponse.json({ error: createError.message }, { status: 400 });
    }
  } else {
    userId = newUser.user.id;
  }

  // 2. Update profile
  await adminClient
    .from("profiles")
    .update({
      role: "client",
      full_name,
      company_name: company_name || null,
      phone: phone || null,
    })
    .eq("id", userId);

  // 3. Generate slug from site name
  const baseSlug = site_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const { data: existingSlug } = await adminClient
    .from("sites")
    .select("id")
    .eq("slug", baseSlug)
    .maybeSingle();

  const slug = existingSlug
    ? `${baseSlug}-${crypto.randomBytes(2).toString("hex")}`
    : baseSlug;

  // 4. Create site (or update existing for this user)
  const { data: existingSite } = await adminClient
    .from("sites")
    .select("id")
    .eq("owner_id", userId)
    .maybeSingle();

  let site: { id: string };
  if (existingSite) {
    site = existingSite;
    await adminClient.from("sites").update({
      site_url,
      codebase_link: codebase_link || null,
    }).eq("id", site.id);
  } else {
    const { data: newSite, error: siteError } = await adminClient
      .from("sites")
      .insert({
        name: site_name,
        slug,
        site_url: site_url || null,
        codebase_link: codebase_link || null,
        domain: domain || null,
        owner_id: userId,
        status: "live",
        proposal_id: proposal_id || null,
        client_temp_password: password,
        // Built via the legacy GitHub+cheerio path, NOT the new template composer.
        is_legacy: true,
      })
      .select("id")
      .single();
    if (siteError || !newSite) {
      return NextResponse.json({ error: siteError?.message || "Failed to create site" }, { status: 500 });
    }
    site = newSite;
  }

  // Always keep site.client_temp_password in sync with latest password so
  // tech/super admin can retrieve it later (e.g. to help the client).
  await adminClient
    .from("sites")
    .update({ client_temp_password: password })
    .eq("id", site.id);

  // 5. Create credit balance
  const credits = initial_credits ?? 1;
  await adminClient.from("credit_balances").upsert({
    site_id: site.id,
    balance: credits,
  }, { onConflict: "site_id" });

  // 6. Link contact if provided
  if (contact_id) {
    await adminClient
      .from("contacts")
      .update({ client_user_id: userId, client_status: "created" })
      .eq("id", contact_id);

    // Update business_email on the contact too
    if (business_email) {
      await adminClient
        .from("contacts")
        .update({ business_email })
        .eq("id", contact_id);
    }
  }

  await logAudit({
    userId: user.id,
    action: "create_client",
    entityType: "profile",
    entityId: userId,
    details: { email, site_name },
  });

  return NextResponse.json({
    client: { name: full_name, email, password },
    site: {
      name: site_name,
      slug,
      site_url,
      codebase_link: codebase_link || null,
      credits,
    },
    site_id: site.id,
  });
}
