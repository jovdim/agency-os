"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CircleNotch as Loader2 } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

interface CommissionRateEditorProps {
  salesPersonId: string;
  initialRate: number;
}

export function CommissionRateEditor({
  salesPersonId,
  initialRate,
}: CommissionRateEditorProps) {
  const router = useRouter();
  const [rate, setRate] = useState(initialRate);
  const [saving, setSaving] = useState(false);
  const hasChanged = rate !== initialRate;

  async function handleSave() {
    if (rate < 0 || rate > 100) {
      toast.error("Rate must be between 0 and 100");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/commission-rate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: salesPersonId, rate }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to save");
        return;
      }

      toast.success("Commission rate saved");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Commission rate</span>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          max={100}
          step={1}
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          className="w-16 h-8 text-sm text-right"
        />
        <span className="text-sm text-muted-foreground">%</span>
      </div>
      <Button
        size="sm"
        variant={hasChanged ? "default" : "ghost"}
        className="h-8"
        onClick={handleSave}
        disabled={saving || !hasChanged}
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
      </Button>
    </div>
  );
}
