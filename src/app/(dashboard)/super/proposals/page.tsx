import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  FolderKanban,
  Globe,
  MessageSquare,
  User,
  Wrench,
  Inbox,
  Hammer,
  Eye,
  RotateCcw,
  Send,
  ScanEye,
  CreditCard,
} from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ProposalTagChips } from "@/components/proposal-tags";
import { TagFilterBar } from "./tag-filter-bar";
import type { ProposalTag } from "@/types/database";

const STATUS_ORDER = [
  "submitted",
  "building",
  "review",
  "revision",
  "sent",
  "viewed",
  "paid",
];

const ACTIVE_STATUSES = [
  "submitted",
  "building",
  "review",
  "revision",
  "sent",
  "viewed",
];

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; color: string; iconBg: string; badgeClass: string }
> = {
  submitted: {
    label: "Waiting to Build",
    icon: <Inbox className="h-4 w-4 text-purple-600 dark:text-purple-400" />,
    color: "text-purple-600 dark:text-purple-400",
    iconBg: "bg-purple-100 dark:bg-purple-900/30",
    badgeClass: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  },
  building: {
    label: "In Progress",
    icon: <Hammer className="h-4 w-4 text-orange-600 dark:text-orange-400" />,
    color: "text-orange-600 dark:text-orange-400",
    iconBg: "bg-orange-100 dark:bg-orange-900/30",
    badgeClass: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  },
  review: {
    label: "Under Review",
    icon: <Eye className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />,
    color: "text-cyan-600 dark:text-cyan-400",
    iconBg: "bg-cyan-100 dark:bg-cyan-900/30",
    badgeClass: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
  },
  revision: {
    label: "Needs Revision",
    icon: <RotateCcw className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />,
    color: "text-yellow-600 dark:text-yellow-400",
    iconBg: "bg-yellow-100 dark:bg-yellow-900/30",
    badgeClass: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  },
  sent: {
    label: "Sent to Client",
    icon: <Send className="h-4 w-4 text-blue-600 dark:text-blue-400" />,
    color: "text-blue-600 dark:text-blue-400",
    iconBg: "bg-blue-100 dark:bg-blue-900/30",
    badgeClass: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  },
  viewed: {
    label: "Client Viewed",
    icon: <ScanEye className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
    color: "text-amber-600 dark:text-amber-400",
    iconBg: "bg-amber-100 dark:bg-amber-900/30",
    badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  paid: {
    label: "Paid",
    icon: <CreditCard className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
    color: "text-emerald-600 dark:text-emerald-400",
    iconBg: "bg-emerald-100 dark:bg-emerald-900/30",
    badgeClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
};

export const dynamic = "force-dynamic";

export default async function SuperProposalsPage({
  searchParams,
}: {
  // Multi-value tag filter — `?tag=urgent&tag=premium` means "show
  // proposals with the urgent OR premium tag". Empty = show everything.
  searchParams: Promise<{ tag?: string | string[] }>;
}) {
  await requireRole("super_admin");
  const supabase = createAdminClient();

  const sp = await searchParams;
  const rawTagParam = sp.tag;
  const selectedSlugs = new Set(
    Array.isArray(rawTagParam)
      ? rawTagParam.filter(Boolean)
      : rawTagParam
        ? [rawTagParam]
        : [],
  );

  const [{ data: proposals }, { data: messageCounts }, { data: tagLibrary }, { data: assignmentRows }] =
    await Promise.all([
      supabase
        .from("proposals")
        .select(
          `id, company_name, industry, town, status, created_at, updated_at, slug,
          contacts(contact_person, phone),
          sales_person:profiles!proposals_sales_person_id_fkey(full_name),
          tech_admin:profiles!proposals_built_by_fkey(full_name),
          deployments(subdomain, deploy_status)`
        )
        .order("updated_at", { ascending: false })
        .range(0, 199),
      supabase
        .from("proposal_messages")
        .select("proposal_id"),
      supabase
        .from("proposal_tags")
        .select("id, name, slug, color, created_by, created_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("proposal_tag_assignments")
        .select("proposal_id, tag_id"),
    ]);

  // Stitch tags onto each proposal client-side (cheap — small set).
  const tagsById = new Map<string, ProposalTag>(
    (tagLibrary ?? []).map((t) => [t.id, t as ProposalTag]),
  );
  const tagsByProposal = new Map<string, ProposalTag[]>();
  for (const row of (assignmentRows ?? []) as { proposal_id: string; tag_id: string }[]) {
    const tag = tagsById.get(row.tag_id);
    if (!tag) continue;
    const list = tagsByProposal.get(row.proposal_id) ?? [];
    list.push(tag);
    tagsByProposal.set(row.proposal_id, list);
  }

  // Per-tag count across the FULL (unfiltered) proposal set — so the
  // filter pills always reflect "if you toggled this tag in isolation".
  const tagCounts: Record<string, number> = {};
  for (const p of proposals ?? []) {
    const tags = tagsByProposal.get(p.id) ?? [];
    for (const t of tags) {
      tagCounts[t.slug] = (tagCounts[t.slug] || 0) + 1;
    }
  }

  // Apply the tag filter (OR semantics) BEFORE grouping.
  const proposalsToShow = (proposals ?? []).filter((p) => {
    if (selectedSlugs.size === 0) return true;
    const tags = tagsByProposal.get(p.id) ?? [];
    return tags.some((t) => selectedSlugs.has(t.slug));
  });

  const messageCountMap: Record<string, number> = {};
  if (messageCounts) {
    for (const msg of messageCounts) {
      messageCountMap[msg.proposal_id] =
        (messageCountMap[msg.proposal_id] || 0) + 1;
    }
  }

  const grouped: Record<string, typeof proposalsToShow> = {};
  for (const status of STATUS_ORDER) {
    grouped[status] = proposalsToShow.filter((p) => p.status === status);
  }

  const activePipeline = proposalsToShow.filter((p) =>
    ACTIVE_STATUSES.includes(p.status)
  );

  const totalCount = proposalsToShow.length;
  const isFiltered = selectedSlugs.size > 0;
  const grandTotal = (proposals ?? []).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/super">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Proposals Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            {isFiltered ? (
              <>
                Showing {totalCount} of {grandTotal} proposals · {activePipeline.length} active
              </>
            ) : (
              <>
                All proposals across all salespersons ({totalCount} total,{" "}
                {activePipeline.length} active)
              </>
            )}
          </p>
        </div>
      </div>

      {/* Tag filter — URL-driven so super admin can bookmark / share a
          filtered view ("show me everything tagged Urgent right now"). */}
      <TagFilterBar
        tags={(tagLibrary as ProposalTag[]) || []}
        selectedSlugs={selectedSlugs}
        tagCounts={tagCounts}
      />

      {/* Stat cards with icons */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
        {STATUS_ORDER.map((status) => {
          const config = STATUS_CONFIG[status];
          const count = (grouped[status] || []).length;
          return (
            <div key={status} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={`text-2xl font-bold ${count > 0 ? config.color : ""}`}>
                    {count}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                    {config.label}
                  </p>
                </div>
                <div className={`rounded-md p-1.5 shrink-0 ${config.iconBg}`}>
                  {config.icon}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pipeline flow indicator */}
      <div className="flex items-center gap-1 overflow-x-auto py-2">
        {ACTIVE_STATUSES.map((status, i) => {
          const config = STATUS_CONFIG[status];
          return (
            <div key={status} className="flex items-center gap-1">
              <Badge variant="outline" className={config.badgeClass}>
                {config.label} ({(grouped[status] || []).length})
              </Badge>
              {i < ACTIVE_STATUSES.length - 1 && (
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* Proposals grouped by status */}
      {STATUS_ORDER.filter(
        (s) => (grouped[s] || []).length > 0
      ).map((status) => {
        const config = STATUS_CONFIG[status];
        return (
          <div key={status} className="rounded-lg border bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b">
              <div className={`rounded-md p-1.5 ${config.iconBg}`}>
                {config.icon}
              </div>
              <span className="text-sm font-semibold">{config.label}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {(grouped[status] || []).length}
              </span>
            </div>
            <div className="divide-y">
              {(grouped[status] || []).map((proposal) => {
                const salesPerson = proposal.sales_person as unknown as {
                  full_name: string;
                } | null;
                const techAdminData = proposal.tech_admin as unknown as {
                  full_name: string;
                } | null;
                const contact = proposal.contacts as unknown as {
                  contact_person: string;
                  phone: string;
                } | null;
                const deployment = Array.isArray(proposal.deployments)
                  ? (proposal.deployments[0] as {
                      subdomain: string;
                      deploy_status: string;
                    } | undefined)
                  : (proposal.deployments as {
                      subdomain: string;
                      deploy_status: string;
                    } | null);
                const msgCount = messageCountMap[proposal.id] || 0;
                const deployUrl = deployment?.subdomain
                  ? `https://${deployment.subdomain}.2dni.sk`
                  : null;

                const proposalTags = tagsByProposal.get(proposal.id) ?? [];
                return (
                  <Link
                    key={proposal.id}
                    href={`/tech/proposals/${proposal.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium truncate">
                          {proposal.company_name}
                        </p>
                        {msgCount > 0 && (
                          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                            <MessageSquare className="h-3 w-3" />
                            {msgCount}
                          </span>
                        )}
                        <ProposalTagChips tags={proposalTags} />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                        <span className="text-xs text-muted-foreground">
                          {proposal.industry || "General"} • {proposal.town || "—"}
                        </span>
                        {contact?.contact_person && (
                          <span className="text-xs text-muted-foreground">
                            Contact: {contact.contact_person}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="h-3 w-3" />
                          {salesPerson?.full_name || "—"}
                        </span>
                        {techAdminData?.full_name && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Wrench className="h-3 w-3" />
                            {techAdminData.full_name}
                          </span>
                        )}
                        {deployUrl && (
                          <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                            <Globe className="h-3 w-3" />
                            {deployment?.subdomain}.2dni.sk
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground ml-4 shrink-0 text-right">
                      {formatDistanceToNow(new Date(proposal.updated_at), {
                        addSuffix: true,
                      })}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Empty state */}
      {totalCount === 0 && (
        <div className="rounded-lg border bg-card px-6 py-16 text-center">
          <FolderKanban className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">
            No proposals in the system yet
          </p>
        </div>
      )}
    </div>
  );
}
