import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import {
  Globe,
  Pencil,
  Mail,
  ExternalLink,
  ListChecks,
  ArrowRight,
  MessageSquare,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { UnpaidDomainEmailCard } from "./unpaid-domain-email-card";

export const dynamic = "force-dynamic";

export default async function ClientDashboard() {
  const { profile } = await requireRole("client");
  const supabase = await createClient();

  // Fetch the client's site. We no longer join credit_balances here —
  // the dashboard doesn't surface the balance number anymore (no context
  // for "25 €" without a per-publish-cost explainer, which lives on
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
      <div className="space-y-6 max-w-4xl mx-auto">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome{profile.company_name?.trim() ? `, ${profile.company_name.trim()}` : ""}
          </h1>
          {/* The no-site state already starts with "Welcome" which is a
              complete greeting on its own — no need for a "welcome"
              tail like the main header has. */}
          <p className="text-sm text-muted-foreground mt-1">
            Your client zone is being set up.
          </p>
        </div>
        <div className="rounded-lg border bg-card px-6 py-16 text-center">
          <Globe className="mx-auto h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-lg font-medium">Your website is being prepared</p>
          <p className="text-sm text-muted-foreground mt-1">
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

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header — time-based greeting + company name (not a slug), plus
          a one-line contextual subtitle that says something meaningful
          about the site's state instead of leaking the internal
          status enum ("queued", "building"…) to clients who can't act
          on it. */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting}, {displayName}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      </div>

      {/* No payment card here for unpaid clients — only the hero "try
          the editor" CTA below. Payment info appears progressively
          inside the composer publish dialog when the client clicks
          Publish. Less pushy, encourages exploration first. */}

      {/* Expired banner */}
      {isPaid && isExpired && (
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300">Your services expired{expiryDateStr ? ` on ${expiryDateStr}` : ""}</p>
          <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">
            Contact us to restore your website and services. The price to renew for another year is 49 €.
          </p>
        </div>
      )}

      {/* Expiry warning banner (30 days or less) */}
      {isPaid && !isExpired && daysRemaining <= 30 && (
        <div className={`rounded-lg border px-4 py-3 ${
          daysRemaining <= 7
            ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30"
            : "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30"
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-semibold ${daysRemaining <= 7 ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}>
                {daysRemaining <= 7 ? `Your services expire in ${daysRemaining} days!` : `${daysRemaining} days left until expiration`}
              </p>
              <p className={`text-xs mt-1 ${daysRemaining <= 7 ? "text-red-600/80 dark:text-red-400/80" : "text-amber-600/80 dark:text-amber-400/80"}`}>
                {expiryDateStr ? `Expiration date: ${expiryDateStr}. ` : ""}Renewal for another year costs just 49 €.
              </p>
            </div>
            <span className={`text-lg font-bold shrink-0 ${daysRemaining <= 7 ? "text-red-600" : "text-amber-600"}`}>
              {daysRemaining}d
            </span>
          </div>
        </div>
      )}

      {/* Active service banner — the resting state expiration indicator
          (>30 days from expiry). Wording leads with "valid until"
          so the date is the focal point, not a vague
          "services are active" label. The expiry-warning + expired
          banners above take over once daysRemaining drops to ≤30. */}
      {isPaid && !isExpired && daysRemaining > 30 && (
        <div className="rounded-lg border bg-card px-4 py-2 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm text-muted-foreground">
            Website valid{expiryDateStr ? ` until ${expiryDateStr}` : ""}
          </span>
          <span className="text-sm font-medium text-emerald-600 tabular-nums">
            {daysRemaining} days left
          </span>
        </div>
      )}

      {/* Stats row removed: "balance" and "days left" had
          no context on the dashboard — clients can't read a number like
          "25 €" without knowing it's the credit pool for publishing
          changes. The expiration counter lives in the "active service"
          banner above (or the warning banners when close to expiry).
          Balance is reachable via the "Credits and payments" link at the
          bottom, where the full context lives. */}

      {/* Hero Edit CTA — shown to ALL clients (paid + unpaid). The primary
          action on the dashboard: get the client into the editor. The
          actual paywall lives at publish-time, not at editor access, so
          there's no value in pretending unpaid clients have a different
          editor experience than paid ones. Same copy for everyone. */}
      <Link
        href="/client/edit"
        className="group relative block rounded-xl border-2 border-primary/40 bg-linear-to-br from-primary/6 via-primary/4 to-transparent p-5 hover:border-primary/60 hover:shadow-md transition-all overflow-hidden"
      >
        <div className="flex items-center gap-5">
          <div className="rounded-xl bg-primary/15 p-3.5 shrink-0 group-hover:bg-primary/20 group-hover:scale-105 transition-all">
            <Pencil className="h-6 w-6 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-foreground mb-1">
              Edit your website
            </p>
            <p className="text-xs text-muted-foreground leading-snug">
              Click on any text or image directly on the page and customize
              it to match your vision.
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-primary shrink-0 group-hover:translate-x-1 transition-transform" />
        </div>
      </Link>

      {/* Secondary action cards. The "Edit website" tile that used
          to live here has been promoted to the hero CTA above (one entry
          point, no duplication). What's left:
            - Business email — clickable for unpaid, read-only for paid
            - My changes — legacy clients only
          Grid collapses to a single column on mobile and when there's
          only one card to show. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

        {/* My Changes — legacy-only. Modern composer-based clients publish
            edits directly, so there's no review queue to show. */}
        {isLegacy && (
          <Link
            href="/client/requests"
            className="group tile-interactive rounded-lg border bg-card p-5 hover:border-primary/50 hover:shadow-sm"
          >
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-muted p-2.5 shrink-0 group-hover:bg-muted/80 transition-colors">
                <ListChecks className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">My changes</p>
                  {(pendingCount ?? 0) > 0 && (
                    <span className="text-[10px] font-medium bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
                      {pendingCount}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
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
          <Link
            href="/client/domain"
            className="group tile-interactive rounded-lg border bg-card p-5 hover:border-primary/50 hover:shadow-sm"
          >
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-muted p-2.5 shrink-0 group-hover:bg-muted/80 transition-colors">
                <Mail className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Domain and business email</p>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
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
        <div className="rounded-lg border bg-card px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
            <a
              href={site.site_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline truncate"
            >
              {site.site_url.replace(/^https?:\/\//, "")}
            </a>
          </div>
          <a
            href={site.site_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 shrink-0"
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
      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
        <Link
          href="/client/messages"
          className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Need help?
        </Link>
        {isLegacy && (
          <>
            <span className="text-border">|</span>
            <Link
              href="/client/requests"
              className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
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
