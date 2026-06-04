import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import {
  AlertCircle,
  Receipt,
  Globe2,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

export const dynamic = "force-dynamic";

// Thresholds (in days) above which an item starts showing up in the
// "Needs your attention" list. Different SLAs for different work
// streams. Payments intentionally NOT tracked here per Peter — super
// admin doesn't want overdue payment confirmations on the overview.
const STALE_INVOICE_REQUEST_DAYS = 2;
const STALE_DOMAIN_REQUEST_DAYS = 2;
const ATTENTION_LIMIT = 8;

interface AttentionItem {
  key: string;
  category: "invoice" | "domain";
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
  const cutoffInvoice = new Date(
    now - STALE_INVOICE_REQUEST_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
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
    { count: invoiceRequestCount },
    // ── Needs your attention sources ───────────────────────────────
    // 1) Invoice requests still pending past the SLA.
    { data: staleInvoiceRequests },
    // 2) Domain requests (register_new / transfer) sitting longer
    //    than the SLA without a status flip to active.
    { data: staleDomainRequests },
    { data: confirmedPayments },
  ] = await Promise.all([
    admin.from("proposals").select("id", { count: "exact", head: true }).eq("status", "paid"),
    admin.rpc("proposals_build_queue_count"),
    admin.from("contacts").select("id", { count: "exact", head: true }).eq("status", "new"),
    admin.from("sites").select("id", { count: "exact", head: true }).in("domain_status", ["register_new", "transfer"]),
    admin.from("invoice_requests").select("id", { count: "exact", head: true }).eq("is_done", false),
    admin
      .from("invoice_requests")
      .select("id, company_name, created_at")
      .eq("is_done", false)
      .lt("created_at", cutoffInvoice)
      .order("created_at", { ascending: true })
      .limit(ATTENTION_LIMIT),
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
  for (const ir of staleInvoiceRequests ?? []) {
    const d = daysSince(ir.created_at);
    attentionItems.push({
      key: `invoice:${ir.id}`,
      category: "invoice",
      title: ir.company_name,
      description: `Invoice request ${d}d old`,
      days: d,
      href: "/super/invoice-requests",
      actionLabel: "fulfil",
    });
  }
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
  const invoiceItems = attentionItems
    .filter((i) => i.category === "invoice")
    .sort((a, b) => b.days - a.days)
    .slice(0, ATTENTION_LIMIT);
  const hasAttention = domainItems.length + invoiceItems.length > 0;

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
      value: (leadsLeft ?? 0).toLocaleString("sk-SK"),
      sublabel: "uncalled contacts",
      href: "/super/contacts",
    },
    {
      label: "Domain requests",
      value: String(pendingDomains ?? 0),
      sublabel: "to handle",
      href: "/super/domains",
    },
    {
      label: "Invoice requests",
      value: String(invoiceRequestCount ?? 0),
      sublabel: "pending",
      href: "/super/invoice-requests",
    },
  ];

  const categoryIcon = {
    invoice: Receipt,
    domain: Globe2,
  } as const;

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-semibold">Hello, {firstName}</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.label} href={card.href}>
            <div className="tile-interactive rounded-lg border bg-card p-6 hover:shadow-md hover:border-foreground/15 h-full">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                {card.label}
              </p>
              <p className="text-4xl font-bold mt-2 tabular-nums">{card.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{card.sublabel}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Needs your attention — grouped by category so the two work
          streams stay visually separate. Each sub-list sorted oldest-
          first. An empty sub-group is hidden entirely. */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Needs your attention
          </h2>
        </div>

        {!hasAttention ? (
          <div className="px-4 py-10 text-center">
            <CheckCircle2 className="h-7 w-7 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">
              All caught up — nothing overdue.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {domainItems.length > 0 && (
              <section>
                <div className="px-4 py-2 bg-muted/30 flex items-center justify-between">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Domain requests
                  </h3>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {domainItems.length}
                  </span>
                </div>
                <ul className="divide-y">
                  {domainItems.map((item) => {
                    const Icon = categoryIcon[item.category];
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors group"
                        >
                          <div className="rounded-md p-1.5 shrink-0 bg-muted">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">
                              {item.title}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {item.description}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground inline-flex items-center gap-1 shrink-0 group-hover:text-foreground transition-colors">
                            {item.actionLabel}
                            <ArrowRight className="h-3 w-3" />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {invoiceItems.length > 0 && (
              <section>
                <div className="px-4 py-2 bg-muted/30 flex items-center justify-between">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Invoice requests
                  </h3>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {invoiceItems.length}
                  </span>
                </div>
                <ul className="divide-y">
                  {invoiceItems.map((item) => {
                    const Icon = categoryIcon[item.category];
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors group"
                        >
                          <div className="rounded-md p-1.5 shrink-0 bg-muted">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">
                              {item.title}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {item.description}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground inline-flex items-center gap-1 shrink-0 group-hover:text-foreground transition-colors">
                            {item.actionLabel}
                            <ArrowRight className="h-3 w-3" />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
