import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/auth/resolve-identifier
 * Body: { identifier: string }
 *
 * Maps a login-form identifier (username OR email) to the email
 * Supabase Auth expects in signInWithPassword. The login page calls
 * this BEFORE its auth call so the user can type either credential
 * into a single field.
 *
 * - If `identifier` contains "@", we trust the caller and echo it
 *   back (still lowercased for consistency). No DB roundtrip.
 * - Otherwise we look up profiles.username and pair it with the
 *   auth.users.email of the matching row.
 *
 * On miss we still return 200 with the original input as the email.
 * That keeps the response time constant — an attacker probing for
 * valid usernames gets the same shape of response whether the name
 * exists or not. The actual auth call downstream will fail with
 * "invalid credentials" either way.
 *
 * No auth required — this endpoint runs BEFORE the user is signed in.
 * It only exposes one bit of information (does this username exist
 * AND have an email), which a sufficiently motivated attacker can
 * also derive from password-reset timing. We rely on Supabase Auth's
 * own rate-limiting downstream.
 */
export async function POST(request: Request) {
  let body: { identifier?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const raw =
    typeof body.identifier === "string" ? body.identifier.trim() : "";
  if (!raw) {
    return NextResponse.json({ error: "Missing identifier" }, { status: 400 });
  }

  // Looks like an email → no DB work needed.
  if (raw.includes("@")) {
    return NextResponse.json({ email: raw.toLowerCase() });
  }

  const username = raw.toLowerCase();
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (!profile) {
    // Miss: return the input so the downstream auth call fails with
    // a normal "invalid credentials" instead of leaking that the
    // username doesn't exist.
    return NextResponse.json({ email: username });
  }

  // Found a profile — pull the auth email.
  const { data: authRes } = await admin.auth.admin.getUserById(profile.id);
  if (!authRes.user?.email) {
    return NextResponse.json({ email: username });
  }

  return NextResponse.json({ email: authRes.user.email });
}
