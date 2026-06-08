import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { canAccessRoute, getDefaultRoute } from "@/lib/auth/roles";
import type { UserRole } from "@/types/database";

const PUBLIC_ROUTES = ["/login", "/proposal"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    const { response } = await updateSession(request);
    return response;
  }

  // Refresh session and get user
  const { supabase, user, response } = await updateSession(request);

  // "/" is the public marketing landing page, shown to EVERYONE (logged in or
  // out) with NO redirect. Signed-in users reach their dashboard via the
  // sidebar or a direct URL; the login flow routes them there explicitly.
  if (pathname === "/") {
    return response;
  }

  // Not authenticated - redirect to login
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // "Last active" heartbeat. Fire-and-forget so we don't add round-trip
  // latency to every page nav. The RPC is debounced at the DB to one
  // write per minute per user, so spamming it is cheap. See migration
  // 00074_profiles_last_seen_at.sql.
  supabase.rpc("bump_my_last_seen").then(() => {}, () => {});

  // Get role from app_metadata (synced there by DB trigger)
  const role = user.app_metadata?.role as UserRole | undefined;

  if (!role) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "no_role");
    return NextResponse.redirect(url);
  }

  // (Root "/" is handled above — it always renders the public landing now,
  // so there is no role-based redirect here anymore.)

  // Sales on mobile hitting /sales dashboard → redirect to dialer
  if (role === "sales" && pathname === "/sales") {
    const ua = request.headers.get("user-agent") || "";
    const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(ua);
    if (isMobile) {
      const url = request.nextUrl.clone();
      url.pathname = "/sales/dialer";
      return NextResponse.redirect(url);
    }
  }

  // Check role-based access
  if (!canAccessRoute(role, pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = getDefaultRoute(role);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|js|css)$).*)",
  ],
};
