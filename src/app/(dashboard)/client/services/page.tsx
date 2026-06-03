import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  const siteMap = Object.fromEntries((sites || []).map((s) => [s.id, s]));
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Services</h1>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Active Services
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeServices.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {expiringSoon.length}
            </div>
            <p className="text-xs text-muted-foreground">within 30 days</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Expired</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {expired.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Services by site */}
      {(sites || []).length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <ShoppingBag className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">
              No sites found. Services will appear here once you have an active
              site.
            </p>
          </CardContent>
        </Card>
      ) : (
        (sites || []).map((site) => {
          const siteServices = services.filter((s) => s.site_id === site.id);
          return (
            <Card key={site.id}>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  {site.name}
                  <Badge variant="outline" className="text-xs capitalize">
                    {site.status}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {siteServices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No services for this site yet.
                  </p>
                ) : (
                  <div className="space-y-3">
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
                        <div
                          key={service.id}
                          className="flex items-center justify-between rounded-lg border px-4 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">
                              {service.name}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="secondary" className="text-xs">
                                {service.type}
                              </Badge>
                              {service.price && (
                                <span className="text-xs text-muted-foreground">
                                  €{Number(service.price).toFixed(2)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 ml-4">
                            <div className="text-right">
                              <div className="flex items-center gap-1 text-xs">
                                <Calendar className="h-3 w-3 text-muted-foreground" />
                                <span
                                  className={
                                    isExpired
                                      ? "text-destructive font-medium"
                                      : isExpiringSoon
                                        ? "text-yellow-600 font-medium"
                                        : "text-muted-foreground"
                                  }
                                >
                                  {daysUntil(service.expires_at)}
                                </span>
                              </div>
                              {service.expires_at && (
                                <p className="text-xs text-muted-foreground">
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
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
