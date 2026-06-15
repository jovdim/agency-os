import type { ComponentProps } from "react";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { BalanceClient } from "@/app/(dashboard)/client/balance/balance-client";
import { resolveSiteAdminContext } from "../auth";
import { LoginForm } from "../login-form";
import { SiteAdminHeader } from "../header";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

type BalanceProps = ComponentProps<typeof BalanceClient>;

/**
 * Per-site /admin BALANCE — reuses the CRM client BalanceClient verbatim, with
 * the same top-up flow (BuyCreditsDialog → Stripe create-session, which now
 * accepts the site-admin login). Data is scoped to this site by site_id rather
 * than the CRM owner_id/profile_id.
 */
export default async function SiteAdminBalancePage({
  params,
}: {
  params: Promise<{ host: string }>;
}) {
  const { host: rawHost } = await params;
  const ctx = await resolveSiteAdminContext(rawHost);
  if (!ctx) notFound();
  if (!ctx.authed) return <LoginForm />;

  const admin = createAdminClient();
  const [{ data: site }, { data: transactions }, { data: payments }] =
    await Promise.all([
      admin
        .from("sites")
        .select("id, name, status, is_paid, is_legacy, credit_balances(balance)")
        .eq("id", ctx.siteId)
        .single(),
      admin
        .from("credit_transactions")
        .select("*, sites(name)")
        .eq("site_id", ctx.siteId)
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("payments")
        .select("*, sites(name), invoices(id, invoice_number)")
        .eq("site_id", ctx.siteId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const siteRow = site as
    | { is_paid?: boolean | null; is_legacy?: boolean | null }
    | null;
  if (siteRow?.is_legacy) {
    return (
      <div className="min-h-screen bg-background">
        <SiteAdminHeader active="balance" />
        <div className="flex items-center justify-center px-4 py-20 text-center text-sm text-muted-foreground">
          This website isn&apos;t available in the new editor.
        </div>
      </div>
    );
  }
  const isPaid = siteRow?.is_paid === true;

  return (
    <div className="min-h-screen bg-background">
      <SiteAdminHeader active="balance" />
      <div className="px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <BalanceClient
            sites={(site ? [site] : []) as unknown as BalanceProps["sites"]}
            transactions={
              (transactions ?? []) as unknown as BalanceProps["transactions"]
            }
            payments={(payments ?? []) as unknown as BalanceProps["payments"]}
            // No tenant invoice route yet — hide the (CRM-only) Invoice button.
            invoiceBasePath={null}
            // Don't offer top-up on an unpaid site (credit would be unspendable).
            canTopUp={isPaid}
          />
        </div>
      </div>
    </div>
  );
}
