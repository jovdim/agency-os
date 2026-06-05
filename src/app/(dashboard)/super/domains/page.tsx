import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import {
  Globe2,
  ExternalLink,
  Mail,
  Phone,
  ArrowRight,
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
    const isActive = site.domain_status === "active";
    const requesterId =
      (site as { domain_requested_by?: string | null }).domain_requested_by ?? null;
    const requester = requesterId ? requesterMap.get(requesterId) ?? null : null;

    return (
      <div key={site.id} className="dash-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span
              className={`${isActive ? "dash-chip-pink" : "dash-chip"} mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg`}
            >
              <Globe2 className="h-4 w-4" />
            </span>
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
          </div>
          <Badge
            variant="outline"
            className={
              isActive
                ? "bg-(--dash-chip-bg-2) text-(--dash-accent-2) border-(--dash-accent-2)/30"
                : "bg-muted text-muted-foreground border-border"
            }
          >
            {label}
          </Badge>
        </div>

        <div className="dash-hairline rounded-lg border bg-muted/30 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Client
            </p>
            {site.proposal_id ? (
              <Link
                href={`/tech/proposals/${site.proposal_id}`}
                className="dash-accent inline-flex items-center gap-1 text-xs font-medium hover:underline"
              >
                View proposal <ArrowRight className="h-3 w-3" />
              </Link>
            ) : (
              <Link
                href={`/super/users/${site.owner_id}`}
                className="dash-accent inline-flex items-center gap-1 text-xs font-medium hover:underline"
              >
                View client <ArrowRight className="h-3 w-3" />
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
                className="dash-hairline inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs transition-colors hover:bg-muted/60"
              >
                <Mail className="h-3 w-3 text-muted-foreground" />
                {profile.email}
              </a>
            )}
            {profile?.phone ? (
              <a
                href={`tel:${profile.phone}`}
                className="dash-hairline inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs transition-colors hover:bg-muted/60"
              >
                <Phone className="h-3 w-3 text-muted-foreground" />
                {profile.phone}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1 text-xs text-muted-foreground">
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

  const emptyState = (message: string) => (
    <div className="dash-panel flex flex-col items-center justify-center px-4 py-14 text-center">
      <span className="dash-chip mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full">
        <Globe2 className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium">{message}</p>
    </div>
  );

  const queueContent =
    queueRequests.length === 0 ? (
      emptyState("No new requests")
    ) : (
      <div className="space-y-4">
        {queueRequests.map((site) => renderRequestCard(site))}
      </div>
    );

  const inProgressContent =
    inProgressRequests.length === 0 ? (
      emptyState("Nothing being processed")
    ) : (
      <div className="space-y-4">
        {inProgressRequests.map((site) => renderRequestCard(site))}
      </div>
    );

  const doneContent =
    doneRequests.length === 0 ? (
      emptyState("No completed requests yet")
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
    <div className="dash-root max-w-5xl space-y-8">
      {/* Clean page header — title + one-line subtitle on the left, the live
          pending count promoted to a compact stat tile on the right. No
          gradient: this is an operational list page, not a greeting surface. */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Operations
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Domain Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Each client&apos;s requested domain appears below. Register or
            transfer it, then connect the domain to their website.
          </p>
        </div>

        <div className="dash-card flex shrink-0 items-center gap-3 p-4 sm:w-56">
          <span className="dash-chip inline-flex h-10 w-10 items-center justify-center rounded-lg">
            <Globe2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-3xl font-bold leading-none tabular-nums">
              {pendingCount}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              pending · awaiting action
            </p>
          </div>
        </div>
      </header>

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
