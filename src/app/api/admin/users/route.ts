import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import type { UserRole } from "@/types/database";

// Domain used to synthesize a placeholder email when a teammate is
// created with ONLY a username. Supabase Auth requires an email on
// every user row; the user never sees this address because they sign
// in by username. Kept non-routable so nobody accidentally tries to
// email it.
const SYNTHESIZED_EMAIL_DOMAIN = "staff.local";

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_.-]{1,30}[a-z0-9])?$/;

export async function POST(request: Request) {
  // Verify the caller is a super_admin
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

  if (profile?.role !== "super_admin") {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // The "identifier" field is what the operator typed into the single
  // "Username or Email" input. If it contains @ we treat it as an
  // email; otherwise as a username and we synthesize an email so
  // Supabase Auth still has something to store.
  const body = await request.json();
  const {
    identifier,
    password,
    full_name,
    role,
  } = body as {
    identifier: string;
    password: string;
    full_name: string;
    role: UserRole;
  };

  if (!identifier || !password || !full_name || !role) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  const trimmed = identifier.trim();
  const looksLikeEmail = trimmed.includes("@");

  let authEmail: string;
  let usernameToStore: string | null = null;

  if (looksLikeEmail) {
    authEmail = trimmed.toLowerCase();
  } else {
    // Treat as username: lowercase, validate shape, synthesize email.
    const lower = trimmed.toLowerCase();
    if (!USERNAME_RE.test(lower)) {
      return NextResponse.json(
        {
          error:
            "Username must be 2-32 characters, letters/digits/._- only, no leading/trailing punctuation",
        },
        { status: 400 },
      );
    }
    usernameToStore = lower;
    authEmail = `${lower}@${SYNTHESIZED_EMAIL_DOMAIN}`;

    // Pre-check username uniqueness to give a nice error before
    // bothering the auth API.
    const adminCheck = createAdminClient();
    const { data: existing } = await adminCheck
      .from("profiles")
      .select("id")
      .eq("username", lower)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: `Username "${lower}" is already taken` },
        { status: 409 },
      );
    }
  }

  // Create the auth user. The handle_new_user trigger creates the
  // profile row automatically; we then patch role + username after.
  const adminClient = createAdminClient();
  const { data: newUser, error: createError } =
    await adminClient.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name, role },
    });

  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 400 });
  }

  // Patch profile with role + full_name + username + plaintext password.
  // We mirror the password in profiles.login_password so the operator
  // can see it later in the Edit dialog (matches how
  // business_email_password is stored). The auth.users row keeps the
  // bcrypt hash; the column here is a plaintext convenience copy.
  await adminClient
    .from("profiles")
    .update({
      role,
      full_name,
      username: usernameToStore,
      login_password: password,
    })
    .eq("id", newUser.user.id);

  await logAudit({
    userId: user.id,
    action: "create_user",
    entityType: "profile",
    entityId: newUser.user.id,
    details: {
      role,
      full_name,
      // Don't log the synthesized email — log the username if that's
      // what was used, otherwise the real email.
      identifier: usernameToStore ?? authEmail,
    },
  });

  return NextResponse.json({
    success: true,
    user_id: newUser.user.id,
    // Also return the camelCase variant so callers that still expect
    // the old shape don't break in flight.
    userId: newUser.user.id,
  });
}
