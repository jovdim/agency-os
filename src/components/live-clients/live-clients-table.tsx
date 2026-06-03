"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ExternalLink,
  Search,
  PenLine,
  CheckCircle,
  ChevronDown,
  X,
  Users,
  Plus,
  ArrowLeft,
  Bell,
} from "lucide-react";
import { format } from "date-fns";
import { AddMigratedClientDialog } from "./add-migrated-client-dialog";

/**
 * One row in the live-clients table — flat, render-ready shape. The
 * server page assembles this from joined proposal + contact + site
 * data + payment sums so the client component doesn't have to know
 * about the underlying schema relationships.
 *
 * Re-exported so the role pages can `import type { LiveClientRow }`
 * without reaching deeper into the component module.
 */
export interface LiveClientRow {
  proposal_id: string;
  site_id: string | null;
  company_name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  /** ISO timestamp of when the proposal flipped to paid */
  paid_at: string | null;
  /** True iff backfilled via the migrate-client API (vs. organic flow) */
  is_migrated: boolean;
  subdomain: string | null;
  custom_domain: string | null;
  last_published_at: string | null;
  /** Sum of confirmed payments for this proposal */
  amount_paid: number;
  /** null on migrated rows (no real salesperson attribution) */
  salesperson: string | null;
  /**
   * True when this client has a PENDING publish request awaiting IT
   * review. Drives the bell badge + the "waiting" count so IT knows who
   * to open without visiting each pipeline page. Optional: role pages
   * that don't populate it (super / sales for now) simply show no badge.
   */
  has_pending_publish?: boolean;
}

/**
 * Shared Live Clients table — mirrors the Published Websites
 * (`/tech/production`) visual structure so the two pages feel like
 * the same product surface. Single emerald-accented card (all rows
 * are paid by definition), compact row layout, search + date filter +
 * Organic/Migrated source chips.
 *
 * Used by /tech/live-clients, /super/live-clients, and /sales/live-
 * clients. Each role passes its own `rowHrefBase` so the company-name
 * link routes to the right per-client surface:
 *   - tech  → /tech/proposals       (unified timeline + paid cards)
 *   - super → /super/live-clients   (standalone detail page)
 *   - sales → /sales/live-clients   (standalone detail page)
 *
 * Language switch: tech + super render English (per the role rule
 * tech/super/admin = EN, sales/client = SK). Sales passes lang='sk'
 * and every visible string flips through the `STRINGS` dictionary
 * below. Keep the dictionary keys exhaustive — if you add a new
 * label, add both EN and SK entries before shipping.
 */

type Lang = "en" | "sk";

type DateFilter = "all" | "week" | "month" | "custom";
type SourceFilter = "all" | "organic" | "migrated";

// All user-facing strings switched by `lang`. Kept as a flat object
// (not nested) so it's grep-able and TypeScript catches missing
// translations when a new key is added.
const STRINGS = {
  en: {
    back: "Back",
    pageTitle: "Live Clients",
    pageSubtitle_total: "total",
    pageSubtitle_organic: "organic",
    pageSubtitle_migrated: "migrated",
    addMigrated: "Add migrated client",
    cardTitle: "Paying Clients",
    cardSubtitle:
      "Organic and migrated. Click a name to open management.",
    clientsOne: "1 client",
    clients: (n: number) => `${n} clients`,
    searchPlaceholder: "Search company, contact, email, domain...",
    dateAriaLabel: "Paid date range",
    dateAllTime: "All time",
    dateThisWeek: "Paid this week",
    dateThisMonth: "Paid this month",
    dateCustom: "Custom…",
    clear: "Clear",
    sourceAll: "All",
    sourceOrganic: "Organic",
    sourceMigrated: "Migrated",
    fromAriaLabel: "From date",
    toAriaLabel: "To date",
    colCompany: "Company",
    colPhone: "Phone",
    colOpen: "Open",
    colVisit: "Visit",
    colAmount: "Amount",
    colPaid: "Paid",
    emptyNoMatches: "No matches",
    emptyNoClients: "No paying clients yet",
    openRowTitle: "Open client management",
    openRowLabel: "Open",
    visitRowTitle: (url: string) => `Open ${url}`,
    pendingBadge: "Pending",
    pendingBadgeTitle: "Client requested a publish — open to approve",
    pendingWaiting: (n: number) =>
      n === 1 ? "1 waiting for approval" : `${n} waiting for approval`,
  },
  sk: {
    back: "Back",
    pageTitle: "Live Clients",
    pageSubtitle_total: "total",
    pageSubtitle_organic: "organic",
    pageSubtitle_migrated: "migrated",
    addMigrated: "Add migrated client",
    cardTitle: "Paying Clients",
    cardSubtitle:
      "Organic and migrated. Click a name to open management.",
    clientsOne: "1 client",
    clients: (n: number) => `${n} clients`,
    searchPlaceholder: "Search company, contact, email, domain...",
    dateAriaLabel: "Paid date range",
    dateAllTime: "All time",
    dateThisWeek: "Paid this week",
    dateThisMonth: "Paid this month",
    dateCustom: "Custom…",
    clear: "Clear",
    sourceAll: "All",
    sourceOrganic: "Organic",
    sourceMigrated: "Migrated",
    fromAriaLabel: "From date",
    toAriaLabel: "To date",
    colCompany: "Company",
    colPhone: "Phone",
    colOpen: "Open",
    colVisit: "Visit",
    colAmount: "Amount",
    colPaid: "Paid",
    emptyNoMatches: "No matches",
    emptyNoClients: "No paying clients yet",
    openRowTitle: "Open client management",
    openRowLabel: "Open",
    visitRowTitle: (url: string) => `Open ${url}`,
    pendingBadge: "Pending",
    pendingBadgeTitle: "Client requested a publish — open to approve",
    pendingWaiting: (n: number) =>
      n === 1 ? "1 waiting for approval" : `${n} waiting for approval`,
  },
} as const;

