import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import {
  AlertCircle,
  Globe2,
  ArrowRight,
  CheckCircle2,
  TrendingUp,
  Users,
  Layers,
  PhoneCall,
  Inbox,
} from "lucide-react";

export const dynamic = "force-dynamic";

// Thresholds (in days) above which an item starts showing up in the
// "Needs your attention" list.
const STALE_DOMAIN_REQUEST_DAYS = 2;
const ATTENTION_LIMIT = 8;

interface AttentionItem {
  key: string;
  category: "domain";
  title: string;
  description: string;
  days: number;
  href: string;
  actionLabel: string;
}

function daysSince(iso: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

export default async function SuperAdminDashboard() {
  const { profile } = await requireRole("super_admin");
  const admin = createAdminClient();

  const firstName = profile.full_name?.trim().split(/\s+/)[0] || "there";

  // Cutoff timestamps for the "needs attention" queries — computed
  // once here so all queries see the same instant.
  const now = Date.now();
  const cutoffDomain = new Date(
    now - STALE_DOMAIN_REQUEST_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [
    { count: liveClientCount },
    // "Pending" here means the exact same thing the IT build queue
    // shows on /tech/proposals — proposals with no published site and
    // no live deployment. We route through the proposals_build_queue_count
    // RPC (migration 00069) so the two surfaces stay in lockstep: if
    // the queue logic ever changes, both numbers update together.
    { data: buildQueueCountRaw },
    { count: leadsLeft },
    { count: pendingDomains },
    // ── Needs your attention sources ───────────────────────────────
    // Domain requests (register_new / transfer) sitting longer than the
    // SLA without a status flip to active.
    { data: staleDomainRequests },
    { data: confirmedPayments },
  ] = await Promise.all([
    admin.from("proposals").select("id", { count: "exact", head: true }).eq("status", "paid"),
    admin.rpc("proposals_build_queue_count"),
    admin.from("contacts").select("id", { count: "exact", head: true }).eq("status", "new"),
    admin.from("sites").select("id", { count: "exact", head: true }).in("domain_status", ["register_new", "transfer"]),
    admin
      .from("sites")
      .select("id, name, requested_domain, domain_status, updated_at")
      .in("domain_status", ["register_new", "transfer"])
      .lt("updated_at", cutoffDomain)
      .order("updated_at", { ascending: true })
      .limit(ATTENTION_LIMIT),
    admin.from("payments").select("amount").eq("status", "confirmed"),
  ]);

  const pendingProposals = Number(buildQueueCountRaw ?? 0);

  // Total Sales = total revenue: sum of all confirmed payment amounts.
  const totalSalesAmount = (confirmedPayments ?? []).reduce(
    (sum, p) => sum + (Number(p.amount) || 0),
    0,
  );
  const totalSalesLabel = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(totalSalesAmount);

  // Build a single, type-tagged attention list. Each item knows its
  // own age + where the operator should go to resolve it.
  const attentionItems: AttentionItem[] = [];
  for (const s of staleDomainRequests ?? []) {
    const d = daysSince(s.updated_at);
    const label =
      s.domain_status === "transfer" ? "Domain transfer" : "Domain registration";
    attentionItems.push({
      key: `domain:${s.id}`,
      category: "domain",
      title: s.requested_domain || s.name,
      description: `${label} waiting ${d}d`,
      days: d,
      href: "/super/domains",
      actionLabel: "review",
    });
  }
  // Split into separate lists per category so the UI groups them.
  // Each list sorted oldest-first within itself.
  const domainItems = attentionItems
    .filter((i) => i.category === "domain")
    .sort((a, b) => b.days - a.days)
    .slice(0, ATTENTION_LIMIT);
  const hasAttention = domainItems.length > 0;

  const cards: Array<{
    label: string;
    value: string;
    sublabel: string;
    href: string;
  }> = [
    {
      label: "Total Sales",
      value: totalSalesLabel,
      sublabel: "revenue from paid clients",
      href: "/super/payments",
    },
    {
      label: "Live clients",
      value: String(liveClientCount ?? 0),
      sublabel: "paying customers",
      href: "/super/live-clients",
    },
    {
      label: "Pending proposals",
      value: String(pendingProposals),
      sublabel: "in build queue",
      href: "/tech/proposals",
    },
    {
      label: "Leads left",
      value: (leadsLeft ?? 0).toLocaleString("en-US"),
      sublabel: "uncalled contacts",
      href: "/super/contacts",
    },
    {
      label: "Domain requests",
      value: String(pendingDomains ?? 0),
      sublabel: "to handle",
      href: "/super/domains",
    },
  ];

  const categoryIcon = {
    domain: Globe2,
  } as const;

  // One icon per secondary stat — small, single-tone accents (never a
  // gradient on the icon itself) for quiet visual rhythm.
  const statIcon: Record<string, typeof Globe2> = {
    "Live clients": Users,
    "Pending proposals": Layers,
    "Leads left": PhoneCall,
    "Domain requests": Globe2,
  };

  // Two brand accents used as flat single-tone tints (never blended into a
  // violet→pink rainbow): pink marks the positive "good news" metrics, violet
  // the operational ones.
  const statChip: Record<string, string> = {
    "Live clients": "dash-chip-pink",
    "Pending proposals": "dash-chip",
    "Leads left": "dash-chip",
    "Domain requests": "dash-chip",
  };

  // Total Sales is the focal metric — it lives in the hero band; the rest
  // sit in the stat grid below.
  const heroCard = cards[0];
  const secondaryCards = cards.slice(1);

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Hero band — the page's single gradient surface. Greeting on the left,
          the focal Total Sales metric in a frosted inset on the right. The only
          gradient and the only pink hero chip live here. */}
      <section className="dash-hero relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Command center
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Hello, {firstName}</h1>
          <p className="text-sm text-muted-foreground">
            Here&apos;s the state of the business and what needs you today.
          </p>
        </div>

        <Link href={heroCard.href} className="group w-full shrink-0 sm:w-auto">
          <div className="dash-hero-metric flex items-center gap-4 px-5 py-4">
            <span className="dash-chip-pink inline-flex h-12 w-12 items-center justify-center rounded-xl">
              <TrendingUp className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {heroCard.label}
              </p>
              <p className="text-3xl font-bold leading-tight tabular-nums">
                {heroCard.value}
              </p>
              <p className="text-xs text-muted-foreground">{heroCard.sublabel}</p>
            </div>
            <ArrowRight className="dash-accent ml-2 hidden h-4 w-4 shrink-0 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 sm:block" />
          </div>
        </Link>
      </section>

      {/* Command-center body: operational stat grid (left) sits beside the
          promoted "Needs your attention" feed (right) so state + to-dos read
          together without scrolling. Balanced 1/1 split on desktop; stacks to a
          single column below lg with the action feed beneath the stats. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left — operational stat grid (2-up). Quiet violet chips; the only
            pink lives on Live clients via the statChip map. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {secondaryCards.map((card) => {
            const Icon = statIcon[card.label] ?? Globe2;
            return (
              <Link
                key={card.label}
                href={card.href}
                className="dash-card group block p-5"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`${statChip[card.label] ?? "dash-chip"} inline-flex h-9 w-9 items-center justify-center rounded-lg`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <ArrowRight className="dash-accent h-4 w-4 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                </div>
                <p className="mt-4 text-3xl font-bold tabular-nums">{card.value}</p>
                <p className="mt-1 text-sm font-medium">{card.label}</p>
                <p className="text-xs text-muted-foreground">{card.sublabel}</p>
              </Link>
            );
          })}
        </div>

        {/* Right rail — "Needs your attention" promoted to a co-equal feed. The
            header carries a live count badge for instant triage when there's
            work, or a calm "All clear" indicator when the queue is empty. */}
        <aside className="dash-panel flex flex-col overflow-hidden">
          <div className="dash-hairline flex items-center justify-between gap-2 border-b px-5 py-3.5">
            <div className="flex items-center gap-2">
              <AlertCircle className="dash-accent h-4 w-4" />
              <h2 className="text-xs font-semibold uppercase tracking-wider">
                Needs your attention
              </h2>
            </div>
            {hasAttention ? (
              <span className="dash-chip inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums">
                {domainItems.length}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <CheckCircle2 className="dash-accent h-3.5 w-3.5" />
                All clear
              </span>
            )}
          </div>

          {!hasAttention ? (
            <div className="flex flex-1 flex-col items-center justify-center px-4 py-14 text-center">
              <span className="dash-chip mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium">All caught up</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Nothing overdue right now.
              </p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col">
              {domainItems.length > 0 && (
                <section className="flex flex-1 flex-col">
                  <div className="dash-subhead flex items-center gap-2 px-5 py-2.5">
                    <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Domain requests
                    </h3>
                  </div>
                  <ul className="dash-hairline flex-1 divide-y">
                    {domainItems.map((item) => {
                      const Icon = categoryIcon[item.category];
                      return (
                        <li key={item.key}>
                          <Link
                            href={item.href}
                            className="dash-row group flex items-center gap-3 px-5 py-3.5"
                          >
                            <span className="dash-chip inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                              <Icon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold">
                                {item.title}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {item.description}
                              </p>
                            </div>
                            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-(--dash-accent)">
                              {item.actionLabel}
                              <ArrowRight className="h-3 w-3" />
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                  <Link
                    href="/super/domains"
                    className="dash-row dash-hairline group flex items-center justify-center gap-1.5 border-t px-5 py-3 text-xs font-semibold"
                  >
                    <span className="dash-accent">Open domain requests</span>
                    <ArrowRight className="dash-accent h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </section>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
