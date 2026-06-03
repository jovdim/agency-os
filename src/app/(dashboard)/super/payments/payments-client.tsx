"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
  Clock,
  XCircle,
  Search,
  CheckCircle2,
  Receipt,
} from "lucide-react";
import { ConfirmPaymentDialog } from "./confirm-payment-dialog";

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

interface AwaitingRow {
  id: string;
  company_name: string;
  variable_symbol: string;
  active_price: number;
  discount_price: number | null;
  base_price: number | null;
  discount_expires_at: string | null;
  sent_at: string | null;
  contact_person: string | null;
  contact_email: string | null;
}

interface PaymentsClientProps {
  payments: PaymentRow[];
  awaiting: AwaitingRow[];
  stats: {
    confirmed: number;
    pending: number;
    failed: number;
  };
}

// A proposal that's been waiting more than this is treated as "stale" —
// surfaces an orange dot on the row and tilts the Awaiting stat card
// color so it nags. 14 days matches the discount window: past that, the
// price has reverted to base and the customer is officially overdue.
const STALE_DAYS = 14;

export function PaymentsClient({
  payments,
  awaiting,
  stats,
}: PaymentsClientProps) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"awaiting" | "confirmed">("awaiting");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<AwaitingRow | null>(
    null,
  );

  function handleConfirmClick(proposal: AwaitingRow) {
    setSelectedProposal(proposal);
    setDialogOpen(true);
  }

  function daysSince(dateStr: string | null): number {
    if (!dateStr) return 0;
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  const filteredAwaiting = awaiting.filter((a) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      a.variable_symbol.includes(q) ||
      a.company_name.toLowerCase().includes(q) ||
      (a.contact_person?.toLowerCase().includes(q) ?? false)
    );
  });

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

  // Oldest awaiting proposal — drives the "your queue is stale" cue on
  // the Awaiting stat card. Server returns awaiting sorted DESC by
  // sent_at, so the oldest is the last item.
  const oldestAwaiting = useMemo(() => {
    if (awaiting.length === 0) return null;
    return awaiting[awaiting.length - 1];
  }, [awaiting]);
  const oldestDays = oldestAwaiting ? daysSince(oldestAwaiting.sent_at) : 0;
  const queueIsStale = oldestDays > STALE_DAYS;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Payments</h1>
        <p className="text-sm text-muted-foreground">
          Match bank transfers to sent proposals — confirm by variable symbol.
        </p>
      </div>

      {/* Stat row — three counts only. No aggregate dollar figure
          (a sum of every sent/viewed proposal misleads on a
          reconciliation page because dead leads pad it). */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className={`text-2xl font-bold ${
                  awaiting.length === 0
                    ? "text-muted-foreground"
                    : queueIsStale
                      ? "text-orange-600 dark:text-orange-400"
                      : ""
                }`}
              >
                {awaiting.length}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                Awaiting
                {oldestAwaiting && (
                  <span
                    className={`block text-[10px] mt-0.5 ${
                      queueIsStale ? "text-orange-600/80 dark:text-orange-400/80" : ""
                    }`}
                  >
                    oldest {oldestDays}d
                  </span>
                )}
              </p>
            </div>
            <div className="rounded-md p-1.5 shrink-0 bg-muted">
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
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

      {/* Tabs + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-md bg-muted p-1">
          <button
            type="button"
            onClick={() => setTab("awaiting")}
            className={`px-3 py-1.5 text-sm font-medium rounded transition-colors flex items-center gap-1.5 ${
              tab === "awaiting"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Awaiting
            {awaiting.length > 0 && (
              <span
                className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-4 h-4 text-[10px] font-semibold tabular-nums ${
                  tab === "awaiting"
                    ? "bg-foreground/10 text-foreground"
                    : "bg-foreground/10 text-muted-foreground"
                }`}
              >
                {awaiting.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab("confirmed")}
            className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
              tab === "confirmed"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Confirmed
          </button>
        </div>
        <div className="relative w-64 ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              tab === "awaiting"
                ? "Search by VS, company, contact..."
                : "Search confirmed payments..."
            }
            className="pl-8 h-9 text-sm"
          />
        </div>
      </div>

      {/* Awaiting tab — workflow surface. Operator scans the variable
          symbol from a bank email, finds the matching row, clicks
          Confirm. Bigger row padding + monospace VS column makes the
          match feel obvious. */}
      {tab === "awaiting" ? (
        filteredAwaiting.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center">
            <CheckCircle2 className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">
              {search
                ? "No matching proposals"
                : "All caught up — no proposals awaiting payment."}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden [&_td]:py-3 [&_th]:py-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">VS</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="w-24">Price</TableHead>
                  <TableHead className="w-32">Sent</TableHead>
                  <TableHead className="w-32 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAwaiting.map((a) => {
                  const days = daysSince(a.sent_at);
                  const isStale = days > STALE_DAYS;
                  return (
                    <TableRow key={a.id} className="text-sm">
                      <TableCell>
                        <span className="font-mono text-base font-bold tabular-nums">
                          {a.variable_symbol}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {isStale && (
                            <span
                              className="h-2 w-2 rounded-full bg-orange-500 shrink-0"
                              title={`Sent ${days} days ago — past discount window`}
                            />
                          )}
                          <span className="font-medium">{a.company_name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">{a.contact_person ?? "—"}</p>
                        {a.contact_email && (
                          <p className="text-xs text-muted-foreground truncate max-w-50">
                            {a.contact_email}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold tabular-nums">
                          €{a.active_price.toFixed(0)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-muted-foreground">
                          {a.sent_at
                            ? new Date(a.sent_at).toLocaleDateString("sk-SK")
                            : "—"}
                        </p>
                        <p
                          className={`text-[10px] mt-0.5 ${
                            isStale
                              ? "text-orange-600 dark:text-orange-400"
                              : "text-muted-foreground/70"
                          }`}
                        >
                          {days}d ago
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          className="h-8 gap-1.5"
                          onClick={() => handleConfirmClick(a)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Confirm
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )
      ) : filteredPayments.length === 0 ? (
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
                      €{(p.amount ?? 0).toFixed(0)}
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
                    {new Date(p.created_at).toLocaleDateString("sk-SK")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Confirm dialog — unchanged behavior; just keeps the bank
          reconciliation flow intact. Wizard is intentionally NOT wired
          in here per scope (handover wizard stays on the proposal
          timeline). */}
      <ConfirmPaymentDialog
        proposal={selectedProposal}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
