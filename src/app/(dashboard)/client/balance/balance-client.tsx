"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Wallet, ArrowUpRight, ArrowDownRight, Receipt, Plus, Rocket, CreditCard, ClockCounterClockwise as History } from "@phosphor-icons/react/ssr";
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
  /** Credit top-ups: "stripe" (current) or "bysquare_credit" (legacy).
   *  Website/proposal payments: "card" (Stripe) or "bank_transfer"/"cash"/
   *  etc (manual). Used to gate the Invoice button — credit topups
   *  intentionally have no invoice. */
  payment_method: string | null;
  created_at: string;
  sites: { name: string } | null;
  invoices: { id: string; invoice_number: string }[] | null;
}

interface Props {
  sites: Site[];
  transactions: Transaction[];
  payments: Payment[];
  /** Base path for the printable-invoice link; the button links to
   *  `${invoiceBasePath}/${paymentId}/invoice`. Pass `null` to HIDE the Invoice
   *  button (the per-site /admin surface has no invoice route yet, and the CRM
   *  /client path is unreachable there). Defaults to the CRM client route.
   *  A plain string/null — NOT a function, since Server Components can't pass
   *  functions to Client Components. */
  invoiceBasePath?: string | null;
  /** Whether the Top-up CTA is shown. False for unpaid sites (credit can't be
   *  spent until the site fee is paid). Defaults to true (CRM behaviour). */
  canTopUp?: boolean;
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

export function BalanceClient({
  sites,
  transactions,
  payments,
  invoiceBasePath = "/client/payments",
  canTopUp = true,
}: Props) {
  const router = useRouter();
  const [buyDialog, setBuyDialog] = useState<{ siteId: string; siteName: string } | null>(null);
  // Sum of all per-site balances, in euros.
  const totalCredits = sites.reduce((sum, s) => sum + getBalance(s), 0);
  // How many publishes that euro balance buys at the current per-publish cost.
  const publishesAvailable = Math.floor(totalCredits / PUBLISH_COST_EUR);

  // The buy dialog needs a site_id + name. Since there's always exactly
  // one site, take the first; defensive null otherwise so the page still
  // renders for an edge case where the site row is missing (would never
  // happen in production). Hoisted out of the JSX so both the hero CTA and
  // any future top-up entry points can share it.
  const onlySite = sites[0] ?? null;
  const hasBalance = totalCredits > 0;

  return (
    <div className="dash-root max-w-3xl space-y-8">
      {/* Hero band — the page's single gradient surface. Balance is the
          focal metric and the only "good news" number on the page, so it
          lives in the frosted inset with the pink chip. Per Peter 2026-05-11
          every client owns exactly 1 site, so the previous "Balance by site"
          per-site breakdown was just visual noise — a single total reads
          cleaner. See project_one_site_per_client.md memory. */}
      <section className="dash-hero relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Balance and payments
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Your balance</h1>
          <p className="text-sm text-muted-foreground">
            Top up to publish website changes — 1 publish = $12.50.
          </p>
        </div>

        <div className="dash-hero-metric flex w-full shrink-0 items-center gap-4 px-5 py-4 sm:w-auto">
          <span className="dash-chip-pink inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
            <Wallet className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Available
            </p>
            <p
              className={`text-3xl font-bold leading-tight tabular-nums ${
                hasBalance ? "text-(--dash-accent-2)" : "text-muted-foreground"
              }`}
            >
              {toEur(totalCredits)}
            </p>
            <p className="text-xs text-muted-foreground">
              {publishesAvailable} {publishesAvailable === 1 ? "publish" : "publishes"} available
            </p>
          </div>
          {onlySite && canTopUp && (
            <Button
              size="sm"
              className="h-8 shrink-0 gap-1.5 text-xs"
              onClick={() => setBuyDialog({ siteId: onlySite.id, siteName: onlySite.name })}
            >
              <Plus className="h-3.5 w-3.5" />
              Top up
            </Button>
          )}
        </div>
      </section>

      {/* Tabs — Payments first (Peter 2026-05-30): the user came here
          to top up, so the most relevant view after dialog close is
          "did my payment land?", not "what have I published?" */}
      <Tabs defaultValue="payments" className="space-y-4">
        <TabsList>
          <TabsTrigger value="payments">Payment history</TabsTrigger>
          <TabsTrigger value="transactions">Publish history</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions">
          <div className="dash-panel overflow-hidden">
            <div className="dash-hairline flex items-center justify-between gap-2 border-b px-5 py-3.5">
              <div className="flex items-center gap-2">
                <History className="dash-accent h-4 w-4" />
                <h2 className="text-xs font-semibold uppercase tracking-wider">
                  Transactions
                </h2>
              </div>
              <span className="dash-chip inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums">
                {transactions.length}
              </span>
            </div>
            {transactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
                <span className="dash-chip mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full">
                  <History className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium">No transactions yet</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Your publish history will appear here.
                </p>
              </div>
            ) : (
              <ul className="dash-hairline divide-y">
                {transactions.map((tx) => {
                  const isPositive = tx.amount > 0;
                  return (
                    <li
                      key={tx.id}
                      className="dash-row flex items-center justify-between gap-3 px-5 py-3.5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {/* Pink chip = money in (positive); violet chip =
                            operational spend. Keeps the brand-accent rule:
                            pink only for good news. */}
                        <span
                          className={`${
                            isPositive ? "dash-chip-pink" : "dash-chip"
                          } inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg`}
                        >
                          {isPositive ? (
                            <ArrowUpRight className="h-4 w-4" />
                          ) : (
                            <ArrowDownRight className="h-4 w-4" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {TX_TYPE_LABEL[tx.type] ?? tx.type}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {tx.sites?.name}
                          </p>
                        </div>
                      </div>
                      <div className="ml-3 shrink-0 text-right">
                        <p
                          className={`text-sm font-bold tabular-nums ${
                            isPositive ? "text-(--dash-accent-2)" : ""
                          }`}
                        >
                          {isPositive ? "+" : ""}{toEur(Math.abs(tx.amount))}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {new Date(tx.created_at).toLocaleDateString("en-GB")}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="payments">
          <div className="dash-panel overflow-hidden">
            <div className="dash-hairline flex items-center justify-between gap-2 border-b px-5 py-3.5">
              <div className="flex items-center gap-2">
                <CreditCard className="dash-accent h-4 w-4" />
                <h2 className="text-xs font-semibold uppercase tracking-wider">
                  Payments
                </h2>
              </div>
              <span className="dash-chip inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums">
                {payments.length}
              </span>
            </div>
            {payments.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
                <span className="dash-chip mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full">
                  <CreditCard className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium">No payments yet</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Top up your balance to get started.
                </p>
              </div>
            ) : (
              <ul className="dash-hairline divide-y">
                {payments.map((p) => {
                  // Credit topups don't get an invoice (Peter 2026-05-30 —
                  // intentional). Explicit gate so the Invoice button can't
                  // surface on these rows. Stripe credit topups use
                  // payment_method "stripe"; website payments use "card".
                  const isCreditTopup =
                    p.payment_method === "bysquare_credit" ||
                    p.payment_method === "stripe";
                  const invoice =
                    !isCreditTopup &&
                    (Array.isArray(p.invoices) ? p.invoices[0] : null);
                  const invoiceUrl =
                    invoice && invoiceBasePath
                      ? `${invoiceBasePath}/${p.id}/invoice`
                      : null;
                  const isPending = p.status === "pending";
                  return (
                    <li
                      key={p.id}
                      className="dash-row flex items-center justify-between gap-3 px-5 py-3.5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="dash-chip inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                          <Rocket className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold tabular-nums">
                            ${p.amount.toFixed(2)}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {p.sites?.name}
                            {p.description ? ` · ${p.description}` : ""}
                            {" · "}
                            {new Date(p.created_at).toLocaleDateString("en-GB")}
                          </p>
                          {/* Reassurance line for pending bank transfers —
                              without it, a client who just paid sees
                              "Pending" and worries something is wrong. */}
                          {isPending && (
                            <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                              Will be credited within 60 minutes of the bank receiving the payment.
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="ml-3 flex shrink-0 items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${PAYMENT_STATUS_STYLE[p.status] ?? "bg-muted text-muted-foreground"}`}>
                          {PAYMENT_STATUS_LABEL[p.status] ?? p.status}
                        </span>
                        {invoiceUrl && (
                          <Link href={invoiceUrl} target="_blank">
                            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                              <Receipt className="h-3 w-3" />
                              Invoice
                            </Button>
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
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
