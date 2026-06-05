"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ExternalLink,
  Search,
  ArrowLeft,
  Pencil,
  Clock,
  ChevronDown,
  X,
  Globe2,
} from "lucide-react";
import { format } from "date-fns";

type DateFilter = "all" | "week" | "month" | "custom";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Site {
  id: string;
  proposal_id: string | null;
  name: string | null;
  subdomain: string | null;
  site_url: string | null;
  // Custom domain state — see SiteRow on the page-level type for full notes
  domain: string | null;
  domain_status: string | null;
  domain_setup_status: string | null;
  last_published_at: string | null;
  is_legacy: boolean | null;
  is_paid: boolean | null;
  proposals: {
    id: string;
    company_name: string;
    paid_at: string | null;
    contacts: { phone: string | null } | null;
  } | null;
}

// Resolve the "real" public URL for a site. Preference order:
//   1. Custom domain when verified-active by Cloudflare (the truth on the
//      open internet — what visitors see when typing the domain).
//   2. site_url field (set by composer publish + subdomain changes; usually
//      the .2dni.sk subdomain URL, but not always kept in sync after a
//      custom domain comes online — that's the bug we're working around).
//   3. Computed .2dni.sk URL from the subdomain field.
//   4. null — site can't be visited yet.
//
// Mirrors the conservative active-check from /api/sites/[id]/subdomain:
// failed CF setup overrides everything, active wins, legacy NULL falls back
// to the workflow flag.
function resolveVisitUrl(s: Site): string | null {
  const setupFailed = s.domain_setup_status === "failed";
  const setupActive = s.domain_setup_status === "active";
  const legacyApproved =
    !s.domain_setup_status && s.domain_status === "active";
  const isCustomDomainActive =
    !!s.domain &&
    s.domain.length > 0 &&
    !setupFailed &&
    (setupActive || legacyApproved);

  if (isCustomDomainActive && s.domain) {
    return `https://${s.domain}`;
  }
  if (s.site_url) return s.site_url;
  if (s.subdomain) return `https://${s.subdomain}.2dni.sk`;
  return null;
}

interface TechProductionClientProps {
  sites: Site[];
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TechProductionClient({ sites }: TechProductionClientProps) {
  // Only awaiting-payment sites live on this page now. Paid clients
  // moved to /tech/live-clients (dedicated roster with editable
  // domain / login / credits). Keeping the split that way means
  // each surface has one job — Published Websites = "deployed but
  // not yet paid", Live Clients = "paying customer management".
  const unpaidSites = useMemo(() => {
    return sites.filter((s) => {
      const isPaid = !!s.proposals?.paid_at || s.is_paid === true;
      return !isPaid;
    });
  }, [sites]);

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Page header — clean title block on the left (violet chip + title +
          one-line subtitle), the Back action sitting to the right. No gradient
          hero on this page: it's a working list, so a calm header reads best. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="dash-chip mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
            <Globe2 className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Production
            </p>
            <h1 className="text-2xl font-bold tracking-tight">
              Published Websites
            </h1>
            <p className="text-sm text-muted-foreground">
              <span className="tabular-nums">{unpaidSites.length}</span> awaiting
              payment
              <span className="mx-1.5 opacity-50">·</span>
              Paying customers in{" "}
              <Link
                href="/tech/live-clients"
                className="dash-accent font-medium hover:underline"
              >
                Live Clients
              </Link>
            </p>
          </div>
        </div>

        <Button variant="outline" size="sm" asChild className="shrink-0">
          <Link href="/tech">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      {/* Single panel — Awaiting Payment only. The Paid lane was moved
          to /tech/live-clients so paying customers get the richer
          management surface (edit subdomain / domain / login / credits
          + send credentials + journey) instead of just a list row. */}
      <SiteCard
        title="Awaiting Payment"
        subtitle="Deployed but the client hasn't paid yet"
        sites={unpaidSites}
        baseEmptyText="No unpaid websites"
      />
    </div>
  );
}

// ─── SiteCard ────────────────────────────────────────────────────────────────

interface SiteCardProps {
  title: string;
  subtitle: string;
  sites: Site[];
  baseEmptyText: string;
}

