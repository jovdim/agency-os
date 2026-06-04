"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Receipt,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { BuyCreditsDialog } from "@/components/payments/buy-credits-dialog";

const CREDIT_PRICE = 1; // 1 unit = $1 (balance stored in euros)
// Cost per publish — keep in sync with PUBLISH_COST_EUR in the credits API
// route. Used to convert balance to "X publishes available" for the UI.
const PUBLISH_COST_EUR = 12.5;

interface Site {
  id: string;
  name: string;
  status: string;
  credit_balances: { balance: number }[] | { balance: number } | null;
}

interface Transaction {
  id: string;
  amount: number;
  type: string;
  note: string | null;
  created_at: string;
  sites: { name: string } | null;
}

interface Payment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  description: string | null;
  /** "bysquare_credit" for client credit topups, "bank_transfer" or
   *  "stripe" for proposal payments. Used to gate the Invoice button —
   *  credit topups intentionally have no invoice. */
  payment_method: string | null;
  created_at: string;
  sites: { name: string } | null;
  invoices: { id: string; invoice_number: string }[] | null;
}

interface Props {
  sites: Site[];
  transactions: Transaction[];
  payments: Payment[];
}

const TX_TYPE_LABEL: Record<string, string> = {
  purchase: "Balance top-up",
  admin_grant: "Bonus from the team",
  submission_deduct: "Change submission",
  rejection_refund: "Refund (rejected)",
  publish_charge: "Website publish",
  publish_refund: "Refund — publish failed",
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  failed: "Failed",
  cancelled: "Cancelled",
};

const PAYMENT_STATUS_STYLE: Record<string, string> = {
  confirmed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};

function getBalance(site: Site): number {
  if (!site.credit_balances) return 0;
  if (Array.isArray(site.credit_balances))
    return site.credit_balances[0]?.balance ?? 0;
  return (site.credit_balances as { balance: number }).balance ?? 0;
}

function toEur(credits: number): string {
  return (credits * CREDIT_PRICE).toFixed(2) + " $";
}

export function BalanceClient({ sites, transactions, payments }: Props) {
  const router = useRouter();
  const [buyDialog, setBuyDialog] = useState<{ siteId: string; siteName: string } | null>(null);
  // Sum of all per-site balances, in euros.
  const totalCredits = sites.reduce((sum, s) => sum + getBalance(s), 0);
  // How many publishes that euro balance buys at the current per-publish cost.
  const publishesAvailable = Math.floor(totalCredits / PUBLISH_COST_EUR);

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Balance and payments</h1>
        <p className="text-sm text-muted-foreground">
          1 publish = $12.50
        </p>
      </div>

      {/* Total balance — single card, "Top up" lives here too. Per Peter
          2026-05-11 every client owns exactly 1 site, so the previous
          "Balance by site" per-site breakdown was just visual noise.
          See project_one_site_per_client.md memory. */}
      {(() => {
        // The buy dialog needs a site_id + name. Since there's always
        // exactly one site, take the first; defensive null otherwise so
        // the page still renders for an edge case where the site row is
        // missing (would never happen in production).
        const onlySite = sites[0] ?? null;
        return (
          <div className="rounded-xl border bg-card p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Your balance</p>
                <p className={`text-3xl font-bold mt-1 ${totalCredits > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                  {toEur(totalCredits)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {publishesAvailable} {publishesAvailable === 1 ? "publish" : "publishes"} available
                </p>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <div className="rounded-xl p-3 bg-emerald-500/10">
                  <Wallet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                {onlySite && (
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => setBuyDialog({ siteId: onlySite.id, siteName: onlySite.name })}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Top up balance
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tabs — Payments first (Peter 2026-05-30): the user came here
          to top up, so the most relevant view after dialog close is
          "did my payment land?", not "what have I published?" */}
      <Tabs defaultValue="payments" className="space-y-4">
        <TabsList>
          <TabsTrigger value="payments">Payment history</TabsTrigger>
          <TabsTrigger value="transactions">Publish history</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions">
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="text-sm font-semibold">Transactions</span>
              <span className="text-xs text-muted-foreground">{transactions.length}</span>
            </div>
            {transactions.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No transactions yet.
              </div>
            ) : (
              <div className="divide-y">
                {transactions.map((tx) => {
                  const isPositive = tx.amount > 0;
                  return (
                    <div key={tx.id} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`rounded-full p-1.5 shrink-0 ${
                          isPositive
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-red-500/10 text-red-600 dark:text-red-400"
                        }`}>
                          {isPositive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{TX_TYPE_LABEL[tx.type] ?? tx.type}</p>
                          <p className="text-xs text-muted-foreground truncate">{tx.sites?.name}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <p className={`text-sm font-bold ${isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {isPositive ? "+" : ""}{toEur(Math.abs(tx.amount))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(tx.created_at).toLocaleDateString("en-GB")}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="payments">
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="text-sm font-semibold">Payments</span>
              <span className="text-xs text-muted-foreground">{payments.length}</span>
            </div>
            {payments.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No payments yet.
              </div>
            ) : (
              <div className="divide-y">
                {payments.map((p) => {
                  // Credit topups don't get an invoice (Peter 2026-05-30 —
                  // intentional, not a Slovak-law-requiring transaction).
                  // Explicit gate so the Invoice button can't surface on
                  // these rows even if someone later wires invoice creation
                  // into confirmCreditPurchase by mistake.
                  const isCreditTopup = p.payment_method === "bysquare_credit";
                  const invoice =
                    !isCreditTopup &&
                    (Array.isArray(p.invoices) ? p.invoices[0] : null);
                  const isPending = p.status === "pending";
                  return (
                    <div key={p.id} className="flex items-center justify-between px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">${p.amount.toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {p.sites?.name}
                          {p.description ? ` · ${p.description}` : ""}
                          {" · "}
                          {new Date(p.created_at).toLocaleDateString("en-GB")}
                        </p>
                        {/* Reassurance line for pending bank transfers —
                            without it, a client who just paid sees
                            "Pending" and worries something is wrong. */}
                        {isPending && (
                          <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                            Will be credited within 60 minutes of the bank receiving the payment.
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${PAYMENT_STATUS_STYLE[p.status] ?? "bg-muted"}`}>
                          {PAYMENT_STATUS_LABEL[p.status] ?? p.status}
                        </span>
                        {invoice && (
                          <Link href={`/client/payments/${p.id}/invoice`} target="_blank">
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                              <Receipt className="h-3 w-3" />
                              Invoice
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {buyDialog && (
        <BuyCreditsDialog
          siteId={buyDialog.siteId}
          siteName={buyDialog.siteName}
          onClose={() => {
            setBuyDialog(null);
            // Refresh server-fetched data so a freshly-created
            // pending payment shows up in the Payments tab immediately
            // (instead of waiting for the next manual page reload).
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
