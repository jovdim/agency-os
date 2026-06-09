import { createAdminClient } from "@/lib/supabase/admin";

export interface RateLimitResult {
  /** True once the caller has exceeded `max` within the current window. */
  blocked: boolean;
  /** Running count for the current window (after this hit). */
  count: number;
}

/**
 * Shared, DB-backed fixed-window rate limit (migration 00081). Safe across many
 * serverless instances, unlike an in-memory Map — every instance increments the
 * same Postgres row.
 *
 * Fails OPEN on any DB/limiter error: a limiter outage must never lock out
 * legitimate users, and the actions this guards (login) already require the DB
 * to function, so an attacker gains nothing from a DB outage here.
 *
 * Node-only (uses the service-role admin client). Call from route handlers.
 */
export async function rateLimit(opts: {
  key: string;
  windowSeconds: number;
  max: number;
}): Promise<RateLimitResult> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("rate_limit_touch", {
      p_key: opts.key,
      p_window_seconds: opts.windowSeconds,
      p_max: opts.max,
    });
    if (error) return { blocked: false, count: 0 };
    const row = Array.isArray(data) ? data[0] : data;
    return {
      blocked: Boolean(row?.blocked),
      count: Number(row?.current_count ?? 0),
    };
  } catch {
    return { blocked: false, count: 0 };
  }
}