interface LiveClientsTableProps {
  rows: LiveClientRow[];
  /** Whether the current viewer can backfill migrated clients. Tech +
   *  super are true; sales is false (only tech/super can run the
   *  /api/admin/migrate-client backfill). */
  canAddMigrated: boolean;
  /** Where the "Back" button in the page-level header points to.
   *  Defaults to the role's dashboard. Ignored in embedded mode. */
  backHref?: string;
  /** Base path for the company-name link + the "Open" button. The
   *  proposal id is appended at render time (`{rowHrefBase}/{id}`).
   *  Each role decides where rows route:
   *    - tech: "/tech/proposals"      → unified proposal page
   *    - super: "/super/live-clients" → standalone detail page
   *    - sales: "/sales/live-clients" → standalone detail page
   *  Pinned as a string (not a function) so the server component can
   *  pass it across the server→client boundary without violating
   *  Next.js' "functions cannot cross" rule. */
  rowHrefBase?: string;
  /** Language for all visible labels. Sales passes "sk" per the
   *  language rule; tech/super/admin default to "en". Strings live
   *  in the STRINGS dictionary at the top of the file. */
  lang?: Lang;
  /** When rendered inside a host page that owns its own chrome (page
   *  heading + back button), embedded mode skips this component's
   *  page-level header but keeps the inner card + actions. */
  embedded?: boolean;
}

