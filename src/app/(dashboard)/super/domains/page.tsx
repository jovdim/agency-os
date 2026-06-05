import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import {
  Globe2,
  ExternalLink,
  Mail,
  Phone,
} from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { DomainRequestActions } from "./domain-request-actions";
import { DomainTabs } from "./domain-tabs";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  register_new: "New Registration",
  transfer: "Transfer",
  register_in_progress: "Registering…",
  transfer_in_progress: "Transferring…",
  active: "Active",
  rejected: "Rejected",
};

export default async function DomainsPage() {
  await requireRole("super_admin");
  const admin = createAdminClient();

  const { data: domainRequests, error: domainError } = await admin
    .from("sites")
    .select(
      "id, name, site_url, domain, domain_status, requested_domain, domain_auth_code, domain_notes, domain_decided_at, owner_id, domain_requested_by, proposal_id",
    )
    .in("domain_status", [
      "register_new",
      "transfer",
      "register_in_progress",
      "transfer_in_progress",
      "active",
      "rejected",
    ])
    .order("domain_decided_at", { ascending: false });

  if (domainError) {
    console.error("Domain requests query error:", domainError);
  }

  // Fetch owner profiles + auth emails + staff requester profiles in one batch
  const ownerIds = (domainRequests || []).map((s) => s.owner_id).filter(Boolean);
  const profileMap = new Map<
    string,
    {
      full_name: string;
      email: string | null;
      phone: string | null;
      company_name: string | null;
    }
  >();
  const requesterMap = new Map<string, { full_name: string; role: string | null }>();
  const requesterIds = (domainRequests || [])
    .map((s) => (s as { domain_requested_by?: string | null }).domain_requested_by)
    .filter((id): id is string => !!id);
  const uniqueRequesterIds = [...new Set(requesterIds)];

  if (ownerIds.length > 0 || uniqueRequesterIds.length > 0) {
    const profileSelectIds = [...new Set([...ownerIds, ...uniqueRequesterIds])];
    const [{ data: profiles }, { data: authData }] = await Promise.all([
      admin
        .from("profiles")
        .select("id, full_name, phone, company_name, role")
        .in("id", profileSelectIds),
      admin.auth.admin.listUsers(),
    ]);
    const emailMap = new Map<string, string>();
    for (const u of authData?.users || []) {
      if (u.email) emailMap.set(u.id, u.email);
    }
    for (const p of profiles || []) {
      if (ownerIds.includes(p.id)) {
        profileMap.set(p.id, {
          full_name: p.full_name,
          email: emailMap.get(p.id) || null,
          phone: p.phone,
          company_name: p.company_name,
        });
      }
      if (uniqueRequesterIds.includes(p.id)) {
        requesterMap.set(p.id, {
          full_name: p.full_name,
          role: (p as { role?: string | null }).role ?? null,
        });
      }
    }
  }

  const allDomainRequests = domainRequests || [];
  const queueRequests = allDomainRequests.filter(
    (s) => s.domain_status === "register_new" || s.domain_status === "transfer",
  );
  const inProgressRequests = allDomainRequests.filter(
    (s) =>
      s.domain_status === "register_in_progress" ||
      s.domain_status === "transfer_in_progress",
  );
  const doneRequests = allDomainRequests.filter(
    (s) => s.domain_status === "active" || s.domain_status === "rejected",
  );

  type DomainSite = (typeof allDomainRequests)[number];

  const renderRequestCard = (site: DomainSite) => {
    const profile = profileMap.get(site.owner_id) || null;
    const label = STATUS_LABELS[site.domain_status] || site.domain_status;
    const requesterId =
      (site as { domain_requested_by?: string | null }).domain_requested_by ?? null;
    const requester = requesterId ? requesterMap.get(requesterId) ?? null : null;

    return (
      <div key={site.id} className="rounded-lg border px-5 py-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{site.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {site.domain_decided_at
                ? `Requested ${formatDistanceToNow(new Date(site.domain_decided_at), { addSuffix: true })}`
                : ""}
              {requester && (
                <>
                  {site.domain_decided_at ? " · " : ""}
                  by{" "}
                  <span className="text-foreground font-medium">
                    {requester.full_name || "Staff"}
                  </span>
                  {requester.role && (
                    <span className="ml-1 text-[10px] uppercase tracking-wide opacity-70">
                      ({requester.role.replace(/_/g, " ")})
                    </span>
                  )}
                </>
              )}
              {!requester && site.domain_decided_at && (
                <span className="ml-1 text-[10px] uppercase tracking-wide opacity-70">
                  by client
                </span>
              )}
            </p>
          </div>
          <Badge
            variant="outline"
            className="bg-muted text-muted-foreground border-border"
          >
            {label}
          </Badge>
        </div>

        <div className="rounded-md bg-muted/40 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Client
            </p>
            {site.proposal_id ? (
              <Link
                href={`/tech/proposals/${site.proposal_id}`}
                className="text-xs hover:underline"
              >
                View proposal →
              </Link>
            ) : (
              <Link
                href={`/super/users/${site.owner_id}`}
                className="text-xs hover:underline"
              >
                View client →
              </Link>
            )}
          </div>

          <div>
            <p className="text-sm font-semibold">
              {profile?.company_name ||
                profile?.full_name ||
                profile?.email ||
                "Unknown"}
            </p>
            {profile?.company_name && profile?.full_name && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {profile.full_name}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {profile?.email && (
              <a
                href={`mailto:${profile.email}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs hover:bg-background transition-colors"
              >
                <Mail className="h-3 w-3 text-muted-foreground" />
                {profile.email}
              </a>
            )}
            {profile?.phone ? (
              <a
                href={`tel:${profile.phone}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs hover:bg-background transition-colors"
              >
                <Phone className="h-3 w-3 text-muted-foreground" />
                {profile.phone}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-dashed text-xs text-muted-foreground">
                <Phone className="h-3 w-3" />
                No phone
              </span>
            )}
          </div>

          {(site.site_url || site.domain) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-2 border-t border-border/50">
              {site.domain && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Globe2 className="h-3 w-3" />
                  Current:{" "}
                  <span className="text-foreground font-medium">
                    {site.domain}
                  </span>
                </span>
              )}
              {site.site_url && (
                <a
                  href={site.site_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3 w-3" />
                  {site.site_url}
                </a>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 text-sm flex-wrap">
          <span className="text-muted-foreground">Domain:</span>
          <span className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-sm font-semibold font-mono">
            {site.requested_domain}
          </span>
          {site.domain_auth_code && (
            <span className="text-muted-foreground">
              EPP:{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                {site.domain_auth_code}
              </code>
            </span>
          )}
        </div>

        {site.domain_notes && (
          <p className="text-xs text-muted-foreground italic">
            Note: {site.domain_notes}
          </p>
        )}

        {site.domain_status !== "active" && site.domain_status !== "rejected" && (
          <DomainRequestActions
            siteId={site.id}
            currentNotes={site.domain_notes}
            currentStatus={site.domain_status}
          />
        )}
      </div>
    );
  };

  const queueContent =
    queueRequests.length === 0 ? (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No new requests
      </p>
    ) : (
      <div className="space-y-4">
        {queueRequests.map((site) => renderRequestCard(site))}
      </div>
    );

  const inProgressContent =
    inProgressRequests.length === 0 ? (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nothing being processed
      </p>
    ) : (
      <div className="space-y-4">
        {inProgressRequests.map((site) => renderRequestCard(site))}
      </div>
    );

  const doneContent =
    doneRequests.length === 0 ? (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No completed requests yet
      </p>
    ) : (
      <div className="space-y-4">
        {doneRequests.slice(0, 20).map((site) => renderRequestCard(site))}
        {doneRequests.length > 20 && (
          <p className="text-xs text-muted-foreground text-center pt-2">
            Showing 20 most recent of {doneRequests.length} completed
          </p>
        )}
      </div>
    );

  const pendingCount = queueRequests.length + inProgressRequests.length;

  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-2xl font-semibold">Domain Management</h1>

      <div className="rounded-lg border bg-card p-6 max-w-xs">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
          Pending
        </p>
        <p className="text-4xl font-bold mt-2 tabular-nums">{pendingCount}</p>
        <p className="text-xs text-muted-foreground mt-1">awaiting action</p>
      </div>

      <div className="space-y-1">
        <h2 className="text-base font-semibold">Client domains to set up</h2>
        <p className="text-sm text-muted-foreground">
          Each client&apos;s requested domain appears below. Register or transfer
          it, then connect the domain to their website.
        </p>
      </div>

      <DomainTabs
        queueContent={queueContent}
        inProgressContent={inProgressContent}
        doneContent={doneContent}
        queueCount={queueRequests.length}
        inProgressCount={inProgressRequests.length}
        doneCount={doneRequests.length}
      />
    </div>
  );
}
