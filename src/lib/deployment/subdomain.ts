import { SupabaseClient } from "@supabase/supabase-js";

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/;

/**
 * Validate subdomain format.
 * Rules: lowercase alphanumeric + hyphens, 3-50 chars, no leading/trailing hyphens.
 */
export function validateSubdomainFormat(subdomain: string): {
  valid: boolean;
  error?: string;
} {
  if (!subdomain) return { valid: false, error: "Subdomain is required" };
  if (subdomain.length < 3)
    return { valid: false, error: "Subdomain must be at least 3 characters" };
  if (subdomain.length > 50)
    return { valid: false, error: "Subdomain must be 50 characters or less" };
  if (subdomain !== subdomain.toLowerCase())
    return { valid: false, error: "Subdomain must be lowercase" };
  if (!SUBDOMAIN_REGEX.test(subdomain))
    return {
      valid: false,
      error:
        "Only lowercase letters, numbers, and hyphens allowed (no leading/trailing hyphens)",
    };
  return { valid: true };
}

/**
 * Check if a subdomain is available in the deployments table.
 * Pass excludeDeploymentId when updating an existing deployment's subdomain.
 */
export async function checkSubdomainAvailability(
  adminClient: SupabaseClient,
  subdomain: string,
  excludeDeploymentId?: string
): Promise<{ available: boolean }> {
  // Only count deployments that are actually live or currently deploying.
  // Failed / pending deployments are "ghosts" — they shouldn't block reuse.
  let query = adminClient
    .from("deployments")
    .select("id")
    .eq("subdomain", subdomain)
    .in("deploy_status", ["live", "deploying"])
    .limit(1);

  if (excludeDeploymentId) {
    query = query.neq("id", excludeDeploymentId);
  }

  const { data } = await query;
  return { available: !data || data.length === 0 };
}

/**
 * Generate a slug from a company name (for auto-populating subdomain input).
 */
export function generateSubdomainSlug(companyName: string): string {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}
