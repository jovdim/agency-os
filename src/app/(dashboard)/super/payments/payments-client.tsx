"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TrendingUp,
  XCircle,
  Search,
  CheckCircle2,
  Receipt,
} from "lucide-react";

interface PaymentRow {
  id: string;
  profile_name: string | null;
  profile_company: string | null;
  site_name: string | null;
  amount: number;
  status: string;
  invoice_number: string | null;
  created_at: string;
}

interface PaymentsClientProps {
  payments: PaymentRow[];
  stats: {
    confirmed: number;
    failed: number;
    revenue: number;
  };
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function PaymentsClient({ payments, stats }: PaymentsClientProps) {
  const [search, setSearch] = useState("");

  const filteredPayments = payments.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (p.profile_name?.toLowerCase().includes(q) ?? false) ||
      (p.profile_company?.toLowerCase().includes(q) ?? false) ||
      (p.site_name?.toLowerCase().includes(q) ?? false) ||
      (p.invoice_number?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Hero band — the page's single gradient surface. Title + subtitle on the
          left; the focal Revenue metric (pink = good news) in a frosted inset on
          the right. The only gradient and the only pink chip live here. */}
      <section className="dash-hero relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Finance
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
          <p className="text-sm text-muted-foreground">
            Confirmed payments, invoices, and total revenue at a glance.
          </p>
        </div>

        <div className="dash-hero-metric flex w-full shrink-0 items-center gap-4 px-5 py-4 sm:w-auto">
          <span className="dash-chip-pink inline-flex h-12 w-12 items-center justify-center rounded-xl">
            <TrendingUp className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Total revenue
            </p>
            <p className="text-3xl font-bold leading-tight tabular-nums">
              {usd.format(stats.revenue)}
            </p>
            <p className="text-xs text-muted-foreground">
              from confirmed payments
            </p>
          </div>
        </div>
      </section>

      {/* Operational stat tiles — quiet violet chips, tabular-nums values. The
          "failed" tile only colors up when something actually failed. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="dash-card block p-5">
          <span className="dash-chip inline-flex h-9 w-9 items-center justify-center rounded-lg">
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <p className="mt-4 text-3xl font-bold tabular-nums">
            {stats.confirmed.toLocaleString("en-US")}
          </p>
          <p className="mt-1 text-sm font-medium">Confirmed</p>
          <p className="text-xs text-muted-foreground">successful payments</p>
        </div>

        <div className="dash-card block p-5">
          <span className="dash-chip inline-flex h-9 w-9 items-center justify-center rounded-lg">
            <XCircle className="h-4 w-4" />
          </span>
          <p
            className={`mt-4 text-3xl font-bold tabular-nums ${
              stats.failed > 0 ? "text-red-600 dark:text-red-400" : ""
            }`}
          >
            {stats.failed.toLocaleString("en-US")}
          </p>
          <p className="mt-1 text-sm font-medium">Failed</p>
          <p className="text-xs text-muted-foreground">needs a second look</p>
        </div>
      </div>

      {/* Payment history — calm panel wrapping a header row (with inline search)
          and the table, so the whole surface reads as one premium card. */}
      <section className="dash-panel overflow-hidden">
        <div className="dash-hairline flex flex-col gap-3 border-b px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="dash-accent h-4 w-4" />
            <h2 className="text-xs font-semibold uppercase tracking-wider">
              Payment history
            </h2>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search payments..."
              className="h-9 pl-8 text-sm"
            />
          </div>
        </div>

        {filteredPayments.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <span className="dash-chip mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full">
              <Receipt className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium">
              {search ? "No matching payments" : "No payments yet"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {search
                ? "Try a different name, site, or invoice number."
                : "Confirmed payments will show up here."}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden [&_td]:py-3 [&_th]:py-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead className="w-28">Amount</TableHead>
                  <TableHead className="w-36">Invoice</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-32">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments.map((p) => (
                  <TableRow key={p.id} className="text-sm">
                    <TableCell>
                      <p className="font-medium">{p.profile_name ?? "—"}</p>
                      {p.profile_company && (
                        <p className="text-xs text-muted-foreground">
                          {p.profile_company}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.site_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold tabular-nums">
                        ${(p.amount ?? 0).toFixed(0)}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {p.invoice_number ?? "—"}
                    </TableCell>
                    <TableCell>
                      {p.status === "confirmed" ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />
                          Confirmed
                        </span>
                      ) : p.status === "failed" ? (
                        <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                          <XCircle className="h-3 w-3" />
                          Failed
                        </span>
                      ) : (
                        <span className="text-xs capitalize text-muted-foreground">
                          {p.status}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(p.created_at).toLocaleDateString("en-US")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
