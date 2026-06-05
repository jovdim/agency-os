"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Globe, Copy, ArrowSquareOut as ExternalLink, MagnifyingGlass as Search, X, ArrowLeft, CheckCircle, Clock, CurrencyDollar as DollarSign, Users, PencilSimpleLine as PenLine } from "@phosphor-icons/react/ssr";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DeploymentItem {
  id: string;
  proposal_id: string;
  subdomain: string;
  deploy_status: string;
  deployed_at: string | null;
  company_name: string;
  proposal_status: string;
  paid_at: string | null;
  discount_price: number | null;
  base_price: number | null;
  price: number | null;
  contact_person: string | null;
  contact_email: string | null;
  contact_company: string | null;
  client_status: string | null;
  salesperson: string | null;
  revenue: number;
}

interface SuperProductionClientProps {
  deployments: DeploymentItem[];
  totalRevenue: number;
  totalClients: number;
  pendingEdits: number;
}

// ─── Status styles ──────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  sent: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  viewed: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  review: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  building: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
};

const STATUS_LABEL: Record<string, string> = {
  sent: "Sent",
  viewed: "Viewed",
  paid: "Paid",
  review: "In Review",
  building: "Building",
};

// ─── Component ──────────────────────────────────────────────────────────────

export function SuperProductionClient({
  deployments,
  totalRevenue,
  totalClients,
  pendingEdits,
}: SuperProductionClientProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paidFilter, setPaidFilter] = useState("all");

  const filtered = deployments.filter((d) => {
    if (statusFilter !== "all" && d.proposal_status !== statusFilter) return false;
    if (paidFilter === "paid" && d.proposal_status !== "paid") return false;
    if (paidFilter === "unpaid" && d.proposal_status === "paid") return false;
    if (search) {
      const q = search.toLowerCase();
      const fields = [
        d.company_name,
        d.contact_person,
        d.contact_email,
        d.contact_company,
        d.subdomain,
        d.salesperson,
      ];
      if (!fields.some((f) => (f ?? "").toLowerCase().includes(q))) return false;
    }
    return true;
  });

  const hasFilters = search !== "" || statusFilter !== "all" || paidFilter !== "all";

  async function copyUrl(subdomain: string) {
    const url = `https://${subdomain}.2dni.sk`;
    await navigator.clipboard.writeText(url);
    toast.success("URL copied to clipboard");
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/super">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Production Overview</h1>
          <p className="text-sm text-muted-foreground">
            All live websites across the agency
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Live Websites
              </p>
              <p className="text-3xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
                {deployments.length}
              </p>
            </div>
            <div className="rounded-md bg-emerald-100 dark:bg-emerald-900/30 p-2">
              <Globe className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Total Revenue
              </p>
              <p className="text-3xl font-bold mt-1 text-violet-600 dark:text-violet-400">
                {"$"}{totalRevenue.toLocaleString()}
              </p>
            </div>
            <div className="rounded-md bg-violet-100 dark:bg-violet-900/30 p-2">
              <DollarSign className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Total Clients
              </p>
              <p className="text-3xl font-bold mt-1 text-blue-600 dark:text-blue-400">
                {totalClients}
              </p>
            </div>
            <div className="rounded-md bg-blue-100 dark:bg-blue-900/30 p-2">
              <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Pending Edits
              </p>
              <p className="text-3xl font-bold mt-1 text-amber-600 dark:text-amber-400">
                {pendingEdits}
              </p>
            </div>
            <div className="rounded-md bg-amber-100 dark:bg-amber-900/30 p-2">
              <PenLine className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 rounded-md border bg-muted/30 px-3 py-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search company, contact, email, subdomain, salesperson..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm bg-background"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-sm bg-background">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="viewed">Viewed</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="review">In Review</SelectItem>
            <SelectItem value="building">Building</SelectItem>
          </SelectContent>
        </Select>
        <Select value={paidFilter} onValueChange={setPaidFilter}>
          <SelectTrigger className="w-32 h-8 text-sm bg-background">
            <SelectValue placeholder="Payment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
              setPaidFilter("all");
            }}
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 px-3 text-right font-medium w-8">#</th>
                <th className="py-2 px-3 text-left font-medium min-w-44">Company</th>
                <th className="py-2 px-3 text-left font-medium min-w-32">Owner</th>
                <th className="py-2 px-3 text-left font-medium min-w-40">Domain</th>
                <th className="py-2 px-3 text-left font-medium min-w-20">Status</th>
                <th className="py-2 px-3 text-left font-medium min-w-20">Paid</th>
                <th className="py-2 px-3 text-left font-medium min-w-24">Salesperson</th>
                <th className="py-2 px-3 text-right font-medium min-w-20">Revenue</th>
                <th className="py-2 px-3 text-right font-medium min-w-28">Created</th>
                <th className="py-2 px-3 text-center font-medium w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-muted-foreground">
                    {hasFilters
                      ? "No deployments match your filters."
                      : "No live deployments yet."}
                  </td>
                </tr>
              ) : (
                filtered.map((d, idx) => {
                  const siteUrl = `https://${d.subdomain}.2dni.sk`;
                  const isPaid = d.proposal_status === "paid";
                  const revenueAmount = d.revenue;

                  return (
                    <tr
                      key={d.id}
                      data-interactive="true"
                      className="border-b last:border-0 hover:bg-muted/40 transition-colors group"
                    >
                      {/* Row number */}
                      <td className="py-1.5 px-3 text-right text-muted-foreground tabular-nums text-xs select-none">
                        {idx + 1}
                      </td>

                      {/* Company name */}
                      <td className="py-1.5 px-3 max-w-44">
                        <span
                          className="font-medium text-foreground truncate block"
                          title={d.company_name}
                        >
                          {d.company_name}
                        </span>
                      </td>

                      {/* Owner (contact) */}
                      <td className="py-1.5 px-3 max-w-32">
                        <div className="truncate">
                          <span
                            className="text-foreground text-xs block truncate"
                            title={d.contact_person ?? undefined}
                          >
                            {d.contact_person ?? "\u2014"}
                          </span>
                          {d.contact_email && (
                            <span
                              className="text-muted-foreground text-[11px] block truncate"
                              title={d.contact_email}
                            >
                              {d.contact_email}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Domain / subdomain */}
                      <td className="py-1.5 px-3">
                        <a
                          href={siteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-mono text-xs"
                          title={siteUrl}
                        >
                          <Globe className="h-3 w-3 shrink-0" />
                          <span className="truncate max-w-32">
                            {d.subdomain}.2dni.sk
                          </span>
                          <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
                        </a>
                      </td>

                      {/* Proposal status */}
                      <td className="py-1.5 px-3">
                        <span
                          className={`inline-flex items-center text-xs rounded px-1.5 py-0.5 font-medium ${
                            STATUS_STYLE[d.proposal_status] ??
                            "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                          }`}
                        >
                          {STATUS_LABEL[d.proposal_status] ?? d.proposal_status}
                        </span>
                      </td>

                      {/* Paid badge */}
                      <td className="py-1.5 px-3">
                        {isPaid ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                            <CheckCircle className="h-2.5 w-2.5" />
                            Paid
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                            <Clock className="h-2.5 w-2.5" />
                            Unpaid
                          </span>
                        )}
                      </td>

                      {/* Salesperson */}
                      <td className="py-1.5 px-3">
                        <span className="text-xs text-muted-foreground truncate block max-w-24">
                          {d.salesperson ?? "\u2014"}
                        </span>
                      </td>

                      {/* Revenue */}
                      <td className="py-1.5 px-3 text-right tabular-nums text-muted-foreground">
                        {revenueAmount > 0
                          ? `$${revenueAmount.toLocaleString()}`
                          : "\u2014"}
                      </td>

                      {/* Created / deployed date */}
                      <td className="py-1.5 px-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                        {d.deployed_at
                          ? formatDistanceToNow(new Date(d.deployed_at), {
                              addSuffix: true,
                            })
                          : "\u2014"}
                      </td>

                      {/* Actions */}
                      <td className="py-1.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => copyUrl(d.subdomain)}
                            title="Copy site URL"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <a
                            href={siteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              title="Visit website"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
