/**
 * Site edit-lock helpers — wraps the `acquire_site_lock` /
 * `release_site_lock` RPC functions defined in migration 00051.
 *
 * Lifecycle from the caller's POV:
 *   1. Composer page (server component) calls `acquireOrCheckLock` on
 *      every render. Either we get the lock or we get told who holds it.
 *   2. If we got it, the client mounts the composer + heartbeats every
 *      30s by re-calling the same acquire endpoint (idempotent for
 *      same-user, refreshes lock_heartbeat_at).
 *   3. If we didn't get it, the page renders `<SiteLockedScreen>`
 *      instead of the composer.
 *   4. On clean tab close, the client calls `releaseLock` via
 *      `fetch(..., { keepalive: true })` so the next opener doesn't have
 *      to wait the full 90s TTL.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Seconds without a heartbeat before a lock is considered abandoned and
 *  any user can take it over. Must stay LARGER than the client's
 *  heartbeat interval (composer-client.tsx) — otherwise a tab loses its
 *  own lock between pings. 90s gives ~3 missed heartbeats of slack
 *  for slow networks while keeping crash-recovery under 2 minutes. */
export const LOCK_TTL_SECONDS = 90;

/** Wire-format result of `acquireOrCheckLock`. The DB-friendly role name
 *  (`tech_admin`, `sales`, etc.) is mapped to a user-visible team label
 *  (`IT team`, `Sales`, ...) by `roleToTeam` below before display. */
export type LockResult =
  | { status: "acquired" }
  | { status: "held_by_other"; team: string; since: string }
  | { status: "site_not_found" };

/**
 * Atomically try to claim or refresh the lock. Single round-trip; the
 * RPC handles the read+update in one transaction so two simultaneous
 * openers can never both see "available".
 */
export async function acquireOrCheckLock(
  admin: SupabaseClient,
  siteId: string,
  userId: string,
  role: string,
): Promise<LockResult> {
  const { data, error } = await admin.rpc("acquire_site_lock", {
    p_site_id: siteId,
    p_user_id: userId,
    p_role: role,
    p_ttl_seconds: LOCK_TTL_SECONDS,
  });

  if (error) {
    // 42883 = function does not exist → migration 00051 not applied yet.
    // Fail open (treat as acquired) so the composer keeps working in
    // dev environments before the migration runs. Real conflicts only
    // happen at the seam where the migration IS applied, so this only
    // affects the period between deploy and migrate.
    if (error.code === "42883") {
      console.warn(
        "[site-lock] acquire_site_lock RPC not found — apply migration 00051 to enable concurrent-edit guards",
      );
      return { status: "acquired" };
    }
    throw error;
  }

  return data as LockResult;
}

/**
 * Release the lock if we currently hold it. No-op + no error if we
 * don't (someone took over, lock expired, etc).
 */
export async function releaseLock(
  admin: SupabaseClient,
  siteId: string,
  userId: string,
): Promise<void> {
  const { error } = await admin.rpc("release_site_lock", {
    p_site_id: siteId,
    p_user_id: userId,
  });
  // Same fail-open rationale as acquire above.
  if (error && error.code !== "42883") {
    console.warn("[site-lock] release_site_lock failed:", error.message);
  }
}

/**
 * Map an internal role string to a user-visible team label. Used in the
 * lock screen so we say "Sales is editing" instead of "sales is editing".
 *
 * Mirrors the role labels the publish menu uses for "who edited this"
 * attribution — keeps team naming consistent across the app.
 */
export function roleToTeam(role: string | null | undefined): string {
  switch (role) {
    case "tech_admin":
      return "IT team";
    case "super_admin":
      return "Admin";
    case "administrator":
      return "Admin";
    case "sales":
      return "Sales";
    case "client":
      return "Client";
    default:
      return "Another user";
  }
}
