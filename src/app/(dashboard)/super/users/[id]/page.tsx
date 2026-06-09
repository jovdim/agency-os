import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, User, Buildings as Building2, Envelope as Mail, Phone, GlobeHemisphereWest as Globe2, ArrowSquareOut as ExternalLink, CalendarBlank as Calendar, CreditCard, FileText, Coins, Clock, CheckCircle, XCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("super_admin");
  const { id } = await params;
  const admin = createAdminClient();

  // ── Wave 1: six parallel lookups, all only need the URL id ──
  // Previously profile + authUser ran sequentially before a Promise.all,
  // and the change_requests query had a nested `await admin.from("sites")
  // .select("id")` that re-ran the SAME sites query that was already in
  // the Promise.all — defeating parallelization AND doing duplicate work.
  // Here change_requests is moved to Wave 2 so it can use the sites
  // result without the nested await.
  const [
    { data: profile },
    { data: authUser },
    { data: sites },
    { data: contact },
    { data: payments },
    { data: invoices },
  ] = await Promise.all([
    admin.from("profiles").select("*").eq("id", id).single(),
    admin.auth.admin.getUserById(id),
    admin
      .from("sites")
      .select("id, name, slug, site_url, domain, status, domain_status, requested_domain, domain_notes, created_at, codebase_link")
      .eq("owner_id", id)
      .order("created_at", { ascending: false }),
    admin
      .from("contacts")
      .select("id, company_name, contact_person, phone, email, industry, town, location, website_url, notes, status")
      .eq("client_user_id", id)
      .maybeSingle(),
    admin
      .from("payments")
      .select("id, amount, currency, status, description, payment_method, created_at")
      .eq("profile_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    admin
      .from("invoices")
      .select("id, invoice_number, type, amount, vat_amount, issued_at, paid_at")
      .eq("profile_id", id)
      .order("issued_at", { ascending: false })
      .limit(10),
  ]);

  if (!profile) redirect("/super/users");
  const email = authUser?.user?.email || null;
  const siteIds = (sites || []).map(s => s.id);

  // ── Wave 2: two parallel lookups, all scoped by siteIds ──
  const [
    { data: creditBalances },
    { data: deployments },
  ] = siteIds.length > 0
    ? await Promise.all([
        admin.from("credit_balances").select("site_id, balance").in("site_id", siteIds),
        admin.from("deployments").select("id, subdomain, deploy_status, deployed_at, site_id").in("site_id", siteIds),
      ])
    : [
        { data: [] as { site_id: string; balance: number }[] },
        { data: [] as { id: string; subdomain: string; deploy_status: string; deployed_at: string | null; site_id: string }[] },
      ];

  const creditMap = new Map<string, number>();
  for (const cb of creditBalances || []) {
    creditMap.set(cb.site_id, cb.balance);
  }

  const deploymentMap = new Map<string, { subdomain: string; deploy_status: string; deployed_at: string | null }>();
  for (const d of deployments || []) {
    if (d.site_id) deploymentMap.set(d.site_id, d);
  }

  const allPayments = payments || [];
  const allInvoices = invoices || [];
  const allSites = sites || [];

  const totalPaid = allPayments
    .filter(p => p.status === "confirmed")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const domainStatusLabels: Record<string, { label: string; className: string }> = {
    none: { label: "Not configured", className: "bg-muted text-muted-foreground" },
    register_new: { label: "Pending registration", className: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
    transfer: { label: "Pending transfer", className: "bg-purple-500/15 text-purple-600 border-purple-500/30" },
    decided_later: { label: "Deferred", className: "bg-muted text-muted-foreground" },
    active: { label: "Active", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
    rejected: { label: "Rejected", className: "bg-red-500/15 text-red-600 border-red-500/30" },
  };

  const paymentStatusIcon = (status: string) => {
    if (status === "confirmed") return <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />;
    if (status === "failed" || status === "cancelled") return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    return <Clock className="h-3.5 w-3.5 text-yellow-500" />;
  };

  return (
    <div className="dash-root space-y-8 max-w-5xl">
      {/* Back link */}
      <Button variant="ghost" size="sm" asChild className="-ml-2 h-8 text-muted-foreground">
        <Link href="/super/users">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to users
        </Link>
      </Button>

      {/* Page header — avatar chip + identity + status, on a soft panel */}
      <div className="dash-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-center gap-4">
          <span className="dash-chip inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
            <User className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {profile.role === "client" ? "Client" : profile.role}
            </p>
            <h1 className="truncate text-2xl font-bold tracking-tight">{profile.full_name || "Unknown"}</h1>
            <p className="text-sm text-muted-foreground">
              {profile.company_name && `${profile.company_name} · `}
              Joined {formatDistanceToNow(new Date(profile.created_at), { addSuffix: true })}
            </p>
          </div>
        </div>
        <Badge variant={profile.is_active ? "default" : "destructive"} className="self-start text-xs sm:self-auto">
          {profile.is_active ? "Active" : "Inactive"}
        </Badge>
      </div>

      {/* Financial summary — quiet stat tiles. Pink marks the positive "paid" total. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="dash-card p-5">
          <span className="dash-chip-pink inline-flex h-9 w-9 items-center justify-center rounded-lg">
            <Coins className="h-4 w-4" />
          </span>
          <p className="mt-4 text-2xl font-bold tabular-nums">${totalPaid.toFixed(2)}</p>
          <p className="mt-1 text-sm font-medium">Total paid</p>
        </div>
        <div className="dash-card p-5">
          <span className="dash-chip inline-flex h-9 w-9 items-center justify-center rounded-lg">
            <Globe2 className="h-4 w-4" />
          </span>
          <p className="mt-4 text-2xl font-bold tabular-nums">{allSites.length}</p>
          <p className="mt-1 text-sm font-medium">Sites</p>
        </div>
        <div className="dash-card p-5">
          <span className="dash-chip inline-flex h-9 w-9 items-center justify-center rounded-lg">
            <CreditCard className="h-4 w-4" />
          </span>
          <p className="mt-4 text-2xl font-bold tabular-nums">{allPayments.length}</p>
          <p className="mt-1 text-sm font-medium">Payments</p>
        </div>
        <div className="dash-card p-5">
          <span className="dash-chip inline-flex h-9 w-9 items-center justify-center rounded-lg">
            <FileText className="h-4 w-4" />
          </span>
          <p className="mt-4 text-2xl font-bold tabular-nums">{allInvoices.length}</p>
          <p className="mt-1 text-sm font-medium">Invoices</p>
        </div>
      </div>

      {/* Contact info + linked contact */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <span className="dash-chip inline-flex h-7 w-7 items-center justify-center rounded-md">
                <User className="h-3.5 w-3.5" />
              </span>
              Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>{profile.full_name || "—"}</span>
            </div>
            {email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>{email}</span>
              </div>
            )}
            {profile.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>{profile.phone}</span>
              </div>
            )}
            {profile.company_name && (
              <div className="flex items-center gap-2 text-sm">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>{profile.company_name}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>Created {new Date(profile.created_at).toLocaleDateString()}</span>
            </div>
          </CardContent>
        </Card>

        {contact && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <span className="dash-chip inline-flex h-7 w-7 items-center justify-center rounded-md">
                  <Building2 className="h-3.5 w-3.5" />
                </span>
                Linked Contact (CRM)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>{contact.contact_person || contact.company_name}</span>
              </div>
              {contact.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{contact.email}</span>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{contact.phone}</span>
                </div>
              )}
              {contact.industry && (
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{contact.industry}{contact.town ? ` · ${contact.town}` : ""}</span>
                </div>
              )}
              {contact.website_url && (
                <div className="flex items-center gap-2 text-sm">
                  <Globe2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <a href={contact.website_url} target="_blank" rel="noopener noreferrer" className="dash-accent hover:underline">
                    {contact.website_url}
                  </a>
                </div>
              )}
              {contact.notes && (
                <p className="text-xs text-muted-foreground italic mt-2">
                  {contact.notes}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Sites */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="dash-chip inline-flex h-7 w-7 items-center justify-center rounded-md">
              <Globe2 className="h-3.5 w-3.5" />
            </span>
            Sites ({allSites.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {allSites.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No sites</p>
          ) : (
            <div className="space-y-4">
              {allSites.map((site) => {
                const dep = deploymentMap.get(site.id);
                const credits = creditMap.get(site.id) ?? 0;
                const ds = domainStatusLabels[site.domain_status || "none"] || domainStatusLabels.none;
                return (
                  <div key={site.id} className="dash-hairline space-y-3 rounded-xl border px-5 py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold">{site.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {site.slug} · Created {formatDistanceToNow(new Date(site.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {site.status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-muted-foreground block">Credits</span>
                        <span className="font-medium flex items-center gap-1">
                          <Coins className="h-3 w-3" /> {credits}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Domain</span>
                        <Badge variant="outline" className={`text-xs ${ds.className}`}>
                          {site.domain || ds.label}
                        </Badge>
                      </div>
                      {dep && (
                        <div>
                          <span className="text-muted-foreground block">Subdomain</span>
                          <a
                            href={`https://${dep.subdomain}.pages.dev`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="dash-accent hover:underline font-medium flex items-center gap-1"
                          >
                            {dep.subdomain}.pages.dev
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      )}
                      {site.site_url && (
                        <div>
                          <span className="text-muted-foreground block">Site URL</span>
                          <a
                            href={site.site_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="dash-accent hover:underline font-medium flex items-center gap-1"
                          >
                            Visit
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      )}
                    </div>

                    {site.requested_domain && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Requested: </span>
                        <span className="dash-accent font-medium">{site.requested_domain}</span>
                        {site.domain_notes && (
                          <span className="text-muted-foreground italic ml-2">— {site.domain_notes}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payments + Invoices */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <span className="dash-chip-pink inline-flex h-7 w-7 items-center justify-center rounded-md">
                <CreditCard className="h-3.5 w-3.5" />
              </span>
              Payments ({allPayments.length})
              {totalPaid > 0 && (
                <span className="ml-auto text-xs font-medium text-(--dash-accent-2) tabular-nums">
                  Total: ${totalPaid.toFixed(2)}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {allPayments.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No payments</p>
            ) : (
              <div className="dash-hairline divide-y">
                {allPayments.map((p) => (
                  <div key={p.id} className="dash-row flex items-center justify-between rounded-md px-1 text-xs py-2">
                    <div className="flex items-center gap-2">
                      {paymentStatusIcon(p.status)}
                      <span>{p.description || p.payment_method || "Payment"}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold tabular-nums">${Number(p.amount).toFixed(2)}</span>
                      <span className="text-muted-foreground">
                        {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <span className="dash-chip inline-flex h-7 w-7 items-center justify-center rounded-md">
                <FileText className="h-3.5 w-3.5" />
              </span>
              Invoices ({allInvoices.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {allInvoices.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No invoices</p>
            ) : (
              <div className="dash-hairline divide-y">
                {allInvoices.map((inv) => (
                  <div key={inv.id} className="dash-row flex items-center justify-between rounded-md px-1 text-xs py-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{inv.invoice_number}</span>
                      <Badge variant="outline" className="text-xs h-5">
                        {inv.type}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold tabular-nums">${Number(inv.amount).toFixed(2)}</span>
                      <span className="text-muted-foreground">
                        {new Date(inv.issued_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
