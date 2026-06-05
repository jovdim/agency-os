import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingBag,
  Globe,
  Calendar,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ClientServicesPage() {
  await requireRole("client");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch services for all sites owned by this client
  const { data: sites } = await supabase
    .from("sites")
    .select("id, name, slug, status")
    .eq("owner_id", user!.id);

  const siteIds = (sites || []).map((s) => s.id);

  let services: Array<{
    id: string;
    site_id: string;
    type: string;
    name: string;
    starts_at: string | null;
    expires_at: string | null;
    is_active: boolean;
    price: number | null;
  }> = [];

  if (siteIds.length > 0) {
    const { data } = await supabase
      .from("services")
      .select("*")
      .in("site_id", siteIds)
      .order("expires_at", { ascending: true });
    services = data || [];
  }

  const now = new Date();

  const activeServices = services.filter((s) => s.is_active);
  const expiringSoon = activeServices.filter((s) => {
    if (!s.expires_at) return false;
    const daysLeft = Math.ceil(
      (new Date(s.expires_at).getTime() - now.getTime()) / 86400000,
    );
    return daysLeft > 0 && daysLeft <= 30;
  });
  const expired = services.filter((s) => {
    if (!s.expires_at) return false;
    return new Date(s.expires_at) < now;
  });

  function daysUntil(dateStr: string | null): string {
    if (!dateStr) return "No expiry";
    const days = Math.ceil(
      (new Date(dateStr).getTime() - now.getTime()) / 86400000,
    );
    if (days < 0) return `Expired ${Math.abs(days)}d ago`;
    if (days === 0) return "Expires today";
    if (days === 1) return "Expires tomorrow";
    return `${days} days left`;
  }

  // Stat tiles. Pink (good news) marks active/paying services; violet stays
  // operational. Expired numbers borrow the destructive tone for urgency.
  const stats: Array<{
    label: string;
    value: number;
    sublabel?: string;
    icon: typeof CheckCircle;
    chip: string;
    valueClass?: string;
  }> = [
    {
      label: "Active Services",
      value: activeServices.length,
      icon: CheckCircle,
      chip: "dash-chip-pink",
    },
    {
      label: "Expiring Soon",
      value: expiringSoon.length,
      sublabel: "within 30 days",
      icon: AlertTriangle,
      chip: "dash-chip",
    },
    {
      label: "Expired",
      value: expired.length,
      icon: AlertTriangle,
      chip: "dash-chip",
      valueClass: expired.length > 0 ? "text-destructive" : undefined,
    },
  ];

  return (
    <div className="dash-root max-w-5xl space-y-8">
      {/* ── Page header — clean title + subtitle with a violet icon chip. No
          gradient needed on this overview page. ── */}
      <div className="flex items-center gap-3">
        <span className="dash-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
          <ShoppingBag className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Your subscriptions
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Services</h1>
          <p className="text-sm text-muted-foreground">
            Hosting, domains and add-ons across all of your sites.
          </p>
        </div>
      </div>

      {/* ── Summary stat tiles ── */}
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="dash-card p-5">
              <div className="flex items-center justify-between">
                <span
                  className={`${stat.chip} inline-flex h-9 w-9 items-center justify-center rounded-lg`}
                >
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <p
                className={`mt-4 text-3xl font-bold tabular-nums ${stat.valueClass ?? ""}`}
              >
                {stat.value}
              </p>
              <p className="mt-1 text-sm font-medium">{stat.label}</p>
              {stat.sublabel && (
                <p className="text-xs text-muted-foreground">{stat.sublabel}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Services by site ── */}
      {(sites || []).length === 0 ? (
        <div className="dash-panel flex flex-col items-center justify-center px-4 py-16 text-center">
          <span className="dash-chip mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full">
            <ShoppingBag className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium">No sites yet</p>
          <p className="mt-0.5 max-w-sm text-xs text-muted-foreground">
            Services will appear here once you have an active site.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {(sites || []).map((site) => {
            const siteServices = services.filter((s) => s.site_id === site.id);
            return (
              <div key={site.id} className="dash-panel overflow-hidden">
                {/* Site header row */}
                <div className="dash-hairline flex items-center gap-3 border-b px-5 py-3.5">
                  <span className="dash-chip inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                    <Globe className="h-4 w-4" />
                  </span>
                  <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {site.name}
                  </h2>
                  <Badge variant="outline" className="text-xs capitalize">
                    {site.status}
                  </Badge>
                </div>

                {siteServices.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">
                    No services for this site yet.
                  </p>
                ) : (
                  <ul className="dash-hairline divide-y">
                    {siteServices.map((service) => {
                      const isExpired =
                        service.expires_at &&
                        new Date(service.expires_at) < now;
                      const isExpiringSoon =
                        service.expires_at &&
                        !isExpired &&
                        Math.ceil(
                          (new Date(service.expires_at).getTime() -
                            now.getTime()) /
                            86400000,
                        ) <= 30;

                      return (
                        <li
                          key={service.id}
                          className="flex items-center gap-3 px-5 py-3.5"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">
                              {service.name}
                            </p>
                            <div className="mt-1 flex items-center gap-2">
                              <Badge variant="secondary" className="text-xs">
                                {service.type}
                              </Badge>
                              {service.price && (
                                <span className="text-xs tabular-nums text-muted-foreground">
                                  ${Number(service.price).toFixed(2)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="ml-4 flex items-center gap-3">
                            <div className="text-right">
                              <div className="flex items-center justify-end gap-1 text-xs">
                                <Calendar className="h-3 w-3 text-muted-foreground" />
                                <span
                                  className={
                                    isExpired
                                      ? "font-medium text-destructive"
                                      : isExpiringSoon
                                        ? "font-medium text-amber-600 dark:text-amber-400"
                                        : "text-muted-foreground"
                                  }
                                >
                                  {daysUntil(service.expires_at)}
                                </span>
                              </div>
                              {service.expires_at && (
                                <p className="text-xs tabular-nums text-muted-foreground">
                                  {new Date(
                                    service.expires_at,
                                  ).toLocaleDateString("en-GB")}
                                </p>
                              )}
                            </div>
                            <Badge
                              variant={
                                service.is_active && !isExpired
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {isExpired
                                ? "Expired"
                                : service.is_active
                                  ? "Active"
                                  : "Inactive"}
                            </Badge>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
