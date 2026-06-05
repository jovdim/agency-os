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
  };
}

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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Payments</h1>
        <p className="text-sm text-muted-foreground">
          Confirmed payments and invoices.
        </p>
      </div>

      {/* Stat row */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-2xl font-bold text-muted-foreground">
                {stats.confirmed}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                Confirmed
              </p>
            </div>
            <div className="rounded-md p-1.5 shrink-0 bg-muted">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className={`text-2xl font-bold ${
                  stats.failed > 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-muted-foreground"
                }`}
              >
                {stats.failed}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                Failed
              </p>
            </div>
            <div className="rounded-md p-1.5 shrink-0 bg-muted">
              <XCircle className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center">
        <div className="relative w-64 ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search confirmed payments..."
            className="pl-8 h-9 text-sm"
          />
        </div>
      </div>

      {/* Payment history */}
      {filteredPayments.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <Receipt className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">
            {search ? "No matching payments" : "No payments recorded yet."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden [&_td]:py-3 [&_th]:py-2">
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
                  <TableCell className="text-xs text-muted-foreground font-mono">
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
                      <span className="text-xs text-muted-foreground capitalize">
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
    </div>
  );
}
