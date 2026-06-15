import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Globe,
  Envelope as Mail,
  ArrowSquareOut as ExternalLink,
  Clock,
  CalendarCheck,
  Warning as AlertTriangle,
  PencilSimple,
} from "@phosphor-icons/react/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { UnpaidDomainEmailCard } from "@/app/(dashboard)/client/unpaid-domain-email-card";
import { resolveSiteAdminContext } from "./auth";
import { LoginForm } from "./login-form";
import { SiteAdminHeader } from "./header";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/**
 * Per-site /admin OVERVIEW — a faithful port of the old in-CRM client dashboard
 * (src/app/(dashboard)/client/page.tsx): same hero band, greeting, "Service
 * active" metric, expiry banners, domain/email tile, and live-site link. Only
 * the plumbing differs — auth is the per-site cookie (resolveSiteAdminContext)
 * and the site is fetched by id, not by owner_id. A standalone top bar
 * (Brand + sign-out) replaces the CRM dashboard shell, and an "Edit your
 * website" tile opens the editor at /admin/edit.
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
  const { data: site } = await admin
    .from("sites")
    .select("*")
    .eq("id", ctx.siteId)
    .single();
  if (!site) notFound();

  // Legacy (GitHub/static) sites aren't editable in the new editor — keep the
  // overview consistent with the editor + publish guards instead of offering
  // an Edit tile / top-up that dead-ends.
  if (site.is_legacy) {
    return (
      <div className="min-h-screen bg-background">
        <SiteAdminHeader active="dashboard" />
        <div className="flex items-center justify-center px-4 py-20 text-center text-sm text-muted-foreground">
          This website isn&apos;t available in the new editor.
        </div>
      </div>
    );
  }

  const isPaid = site.is_paid === true;

  // Days remaining from next_billing_date (set on payment), else live date + 1y.
  let daysRemaining = 365;
  let expiryDateStr = "";
  let isExpired = false;
  if (site.next_billing_date) {
    const expiryDate = new Date(site.next_billing_date);
    daysRemaining = Math.ceil(
      (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    expiryDateStr = expiryDate.toLocaleDateString("en-GB");
    isExpired = daysRemaining <= 0;
    daysRemaining = Math.max(0, daysRemaining);
  } else if (site.website_live_date) {
    const startDate = new Date(site.website_live_date);
    const expiryDate = new Date(startDate);
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    daysRemaining = Math.max(
      0,
      Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    );
    expiryDateStr = expiryDate.toLocaleDateString("en-GB");
    isExpired = daysRemaining <= 0;
  }

  // Time-based greeting (server local hour — white-label, no fixed locale).
  const hour = new Date().getHours();
  const greeting =
    hour >= 5 && hour < 10
      ? "Good morning"
      : hour >= 10 && hour < 17
        ? "Good day"
        : hour >= 17 && hour < 22
          ? "Good evening"
          : "Welcome back";

  // Company-facing name — the site/business name (the standalone /admin has no
  // staff profile). Falls back to a generic tail so the greeting reads complete.
  const displayName = site.name?.trim() || "welcome";

  const subtitle = !isPaid
    ? "Your website is ready and waiting to be activated."
    : site.status === "live" && (site.domain || site.site_url)
      ? `Your website is live at ${(site.domain || site.site_url || "").replace(/^https?:\/\//, "")}.`
      : site.status === "live"
        ? "Your website is live."
        : "Manage your website.";

  const showHeroMetric = isPaid && !isExpired && daysRemaining > 30;

  return (
    <div className="min-h-screen bg-background">
      {/* Standalone top bar — replaces the CRM dashboard shell's chrome. */}
      <SiteAdminHeader active="dashboard" />

      <div className="px-4 py-8 sm:px-6">
        <div className="dash-root mx-auto max-w-4xl space-y-6">
          {/* Hero band — time-based greeting + business name + contextual subtitle. */}
          <section className="dash-hero relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Your website
              </p>
              <h1 className="text-3xl font-bold tracking-tight">
                {greeting}, {displayName}
              </h1>
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            </div>

            {showHeroMetric && (
              <div className="dash-hero-metric flex items-center gap-4 px-5 py-4">
                <span className="dash-chip-pink inline-flex h-12 w-12 items-center justify-center rounded-xl">
                  <CalendarCheck className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Service active
                  </p>
                  <p className="text-3xl font-bold leading-tight tabular-nums">
                    {daysRemaining}
                    <span className="ml-1 text-base font-semibold text-muted-foreground">
                      days left
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {expiryDateStr ? `Valid until ${expiryDateStr}` : "Website is live"}
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* Expired banner */}
          {isPaid && isExpired && (
            <div className="flex items-start gap-3 rounded-xl border border-red-300/70 bg-red-50/70 px-4 py-3.5 dark:border-red-900/60 dark:bg-red-950/30">
              <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                  Your services expired{expiryDateStr ? ` on ${expiryDateStr}` : ""}
                </p>
                <p className="mt-1 text-xs text-red-600/80 dark:text-red-400/80">
                  Contact us to restore your website and services. The price to
                  renew for another year is $49.
                </p>
              </div>
            </div>
          )}

          {/* Expiry warning banner (≤30 days) */}
          {isPaid && !isExpired && daysRemaining <= 30 && (
            <div
              className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 ${
                daysRemaining <= 7
                  ? "border-red-300/70 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/30"
                  : "border-amber-300/70 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30"
              }`}
            >
              <span
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  daysRemaining <= 7
                    ? "bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400"
                    : "bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400"
                }`}
              >
                <Clock className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-semibold ${daysRemaining <= 7 ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}
                >
                  {daysRemaining <= 7
                    ? `Your services expire in ${daysRemaining} days!`
                    : `${daysRemaining} days left until expiration`}
                </p>
                <p
                  className={`mt-1 text-xs ${daysRemaining <= 7 ? "text-red-600/80 dark:text-red-400/80" : "text-amber-600/80 dark:text-amber-400/80"}`}
                >
                  {expiryDateStr ? `Expiration date: ${expiryDateStr}. ` : ""}
                  Renewal for another year costs just $49.
                </p>
              </div>
              <span
                className={`shrink-0 text-lg font-bold tabular-nums ${daysRemaining <= 7 ? "text-red-600" : "text-amber-600"}`}
              >
                {daysRemaining}d
              </span>
            </div>
          )}

          {/* Action tiles — Edit website + Domain/email. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Edit your website — opens the per-site editor. */}
            <Link href="/admin/edit" className="dash-card group block p-5">
              <div className="flex items-start gap-4">
                <span className="dash-chip inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                  <PencilSimple className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Edit your website</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    Change text, images, and content — then publish.
                  </p>
                </div>
              </div>
            </Link>

            {/* Domain + business email — paid: link to setup; unpaid: gated card. */}
            {isPaid ? (
              <Link href="/admin/domain" className="dash-card group block p-5">
                <div className="flex items-start gap-4">
                  <span className="dash-chip inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                    <Mail className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Domain and business email</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      Manage your domain and business email address.
                    </p>
                  </div>
                </div>
              </Link>
            ) : (
              <UnpaidDomainEmailCard siteId={site.id} />
            )}
          </div>

          {/* Live site link */}
          {site.status === "live" && site.site_url && (
            <div className="dash-panel flex items-center justify-between px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="dash-chip inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                  <Globe className="h-4 w-4" />
                </span>
                <a
                  href={site.site_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dash-accent truncate text-sm font-medium hover:underline"
                >
                  {site.site_url.replace(/^https?:\/\//, "")}
                </a>
              </div>
              <a
                href={site.site_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
