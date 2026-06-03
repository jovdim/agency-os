"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Clock } from "lucide-react";
import Link from "next/link";

interface ChangeRequest {
  id: string;
  site_id: string;
  user_id: string;
  status: string;
  changes: Record<string, unknown>[];
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

interface QueueClientProps {
  requests: ChangeRequest[];
  siteMap: Record<string, string>;
}

export function QueueClient({ requests, siteMap }: QueueClientProps) {
  const pending = requests.filter((r) => r.status === "pending");
  const approved = requests.filter((r) => r.status === "approved");
  const rejected = requests.filter((r) => r.status === "rejected");

  const statusColors: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    pending: "secondary",
    approved: "default",
    rejected: "destructive",
  };

  function renderList(items: ChangeRequest[]) {
    if (items.length === 0) {
      return (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No change requests
        </p>
      );
    }
    return (
      <div className="space-y-3">
        {items.map((req) => {
          const age = Math.floor(
            (Date.now() - new Date(req.created_at).getTime()) / 3600000,
          );
          const changesArr = req.changes;
          return (
            <div
              key={req.id}
              className="flex items-center justify-between rounded-lg border px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {siteMap[req.site_id] || "Unknown site"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {changesArr.length} change{changesArr.length !== 1 ? "s" : ""}{" "}
                  ·{" "}
                  {age < 1
                    ? "just now"
                    : age < 24
                      ? `${age}h ago`
                      : `${Math.floor(age / 24)}d ago`}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4">
                {age >= 24 && req.status === "pending" && (
                  <Clock className="h-3.5 w-3.5 text-destructive" />
                )}
                <Badge variant={statusColors[req.status] || "secondary"}>
                  {req.status}
                </Badge>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/tech/queue/${req.id}`}>
                    {req.status === "pending" ? "Review" : "View"}
                  </Link>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Tabs defaultValue="pending">
      <TabsList>
        <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
        <TabsTrigger value="approved">Approved ({approved.length})</TabsTrigger>
        <TabsTrigger value="rejected">Rejected ({rejected.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="pending" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending Reviews</CardTitle>
          </CardHeader>
          <CardContent>{renderList(pending)}</CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="approved" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approved</CardTitle>
          </CardHeader>
          <CardContent>{renderList(approved)}</CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="rejected" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rejected</CardTitle>
          </CardHeader>
          <CardContent>{renderList(rejected)}</CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
