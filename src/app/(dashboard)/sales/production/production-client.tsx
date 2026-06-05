"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MagnifyingGlass as Search, ArrowSquareOut as ExternalLink, Globe, Eye, Copy, CurrencyEur as Euro, CalendarBlank as Calendar } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";

interface ProductionProposal {
  id: string;
  slug: string;
  company_name: string;
  industry: string | null;
  town: string | null;
  status: string;
  price: number | null;
  discount_price: number | null;
  base_price: number | null;
  paid_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  contacts: {
    company_name: string;
    contact_person: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  deployment: {
    id: string;
    proposal_id: string;
    subdomain: string;
    deploy_status: string;
    deployed_at: string;
  } | null;
}

export function ProductionClient({
  proposals,
}: {
  proposals: ProductionProposal[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const filtered = proposals.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.company_name.toLowerCase().includes(q) ||
      (p.industry ?? "").toLowerCase().includes(q) ||
      (p.town ?? "").toLowerCase().includes(q) ||
      (p.contacts?.contact_person ?? "").toLowerCase().includes(q) ||
      (p.deployment?.subdomain ?? "").toLowerCase().includes(q)
    );
  });

  function copyUrl(subdomain: string) {
    navigator.clipboard.writeText(`https://${subdomain}.pages.dev`);
    toast.success("URL copied!");
  }

  const totalRevenue = proposals.reduce(
    (sum, p) => sum + (p.discount_price ?? p.price ?? 0),
    0
  );

  const latestSale = proposals[0]?.paid_at
    ? format(new Date(proposals[0].paid_at), "d MMM yyyy")
    : "—";

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Page header — clean title block with a violet chip on the left and a
          one-line subtitle. No gradient hero: this is a working list, so a calm
          header reads best (matches the rest of the redesigned surfaces). */}
      <div className="flex items-start gap-3">
        <span className="dash-chip mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
          <Globe className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Production
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Live client websites</h1>
          <p className="text-sm text-muted-foreground">
            Every website you&apos;ve sold and shipped.
          </p>
        </div>
      </div>

      {/* Stat tiles — operational metrics use quiet violet chips; revenue is the
          one piece of "good news" so it carries the sparing pink accent. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="dash-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Live Websites
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums">{proposals.length}</p>
            </div>
            <span className="dash-chip inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
              <Globe className="h-4 w-4" />
            </span>
          </div>
        </div>
        <div className="dash-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Total Revenue
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-(--dash-accent-2)">
                ${totalRevenue.toLocaleString()}
              </p>
            </div>
            <span className="dash-chip-pink inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
              <Euro className="h-4 w-4" />
            </span>
          </div>
        </div>
        <div className="dash-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Latest Sale
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums">{latestSale}</p>
            </div>
            <span className="dash-chip inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
              <Calendar className="h-4 w-4" />
            </span>
          </div>
        </div>
      </div>

      {/* Table panel — search row in the panel header, then the website list. */}
      <div className="dash-panel overflow-hidden">
        <div className="dash-hairline flex items-center gap-3 border-b px-5 py-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search company, contact, town, or subdomain…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm bg-background"
            />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {filtered.length === 1 ? "1 website" : `${filtered.length} websites`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="dash-subhead dash-hairline border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2.5 px-3 text-right font-semibold w-8 select-none">#</th>
                <th className="py-2.5 px-3 text-left font-semibold min-w-44">Company</th>
                <th className="py-2.5 px-3 text-left font-semibold min-w-28">Contact</th>
                <th className="py-2.5 px-3 text-left font-semibold min-w-36">Website</th>
                <th className="py-2.5 px-3 text-left font-semibold min-w-24">Industry</th>
                <th className="py-2.5 px-3 text-left font-semibold min-w-24">Town</th>
                <th className="py-2.5 px-3 text-right font-semibold min-w-20">Paid</th>
                <th className="py-2.5 px-3 text-right font-semibold min-w-28">Date</th>
                <th className="py-2.5 px-3 text-center font-semibold w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-14 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <span className="dash-chip inline-flex h-11 w-11 items-center justify-center rounded-full">
                        <Globe className="h-5 w-5" />
                      </span>
                      <p className="text-sm font-medium">
                        {search ? "No websites match your search." : "No live websites yet."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((p, idx) => (
                  <tr
                    key={p.id}
                    data-interactive="true"
                    className="dash-row dash-hairline border-b last:border-0 cursor-pointer group"
                    onClick={() => router.push(`/sales/proposals/${p.id}`)}
                  >
                    <td className="py-2 px-3 text-right text-muted-foreground tabular-nums text-xs select-none">
                      {idx + 1}
                    </td>
                    <td className="py-2 px-3">
                      <span className="font-medium group-hover:text-(--dash-accent) transition-colors truncate block max-w-44" title={p.company_name}>
                        {p.company_name}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-muted-foreground truncate max-w-28">
                      {p.contacts?.contact_person ?? "—"}
                    </td>
                    <td className="py-2 px-3">
                      {p.deployment?.subdomain ? (
                        <span
                          className="text-xs text-(--dash-accent) hover:underline truncate block max-w-36 cursor-pointer"
                          title={`${p.deployment.subdomain}.pages.dev`}
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(`https://${p.deployment!.subdomain}.pages.dev`, "_blank");
                          }}
                        >
                          {p.deployment.subdomain}.pages.dev
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground truncate max-w-24">
                      {p.industry ?? "—"}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground truncate max-w-24">
                      {p.town ?? "—"}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums font-medium text-(--dash-accent-2)">
                      ${(p.discount_price ?? p.price ?? 0).toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {p.paid_at
                        ? formatDistanceToNow(new Date(p.paid_at), { addSuffix: true })
                        : "—"}
                    </td>
                    <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-0.5">
                        <Link href={`/sales/proposals/${p.id}`}>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="View proposal">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        {p.deployment?.subdomain && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              title="Copy URL"
                              onClick={() => copyUrl(p.deployment!.subdomain)}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <a
                              href={`https://${p.deployment.subdomain}.pages.dev`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Visit website">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            </a>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