export function LiveClientsTable({
  rows,
  canAddMigrated,
  backHref = "/tech",
  rowHrefBase = "/tech/proposals",
  lang = "en",
  embedded = false,
}: LiveClientsTableProps) {
  const t = STRINGS[lang];
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // Counts per source tab — used for the chip labels so they stay
  // accurate as rows reload (e.g. after a successful Add migrated).
  const counts = useMemo(() => {
    let organic = 0;
    let migrated = 0;
    for (const r of rows) {
      if (r.is_migrated) migrated++;
      else organic++;
    }
    return { all: rows.length, organic, migrated };
  }, [rows]);

  return (
    <div className={embedded ? "space-y-4" : "space-y-6"}>
      {/* Page-level header — hidden in embedded mode (host owns it) */}
      {!embedded && (
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href={backHref}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t.back}
            </Link>
          </Button>
          <div className="mr-auto">
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-600" />
              {t.pageTitle}
            </h1>
            <p className="text-sm text-muted-foreground">
              {counts.all} {t.pageSubtitle_total}
              <span className="mx-1.5 opacity-50">·</span>
              {counts.organic} {t.pageSubtitle_organic}
              <span className="mx-1.5 opacity-50">·</span>
              {counts.migrated} {t.pageSubtitle_migrated}
            </p>
          </div>
          {canAddMigrated && (
            <Button onClick={() => setAddDialogOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              {t.addMigrated}
            </Button>
          )}
        </div>
      )}

      {/* Embedded mode: small action row above the card so "Add
          migrated client" stays reachable without rebuilding the
          whole page chrome. */}
      {embedded && canAddMigrated && (
        <div className="flex justify-end">
          <Button onClick={() => setAddDialogOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            {t.addMigrated}
          </Button>
        </div>
      )}

      <ClientsCard
        rows={rows}
        counts={counts}
        rowHrefBase={rowHrefBase}
        t={t}
      />

      <AddMigratedClientDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />
    </div>
  );
}

// ─── ClientsCard — single card mirroring SiteCard from production ──────────

interface ClientsCardProps {
  rows: LiveClientRow[];
  counts: { all: number; organic: number; migrated: number };
  rowHrefBase: string;
  /** Translation dictionary picked by the parent based on the lang
   *  prop. Kept as a prop so this subcomponent stays render-pure
   *  (no extra lookup needed inside). */
  t: (typeof STRINGS)[Lang];
}

function ClientsCard({ rows, counts, rowHrefBase, t }: ClientsCardProps) {
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");

  // Resolve the lower-bound timestamp for the active date filter.
  // Mirrors the helper inside production-client.tsx so behavior + UX
  // stay aligned between the two pages.
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
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (source === "organic" && r.is_migrated) return false;
      if (source === "migrated" && !r.is_migrated) return false;
      if (dateRange) {
        const ts = r.paid_at ? new Date(r.paid_at).getTime() : null;
        if (ts === null) return false;
        if (ts < dateRange[0] || ts > dateRange[1]) return false;
      }
      if (!q) return true;
      const company = r.company_name.toLowerCase();
      const phone = (r.phone ?? "").toLowerCase();
      const email = (r.email ?? "").toLowerCase();
      const sub = (r.subdomain ?? "").toLowerCase();
      const dom = (r.custom_domain ?? "").toLowerCase();
      return (
        company.includes(q) ||
        phone.includes(q) ||
        email.includes(q) ||
        sub.includes(q) ||
        dom.includes(q)
      );
    });
  }, [rows, source, search, dateRange]);

  // Total clients with a pending publish request (across all rows, not
  // just the filtered view) — the "who's waiting" signal that feeds IT
  // into the per-client pipeline page where the approval card lives.
  const pendingCount = useMemo(
    () => rows.filter((r) => r.has_pending_publish).length,
    [rows],
  );

  const accentBorder = "border-emerald-200/60 dark:border-emerald-900/40";
  const accentBg = "bg-emerald-50/40 dark:bg-emerald-950/10";
  const emptyText =
    search || dateRange || source !== "all"
      ? t.emptyNoMatches
      : t.emptyNoClients;
  const hasFilters =
    search !== "" ||
    dateFilter !== "all" ||
    customFrom !== "" ||
    customTo !== "" ||
    source !== "all";

  function clearAll() {
    setSearch("");
    setDateFilter("all");
    setCustomFrom("");
    setCustomTo("");
    setSource("all");
  }

  return (
    <div className={`rounded-lg border ${accentBorder} overflow-hidden`}>
      {/* Card header — title + count + source chips + search/date filter.
          Tabs go on their own row beneath the search row so on narrow
          screens nothing wraps awkwardly. */}
      <div className={`border-b ${accentBorder} ${accentBg}`}>
        <div className="flex items-center gap-2 px-4 pt-3">
          <CheckCircle className="h-4 w-4 text-emerald-500" />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">
              {t.cardTitle}
            </p>
            <p className="text-[11px] text-muted-foreground leading-tight">
              {t.cardSubtitle}
            </p>
          </div>
          {pendingCount > 0 && (
            <span
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
              title={t.pendingBadgeTitle}
            >
              <Bell className="h-3 w-3" />
              {t.pendingWaiting(pendingCount)}
            </span>
          )}
          <span
            className={`${pendingCount > 0 ? "" : "ml-auto"} text-xs text-muted-foreground tabular-nums`}
          >
            {filtered.length === 1 ? t.clientsOne : t.clients(filtered.length)}
          </span>
        </div>

        {/* Search + date filter row */}
        <div className="flex items-center gap-2 px-4 py-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-7 text-xs bg-background"
            />
          </div>
          <div className="relative shrink-0">
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              className="h-7 min-w-27.5 text-xs bg-background border border-input rounded-md pl-2 pr-7 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/50 appearance-none"
              aria-label={t.dateAriaLabel}
            >
              <option value="all">{t.dateAllTime}</option>
              <option value="week">{t.dateThisWeek}</option>
              <option value="month">{t.dateThisMonth}</option>
              <option value="custom">{t.dateCustom}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={clearAll}
              className="shrink-0 inline-flex items-center h-7 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3 mr-1" />
              {t.clear}
            </button>
          )}
        </div>

        {/* Source filter chips — All / Organic / Migrated */}
        <div className="flex items-center gap-1 px-4 pb-2.5">
          {(["all", "organic", "migrated"] as const).map((s) => {
            const label =
              s === "all"
                ? t.sourceAll
                : s === "organic"
                  ? t.sourceOrganic
                  : t.sourceMigrated;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={
                  "text-xs h-7 px-3 rounded border transition-colors " +
                  (source === s
                    ? "bg-background border-emerald-500/40 font-medium"
                    : "bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-background/50")
                }
              >
                {label}
                <span className="text-[10px] text-muted-foreground ml-1">
                  ({counts[s]})
                </span>
              </button>
            );
          })}
        </div>

        {/* Custom range — same inline-input pattern as production */}
        {dateFilter === "custom" && (
          <div className="flex items-center gap-2 px-4 pb-2.5 text-xs">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-7 flex-1 bg-background border border-input rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label={t.fromAriaLabel}
            />
            <span className="text-muted-foreground">→</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-7 flex-1 bg-background border border-input rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label={t.toAriaLabel}
            />
          </div>
        )}
      </div>

      {/* Table — column structure mirrors production with two extra
          fields specific to paid clients (Amount + Paid date). */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 px-3 text-right font-medium w-8">#</th>
              <th className="py-2 px-3 text-left font-medium min-w-44">
                {t.colCompany}
              </th>
              <th className="py-2 px-3 text-left font-medium min-w-28">
                {t.colPhone}
              </th>
              <th className="py-2 px-3 text-center font-medium w-20">
                {t.colOpen}
              </th>
              <th className="py-2 px-3 text-center font-medium w-20">
                {t.colVisit}
              </th>
              <th className="py-2 px-3 text-right font-medium min-w-24">
                {t.colAmount}
              </th>
              <th className="py-2 px-3 text-right font-medium min-w-28">
                {t.colPaid}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="py-8 text-center text-xs text-muted-foreground"
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              filtered.map((row, idx) => {
                const liveUrl = row.custom_domain
                  ? `https://${row.custom_domain}`
                  : row.subdomain
                    ? `https://${row.subdomain}.pages.dev`
                    : null;
                const rowHref = `${rowHrefBase}/${row.proposal_id}`;
                return (
                  <tr
                    key={row.proposal_id}
                    data-interactive="true"
                    className="border-b last:border-0 hover:bg-muted/40 transition-colors group"
                  >
                    {/* Row number */}
                    <td className="py-1.5 px-3 text-right text-muted-foreground tabular-nums text-xs select-none">
                      {idx + 1}
                    </td>

                    {/* Company name — goes to the role-specific detail
                        URL chosen by the caller. Migrated badge surfaces
                        inline so you can tell organic vs backfilled at a
                        glance without a dedicated "Source" column. */}
                    <td className="py-1.5 px-3 max-w-44">
                      <Link
                        href={rowHref}
                        className="font-medium text-foreground hover:text-primary transition-colors truncate flex items-center gap-1.5"
                        title={row.company_name}
                      >
                        <span className="truncate">{row.company_name}</span>
                        {row.has_pending_publish && (
                          <span
                            title={t.pendingBadgeTitle}
                            className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40 font-medium"
                          >
                            <Bell className="h-2.5 w-2.5" />
                            {t.pendingBadge}
                          </span>
                        )}
                        {row.is_migrated && (
                          <span className="shrink-0 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                            M
                          </span>
                        )}
                      </Link>
                    </td>

                    {/* Phone */}
                    <td className="py-1.5 px-3">
                      <span
                        className="font-mono text-xs text-muted-foreground truncate max-w-28 block"
                        title={row.phone ?? undefined}
                      >
                        {row.phone ?? "—"}
                      </span>
                    </td>

                    {/* Open — same destination as the company name. Kept
                        as a button (mirrors production's "Edit" column)
                        so the action is visible without hovering. */}
                    <td className="py-1.5 px-3 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        asChild
                        title={t.openRowTitle}
                      >
                        <Link href={rowHref}>
                          <PenLine className="h-3 w-3" />
                          {t.openRowLabel}
                        </Link>
                      </Button>
                    </td>

                    {/* Visit — direct link to the live site */}
                    <td className="py-1.5 px-3 text-center">
                      {liveUrl ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          asChild
                          title={t.visitRowTitle(liveUrl)}
                        >
                          <a
                            href={liveUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">
                          —
                        </span>
                      )}
                    </td>

                    {/* Amount paid */}
                    <td className="py-1.5 px-3 text-right tabular-nums">
                      <span className="text-xs">
                        {Number.isFinite(row.amount_paid) &&
                        row.amount_paid > 0
                          ? `€${row.amount_paid.toLocaleString("en-US", {
                              maximumFractionDigits: 0,
                            })}`
                          : "—"}
                      </span>
                    </td>

                    {/* Paid date */}
                    <td className="py-1.5 px-3 text-right">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {row.paid_at
                          ? format(new Date(row.paid_at), "dd MMM yyyy")
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
