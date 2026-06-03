import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, buildClientWelcomeEmailHtml } from "@/lib/email";

/**
 * POST /api/admin/clients/send-welcome
 * Send (or re-send) welcome email to a client.
 * Body: {
 *   to: string,           — client email address
 *   full_name: string,
 *   company_name?: string,
 *   login_email: string,
 *   login_password: string,
 *   site_url?: string,
 *   site_name?: string,
 *   custom_message?: string  — optional extra text added to the email
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

  if (!profile || !["tech_admin", "super_admin", "sales"].includes(profile.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json();
  const {
    to,
    full_name,
    company_name,
    login_email,
    login_password,
    site_url,
    site_name,
    custom_message,
  } = body as {
    to: string;
    full_name: string;
    company_name?: string;
    login_email: string;
    login_password: string;
    site_url?: string;
    site_name?: string;
    custom_message?: string;
  };

  if (!to || !login_email || !login_password) {
    return NextResponse.json(
      { error: "Missing required fields: to, login_email, login_password" },
      { status: 400 }
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_CLIENT_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
  const loginUrl = baseUrl ? `${baseUrl}/login` : "";

  if (!loginUrl) {
    return NextResponse.json(
      { error: "Login URL not configured (NEXT_PUBLIC_SITE_URL)" },
      { status: 500 }
    );
  }

  const html = buildClientWelcomeEmailHtml({
    fullName: full_name,
    companyName: company_name,
    loginEmail: login_email,
    loginPassword: login_password,
    siteUrl: site_url,
    loginUrl,
    customMessage: custom_message,
  });

  // Sync the password to Supabase auth so the client can actually log in with it,
  // and update proposal.client_temp_password so the encrypted auto-login token
  // (used by the "I need changes" button) keeps working.
  try {
    const admin = createAdminClient();
    const normalizedEmail = login_email.trim().toLowerCase();

    const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const matchingUser = usersList?.users?.find(
      (u) => u.email?.toLowerCase() === normalizedEmail,
    );

    if (matchingUser) {
      await admin.auth.admin.updateUserById(matchingUser.id, {
        password: login_password,
      });
    }

    // Update proposal.client_temp_password for any proposal pointing at this contact's email
    const { data: contactRow } = await admin
      .from("contacts")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (contactRow?.id) {
      await admin
        .from("proposals")
        .update({ client_temp_password: login_password })
        .eq("contact_id", contactRow.id);
    }
  } catch (syncErr) {
    console.error("[send-welcome] Password sync failed (non-blocking):", syncErr);
    // Non-blocking — email still goes out
  }

  const result = await sendEmail({
    to,
    subject: `Your client zone — ${company_name || site_name || full_name}`,
    html,
    type: "global",
  });

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "Failed to send email" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, messageId: result.messageId });
}

/**
 * GET /api/admin/clients/send-welcome?...
 * Returns the email HTML for preview (no sending).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const full_name = url.searchParams.get("full_name") || "";
  const company_name = url.searchParams.get("company_name") || undefined;
  const login_email = url.searchParams.get("login_email") || "";
  const login_password = url.searchParams.get("login_password") || "";
  const site_url = url.searchParams.get("site_url") || undefined;
  const custom_message = url.searchParams.get("custom_message") || undefined;

  const baseUrl = process.env.NEXT_PUBLIC_CLIENT_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
  const loginUrl = baseUrl ? `${baseUrl}/login` : "https://example.com/login";

  const html = buildClientWelcomeEmailHtml({
    fullName: full_name,
    companyName: company_name,
    loginEmail: login_email,
    loginPassword: login_password,
    siteUrl: site_url,
    loginUrl,
    customMessage: custom_message,
  });

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
