"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface DomainTabsProps {
  queueContent: React.ReactNode;
  inProgressContent: React.ReactNode;
  doneContent: React.ReactNode;
  queueCount: number;
  inProgressCount: number;
  doneCount: number;
}

export function DomainTabs({
  queueContent,
  inProgressContent,
  doneContent,
  queueCount,
  inProgressCount,
  doneCount,
}: DomainTabsProps) {
  return (
    <Tabs defaultValue="queue" className="space-y-4">
      <TabsList>
        <TabsTrigger value="queue">
          Queue
          <span className="ml-1.5 text-xs text-muted-foreground">
            ({queueCount})
          </span>
        </TabsTrigger>
        <TabsTrigger value="in_progress">
          In Progress
          <span className="ml-1.5 text-xs text-muted-foreground">
            ({inProgressCount})
          </span>
        </TabsTrigger>
        <TabsTrigger value="completed">
          Completed
          <span className="ml-1.5 text-xs text-muted-foreground">
            ({doneCount})
          </span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="queue" className="mt-4">
        {queueContent}
      </TabsContent>
      <TabsContent value="in_progress" className="mt-4">
        {inProgressContent}
      </TabsContent>
      <TabsContent value="completed" className="mt-4">
        {doneContent}
      </TabsContent>
    </Tabs>
  );
}
