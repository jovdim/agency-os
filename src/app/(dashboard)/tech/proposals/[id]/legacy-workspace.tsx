import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { Sparkle as Sparkles, ArrowRight } from "@phosphor-icons/react/ssr";
import { BuildWorkspaceClient } from "./build-workspace-client";

/**
 * Legacy build workspace.
 *
 * Used for proposals whose site row has `is_legacy = true` (uploaded HTML +
 * GitHub deployment pipeline). New composer-based proposals use
 * `proposal-timeline.tsx` instead. This file is intentionally kept as a thin
 * server-side wrapper so the legacy code path stays intact while the new
 * timeline takes over the default view.
 */
export async function LegacyWorkspace({
  proposalId,
  currentUserId,
  composerAvailable,
}: {
  proposalId: string;
  currentUserId: string;
  composerAvailable: boolean;
}) {
  const admin = createAdminClient();

  const { data: proposal } = await admin
    .from("proposals")
    .select(
      "*, contacts(company_name, contact_person, phone, email, business_email, industry, town, website_url, location, social_links, notes, quoted_price, client_status)",
    )
    .eq("id", proposalId)
    .single();

  if (!proposal) {
    return (
      <div className="max-w-4xl mx-auto p-8 text-sm text-muted-foreground">
        Proposal not found.
      </div>
    );
  }

  const { data: deployment } = await admin
    .from("deployments")
    .select("id, subdomain, deploy_status, github_url, deployed_at")
    .eq("proposal_id", proposalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Recursively list all uploaded files in storage
  async function listAllFiles(folder: string, prefix = ""): Promise<string[]> {
    const { data: items } = await admin.storage.from("proposals").list(folder);
    if (!items) return [];
    const paths: string[] = [];
    for (const item of items) {
      const relativePath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.metadata) {
        paths.push(relativePath);
      } else {
        const subPaths = await listAllFiles(`${folder}/${item.name}`, relativePath);
        paths.push(...subPaths);
      }
    }
    return paths;
  }

  // Preserved for parity with the original page; BuildWorkspaceClient does
  // not currently take this as a prop but the work is cheap and matches the
  // legacy behavior of warming the storage list cache.
  await listAllFiles(`${proposalId}/site`);

  const { data: clientSite } = await admin
    .from("sites")
    .select(
      "id, owner_id, site_url, is_legacy, profiles!sites_owner_id_fkey(email, full_name)",
    )
    .eq("proposal_id", proposalId)
    .limit(1)
    .maybeSingle();

  const clientAccount = clientSite
    ? {
        email:
          (clientSite.profiles as unknown as { email: string; full_name: string })
            ?.email || null,
        fullName:
          (clientSite.profiles as unknown as { email: string; full_name: string })
            ?.full_name || null,
        siteId: clientSite.id,
        siteUrl: clientSite.site_url,
        tempPassword: (proposal as { client_temp_password?: string | null })
          .client_temp_password ?? null,
      }
    : null;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {composerAvailable && (
        <Link
          href={`/tech/proposals/${proposalId}/composer`}
          className="block rounded-lg border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/15 p-2 shrink-0">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">
                Build with the new template composer
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick pre-built section templates, fill placeholders, click Publish — all inside the CRM. No GitHub, no manual deploys.
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-primary shrink-0" />
          </div>
        </Link>
      )}

      <BuildWorkspaceClient
        proposal={proposal as Record<string, unknown>}
        deployment={deployment as Record<string, unknown> | null}
        currentUserId={currentUserId}
        clientAccount={clientAccount}
      />
    </div>
  );
}
