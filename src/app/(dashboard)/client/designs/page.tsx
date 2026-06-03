import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Eye, Palette } from "lucide-react";
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
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/client">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Design Gallery</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Browse our portfolio of websites. If you like a design, contact us to
        get a similar look for your site — available as an extra service.
      </p>

      {/* Industry filter badges */}
      {industries.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{allDesigns.length} designs</Badge>
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
            <Palette className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No designs available yet.</p>
            <p className="text-sm text-muted-foreground">
              Check back later as we add more website designs.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {allDesigns.map((design) => (
            <Card key={design.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">
                    {design.company_name}
                  </CardTitle>
                  <Badge variant="outline" className="text-xs">
                    {design.industry || "General"}
                  </Badge>
                </div>
                {design.town && (
                  <p className="text-xs text-muted-foreground">{design.town}</p>
                )}
              </CardHeader>
              <CardContent className="flex-1" />
              <div className="border-t px-6 py-3">
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

      {/* Info card */}
      <Card className="bg-muted/30">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Want a design like one of these for your website? Contact your sales
            representative to discuss a redesign. This is available as an
            additional service.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
