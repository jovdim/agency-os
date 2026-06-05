"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Period = "today" | "week" | "all";

interface PeriodCounts {
  today: number;
  week: number;
  all: number;
}

const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  week: "This week",
  all: "All time",
};

export function SalespersonStats({
  calls,
  proposals,
  accepted,
}: {
  calls: PeriodCounts;
  proposals: PeriodCounts;
  accepted: number;
}) {
  const [period, setPeriod] = useState<Period>("today");

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="mb-5 flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-muted-foreground">
            Activity
          </span>
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PERIOD_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-3xl font-bold tabular-nums">{calls[period]}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Calls</p>
          </div>
          <div>
            <p className="text-3xl font-bold tabular-nums">
              {proposals[period]}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Proposals
              {period === "all" && (
                <span className="text-muted-foreground/70">
                  {" "}
                  · {accepted} accepted
                </span>
              )}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
