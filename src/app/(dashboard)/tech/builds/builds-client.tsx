"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Pencil } from "lucide-react";
import Link from "next/link";

interface Site {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  updated_at: string;
  template_id: string | null;
}

interface BuildsClientProps {
  sites: Site[];
}

export function BuildsClient({ sites }: BuildsClientProps) {
  const queued = sites.filter((s) => s.status === "queued");
  const building = sites.filter((s) => s.status === "building");
  const live = sites.filter((s) => s.status === "live");

  const statusColors: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    queued: "secondary",
    building: "default",
    live: "outline",
    suspended: "destructive",
  };

  return (
    <>
      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{queued.length}</div>
            <p className="text-sm text-muted-foreground">Queued</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{building.length}</div>
            <p className="text-sm text-muted-foreground">Building</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{live.length}</div>
            <p className="text-sm text-muted-foreground">Live</p>
          </CardContent>
        </Card>
      </div>

      {/* Sites list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Sites</CardTitle>
        </CardHeader>
        <CardContent>
          {sites.length > 0 ? (
            <div className="space-y-3">
              {sites.map((site) => (
                <div
                  key={site.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{site.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      /{site.slug}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Badge variant={statusColors[site.status] || "secondary"}>
                      {site.status}
                    </Badge>
                    {site.template_id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        asChild
                      >
                        <Link
                          href={`/api/render/site/${site.id}`}
                          target="_blank"
                          title="Preview site"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/tech/sites/${site.id}`} className="gap-1">
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No sites in the system yet
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
