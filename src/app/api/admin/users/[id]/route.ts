import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const SYNTHESIZED_EMAIL_DOMAIN = "staff.local";
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_.-]{1,30}[a-z0-9])?$/;

async function assertSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, status: 401, error: "Not authenticated" };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "super_admin") {
    return { ok: false as const, status: 403, error: "Not authorized" };
  }
  return { ok: true as const, callerId: user.id };
}

/**
 * GET /api/admin/users/[id]
 *
 * Returns the full profile plus the login email pulled from auth.users.
 * The Staff Edit dialog calls this on open so the operator can see
 * every credential associated with a teammate (login email, username,
 * phone, business email, business email password).
 *
 * Login password is intentionally NOT returned — Supabase stores it as
 * a bcrypt hash and the plaintext is permanently unrecoverable. The
 * Edit dialog offers a "set new password" field for changes.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await assertSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  const admin = createAdminClient();

  // Pull the auth row for the login email + the profile for everything
  // else. Done in parallel since they touch different tables.
  const [authRes, profileRes] = await Promise.all([
    admin.auth.admin.getUserById(id),
    admin
      .from("profiles")
      .select(
        "id, role, full_name, phone, business_email, business_email_password, username, login_password, is_active",
      )
      .eq("id", id)
      .maybeSingle(),
  ]);

  if (authRes.error || !authRes.data.user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Surface the real Supabase error if the SELECT failed. Most common
  // cause when this fires: migration 00069 hasn't been applied yet, so
  // the `username` column doesn't exist and the column list rejects.
  if (profileRes.error) {
    return NextResponse.json(
      { error: `Profile lookup failed: ${profileRes.error.message}` },
      { status: 500 },
    );
  }
  if (!profileRes.data) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const authEmail = authRes.data.user.email ?? "";
  // The "login email" we surface to the operator is the real address
  // only — synthesized placeholders are hidden so the UI reads as
  // "this user logs in with their username, no email on file".
  const isSynthesized = authEmail.endsWith(`@${SYNTHESIZED_EMAIL_DOMAIN}`);

  return NextResponse.json({
    profile: profileRes.data,
    login_email: isSynthesized ? "" : authEmail,
    has_synthesized_email: isSynthesized,
  });
}

/**
 * PUT /api/admin/users/[id]
 *
 * Atomic edit endpoint for the Staff Edit dialog. Accepts any subset
 * of: full_name, phone, username, business_email,
 * business_email_password, login_email (auth), new_password (auth).
 *
 * Any field omitted is left untouched. Empty string for nullable
 * profile fields (phone, business_email, business_email_password,
 * username) writes NULL — that's how the dialog "clears" a value.
 *
 * Order: validate → auth updates → profile update. If an auth update
 * fails we abort BEFORE touching the profile so DB and auth never
 * drift. (Profile-only failures roll back nothing — they're
 * idempotent on retry.)
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await assertSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  const body = (await request.json()) as {
    full_name?: string;
    phone?: string | null;
    username?: string | null;
    business_email?: string | null;
    business_email_password?: string | null;
    login_email?: string;
    new_password?: string;
  };

  const admin = createAdminClient();

  // 1) Normalize username — lowercase + validate shape. Empty string
  // means "clear it". Null/undefined means "leave unchanged".
  let normalizedUsername: string | null | undefined;
  if (body.username !== undefined) {
    const raw = (body.username ?? "").trim().toLowerCase();
    if (raw === "") {
      normalizedUsername = null;
    } else if (!USERNAME_RE.test(raw)) {
      return NextResponse.json(
        {
          error:
            "Username must be 2-32 characters, letters/digits/._- only, no leading/trailing punctuation",
        },
        { status: 400 },
      );
    } else {
      // Check uniqueness against other rows.
      const { data: clash } = await admin
        .from("profiles")
        .select("id")
        .eq("username", raw)
        .neq("id", id)
        .maybeSingle();
      if (clash) {
        return NextResponse.json(
          { error: `Username "${raw}" is already taken` },
          { status: 409 },
        );
      }
      normalizedUsername = raw;
    }
  }

  // 2) Auth-side updates (login_email, new_password). Done BEFORE the
  // profile so we don't leave a half-committed profile change if auth
  // rejects (rare — usually bad email format or duplicate email).
  const authPatch: { email?: string; password?: string } = {};
  if (body.login_email !== undefined) {
    const newEmail = body.login_email.trim().toLowerCase();
    if (newEmail.length > 0) {
      if (!newEmail.includes("@")) {
        return NextResponse.json(
          { error: "Login email must be a valid email address" },
          { status: 400 },
        );
      }
      authPatch.email = newEmail;
    }
    // Empty string is rejected — every auth row needs an email of
    // some sort. To "remove" an email, the operator should instead
    // set a username and leave the synthesized email alone.
  }
  if (body.new_password !== undefined && body.new_password.length > 0) {
    if (body.new_password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 },
      );
    }
    authPatch.password = body.new_password;
  }

  if (Object.keys(authPatch).length > 0) {
    const { error: authErr } = await admin.auth.admin.updateUserById(
      id,
      authPatch,
    );
    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: 400 });
    }
  }

  // 3) Profile-side update. Build the patch object so only provided
  // fields are written.
  const profilePatch: Record<string, string | null> = {};
  if (body.full_name !== undefined && body.full_name.trim() !== "") {
    profilePatch.full_name = body.full_name.trim();
  }
  if (body.phone !== undefined) {
    const v = (body.phone ?? "").trim();
    profilePatch.phone = v === "" ? null : v;
  }
  if (body.business_email !== undefined) {
    const v = (body.business_email ?? "").trim();
    profilePatch.business_email = v === "" ? null : v.toLowerCase();
  }
  if (body.business_email_password !== undefined) {
    const v = body.business_email_password ?? "";
    profilePatch.business_email_password = v === "" ? null : v;
  }
  if (normalizedUsername !== undefined) {
    profilePatch.username = normalizedUsername;
  }
  // Mirror the new login password into profiles.login_password whenever
  // we set one on the auth row. Keeps the plaintext copy that the Edit
  // dialog shows in sync with the hash Supabase actually verifies.
  if (authPatch.password) {
    profilePatch.login_password = authPatch.password;
  }

  if (Object.keys(profilePatch).length > 0) {
    const { error: profileErr } = await admin
      .from("profiles")
      .update(profilePatch)
      .eq("id", id);
    if (profileErr) {
      return NextResponse.json({ error: profileErr.message }, { status: 400 });
    }
  }

  await logAudit({
    userId: auth.callerId,
    action: "update_user",
    entityType: "profile",
    entityId: id,
    details: {
      // Log which fields were touched but NOT their values (passwords
      // and emails are sensitive). The audit reader can pair this
      // with the timestamp to know "X changed something" without
      // exposing the secrets.
      fields_changed: [
        ...Object.keys(profilePatch),
        ...Object.keys(authPatch).map((k) =>
          k === "password" ? "login_password" : `login_${k}`,
        ),
      ],
    },
  });

  return NextResponse.json({ success: true });
}
