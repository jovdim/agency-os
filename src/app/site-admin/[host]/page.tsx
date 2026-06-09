import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { Brand } from "@/components/brand";
import {
  PencilSimple,
  Globe,
  CreditCard,
  At,
  CheckCircle,
  Warning,
  ArrowRight,
} from "@phosphor-icons/react/ssr";
import { resolveSiteAdminContext } from "./auth";
import { LoginForm } from "./login-form";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/** Days until renewal: next_billing_date if set, else live date + 1 year. */
function daysLeft(
  nextBilling: string | null,
  liveDate: string | null,
): number | null {
  const base = nextBilling
    ? new Date(nextBilling)
    : liveDate
      ? new Date(new Date(liveDate).getTime() + 365 * 86_400_000)
      : null;
  if (!base || Number.isNaN(base.getTime())) return null;
  return Math.ceil((base.getTime() - Date.now()) / 86_400_000);
}

const DOMAIN_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  register_new: "Registration requested",
  transfer: "Transfer requested",
  decided_later: "Pending your choice",
  none: "Not set up yet",
};

interface OverviewSite {
  name: string;
  status: string | null;
  site_url: string | null;
  is_paid: boolean | null;
  domain: string | null;
  domain_status: string | null;
  next_billing_date: string | null;
  website_live_date: string | null;
  credit_balances: { balance: number | null }[] | { balance: number | null } | null;
}

/**
 * Per-site /admin OVERVIEW — the landing a client sees after signing in (the
 * editor lives behind the "Edit my website" button at /admin/edit). Mirrors the
 * old in-CRM client dashboard: greeting, paid/expiry state, live-site link,
 * credit balance, and domain status.
 */
export default async function SiteAdminOverviewPage({
  params,
}: {
  params: Promise<{ host: string }>;
}) {
  const { host: rawHost } = await params;
  const ctx = await resolveSiteAdminContext(rawHost);
  if (!ctx) notFound();
  if (!ctx.authed) return <LoginForm />;

  const admin = createAdminClient();
  const { data } = await admin
    .from("sites")
    .select(
      "name, status, site_url, is_paid, domain, domain_status, next_billing_date, website_live_date, credit_balances(balance)",
    )
    .eq("id", ctx.siteId)
    .single();
  if (!data) notFound();
  const site = data as unknown as OverviewSite;

  const isPaid = site.is_paid === true;
  const cb = site.credit_balances;
  const balance =
    (Array.isArray(cb) ? cb[0]?.balance : cb?.balance) ?? 0;
  const days = daysLeft(site.next_billing_date, site.website_live_date);
  const isLive = site.status === "live" && !!site.site_url;
  const domainLabel = site.domain || null;
  const domainStatus =
    DOMAIN_STATUS_LABEL[site.domain_status ?? "none"] ?? "Not set up yet";

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="flex items-center justify-between border-b dash-hairline bg-card px-5 py-3">
        <Brand wordmarkClassName="h-8" />
        <LogoutButton />
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-6 px-5 py-8">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{site.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your website, domain, and billing.
          </p>
        </div>

        {/* Paid / expiry state banner */}
        {!isPaid ? (
          <div className="flex items-start gap-3 rounded-xl border border-amber-400/40 bg-amber-50/70 px-4 py-3 dark:bg-amber-500/10">
            <Warning className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" weight="fill" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Your website isn&apos;t active yet
              </p>
              <p className="text-sm text-muted-foreground">
                Complete payment to publish your site and set up your domain &amp;
                business email.
              </p>
            </div>
          </div>
        ) : days !== null && days <= 30 ? (
          <div className="flex items-start gap-3 rounded-xl border border-amber-400/40 bg-amber-50/70 px-4 py-3 dark:bg-amber-500/10">
            <Warning className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" weight="fill" />
            <p className="text-sm text-foreground">
              {days <= 0
                ? "Your service has expired — renew to keep your site online."
                : `Your service renews in ${days} day${days === 1 ? "" : "s"}.`}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-400/40 bg-emerald-50/70 px-4 py-3 dark:bg-emerald-500/10">
            <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600" weight="fill" />
            <p className="text-sm text-foreground">
              Your website is active
              {days !== null ? ` — ${days} days remaining` : ""}.
            </p>
          </div>
        )}

        {/* Primary action — open the editor */}
        <a
          href="/admin/edit"
          className="group flex items-center justify-between rounded-2xl border dash-hairline bg-card px-5 py-4 shadow-(--dash-shadow) transition-colors hover:border-[color-mix(in_oklab,var(--dash-accent)_40%,transparent)]"
        >
          <div className="flex items-center gap-3">
            <div className="dash-chip grid size-10 place-items-center rounded-xl">
              <PencilSimple className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Edit my website
              </p>
              <p className="text-xs text-muted-foreground">
                Change text, images, and content — then publish.
              </p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </a>

        {/* Info tiles */}
        <div className="grid gap-4 sm:grid-cols-2">
          {isLive && (
            <a
              href={site.site_url!}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl border dash-hairline bg-card p-4 transition-colors hover:border-[color-mix(in_oklab,var(--dash-accent)_40%,transparent)]"
            >
              <div className="flex items-center gap-2 text-muted-foreground">
                <Globe className="h-4 w-4" />
                <span className="text-xs font-medium">Live website</span>
              </div>
              <p className="mt-2 truncate text-sm font-medium text-foreground">
                {domainLabel ?? "Open your site"}
              </p>
              <p className="text-xs text-(--dash-accent)">Open ↗</p>
            </a>
          )}

          <div className="rounded-2xl border dash-hairline bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CreditCard className="h-4 w-4" />
              <span className="text-xs font-medium">Balance</span>
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
              ${balance.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              Used when you publish changes.
            </p>
          </div>

          <div className="rounded-2xl border dash-hairline bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <At className="h-4 w-4" />
              <span className="text-xs font-medium">Domain &amp; email</span>
            </div>
            <p className="mt-2 truncate text-sm font-medium text-foreground">
              {domainLabel ?? "Not set up yet"}
            </p>
            <p className="text-xs text-muted-foreground">{domainStatus}</p>
          </div>
        </div>
      </main>
    </div>
  );
}
