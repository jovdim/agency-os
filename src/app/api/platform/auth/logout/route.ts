import { NextRequest, NextResponse } from "next/server";
import { SITE_SESSION_COOKIE } from "@/lib/platform/site-session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  // Mirror the attributes used when the cookie was set so the clear reliably
  // matches and deletes it.
  res.cookies.set(SITE_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure:
      req.headers.get("x-forwarded-proto") === "https" ||
      process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
