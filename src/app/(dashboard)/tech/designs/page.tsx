import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Eye, Copy, Palette } from "lucide-react";
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
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/tech">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Design Library</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        All previously built websites. Clone any design as a starting point for
        new proposals.
      </p>

      {/* Stats */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{allDesigns.length} designs</Badge>
        {industries.map((ind) => (
          <Badge key={ind} variant="outline" className="text-xs">
            {ind} ({allDesigns.filter((d) => (d.industry || "General") === ind).length})
          </Badge>
        ))}
      </div>

      {/* Design list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="h-4 w-4" />
            All Builds ({allDesigns.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {allDesigns.length > 0 ? (
            <div className="space-y-3">
              {allDesigns.map((design) => (
                <div
                  key={design.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{design.company_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {design.industry || "General"} • {design.town || "—"} •{" "}
                      {formatDistanceToNow(new Date(design.created_at), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Badge variant="outline" className="text-xs capitalize">
                      {design.status}
                    </Badge>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild>
                      <Link
                        href={`/api/render/${design.id}`}
                        target="_blank"
                        title="Preview design"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/tech/proposals/${design.id}`} className="gap-1">
                        <Copy className="h-3.5 w-3.5" />
                        Use
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No completed builds yet. Build your first proposal to populate the
              design library.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
