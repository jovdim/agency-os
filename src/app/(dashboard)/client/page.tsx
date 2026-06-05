import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Globe, PencilSimple as Pencil, Envelope as Mail, ArrowSquareOut as ExternalLink, ListChecks, ArrowRight, ChatText as MessageSquare, Clock, CalendarCheck, Warning as AlertTriangle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { UnpaidDomainEmailCard } from "./unpaid-domain-email-card";

export const dynamic = "force-dynamic";

export default async function ClientDashboard() {
  const { profile } = await requireRole("client");
  const supabase = await createClient();

  // Fetch the client's site. We no longer join credit_balances here —
  // the dashboard doesn't surface the balance number anymore (no context
  // for "$25" without a per-publish-cost explainer, which lives on
  // /client/balance). The bottom "Credits and payments" link is the entry
  // point if they want to see / top it up.
  const { data: sites } = await supabase
    .from("sites")
    .select("*")
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(1);

  const site = sites?.[0];

  // If no site yet, show waiting state
  if (!site) {
    return (
      <div className="dash-root max-w-4xl mx-auto space-y-8">
        {/* Greeting band — same hero language as the live dashboard so the
            waiting state still feels like a finished product, not a stub. */}
        <section className="dash-hero relative p-6 sm:p-8">
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Your client zone
            </p>
            {/* The no-site state already starts with "Welcome" which is a
                complete greeting on its own — no need for a "welcome"
                tail like the main header has. */}
            <h1 className="text-3xl font-bold tracking-tight">
              Welcome{profile.company_name?.trim() ? `, ${profile.company_name.trim()}` : ""}
            </h1>
            <p className="text-sm text-muted-foreground">
              Your client zone is being set up.
            </p>
          </div>
        </section>

        <div className="dash-panel flex flex-col items-center px-6 py-16 text-center">
          <span className="dash-chip mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl">
            <Globe className="h-6 w-6" />
          </span>
          <p className="text-lg font-semibold">Your website is being prepared</p>
          <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
            Once your site is ready, it will appear here. You will be able to edit content,
            send change requests, and manage your website.
          </p>
        </div>
      </div>
    );
  }

  // Change-requests UI only shows for legacy sites. Composer-based sites
  // publish edits directly with no review queue, so the "My changes" tile,
  // pending-changes stat, and bottom-row "Requests" link are all hidden.
  const isLegacy = site.is_legacy === true;

  // Skip the count query entirely for non-legacy sites — saves a round-trip.
  let pendingCount: number | null = 0;
  if (isLegacy) {
    const { count } = await supabase
      .from("change_requests")
      .select("id", { count: "exact", head: true })
      .eq("site_id", site.id)
      .eq("user_id", profile.id)
      .eq("status", "pending");
    pendingCount = count;
  }

  const isPaid = site.is_paid === true;

  // Calculate days remaining from next_billing_date (set on payment confirmation)
  let daysRemaining = 365;
  let expiryDateStr = "";
  let isExpired = false;
  if (site.next_billing_date) {
    const expiryDate = new Date(site.next_billing_date);
    daysRemaining = Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    expiryDateStr = expiryDate.toLocaleDateString("en-GB");
    isExpired = daysRemaining <= 0;
    daysRemaining = Math.max(0, daysRemaining);
  } else if (site.website_live_date) {
    const startDate = new Date(site.website_live_date);
    const expiryDate = new Date(startDate);
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    daysRemaining = Math.max(0, Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    expiryDateStr = expiryDate.toLocaleDateString("en-GB");
    isExpired = daysRemaining <= 0;
  }

  // ── Header personality ────────────────────────────────────────
  // Time-based greeting computed in Bratislava local time so the
  // server's machine timezone doesn't end up greeting "Good evening"
  // at 09:00 for Slovak users.
  const hour = parseInt(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Europe/Bratislava",
    }).format(new Date()),
    10,
  );
  const greeting =
    hour >= 5 && hour < 10
      ? "Good morning"
      : hour >= 10 && hour < 17
        ? "Good day"
        : hour >= 17 && hour < 22
          ? "Good evening"
          : "Welcome back";

  // Display name — company name first, then a generic "welcome" tail
  // if no company name exists. NEVER fall back to the person's
  // full_name (per Peter 2026-05-11 — the dashboard is a company-
  // facing surface, not a personal one). "welcome" makes
  // the greeting feel complete — "Good day, welcome" instead of
  // a bare "Good day," which read as cut off.
  const displayName = profile.company_name?.trim() || "welcome";

  // Contextual subtitle. Keeps the technical site.status enum out of
  // the client view; instead surfaces what actually matters to them:
  // "are we live?" / "what should I do next?". Live sites get their
  // domain inline so the URL is one place to look.
  const subtitle = !isPaid
    ? "Your website is ready and waiting to be activated."
    : site.status === "live" && (site.domain || site.site_url)
      ? `Your website is live at ${(site.domain || site.site_url || "").replace(/^https?:\/\//, "")}.`
      : site.status === "live"
        ? "Your website is live."
        : "Manage your website.";

  // The hero shows a focal "service active" metric in its frosted inset only
  // for the calm resting state (paid, live, comfortably far from expiry). When
  // something needs the client's eye — unpaid, expired, or ≤30 days left — the
  // dedicated banners below carry that message instead, so we keep the hero
  // clean rather than competing for attention.
  const showHeroMetric = isPaid && !isExpired && daysRemaining > 30;

  return (
    <div className="dash-root max-w-4xl mx-auto space-y-6">
      {/* Hero band — time-based greeting + company name (not a slug), plus a
          one-line contextual subtitle that says something meaningful about the
          site's state instead of leaking the internal status enum ("queued",
          "building"…) to clients who can't act on it. The page's single
          gradient surface; the pink "service active" metric (positive news)
          sits in a frosted inset on the right when all is well. */}
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

      {/* No payment card here for unpaid clients — only the hero "try
          the editor" CTA below. Payment info appears progressively
          inside the composer publish dialog when the client clicks
          Publish. Less pushy, encourages exploration first. */}

      {/* Expired banner — a genuine alert, so it keeps its red semantic tone
          but softens to a hairline border + blurred surface to match the
          calmer language elsewhere. */}
      {isPaid && isExpired && (
        <div className="flex items-start gap-3 rounded-xl border border-red-300/70 bg-red-50/70 px-4 py-3.5 dark:border-red-900/60 dark:bg-red-950/30">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">Your services expired{expiryDateStr ? ` on ${expiryDateStr}` : ""}</p>
            <p className="mt-1 text-xs text-red-600/80 dark:text-red-400/80">
              Contact us to restore your website and services. The price to renew for another year is $49.
            </p>
          </div>
        </div>
      )}

      {/* Expiry warning banner (30 days or less) */}
      {isPaid && !isExpired && daysRemaining <= 30 && (
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 ${
          daysRemaining <= 7
            ? "border-red-300/70 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/30"
            : "border-amber-300/70 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30"
        }`}>
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            daysRemaining <= 7
              ? "bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400"
              : "bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400"
          }`}>
            <Clock className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold ${daysRemaining <= 7 ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}>
              {daysRemaining <= 7 ? `Your services expire in ${daysRemaining} days!` : `${daysRemaining} days left until expiration`}
            </p>
            <p className={`mt-1 text-xs ${daysRemaining <= 7 ? "text-red-600/80 dark:text-red-400/80" : "text-amber-600/80 dark:text-amber-400/80"}`}>
              {expiryDateStr ? `Expiration date: ${expiryDateStr}. ` : ""}Renewal for another year costs just $49.
            </p>
          </div>
          <span className={`shrink-0 text-lg font-bold tabular-nums ${daysRemaining <= 7 ? "text-red-600" : "text-amber-600"}`}>
            {daysRemaining}d
          </span>
        </div>
      )}

      {/* Active service banner removed from the body — the resting-state
          expiration indicator (>30 days from expiry) now lives in the hero
          "Service active" metric inset above, where the date is the focal
          point. The expiry-warning + expired banners take over once
          daysRemaining drops to ≤30. */}

      {/* Stats row removed: "balance" and "days left" had
          no context on the dashboard — clients can't read a number like
          "$25" without knowing it's the credit pool for publishing
          changes. The expiration counter lives in the hero "Service active"
          metric above (or the warning banners when close to expiry).
          Balance is reachable via the "Credits and payments" link at the
          bottom, where the full context lives. */}

      {/* Hero Edit CTA — shown to ALL clients (paid + unpaid). The primary
          action on the dashboard: get the client into the editor. The
          actual paywall lives at publish-time, not at editor access, so
          there's no value in pretending unpaid clients have a different
          editor experience than paid ones. Same copy for everyone. A
          violet (operational) icon chip leads it. */}
      <Link href="/client/edit" className="dash-card group block p-5">
        <div className="flex items-center gap-5">
          <span className="dash-chip inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105">
            <Pencil className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">Edit your website</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              Click on any text or image directly on the page and customize
              it to match your vision.
            </p>
          </div>
          <ArrowRight className="dash-accent h-5 w-5 shrink-0 transition-transform group-hover:translate-x-1" />
        </div>
      </Link>

      {/* Secondary action cards. The "Edit website" tile that used
          to live here has been promoted to the hero CTA above (one entry
          point, no duplication). What's left:
            - Business email — clickable for unpaid, read-only for paid
            - My changes — legacy clients only
          Grid collapses to a single column on mobile and when there's
          only one card to show. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

        {/* My Changes — legacy-only. Modern composer-based clients publish
            edits directly, so there's no review queue to show. */}
        {isLegacy && (
          <Link href="/client/requests" className="dash-card group block p-5">
            <div className="flex items-start gap-4">
              <span className="dash-chip inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                <ListChecks className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">My changes</p>
                  {(pendingCount ?? 0) > 0 && (
                    <span className="dash-chip inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums">
                      {pendingCount}
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  Here you will find an overview of all your edits and their current status.
                </p>
              </div>
            </div>
          </Link>
        )}

        {/* Domain + business email — single tile that bundles both setup
            actions (domain logically comes first, email is `name@domain`).
            Paid: clickable Link to /client/domain (the 3-step pipeline).
            Unpaid: gated tile with a pulsing attention dot; clicking opens
            the shared <SiteActivationDialog> the composer publish flow
            uses, so the paywall message is identical everywhere. */}
        {isPaid ? (
          <Link href="/client/domain" className="dash-card group block p-5">
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

      {/* Slim secondary nav row at the bottom. Dropped "Credits and payments"
          and "Domain" since those duplicated the sidebar + the
          "Domain and business email" tile above. Kept "Need help?"
          as the discoverable entry point to messaging (the sidebar
          footer link is small / collapses when sidebar collapses, so
          this is the always-visible fallback). "Requests" stays for
          legacy clients only. */}
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <Link
          href="/client/messages"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Need help?
        </Link>
        {isLegacy && (
          <>
            <span className="text-border">|</span>
            <Link
              href="/client/requests"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <Clock className="h-3.5 w-3.5" />
              Requests
            </Link>
          </>
        )}
      </div>

    </div>
  );
}
