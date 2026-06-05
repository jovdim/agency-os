"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { CheckCircle as CheckCircle2, X, Globe, Envelope as Mail } from "@phosphor-icons/react/ssr";
import type { UserRole } from "@/types/database";

/**
 * In-app notification banner mounted at the top of every dashboard
 * surface. Fetches the current user's undismissed staff_notifications
 * rows on mount and re-fetches when the tab regains focus (so a row
 * inserted while the user was on another tab shows up next time they
 * come back).
 *
 * The notifications themselves are written by the API endpoints that
 * complete a request — `PUT /api/sites/[id]/domain` when super flips
 * to active, `POST /api/proposals/[id]/send-business-email` when
 * tech provisions the mailbox. See migration 00072 for the table.
 *
 * All surfaces render in English; the `lang` switch is retained for
 * future localization but currently resolves to English everywhere.
 */

type NotificationKind = "domain_active" | "email_ready";

interface Notification {
  id: string;
  kind: NotificationKind | string;
  site_id: string | null;
  payload: {
    domain?: string;
    business_email?: string;
    site_name?: string;
  } | null;
  created_at: string;
}

const STRINGS = {
  en: {
    domainActive: (domain: string, site: string) =>
      `Domain ${domain} is now active for ${site}.`,
    emailReady: (email: string, site: string) =>
      `Business email ${email} is ready for ${site}.`,
    domainActiveFallback: (site: string) =>
      `Domain went active for ${site}.`,
    emailReadyFallback: (site: string) =>
      `Business email is ready for ${site}.`,
    open: "Open",
    dismiss: "Dismiss",
  },
  sk: {
    domainActive: (domain: string, site: string) =>
      `Domain ${domain} is now active for ${site}.`,
    emailReady: (email: string, site: string) =>
      `Business email ${email} is ready for ${site}.`,
    domainActiveFallback: (site: string) =>
      `Domain went active for ${site}.`,
    emailReadyFallback: (site: string) =>
      `Business email is ready for ${site}.`,
    open: "Open",
    dismiss: "Dismiss",
  },
} as const;

export function StaffNotificationBanner({ role }: { role: UserRole }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const lang: "en" | "sk" =
    role === "sales" || role === "client" ? "sk" : "en";
  const t = STRINGS[lang];

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", {
        cache: "no-store",
      });
      if (!res.ok) {
        // 401 (unauthed) is normal during sign-out; quietly bail.
        setNotifications([]);
        return;
      }
      const data = await res.json();
      setNotifications(data.notifications ?? []);
    } catch {
      // Network errors leave the banner silent — don't escalate a
      // notification-system hiccup into a visible page error.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchNotifications();
    // Re-fetch when the tab regains focus so a notification written
    // while the user was elsewhere appears without a full reload.
    const handler = () => {
      if (document.visibilityState === "visible") void fetchNotifications();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [fetchNotifications]);

  async function dismiss(id: string) {
    // Optimistic remove — UI feels instant, server call is best-effort.
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      await fetch(`/api/notifications/${id}/dismiss`, { method: "POST" });
    } catch {
      // Network blip leaves the row undismissed server-side — it'll
      // come back on next fetch. Acceptable trade for instant UX.
    }
  }

  // Hidden during initial fetch + when nothing to show. No skeleton —
  // the banner should appear silently when there's actual news.
  if (loading || notifications.length === 0) return null;

  function renderMessage(n: Notification): string {
    const site = n.payload?.site_name ?? "the client";
    if (n.kind === "domain_active") {
      const domain = n.payload?.domain;
      return domain
        ? t.domainActive(domain, site)
        : t.domainActiveFallback(site);
    }
    if (n.kind === "email_ready") {
      const email = n.payload?.business_email;
      return email
        ? t.emailReady(email, site)
        : t.emailReadyFallback(site);
    }
    return "";
  }

  /**
   * Where the "Open" button on a banner should route. Sales + super
   * land on their standalone live-clients detail page (no proposals
   * detail for those roles). Tech jumps into the unified proposal
   * page where the management cards render inline.
   */
  function openHref(n: Notification): string | null {
    if (!n.site_id) return null;
    // We don't have proposal_id on the notification payload, but the
    // site_id is enough to route — both detail pages accept either.
    // For simplicity, link to the role's live-clients listing instead;
    // the user clicks through from there. Avoids a server round-trip
    // to translate site_id → proposal_id in the banner.
    switch (role) {
      case "tech_admin":
        return "/tech/live-clients";
      case "super_admin":
        return "/super/live-clients";
      case "sales":
        return "/sales/live-clients";
      case "client":
        return "/client/domain";
      default:
        return null;
    }
  }

  return (
    <div className="space-y-2 mb-4">
      {notifications.map((n) => {
        const href = openHref(n);
        const Icon = n.kind === "email_ready" ? Mail : Globe;
        return (
          <div
            key={n.id}
            className="rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 px-4 py-3 flex items-center gap-3"
          >
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm text-emerald-900 dark:text-emerald-100">
                <Icon className="h-4 w-4 shrink-0 opacity-70" />
                <span className="break-words">{renderMessage(n)}</span>
              </div>
            </div>
            {href && (
              <Link
                href={href}
                className="text-xs font-medium text-emerald-700 dark:text-emerald-300 underline hover:no-underline shrink-0"
              >
                {t.open}
              </Link>
            )}
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100 shrink-0"
              aria-label={t.dismiss}
              title={t.dismiss}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
