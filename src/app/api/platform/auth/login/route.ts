import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSiteByHost } from "@/lib/platform/resolve-site";
import { isPlatformHost } from "@/lib/platform/hosts";
import {
  verifyPassword,
  dummyPasswordHash,
  createSessionToken,
  escapeLike,
  SITE_SESSION_COOKIE,
  SITE_SESSION_TTL_SECONDS,
} from "@/lib/platform/site-session";
import { rateLimit } from "@/lib/platform/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const host = req.headers.get("host");
  if (!isPlatformHost(host)) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const site = await resolveSiteByHost(host!);
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  // Shared, DB-backed throttle (migration 00081): 10 attempts per IP+site per
  // 10 minutes, counted across ALL serverless instances — not per-instance.
  const { blocked } = await rateLimit({
    key: `site-login:${ip}:${site.id}`,
    windowSeconds: 600,
    max: 10,
  });
  if (blocked) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429 },
    );
  }

  let email = "";
  let password = "";
  try {
    const body = await req.json();
    email = String(body?.email || "").trim();
    password = String(body?.password || "");
  } catch {
    /* fall through to validation */
  }
  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("site_admins")
    .select("id, password_hash, is_active")
    .eq("site_id", site.id)
    .ilike("email", escapeLike(email))
    .limit(1);
  const row = rows?.[0] as
    | { id: string; password_hash: string; is_active: boolean | null }
    | undefined;

  // Always run a scrypt verification — use a dummy hash for missing/inactive
  // accounts so unknown emails take the same time as a wrong password (no
  // user-enumeration timing oracle). One generic message for every failure.
  const active = !!row && row.is_active !== false;
  const passwordOk = verifyPassword(
    password,
    active ? row!.password_hash : dummyPasswordHash(),
  );
  if (!active || !passwordOk) {
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 },
    );
  }

  const token = createSessionToken(row.id, site.id);
  admin
    .from("site_admins")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(
      () => {},
      () => {},
    );

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SITE_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Tenant sites are served over their own public HTTPS, so mark Secure for
    // any HTTPS request (not just NODE_ENV=production); only plain-http localhost
    // dev stays non-Secure.
    secure:
      req.headers.get("x-forwarded-proto") === "https" ||
      process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SITE_SESSION_TTL_SECONDS,
    // No Domain attr => host-scoped: this cookie only travels back to the exact
    // site host it was issued on. A session for site A is never sent to site B.
  });
  return res;
}
