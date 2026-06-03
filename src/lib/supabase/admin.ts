import { createClient } from "@supabase/supabase-js";

/**
 * Service role client for server-side admin operations.
 * ONLY use in API routes, webhooks, and cron jobs.
 * NEVER expose in client-side code.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
