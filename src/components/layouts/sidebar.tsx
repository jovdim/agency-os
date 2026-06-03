"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types/database";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LayoutDashboard,
  Globe,
  CreditCard,
  Users,
  Presentation,
  DollarSign,
  PhoneCall,
  ListChecks,
  Hammer,
  BarChart3,
  Building2,
  Shield,
  UserCog,
  Globe2,
  Receipt,
  Settings,
  Pencil,
  UserPlus,
  Rocket,
  ClipboardList,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  CheckCircle,
  Layers,
  Activity,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

/**
 * A group of nav items rendered together. When `label` is set and the
 * sidebar is expanded, a small uppercase header is rendered above the
 * group. When the sidebar is collapsed, the label is hidden and groups
 * are separated by a thin divider instead.
 *
 * A `NavGroup` with no `label` renders as ungrouped items at the top of
 * the sidebar (used for the always-visible "daily driver" links).
 */
interface NavGroup {
  label?: string;
  items: NavItem[];
}

const NAV_ITEMS: Record<UserRole, NavGroup[]> = {
  client: [
    {
      items: [
        {
          label: "Overview",
          href: "/client",
          icon: <LayoutDashboard className="h-4 w-4" />,
        },
        {
          label: "Edit website",
          href: "/client/edit",
          icon: <Pencil className="h-4 w-4" />,
        },
        {
          label: "My changes",
          href: "/client/requests",
          icon: <ListChecks className="h-4 w-4" />,
        },
        {
          label: "Balance",
          href: "/client/balance",
          icon: <CreditCard className="h-4 w-4" />,
        },
      ],
    },
  ],
  sales: [
    {
      items: [
        {
          label: "Calling",
          href: "/sales/volanie",
          icon: <PhoneCall className="h-4 w-4" />,
        },
        {
          label: "Dashboard",
          href: "/sales",
          icon: <LayoutDashboard className="h-4 w-4" />,
        },
        {
          label: "Active",
          href: "/sales/active",
          icon: <Activity className="h-4 w-4" />,
        },
        {
          // Paying-customer roster for the salesperson — their own
          // organic-paid clients + all migrated rows. Mirrors the tech
          // "Live Clients" entry but scoped to this salesperson.
          // Replaced the older "Clients" entry (retired 2026-05-20)
          // which only listed paid proposals — Live Clients is the
          // superset and adds migrated clients too, so the older view
          // was strictly redundant.
          label: "Live Clients",
          href: "/sales/live-clients",
          icon: <Users className="h-4 w-4" />,
        },
        {
          label: "Invoices",
          href: "/sales/faktury",
          icon: <Receipt className="h-4 w-4" />,
        },
        {
          label: "Commissions",
          href: "/sales/commissions",
          icon: <DollarSign className="h-4 w-4" />,
        },
        {
          label: "Settings",
          href: "/sales/settings",
          icon: <Settings className="h-4 w-4" />,
        },
      ],
    },
  ],
  tech_admin: [
    {
      items: [
        {
          label: "Dashboard",
          href: "/tech",
          icon: <LayoutDashboard className="h-4 w-4" />,
        },
        {
          label: "Proposals",
          href: "/tech/proposals",
          icon: <Hammer className="h-4 w-4" />,
        },
        {
          label: "Published Websites",
          href: "/tech/production",
          icon: <Rocket className="h-4 w-4" />,
        },
        {
          // Paying-customer roster (the "Paid" lane lifted out of
          // Published Websites). Sits next to Published Websites so
          // the two lanes are adjacent: deployed-but-unpaid above,
          // paying-customers here. Detail page lives back under
          // /tech/proposals/[id] where the management cards render
          // inline below the timeline.
          label: "Live Clients",
          href: "/tech/live-clients",
          icon: <CheckCircle className="h-4 w-4" />,
        },
        {
          label: "Clients (legacy)",
          href: "/tech/clients",
          icon: <UserPlus className="h-4 w-4" />,
        },
        {
          label: "Section Templates",
          href: "/tech/section-templates",
          icon: <Layers className="h-4 w-4" />,
        },
        {
          // Settings shell — wraps a settings sub-sidebar listing all the
          // tech-side configuration categories. Today only "AI" lives in
          // there (composer copywriting rules + provider config). Going
          // through the parent route lets future categories slot in
          // without further changes to this main sidebar.
          label: "Settings",
          href: "/tech/settings",
          icon: <Settings className="h-4 w-4" />,
        },
      ],
    },
  ],
  administrator: [
    {
      items: [
        {
          label: "Overview",
          href: "/admin",
          icon: <LayoutDashboard className="h-4 w-4" />,
        },
      ],
    },
  ],
  // Super admin has the most entries (13 items), so we break them into
  // labeled groups to make scanning faster. Order of groups goes from
  // "what I check daily" (top, unlabeled) down to "rarely touched"
  // (System at the bottom).
  super_admin: [
    {
      items: [
        { label: "Overview", href: "/super", icon: <Shield className="h-4 w-4" /> },
        { label: "Proposals", href: "/tech/proposals", icon: <ClipboardList className="h-4 w-4" /> },
      ],
    },
    {
      label: "Operations",
      items: [
        {
          label: "Domains",
          href: "/super/domains",
          icon: <Globe2 className="h-4 w-4" />,
        },
        {
          label: "Invoice Requests",
          href: "/super/invoice-requests",
          icon: <Receipt className="h-4 w-4" />,
        },
        {
          label: "Payments",
          href: "/super/payments",
          icon: <Receipt className="h-4 w-4" />,
        },
      ],
    },
    {
      label: "People",
      items: [
        {
          label: "Salespeople",
          href: "/super/sales-overview",
          icon: <BarChart3 className="h-4 w-4" />,
        },
        {
          label: "IT Team",
          href: "/super/it-overview",
          icon: <Hammer className="h-4 w-4" />,
        },
        {
          label: "Staff",
          href: "/super/users",
          icon: <UserCog className="h-4 w-4" />,
        },
      ],
    },
    {
      label: "Published Websites",
      items: [
        {
          label: "Published Websites",
          href: "/super/production",
          icon: <Rocket className="h-4 w-4" />,
        },
      ],
    },
    {
      label: "Database",
      items: [
        {
          label: "Broad Database",
          href: "/super/contacts",
          icon: <Building2 className="h-4 w-4" />,
        },
        {
          label: "Live Clients",
          href: "/super/live-clients",
          icon: <CheckCircle className="h-4 w-4" />,
        },
      ],
    },
    {
      label: "System",
      items: [
        {
          label: "Section Templates",
          href: "/tech/section-templates",
          icon: <Layers className="h-4 w-4" />,
        },
        {
          label: "Settings",
          href: "/super/settings",
          icon: <Settings className="h-4 w-4" />,
        },
      ],
    },
  ],
};

