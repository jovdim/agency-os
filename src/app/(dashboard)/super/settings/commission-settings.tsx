"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

interface SalesPerson {
  id: string;
  fullName: string;
  isActive: boolean;
  currentRate: number;
}

interface CommissionSettingsProps {
  salesPeople: SalesPerson[];
}

export function CommissionSettings({ salesPeople }: CommissionSettingsProps) {
  const router = useRouter();
  const [rates, setRates] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const sp of salesPeople) {
      initial[sp.id] = sp.currentRate;
    }
    return initial;
  });
  const [saving, setSaving] = useState<string | null>(null);

  async function handleSave(profileId: string) {
    const rate = rates[profileId];
    if (rate < 0 || rate > 100) {
      toast.error("Rate must be between 0 and 100");
      return;
    }

    setSaving(profileId);
    try {
      const res = await fetch("/api/admin/commission-rate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: profileId, rate }),
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
      setSaving(null);
    }
  }

  if (salesPeople.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No salespeople found
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {salesPeople.map((sp) => {
        const hasChanged = rates[sp.id] !== sp.currentRate;
        return (
          <div
            key={sp.id}
            className="flex items-center justify-between rounded-lg border px-4 py-3"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium truncate">{sp.fullName}</span>
              {!sp.isActive && (
                <Badge variant="secondary" className="text-xs shrink-0">
                  Inactive
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={rates[sp.id] ?? 10}
                  onChange={(e) =>
                    setRates((prev) => ({
                      ...prev,
                      [sp.id]: Number(e.target.value),
                    }))
                  }
                  className="w-16 h-8 text-sm text-right"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <Button
                size="sm"
                variant={hasChanged ? "default" : "ghost"}
                className="h-8 px-2"
                onClick={() => handleSave(sp.id)}
                disabled={saving === sp.id || !hasChanged}
              >
                {saving === sp.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
