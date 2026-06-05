"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Inbox,
  Hammer,
  Eye,
  RotateCcw,
  Send,
  ScanEye,
  CreditCard,
  Globe,
  ChevronDown,
  ChevronUp,
  Presentation,
  X,
} from "lucide-react";
import { ProposalTagChips, tagPalette } from "@/components/proposal-tags";
import type { ProposalTag } from "@/types/database";
import { cn } from "@/lib/utils";

interface Proposal {
  id: string;
  company_name: string;
  industry: string | null;
  town: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  slug: string | null;
  discount_price: number | null;
  base_price: number | null;
  sent_at: string | null;
  paid_at: string | null;
  contacts: { contact_person: string | null; phone: string | null; email: string | null }[] | { contact_person: string | null; phone: string | null; email: string | null } | null;
  deployments: { subdomain: string; deploy_status: string }[] | { subdomain: string; deploy_status: string } | null;
}

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "building", label: "In progress", statuses: ["submitted", "building", "revision"] },
  { key: "ready", label: "To approve", statuses: ["review"] },
  { key: "sent", label: "Sent", statuses: ["sent", "viewed"] },
  { key: "paid", label: "Paid", statuses: ["paid"] },
  { key: "archived", label: "Archived", statuses: ["archived"] },
];

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; badgeClass: string }> = {
  submitted: {
    label: "Waiting for build",
    icon: <Inbox className="h-3 w-3" />,
    badgeClass: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  },
  building: {
    label: "Building",
    icon: <Hammer className="h-3 w-3" />,
    badgeClass: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  },
  review: {
    label: "To approve",
    icon: <Eye className="h-3 w-3" />,
    badgeClass: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
  },
  revision: {
    label: "Revision",
    icon: <RotateCcw className="h-3 w-3" />,
    badgeClass: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  },
  sent: {
    label: "Sent",
    icon: <Send className="h-3 w-3" />,
    badgeClass: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  },
  viewed: {
    label: "Client viewed",
    icon: <ScanEye className="h-3 w-3" />,
    badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  paid: {
    label: "Paid",
    icon: <CreditCard className="h-3 w-3" />,
    badgeClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  archived: {
    label: "Archived",
    icon: <Inbox className="h-3 w-3" />,
    badgeClass: "bg-gray-500/15 text-gray-500 border-gray-500/30",
  },
};

export function ProposalsListClient({
  proposals,
  proposalTags = {},
  allTags = [],
  initialTagIds = [],
}: {
  proposals: Proposal[];
  /** proposal_id → tags currently attached to it. Pre-stitched server-side. */
  proposalTags?: Record<string, ProposalTag[]>;
  /** Full library — used for the filter bar. */
  allTags?: ProposalTag[];
  /** Pre-applied filter from the URL (server-resolved from ?tag=slug params). */
  initialTagIds?: string[];
}) {
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  // Multi-select: a proposal matches if it has AT LEAST ONE of the
  // selected tags. OR semantics — same as Linear's tag filter.
  // Initialized from the URL once (?tag=urgent) so cross-page navigation
  // can deep-link to a filtered view.
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(
    () => new Set(initialTagIds),
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const saved = localStorage.getItem("sk_collapsed_proposals");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem("sk_collapsed_proposals", JSON.stringify([...next]));
      return next;
    });
  };

  const toggleTagFilter = (tagId: string) => {
    setSelectedTagIds(prev => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  const filtered = useMemo(() => {
    let list = proposals;
    const tab = STATUS_TABS.find(t => t.key === activeTab);
    if (tab?.statuses) {
      list = list.filter(p => tab.statuses!.includes(p.status));
    }
    if (selectedTagIds.size > 0) {
      list = list.filter(p => {
        const tags = proposalTags[p.id] || [];
        // OR semantics — any matching tag passes.
        return tags.some(t => selectedTagIds.has(t.id));
      });
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.company_name.toLowerCase().includes(q) ||
        (p.town || "").toLowerCase().includes(q) ||
        (p.contacts as any)?.contact_person?.toLowerCase().includes(q)
      );
    }
    // Collapsed items go to the bottom
    return [...list].sort((a, b) => {
      const aCollapsed = collapsed.has(a.id) ? 1 : 0;
      const bCollapsed = collapsed.has(b.id) ? 1 : 0;
      return aCollapsed - bCollapsed;
    });
  }, [proposals, activeTab, search, collapsed, selectedTagIds, proposalTags]);

  // Per-tag count across the full proposal set (not the filtered set), so
  // the filter pills always show "how many proposals you'd see if you
  // toggled this tag in isolation". Computed once.
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of proposals) {
      const tags = proposalTags[p.id] || [];
      for (const t of tags) {
        counts[t.id] = (counts[t.id] || 0) + 1;
      }
    }
    return counts;
  }, [proposals, proposalTags]);

  // Hide tags with zero proposals on this salesperson's list — keeps the
  // filter bar focused on what's actually useful here. They'd just clutter.
  const visibleTags = allTags.filter(t => (tagCounts[t.id] || 0) > 0);

  return (
    <div className="dash-root max-w-6xl space-y-6">
      {/* Clean page header — eyebrow + title + one-line subtitle. No hero
          gradient on this operational list; a quiet violet chip carries the
          identity instead. */}
      <header className="flex items-center gap-3">
        <span className="dash-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
          <Presentation className="h-5 w-5" />
        </span>
        <div className="space-y-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sales pipeline
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Proposals</h1>
          <p className="text-sm text-muted-foreground">
            <span className="tabular-nums">{proposals.length}</span> total proposals
          </p>
        </div>
      </header>

      {/* Tabs */}
      <div className="dash-hairline flex items-center gap-1 overflow-x-auto border-b">
        {STATUS_TABS.map(tab => {
          const count = tab.statuses
            ? proposals.filter(p => tab.statuses!.includes(p.status)).length
            : proposals.length;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-(--dash-accent) text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                  active ? "dash-chip" : "bg-foreground/5 text-muted-foreground"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search company, city, contact..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Tag filter bar — only renders when there's at least one tag in
          play. Each pill shows count and toggles the filter on click.
          Multi-select with OR semantics. */}
      {visibleTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1">Tags:</span>
          {visibleTags.map(tag => {
            const palette = tagPalette(tag.color);
            const active = selectedTagIds.has(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTagFilter(tag.id)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-all",
                  active ? palette.filled : palette.chip,
                  "hover:opacity-90",
                )}
              >
                <span>{tag.name}</span>
                <span className={cn(
                  "rounded-full px-1 text-[10px] tabular-nums",
                  active ? "bg-white/20" : "bg-foreground/10",
                )}>
                  {tagCounts[tag.id] || 0}
                </span>
              </button>
            );
          })}
          {selectedTagIds.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedTagIds(new Set())}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground ml-1"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      )}

      {/* List */}
      <div className="dash-panel dash-hairline divide-y overflow-hidden">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <span className="dash-chip mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full">
              <Presentation className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium">No proposals</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Nothing matches your current filters.
            </p>
          </div>
        )}
        {filtered.map(proposal => {
          const isCollapsed = collapsed.has(proposal.id);
          const config = STATUS_CONFIG[proposal.status] || STATUS_CONFIG.submitted;
          const contactRaw = proposal.contacts;
          const contact = Array.isArray(contactRaw) ? contactRaw[0] : contactRaw;
          const deployment = Array.isArray(proposal.deployments)
            ? proposal.deployments[0]
            : proposal.deployments;
          const price = proposal.discount_price || proposal.base_price;

          if (isCollapsed) {
            return (
              <div key={proposal.id} className="dash-subhead flex items-center px-4 py-1.5">
                <button onClick={() => toggleCollapse(proposal.id)} className="mr-2 text-muted-foreground hover:text-foreground">
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <Link href={`/sales/proposals/${proposal.id}`} className="flex-1 flex items-center gap-2 min-w-0 transition-colors hover:text-(--dash-accent)">
                  <span className="text-xs text-muted-foreground truncate">{proposal.company_name}</span>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${config.badgeClass}`}>
                    {config.label}
                  </Badge>
                </Link>
                <span className="text-[10px] text-muted-foreground/60 ml-2">
                  {formatDistanceToNow(new Date(proposal.updated_at), { addSuffix: true })}
                </span>
              </div>
            );
          }

          return (
            <div key={proposal.id} className="dash-row flex items-center">
              <button
                onClick={() => toggleCollapse(proposal.id)}
                className="px-2 py-4 text-muted-foreground/40 hover:text-muted-foreground self-stretch flex items-center"
                title="Hide (call back later)"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <Link href={`/sales/proposals/${proposal.id}`} className="flex-1 flex items-center justify-between py-3.5 pr-4 min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold truncate">{proposal.company_name}</p>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${config.badgeClass}`}>
                      {config.icon}
                      <span className="ml-1">{config.label}</span>
                    </Badge>
                    {price && (
                      <span className="text-xs font-semibold tabular-nums text-(--dash-accent-2)">
                        ${price}
                      </span>
                    )}
                    {/* Tag chips — clicking toggles the filter (matches
                        the chip-as-filter pattern in Linear / GitHub Issues). */}
                    <ProposalTagChips
                      tags={proposalTags[proposal.id]}
                      onTagClick={(tag) => toggleTagFilter(tag.id)}
                    />
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-muted-foreground">
                      {proposal.industry || "—"} • {proposal.town || "—"}
                    </span>
                    {contact?.contact_person && (
                      <span className="text-xs text-muted-foreground">
                        {contact.contact_person}
                      </span>
                    )}
                    {deployment?.subdomain && (
                      <span className="flex items-center gap-1 text-xs text-(--dash-accent)">
                        <Globe className="h-3 w-3" />
                        {deployment.subdomain}.pages.dev
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground ml-4 shrink-0 tabular-nums">
                  {formatDistanceToNow(new Date(proposal.updated_at), { addSuffix: true })}
                </span>
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
