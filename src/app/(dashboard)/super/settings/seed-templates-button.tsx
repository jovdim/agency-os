"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";

export function SeedTemplatesButton() {
  const [seeding, setSeeding] = useState(false);

  async function handleSeed() {
    setSeeding(true);
    try {
      const res = await fetch("/api/seed/templates", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        const created = data.results.filter(
          (r: { error?: string }) => !r.error,
        ).length;
        const skipped = data.results.filter(
          (r: { error?: string }) => r.error,
        ).length;
        toast.success(
          `Seeded ${created} template(s)${skipped ? `, ${skipped} skipped` : ""}`,
        );
      } else {
        toast.error(data.error || "Failed to seed templates");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="flex items-center justify-between rounded border px-4 py-3">
      <div>
        <p className="text-sm font-medium">Seed Starter Templates</p>
        <p className="text-xs text-muted-foreground">
          Load built-in starter templates for common industries
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleSeed}
        disabled={seeding}
        className="gap-1"
      >
        {seeding ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        {seeding ? "Seeding..." : "Seed"}
      </Button>
    </div>
  );
}
