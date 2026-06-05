import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users } from "lucide-react";
import Link from "next/link";
import { TechCreateClientForm } from "./create-client-form";
import { ClientManagement } from "./client-management";

export const dynamic = "force-dynamic";

export default async function TechClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ contact_id?: string }>;
}) {
  const { contact_id } = await searchParams;
  await requireRole("tech_admin");
  const admin = createAdminClient();

  // Fetch all client profiles. Wave 2 needs clientIds, so this has to
  // resolve first.
  const { data: clients } = await admin
    .from("profiles")
    .select("id, full_name, company_name, phone, is_active, created_at")
    .eq("role", "client")
    .order("created_at", { ascending: false });

  const clientIds = (clients || []).map((c) => c.id);

  // ── Wave 2: contacts + sites in parallel, both scoped to clientIds ──
  // Sites query previously had NO WHERE filter — it loaded the entire
  // sites table and filtered in JS. Adding `.in("owner_id", clientIds)`
  // turns this into a scoped read.
  const [{ data: contacts }, { data: sites }] = clientIds.length > 0
    ? await Promise.all([
        admin
          .from("contacts")
          .select("id, client_user_id, email, contact_person, company_name, phone, industry, town")
          .in("client_user_id", clientIds),
        admin
          .from("sites")
          .select("id, owner_id, name, status, site_url, codebase_link, proposal_id")
          .in("owner_id", clientIds),
      ])
    : [
        { data: [] as { id: string; client_user_id: string | null; email: string | null; contact_person: string | null; company_name: string | null; phone: string | null; industry: string | null; town: string | null }[] },
        { data: [] as { id: string; owner_id: string; name: string; status: string; site_url: string | null; codebase_link: string | null; proposal_id: string | null }[] },
      ];

  const contactsByUserId: Record<string, { id: string; email: string | null; contact_person: string | null; company_name: string | null; phone: string | null; industry: string | null; town: string | null }> = {};
  for (const c of contacts || []) {
    if (c.client_user_id) {
      contactsByUserId[c.client_user_id] = {
        id: c.id,
        email: c.email,
        contact_person: c.contact_person,
        company_name: c.company_name,
        phone: c.phone,
        industry: c.industry,
        town: c.town,
      };
    }
  }

  const siteByOwner: Record<string, { id: string; name: string; status: string; site_url: string | null; codebase_link: string | null; proposalId: string | null }> = {};
  for (const site of sites || []) {
    // Take the first site for each owner (should be the only one)
    if (!siteByOwner[site.owner_id]) {
      siteByOwner[site.owner_id] = { id: site.id, name: site.name, status: site.status, site_url: site.site_url, codebase_link: site.codebase_link, proposalId: site.proposal_id };
    }
  }

  // ── Wave 3: credit balances scoped to the sites we just collected ──
  const siteIds = Object.values(siteByOwner).map((s) => s.id);
  const creditsBySite: Record<string, number> = {};

  if (siteIds.length > 0) {
    const { data: balances } = await admin
      .from("credit_balances")
      .select("site_id, balance")
      .in("site_id", siteIds);

    for (const b of balances || []) {
      creditsBySite[b.site_id] = b.balance;
    }
  }

  // Build combined site info per owner
  const clientSiteInfo: Record<string, { id: string; name: string; status: string; credits: number; site_url: string | null; codebase_link: string | null; proposalId: string | null }> = {};
  for (const [ownerId, site] of Object.entries(siteByOwner)) {
    clientSiteInfo[ownerId] = {
      ...site,
      credits: creditsBySite[site.id] ?? 0,
    };
  }

  const clientCount = (clients || []).length;

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Clean page header — no gradient needed here. Quiet back link above an
          eyebrow + title + one-line subtitle, with a violet icon chip anchoring
          the heading. */}
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="-ml-2 h-8 text-muted-foreground"
        >
          <Link href="/tech">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>

        <div className="flex items-center gap-3.5">
          <span className="dash-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
            <Users className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Operations
            </p>
            <h1 className="text-2xl font-bold tracking-tight">Client Management</h1>
            <p className="text-sm text-muted-foreground">
              Create client accounts and link their deployed websites.
            </p>
          </div>
        </div>
      </div>

      {/* Create new client */}
      <TechCreateClientForm initialContactId={contact_id} />

      {/* Client list */}
      <Card>
        <CardHeader className="dash-hairline border-b">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="dash-chip inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                <Users className="h-4 w-4" />
              </span>
              <CardTitle className="text-base">Clients</CardTitle>
            </div>
            <span className="dash-chip inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-bold tabular-nums">
              {clientCount}
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <ClientManagement
            clients={(clients || []) as { id: string; full_name: string | null; company_name: string | null; phone: string | null; is_active: boolean; created_at: string }[]}
            contactsByUserId={contactsByUserId}
            clientSiteInfo={clientSiteInfo}
          />
        </CardContent>
      </Card>
    </div>
  );
}
