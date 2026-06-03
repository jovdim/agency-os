import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDistanceToNow } from "date-fns";

/**
 * Read `profiles.last_seen_at` for every user. Bumped from middleware via
 * the `bump_my_last_seen()` RPC (debounced to once-per-minute per user), so
 * this is true presence — picks up anyone with the app open, not just
 * fresh logins. See migration 00074_profiles_last_seen_at.sql.
 */
export async function fetchLastActiveMap(
  admin: SupabaseClient,
): Promise<Map<string, string | null>> {
  const { data } = await admin
    .from("profiles")
    .select("id, last_seen_at");
  const map = new Map<string, string | null>();
  for (const row of data || []) {
    map.set(row.id as string, (row.last_seen_at as string | null) ?? null);
  }
  return map;
}

export async function fetchLastActiveFor(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("last_seen_at")
    .eq("id", userId)
    .maybeSingle();
  return (data?.last_seen_at as string | null) ?? null;
}

/**
 * Resolve a `last_seen_at` ISO string into the label + active-flag pair
 * the super-admin overview pages render. "Active now" covers anything in
 * the last 5 minutes (one heartbeat cycle plus a safety buffer for the
 * 1-minute DB debounce on `bump_my_last_seen`).
 */
export function lastActiveLabel(
  iso: string | null,
): { label: string; isActive: boolean } {
  if (!iso) return { label: "Never", isActive: false };
  const ageMs = Date.now() - new Date(iso).getTime();
  if (ageMs < 5 * 60 * 1000) return { label: "Active now", isActive: true };
  return {
    label: formatDistanceToNow(new Date(iso), { addSuffix: true }),
    isActive: false,
  };
}