/**
 * Footer-pinned nav items — rendered below the main list with a divider
 * above. Use for low-frequency support entries that shouldn't compete for
 * attention with primary navigation. Currently only the client role has
 * one: "Need help? Write to us" sits at the bottom so the day-to-day
 * actions (edit, balance) stay near the top.
 */
const NAV_FOOTER_ITEMS: Partial<Record<UserRole, NavItem[]>> = {
  client: [
    {
      label: "Need help?",
      href: "/client/messages",
      icon: <MessageSquare className="h-4 w-4" />,
    },
  ],
};

const SIDEBAR_LS_KEY = "sk_sidebar_collapsed";

export function Sidebar({
  role,
  hasLegacySite = false,
  salesNewCount = 0,
}: {
  role: UserRole;
  hasLegacySite?: boolean;
  /** Unread NEW-proposal count for the sales role. Rendered as a small
   *  pill on the "Active" entry when > 0. Hidden when 0 so the sidebar
   *  stays clean once the rep has caught up. */
  salesNewCount?: number;
}) {
  const pathname = usePathname();
  // Filter the change-requests entry out for fully-modern clients
  // (those with no legacy sites). Composer-based sites publish edits
  // directly so "My changes" has nothing to show.
  const groups = (NAV_ITEMS[role] || [])
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (
          role === "client" &&
          item.href === "/client/requests" &&
          !hasLegacySite
        ) {
          return false;
        }
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);

  const footerItems = NAV_FOOTER_ITEMS[role] ?? [];

  // Find the active item using "longest matching prefix wins". An item is a
  // match when the pathname equals its href OR starts with `${href}/` (so
  // a sub-route activates its parent). The longest match wins, which
  // automatically picks the most specific route — e.g. on /sales/live-clients,
  // both /sales and /sales/live-clients match, but the longer one (Live
  // Clients) is chosen. This also folds in the old /client dashboard /sites
  // case: /client/sites/[id] starts with /client/, and since no item matches
  // a longer prefix, /client (Dashboard) stays active.
  const allItems = [
    ...groups.flatMap((g) => g.items),
    ...footerItems,
  ];
  let activeItemHref = "";
  for (const item of allItems) {
    const matches =
      pathname === item.href || pathname.startsWith(item.href + "/");
    if (matches && item.href.length > activeItemHref.length) {
      activeItemHref = item.href;
    }
  }

  // Initial state always false (matches server render to avoid hydration
  // mismatch). We hydrate from localStorage in an effect on mount, and only
  // start writing back AFTER hydration so we never overwrite a saved value
  // with the default during the first render.
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_LS_KEY);
      if (stored !== null) setCollapsed(stored === "1");
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(SIDEBAR_LS_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed, hydrated]);

  // ── Active-item pill ───────────────────────────────────────────────
  // A single absolutely-positioned <div> sits behind the nav links and
  // slides between active items when the route changes. Measure on
  // pathname + collapse changes (collapse changes item heights too).
  // Using offsetTop/offsetHeight against the nav as offsetParent keeps
  // the math correct through scroll & group-div nesting.
  const navRef = useRef<HTMLElement | null>(null);
  const [pillStyle, setPillStyle] = useState<
    { top: number; height: number; visible: boolean }
  >({ top: 0, height: 0, visible: false });

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) {
      setPillStyle((s) => ({ ...s, visible: false }));
      return;
    }
    setPillStyle({
      top: active.offsetTop,
      height: active.offsetHeight,
      visible: true,
    });
  }, [pathname, collapsed, role, hasLegacySite]);

  return (
    <TooltipProvider delayDuration={0}>
      <aside className={cn(
        "flex h-full flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200",
        collapsed ? "w-14" : "w-56"
      )}>
        {/* Logo + collapse toggle */}
        <div className="flex h-14 items-center border-b px-3 justify-between">
          {!collapsed && (
            <Link href="/" className="flex items-center">
              <span className="text-base font-bold tracking-tight">Your Logo</span>
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>

        {/* Nav items, organized into labeled groups. The first group is
            typically unlabeled (daily-driver links) and subsequent groups
            get small uppercase headers when expanded, or a thin divider
            when collapsed. The relative wrapper anchors the sliding pill. */}
        <nav ref={navRef} className="flex-1 overflow-y-auto p-2 relative">
          {/* Sliding active-item pill — measured in useLayoutEffect, slides
              between rows when the route changes. Sits behind link content
              because it comes first in DOM order (both pill + items are
              positioned with auto z-index → DOM order wins). */}
          <div
            aria-hidden="true"
            className="absolute left-2 right-2 rounded-md bg-sidebar-accent transition-[top,height] duration-300 ease-out pointer-events-none"
            style={{
              top: pillStyle.top,
              height: pillStyle.height,
              opacity: pillStyle.visible ? 1 : 0,
            }}
          />
          {groups.map((group, gi) => (
            <div
              key={group.label ?? `group-${gi}`}
              className={cn("space-y-1", gi > 0 && "mt-4")}
            >
              {group.label && !collapsed && (
                <h3 className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                  {group.label}
                </h3>
              )}
              {group.label && collapsed && (
                <div
                  className="mx-2 mb-1 border-t border-sidebar-foreground/10"
                  aria-hidden="true"
                />
              )}
              {group.items.map((item) =>
                renderNavLink(
                  item,
                  activeItemHref,
                  collapsed,
                  // Wire the unread count only onto the sales "Active" entry.
                  // Other nav links pass undefined and render with no badge.
                  item.href === "/sales/active" ? salesNewCount : undefined,
                ),
              )}
            </div>
          ))}
        </nav>

        {/* Footer-pinned nav (e.g. "Need help?" for clients). Rendered
            below the main list with a divider so it reads as secondary
            without disappearing. Skipped entirely when the role has no
            footer entries. */}
        {footerItems.length > 0 && (
          <div className="border-t p-2 space-y-1">
            {footerItems.map((item) =>
              renderNavLink(item, activeItemHref, collapsed),
            )}
          </div>
        )}
      </aside>
    </TooltipProvider>
  );
}

/**
 * Render one sidebar link with the right active state + tooltip wrapper
 * when collapsed. Extracted so the main nav and the footer nav share the
 * same look without duplicating the JSX.
 *
 * `activeItemHref` is the href of the single item that should be active
 * (resolved in the parent via longest-matching-prefix). Each link does
 * a simple equality check against it — no per-link pathname logic here.
 *
 * `badge` is an optional unread count. When present (> 0) it renders as a
 * purple pill next to the label when expanded, or a small purple dot in
 * the top-right of the icon when collapsed. Pass undefined to skip
 * entirely. Currently only the sales "Active" entry uses it.
 */
function renderNavLink(
  item: NavItem,
  activeItemHref: string,
  collapsed: boolean,
  badge?: number,
) {
  const isActive = item.href === activeItemHref;

  const hasBadge = typeof badge === "number" && badge > 0;

  const link = (
    <Link
      key={item.href}
      href={item.href}
      data-active={isActive ? "true" : undefined}
      className={cn(
        // `relative` keeps the link painted ABOVE the absolutely-positioned
        // pill (same z-index tier, later in DOM order → wins).
        "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        collapsed && "justify-center px-0",
        isActive
          // Active: text gets the accent foreground. Background is provided
          // by the sliding pill in the parent <nav>, not the link itself.
          ? "text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
      )}
    >
      {item.icon}
      {!collapsed && (
        <span className="flex-1 flex items-center justify-between gap-2 min-w-0">
          <span className="truncate">{item.label}</span>
          {hasBadge && (
            <span className="inline-flex items-center justify-center rounded-full bg-purple-600 px-1.5 min-w-4.5 h-4.5 text-[10px] font-semibold text-white tabular-nums">
              {badge! > 99 ? "99+" : badge}
            </span>
          )}
        </span>
      )}
      {/* Collapsed-state dot: small purple circle hugging the icon's top-right
          so the rep knows "something's new" even when the sidebar is folded. */}
      {collapsed && hasBadge && (
        <span
          className="absolute top-1 right-1 h-2 w-2 rounded-full bg-purple-600 ring-2 ring-sidebar"
          aria-label={`${badge} new`}
        />
      )}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip key={item.href}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">
          {item.label}
          {hasBadge && ` · ${badge}`}
        </TooltipContent>
      </Tooltip>
    );
  }

  return link;
}