function SiteCard({
  title,
  subtitle,
  sites,
  baseEmptyText,
}: SiteCardProps) {
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Resolve the lower-bound timestamp for the active date filter. Returns
  // [from, to] in ms-since-epoch, or null when no date filter is active.
  // For 'week' / 'month' the upper bound is now; for 'custom' both bounds
  // come from the date inputs (end-of-day for the upper bound so the
  // selected end date is inclusive).
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

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return sites.filter((s) => {
      if (dateRange) {
        const ts = s.last_published_at
          ? new Date(s.last_published_at).getTime()
          : null;
        if (ts === null) return false;
        if (ts < dateRange[0] || ts > dateRange[1]) return false;
      }
      if (!q) return true;
      const company = (s.proposals?.company_name ?? s.name ?? "").toLowerCase();
      const phone = (s.proposals?.contacts?.phone ?? "").toLowerCase();
      return company.includes(q) || phone.includes(q);
    });
  }, [sites, search, dateRange]);

  const emptyText =
    search || dateRange ? "No matches" : baseEmptyText;

  const hasFilters =
    search !== "" ||
    dateFilter !== "all" ||
    customFrom !== "" ||
    customTo !== "";

  function clearAll() {
    setSearch("");
    setDateFilter("all");
    setCustomFrom("");
    setCustomTo("");
  }

  return (
    <div className="dash-panel overflow-hidden">
      {/* Panel header — title row + search row. Date filter is a small dropdown
          on the search row, to the right of the search input. Custom range
          expands as a thin row below it only when selected. */}
      <div className="dash-hairline border-b">
        <div className="flex items-center gap-3 px-5 pt-4">
          <span className="dash-chip inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
            <Clock className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">{title}</p>
            <p className="text-xs text-muted-foreground leading-tight">
              {subtitle}
            </p>
          </div>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {filtered.length === 1 ? "1 website" : `${filtered.length} websites`}
          </span>
        </div>

        {/* Search + date filter on one row. The select is wrapped so the
            chevron icon shows on top of a native <select> — gives it a
            clear button look without losing the native dropdown. */}
        <div className="flex items-center gap-2 px-5 py-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search company or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs bg-background"
            />
          </div>
          <div className="relative shrink-0">
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              className="h-8 min-w-27.5 text-xs bg-background border border-input rounded-md pl-2.5 pr-7 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/50 appearance-none"
              aria-label="Date range"
            >
              <option value="all">All time</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="custom">Custom…</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={clearAll}
              className="shrink-0 inline-flex items-center h-8 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </button>
          )}
        </div>

        {/* Custom range — two date inputs. Inline (no portal) per the
            radix-popover trap memory: this parent re-renders on every
            search/filter keystroke and a portaled popover crashes. */}
        {dateFilter === "custom" && (
          <div className="flex items-center gap-2 px-5 pb-3 text-xs">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 flex-1 bg-background border border-input rounded-md px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="From date"
            />
            <span className="text-muted-foreground">→</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 flex-1 bg-background border border-input rounded-md px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="To date"
            />
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="dash-subhead dash-hairline border-b text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="py-2.5 px-3 text-right font-semibold w-8">#</th>
              <th className="py-2.5 px-3 text-left font-semibold min-w-44">
                Company
              </th>
              <th className="py-2.5 px-3 text-left font-semibold min-w-28">
                Phone
              </th>
              <th className="py-2.5 px-3 text-center font-semibold w-24">Edit</th>
              <th className="py-2.5 px-3 text-center font-semibold w-24">
                Visit
              </th>
              <th className="py-2.5 px-3 text-right font-semibold min-w-28">
                Deployed
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-14 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <span className="dash-chip inline-flex h-11 w-11 items-center justify-center rounded-full">
                      <Globe2 className="h-5 w-5" />
                    </span>
                    <p className="text-sm font-medium">{emptyText}</p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((s, idx) => {
                // Visit URL — prefer verified custom domain, fall back to
                // site_url, then to a computed .2dni.sk subdomain URL.
                // See resolveVisitUrl() at the top of the file for the
                // full preference chain (handles the case where domain is
                // verified-active by Cloudflare but site_url hasn't caught
                // up to point at the custom domain).
                const visitUrl = resolveVisitUrl(s);
                const companyName =
                  s.proposals?.company_name ?? s.name ?? "Unknown";

                return (
                  <tr
                    key={s.id}
                    data-interactive="true"
                    className="dash-row dash-hairline border-b last:border-0 group"
                  >
                    {/* Row number */}
                    <td className="py-2 px-3 text-right text-muted-foreground tabular-nums text-xs select-none">
                      {idx + 1}
                    </td>

                    {/* Company name — links to proposal detail */}
                    <td className="py-2 px-3 max-w-44">
                      {s.proposal_id ? (
                        <Link
                          href={`/tech/proposals/${s.proposal_id}`}
                          className="font-medium text-foreground hover:text-(--dash-accent) transition-colors truncate block"
                          title={companyName}
                        >
                          {companyName}
                        </Link>
                      ) : (
                        <span
                          className="font-medium text-foreground truncate block"
                          title={companyName}
                        >
                          {companyName}
                        </span>
                      )}
                    </td>

                    {/* Phone — contact number for the client */}
                    <td className="py-2 px-3">
                      <span
                        className="font-mono text-xs text-muted-foreground truncate max-w-28 block"
                        title={s.proposals?.contacts?.phone ?? undefined}
                      >
                        {s.proposals?.contacts?.phone ?? "—"}
                      </span>
                    </td>

                    {/* Edit — composer for modern sites, legacy workspace
                        (the OLD upload-and-deploy UI at /tech/proposals/[id])
                        for legacy sites. */}
                    <td className="py-2 px-3 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        asChild
                        title={
                          s.is_legacy
                            ? "Open legacy workspace"
                            : "Open composer"
                        }
                      >
                        <Link
                          href={
                            s.is_legacy && s.proposal_id
                              ? `/tech/proposals/${s.proposal_id}`
                              : `/tech/sites/${s.id}/composer`
                          }
                        >
                          <Pencil className="h-3 w-3" />
                          {s.is_legacy ? "Legacy" : "Composer"}
                        </Link>
                      </Button>
                    </td>

                    {/* Visit — open the live URL in a new tab */}
                    <td className="py-2 px-3 text-center">
                      {visitUrl ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          asChild
                          title={`Open ${visitUrl}`}
                        >
                          <a
                            href={visitUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">{"—"}</span>
                      )}
                    </td>

                    {/* Deployed / last published date */}
                    <td className="py-2 px-3 text-right">
                      <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                        {s.last_published_at
                          ? format(new Date(s.last_published_at), "dd MMM yyyy")
                          : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
