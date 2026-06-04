"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  ExternalLink,
  Globe,
  Rocket,
  Eye,
  Copy,
  Euro,
  Calendar,
} from "lucide-react";
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
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Production</h1>
        <p className="text-sm text-muted-foreground">Live client websites</p>
      </div>

      {/* Stat cards — same style as sales dashboard */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Live Websites</p>
              <p className="text-3xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">{proposals.length}</p>
            </div>
            <div className="rounded-md bg-emerald-100 dark:bg-emerald-900/30 p-2">
              <Globe className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Revenue</p>
              <p className="text-3xl font-bold mt-1 text-violet-600 dark:text-violet-400">${totalRevenue.toLocaleString()}</p>
            </div>
            <div className="rounded-md bg-violet-100 dark:bg-violet-900/30 p-2">
              <Euro className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Latest Sale</p>
              <p className="text-3xl font-bold mt-1">{latestSale}</p>
            </div>
            <div className="rounded-md bg-muted p-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-wrap gap-2 rounded-md border bg-muted/30 px-3 py-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm bg-background"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 px-3 text-right font-medium w-8 select-none">#</th>
                <th className="py-2 px-3 text-left font-medium min-w-44">Company</th>
                <th className="py-2 px-3 text-left font-medium min-w-28">Contact</th>
                <th className="py-2 px-3 text-left font-medium min-w-36">Website</th>
                <th className="py-2 px-3 text-left font-medium min-w-24">Industry</th>
                <th className="py-2 px-3 text-left font-medium min-w-24">Town</th>
                <th className="py-2 px-3 text-right font-medium min-w-20">Paid</th>
                <th className="py-2 px-3 text-right font-medium min-w-28">Date</th>
                <th className="py-2 px-3 text-center font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-muted-foreground">
                    {search ? "No websites match your search." : "No live websites yet."}
                  </td>
                </tr>
              ) : (
                filtered.map((p, idx) => (
                  <tr
                    key={p.id}
                    data-interactive="true"
                    className="border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors group"
                    onClick={() => router.push(`/sales/proposals/${p.id}`)}
                  >
                    <td className="py-1.5 px-3 text-right text-muted-foreground tabular-nums text-xs select-none">
                      {idx + 1}
                    </td>
                    <td className="py-1.5 px-3">
                      <span className="font-medium group-hover:text-primary transition-colors truncate block max-w-44" title={p.company_name}>
                        {p.company_name}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 text-muted-foreground truncate max-w-28">
                      {p.contacts?.contact_person ?? "—"}
                    </td>
                    <td className="py-1.5 px-3">
                      {p.deployment?.subdomain ? (
                        <span
                          className="text-xs text-primary hover:underline truncate block max-w-36 cursor-pointer"
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
                    <td className="py-1.5 px-3 text-muted-foreground truncate max-w-24">
                      {p.industry ?? "—"}
                    </td>
                    <td className="py-1.5 px-3 text-muted-foreground truncate max-w-24">
                      {p.town ?? "—"}
                    </td>
                    <td className="py-1.5 px-3 text-right tabular-nums text-muted-foreground">
                      ${(p.discount_price ?? p.price ?? 0).toLocaleString()}
                    </td>
                    <td className="py-1.5 px-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {p.paid_at
                        ? formatDistanceToNow(new Date(p.paid_at), { addSuffix: true })
                        : "—"}
                    </td>
                    <td className="py-1.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
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
