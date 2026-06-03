"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, X, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { ProposalTagChips } from "@/components/proposal-tags/proposal-tag-chips";
import type { ProposalTag } from "@/types/database";

// ─── Types ──────────────────────────────────────────────────────────────────

type DateFilter = "all" | "week" | "month" | "custom";

interface Proposal {
  id: string;
  company_name: string;
  updated_at: string;
  created_at: string;
  contacts: { phone: string | null } | null;
}

interface TechProposalsClientProps {
  proposals: Proposal[];
  tagsByProposal: Record<string, ProposalTag[]>;
  page: number;
  pageSize: number;
  totalCount: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

const PRIORITY_ORDER = ["urgent", "priority", "premium", "basic"];

export function TechProposalsClient({
  proposals,
  tagsByProposal,
  page,
  pageSize,
  totalCount,
}: TechProposalsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isNavPending, startTransition] = useTransition();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const [search, setSearch] = useState("");

  function goToPage(next: number) {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (next <= 1) params.delete("page");
    else params.set("page", String(next));
    startTransition(() => router.replace(`?${params.toString()}`));
  }
  const [selectedTagSlugs, setSelectedTagSlugs] = useState<Set<string>>(
    new Set(),
  );
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Resolve the lower-bound timestamp for the active date filter. Returns
  // [from, to] in ms-since-epoch, or null when no date filter is active.
  const dateRange = useMemo<[number, number] | null>(() => {
    const now = Date.now();
    if (dateFilter === "week") return [now - 7 * 24 * 60 * 60 * 1000, now];
    if (dateFilter === "month") return [now - 30 * 24 * 60 * 60 * 1000, now];
    if (dateFilter === "custom") {
      if (!customFrom && !customTo) return null;
      const from = customFrom ? new Date(customFrom).getTime() : 0;
      const to = customTo
        ? new Date(customTo).getTime() + 24 * 60 * 60 * 1000 - 1
        : now;
      return [from, to];
    }
    return null;
  }, [dateFilter, customFrom, customTo]);

  // Unique tags present in this build queue, sorted by priority then name.
  // The chip strip below the search bar is built from this — we don't show
  // tag chips that no proposal in the current queue actually has.
  const availableTags = useMemo(() => {
    const seen = new Map<string, ProposalTag>();
    Object.values(tagsByProposal)
      .flat()
      .forEach((t) => {
        if (!seen.has(t.slug)) seen.set(t.slug, t);
      });
    return Array.from(seen.values()).sort((a, b) => {
      const ai = PRIORITY_ORDER.indexOf(a.slug);
      const bi = PRIORITY_ORDER.indexOf(b.slug);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [tagsByProposal]);

  function toggleTag(slug: string) {
    setSelectedTagSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  const filtered = useMemo(() => {
    return proposals.filter((p) => {
      if (dateRange) {
        const ts = p.created_at ? new Date(p.created_at).getTime() : null;
        if (ts === null) return false;
        if (ts < dateRange[0] || ts > dateRange[1]) return false;
      }
      if (selectedTagSlugs.size > 0) {
        const tags = tagsByProposal[p.id] ?? [];
        if (!tags.some((t) => selectedTagSlugs.has(t.slug))) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const name = (p.company_name || "").toLowerCase();
        const phone = (p.contacts?.phone || "").toLowerCase();
        if (!name.includes(q) && !phone.includes(q)) return false;
      }
      return true;
    });
  }, [proposals, selectedTagSlugs, tagsByProposal, search, dateRange]);

  const hasFilters =
    search !== "" ||
    selectedTagSlugs.size > 0 ||
    dateFilter !== "all" ||
    customFrom !== "" ||
    customTo !== "";

  return (
    <div className="space-y-3">
      {/* ── Search + date filter ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search company or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm bg-background"
          />
        </div>
        <div className="relative shrink-0">
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            className="h-8 min-w-27.5 text-xs bg-background border border-input rounded-md pl-2 pr-7 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/50 appearance-none"
            aria-label="Date range"
          >
            <option value="all">All time</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="custom">Custom…</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>
        {dateRange && (
          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
            {filtered.length === 1 ? "1 result" : `${filtered.length} results`}
          </span>
        )}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setSearch("");
              setSelectedTagSlugs(new Set());
              setDateFilter("all");
              setCustomFrom("");
              setCustomTo("");
            }}
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* ── Custom range — only when "Custom…" picked. Inline (no portal)
          to match the production page's pattern and stay safe against the
          radix-popover re-render trap. ── */}
      {dateFilter === "custom" && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="h-7 flex-1 bg-background border border-input rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label="From date"
          />
          <span className="text-muted-foreground">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="h-7 flex-1 bg-background border border-input rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label="To date"
          />
        </div>
      )}

      {/* ── Tag filter chips ── */}
      {availableTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground mr-1">
            Filter by tag:
          </span>
          {availableTags.map((tag) => {
            const active = selectedTagSlugs.has(tag.slug);
            return (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.slug)}
                className={`text-xs px-2 py-0.5 rounded-md border transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/20 bg-background hover:bg-muted"
                }`}
              >
                {tag.name}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Table — minimalist: # · Company+tags · Phone ── */}
      <div className="rounded-md border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 px-3 text-right font-medium w-8">#</th>
                <th className="py-2 px-3 text-left font-medium min-w-44">
                  Company
                </th>
                <th className="py-2 px-3 text-left font-medium min-w-28">
                  Phone
                </th>
              </tr>
            </thead>

            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="py-12 text-center text-muted-foreground"
                  >
                    {hasFilters
                      ? "No proposals match your filters"
                      : "No proposals in the build queue"}
                  </td>
                </tr>
              ) : (
                filtered.map((p, idx) => (
                  <tr
                    key={p.id}
                    data-interactive="true"
                    className="border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors group"
                    onClick={() => router.push(`/tech/proposals/${p.id}`)}
                  >
                    <td className="py-1.5 px-3 text-right text-muted-foreground tabular-nums text-xs select-none">
                      {(page - 1) * pageSize + idx + 1}
                    </td>

                    <td className="py-1.5 px-3 max-w-44">
                      <span
                        className="font-medium text-foreground group-hover:text-primary transition-colors truncate block"
                        title={p.company_name || "Unnamed"}
                      >
                        {p.company_name || "Unnamed"}
                      </span>
                      {tagsByProposal[p.id]?.length > 0 && (
                        <ProposalTagChips
                          tags={tagsByProposal[p.id]}
                          size="minimal"
                          className="mt-0.5"
                        />
                      )}
                    </td>

                    <td className="py-1.5 px-3">
                      <span
                        className="font-mono text-xs text-muted-foreground truncate max-w-28 block"
                        title={p.contacts?.phone ?? undefined}
                      >
                        {p.contacts?.phone ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {totalCount} in queue
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1 || isNavPending}
              onClick={() => goToPage(page - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages || isNavPending}
              onClick={() => goToPage(page + 1)}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
