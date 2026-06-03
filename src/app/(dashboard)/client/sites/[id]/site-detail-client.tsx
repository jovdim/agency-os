"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Globe,
  CreditCard,
  Send,
  Clock,
  CheckCircle,
  XCircle,
  ExternalLink,
  RefreshCw,
  Pencil,
} from "lucide-react";
import Link from "next/link";

interface SiteDetailClientProps {
  site: Record<string, unknown>;
  sections: Array<{
    id: string;
    type: string;
    label: string;
    order: number;
    fields: Record<string, unknown>;
  }>;
  changeRequests: Array<{
    id: string;
    status: string;
    changes: Record<string, unknown>[];
    admin_note: string | null;
    created_at: string;
    updated_at: string;
  }>;
  creditBalance: number;
  transactions: Array<{
    id: string;
    amount: number;
    type: string;
    note: string | null;
    created_at: string;
  }>;
  availableDesigns?: unknown[];
}

export function SiteDetailClient({
  site,
  sections,
  changeRequests,
  creditBalance,
  transactions,
}: SiteDetailClientProps) {
  // Toggle for preview
  const [previewKey, setPreviewKey] = useState(0);

  const siteId = site.id as string;
  const siteName = site.name as string;
  const siteStatus = site.status as string;
  const templateId = site.template_id as string | null;

  const statusColor: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    live: "default",
    building: "secondary",
    queued: "outline",
    suspended: "destructive",
  };

  const requestStatusIcon: Record<string, React.ReactNode> = {
    pending: <Clock className="h-3.5 w-3.5 text-yellow-500" />,
    approved: <CheckCircle className="h-3.5 w-3.5 text-green-500" />,
    rejected: <XCircle className="h-3.5 w-3.5 text-red-500" />,
  };

  const txTypeLabel: Record<string, string> = {
    purchase: "Purchase",
    admin_grant: "Admin Grant",
    submission_deduct: "Change Request",
    rejection_refund: "Refund",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{siteName}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={statusColor[siteStatus] ?? "secondary"}>
              {siteStatus}
            </Badge>
            {(site.domain as string | null) && (
              <span className="text-sm text-muted-foreground">
                {site.domain as string}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {sections.length > 0 && (
            <Button size="sm" asChild>
              <Link href={`/client/sites/${siteId}/edit`}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit Site
              </Link>
            </Button>
          )}
          {templateId && siteStatus === "live" && (
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/render/site/${siteId}`} target="_blank">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                View Site
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold capitalize">{siteStatus}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Credits</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{creditBalance}</div>
            <p className="text-xs text-muted-foreground">
              1 credit per change request
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Change Requests
            </CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{changeRequests.length}</div>
            <p className="text-xs text-muted-foreground">
              {changeRequests.filter((r) => r.status === "pending").length}{" "}
              pending
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Edit Website CTA */}
      {sections.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center justify-between py-5">
            <div>
              <p className="font-medium">Visual Site Editor</p>
              <p className="text-sm text-muted-foreground">
                Change text, swap images, reorder gallery items, and submit changes for review.
              </p>
            </div>
            <Button asChild>
              <Link href={`/client/sites/${siteId}/edit`}>
                <Pencil className="mr-1.5 h-4 w-4" />
                Open Editor
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="history" className="space-y-4">
        <TabsList>
          <TabsTrigger value="history">Request History</TabsTrigger>
          <TabsTrigger value="credits">Credits</TabsTrigger>
          {templateId && <TabsTrigger value="preview">Preview</TabsTrigger>}
        </TabsList>

        {/* Request History */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Change Request History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {changeRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No change requests yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {changeRequests.map((req) => (
                    <div
                      key={req.id}
                      className="border rounded-lg p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {requestStatusIcon[req.status]}
                          <Badge
                            variant={
                              req.status === "approved"
                                ? "default"
                                : req.status === "rejected"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {req.status}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(req.created_at).toLocaleDateString()}{" "}
                          {new Date(req.created_at).toLocaleTimeString()}
                        </span>
                      </div>

                      <div className="space-y-1">
                        {req.changes.map(
                          (change: Record<string, unknown>, i: number) => {
                            const sectionMatch = sections.find(
                              (s) => s.id === change.section_id,
                            );
                            return (
                              <div
                                key={i}
                                className="text-sm flex items-center gap-2"
                              >
                                <span className="text-muted-foreground">
                                  {sectionMatch?.label ?? "Section"}
                                </span>
                                <span className="font-medium">
                                  {String(change.field).replace(/_/g, " ")}
                                </span>
                                <span className="text-muted-foreground">→</span>
                                <span className="truncate max-w-[200px]">
                                  {String(change.new_value ?? "")}
                                </span>
                              </div>
                            );
                          },
                        )}
                      </div>

                      {req.admin_note && (
                        <div className="text-sm bg-muted/50 rounded p-2 mt-1">
                          <span className="font-medium">Tech note:</span>{" "}
                          {req.admin_note}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Credits */}
        <TabsContent value="credits">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Credits & Transactions
                </CardTitle>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <span className="text-lg font-bold">{creditBalance}</span>
                  <span className="text-sm text-muted-foreground">credits</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No transactions yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {transactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between border rounded-lg px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {txTypeLabel[tx.type] ?? tx.type}
                        </p>
                        {tx.note && (
                          <p className="text-xs text-muted-foreground">
                            {tx.note}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-sm font-bold ${
                            tx.amount > 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {tx.amount > 0 ? "+" : ""}
                          {tx.amount}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(tx.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Preview */}
        {templateId && (
          <TabsContent value="preview">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">Live Preview</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPreviewKey((k) => k + 1)}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="border-t">
                  <iframe
                    key={previewKey}
                    src={`/api/render/site/${siteId}`}
                    className="w-full border-0"
                    style={{ height: "70vh" }}
                    title="Site Preview"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
