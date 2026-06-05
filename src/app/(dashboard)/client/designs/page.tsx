import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Eye, Palette, MapPin, Sparkle as Sparkles } from "@phosphor-icons/react/ssr";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ClientDesignGalleryPage() {
  await requireRole("client");
  const supabase = await createClient();

  // Fetch all live/completed websites as design inspiration
  const { data: designs } = await supabase
    .from("proposals")
    .select("id, company_name, industry, town, status")
    .in("status", ["sent", "viewed", "accepted", "paid"])
    .order("created_at", { ascending: false });

  const allDesigns = designs || [];
  const industries = [
    ...new Set(allDesigns.map((d) => d.industry || "General")),
  ].sort();

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="dash-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
            <Palette className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Design Gallery</h1>
            <p className="max-w-prose text-sm text-muted-foreground">
              Browse our portfolio of websites. Like a design? Contact us to get
              a similar look for your site — available as an extra service.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" asChild className="self-start">
          <Link href="/client">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      {/* Industry filter chips */}
      {industries.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Browse by
          </span>
          <Badge variant="secondary" className="tabular-nums">
            {allDesigns.length} designs
          </Badge>
          {industries.map((ind) => (
            <Badge key={ind} variant="outline" className="text-xs">
              {ind}
            </Badge>
          ))}
        </div>
      )}

      {/* Design grid */}
      {allDesigns.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <span className="dash-chip mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl">
              <Palette className="h-6 w-6" />
            </span>
            <p className="font-medium">No designs available yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Check back later as we add more website designs.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {allDesigns.map((design) => (
            <Card
              key={design.id}
              className="group flex flex-col overflow-hidden transition-shadow hover:shadow-md"
            >
              {/* Soft thumbnail band */}
              <div className="dash-chip flex h-28 items-center justify-center border-b">
                <Palette className="h-8 w-8 opacity-70 transition-transform group-hover:scale-110" />
              </div>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-snug">
                    {design.company_name}
                  </CardTitle>
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {design.industry || "General"}
                  </Badge>
                </div>
                {design.town && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {design.town}
                  </p>
                )}
              </CardHeader>
              <CardContent className="flex-1" />
              <div className="dash-hairline border-t px-6 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  asChild
                >
                  <Link
                    href={`/api/render/${design.id}`}
                    target="_blank"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Preview Design
                  </Link>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Info panel */}
      <div className="dash-panel flex items-start gap-3 p-5">
        <span className="dash-chip inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
          <Sparkles className="h-4 w-4" />
        </span>
        <p className="text-sm text-muted-foreground">
          Want a design like one of these for your website? Contact your sales
          representative to discuss a redesign — available as an additional
          service.
        </p>
      </div>
    </div>
  );
}
