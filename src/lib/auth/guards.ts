import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole, Profile } from "@/types/database";
import { hasMinRole, getDefaultRoute } from "./roles";

/**
 * Get the current authenticated user and their profile.
 * Redirects to /login if not authenticated.
 * Wrapped with React cache() to deduplicate within a single server render
 * (layout + page share one result instead of fetching profile twice).
 */
export const requireAuth = cache(async (): Promise<{
  user: { id: string; email: string };
  profile: Profile;
}> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, full_name, phone, company_name, is_active, created_at, updated_at")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/login");
  }

  return {
    user: { id: user.id, email: user.email! },
    profile: profile as Profile,
  };
});

/**
 * Require the user has a specific role (or higher).
 * Redirects to their default route if not authorized.
 */
export async function requireRole(minRole: UserRole): Promise<{
  user: { id: string; email: string };
  profile: Profile;
}> {
  const result = await requireAuth();

  if (!hasMinRole(result.profile.role, minRole)) {
    redirect(getDefaultRoute(result.profile.role));
  }

  return result;
}
