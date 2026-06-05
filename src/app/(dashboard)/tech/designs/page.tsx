import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Eye, Copy, Palette, Buildings as Building2, MapPin } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

export default async function DesignLibraryPage() {
  await requireRole("tech_admin");
  const supabase = await createClient();

  // Fetch all completed proposals — these are reusable designs
  const { data: designs } = await supabase
    .from("proposals")
    .select("id, slug, company_name, industry, town, status, created_at")
    .in("status", ["sent", "viewed", "accepted", "paid"])
    .order("created_at", { ascending: false });

  const allDesigns = designs || [];

  // Group by industry for quick filtering
  const industries = [...new Set(allDesigns.map((d) => d.industry || "General"))].sort();

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Clean page header — eyebrow + title + one-line subtitle on the left,
          the back link on the right. No gradient: this is a library page, not
          a dashboard greeting. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Tech
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Design Library</h1>
          <p className="text-sm text-muted-foreground">
            All previously built websites. Clone any design as a starting point
            for new proposals.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 shrink-0" asChild>
          <Link href="/tech">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      {/* Filter chips — total count first, then a per-industry breakdown for
          quick scanning of what the library is made of. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="dash-chip inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold tabular-nums">
          <Palette className="h-3.5 w-3.5" />
          {allDesigns.length} designs
        </span>
        {industries.map((ind) => (
          <Badge key={ind} variant="outline" className="text-xs font-medium">
            {ind}
            <span className="ml-1 tabular-nums text-muted-foreground">
              {allDesigns.filter((d) => (d.industry || "General") === ind).length}
            </span>
          </Badge>
        ))}
      </div>

      {/* Design grid — soft cards, one per build. Each shows company, industry,
          location and age, with quick Preview + Use actions. */}
      {allDesigns.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allDesigns.map((design) => (
            <div
              key={design.id}
              className="dash-card flex flex-col p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="dash-chip inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                  <Building2 className="h-4 w-4" />
                </span>
                <Badge variant="secondary" className="text-xs capitalize">
                  {design.status}
                </Badge>
              </div>

              <div className="mt-4 min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {design.company_name}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="truncate">{design.industry || "General"}</span>
                  <span aria-hidden>•</span>
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{design.town || "—"}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(design.created_at), {
                    addSuffix: true,
                  })}
                </p>
              </div>

              <div className="dash-hairline mt-4 flex items-center gap-2 border-t pt-3">
                <Button variant="outline" size="sm" className="flex-1 gap-1.5" asChild>
                  <Link
                    href={`/api/render/${design.id}`}
                    target="_blank"
                    title="Preview design"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Preview
                  </Link>
                </Button>
                <Button size="sm" className="flex-1 gap-1.5" asChild>
                  <Link href={`/tech/proposals/${design.id}`}>
                    <Copy className="h-3.5 w-3.5" />
                    Use
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="dash-panel flex flex-col items-center justify-center px-4 py-16 text-center">
          <span className="dash-chip mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full">
            <Palette className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium">No completed builds yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Build your first proposal to populate the design library.
          </p>
        </div>
      )}
    </div>
  );
}
