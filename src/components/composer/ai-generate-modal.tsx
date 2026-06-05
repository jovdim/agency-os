"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CircleNotch as Loader2, Plus, Sparkle as Sparkles, Trash as Trash2 } from "@phosphor-icons/react/ssr";

/**
 * AI Generate modal , global "✨ Generate content" button opens this.
 *
 * Two responsibilities:
 *   1. Show the inputs we already know (company name, industry, town,
 *      services from the proposal) and let the tech tweak before
 *      generation. Services start with empty descriptions; the tech
 *      can fill them in for sharper AI output.
 *   2. POST /api/composer/ai-generate, then hand the returned overrides
 *      back to the composer via `onGenerate`.
 *
 * Skipped on this surface (handled inside the endpoint, never shown to
 * the AI): phone, email, address. The endpoint auto-fills those from
 * proposal.contacts directly.
 */

export interface AiServiceInput {
  title: string;
  description: string;
}

export interface AiInputs {
  companyName: string;
  industry: string;
  town: string;
  services: AiServiceInput[];
}

export type AiOverrides = Record<string, Record<string, unknown>>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  /** Called with the overrides map from the endpoint. Composer applies. */
  onGenerate: (overrides: AiOverrides) => void;
}

export function AiGenerateModal({
  open,
  onOpenChange,
  siteId,
  onGenerate,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [inputs, setInputs] = useState<AiInputs | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Optional free-form message the tech can add to steer the global
  // generation (e.g. "use a luxury tone", "mention winter promo on
  // every CTA"). Forwarded to the endpoint as `custom_prompt`, same
  // wire shape the per-section button uses.
  const [customPrompt, setCustomPrompt] = useState("");

  // Lazy-load prefill the moment the modal opens. We keep the previous
  // inputs in state so reopening within the same composer session
  // doesn't lose what the tech already typed , only refetch when
  // siteId changes or `inputs` is still null (first open).
  useEffect(() => {
    if (!open) return;
    if (inputs) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/composer/ai-inputs?site_id=${encodeURIComponent(siteId)}`)
      .then((res) => res.json())
      .then((data: { inputs?: AiInputs; error?: string }) => {
        if (cancelled) return;
        if (data.inputs) {
          setInputs(data.inputs);
        } else {
          setError(data.error ?? "Failed to load proposal data.");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError("Network error: " + (err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, siteId, inputs]);

  function patchInputs(patch: Partial<AiInputs>) {
    setInputs((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function patchService(idx: number, patch: Partial<AiServiceInput>) {
    setInputs((prev) => {
      if (!prev) return prev;
      const services = prev.services.slice();
      services[idx] = { ...services[idx], ...patch };
      return { ...prev, services };
    });
  }

  function addService() {
    setInputs((prev) =>
      prev
        ? { ...prev, services: [...prev.services, { title: "", description: "" }] }
        : prev,
    );
  }

  function removeService(idx: number) {
    setInputs((prev) =>
      prev
        ? { ...prev, services: prev.services.filter((_, i) => i !== idx) }
        : prev,
    );
  }

  async function handleGenerate() {
    if (!inputs || generating) return;

    // Light validation , the rest is enforced server-side. We just
    // catch the obvious "tech hit Generate without filling anything".
    if (!inputs.companyName.trim()) {
      toast.error("Company name is required.");
      return;
    }

    // Strip empty services , we don't want to send blank rows to AI.
    const cleanServices = inputs.services
      .map((s) => ({ title: s.title.trim(), description: s.description.trim() }))
      .filter((s) => s.title.length > 0);

    setGenerating(true);
    try {
      const res = await fetch("/api/composer/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: siteId,
          mode: "all",
          inputs: {
            companyName: inputs.companyName.trim(),
            industry: inputs.industry.trim(),
            town: inputs.town.trim(),
            services: cleanServices,
          },
          custom_prompt: customPrompt.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        overrides?: AiOverrides;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error || "Generation failed");
        return;
      }
      const overrides = data.overrides ?? {};
      const fieldCount = Object.values(overrides).reduce(
        (sum, fields) => sum + Object.keys(fields).length,
        0,
      );
      if (fieldCount === 0) {
        // Empty overrides , every field already filled. Friendly UX
        // rather than treating this as an error.
        toast.info(data.message ?? "Every text field is already filled.");
        onOpenChange(false);
        return;
      }
      onGenerate(overrides);
      toast.success(
        `Generated content for ${fieldCount} field${fieldCount === 1 ? "" : "s"}.`,
      );
      onOpenChange(false);
    } catch (err) {
      toast.error("Network error: " + (err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="dash-chip inline-flex size-7 items-center justify-center rounded-lg">
              <Sparkles className="size-4" />
            </span>
            Generate content with AI
          </DialogTitle>
          <DialogDescription>
            Fills every empty placeholder across the site with English copy
            tailored to this company. Already-edited fields stay untouched.
            To re-roll just one section, use the sparkles button on that
            section card.
          </DialogDescription>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {loading && (
            <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading proposal info…
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
              {error}
            </div>
          )}

          {inputs && !loading && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ai-company" className="text-xs">
                    Company name
                  </Label>
                  <Input
                    id="ai-company"
                    value={inputs.companyName}
                    onChange={(e) =>
                      patchInputs({ companyName: e.target.value })
                    }
                    disabled={generating}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-industry" className="text-xs">
                    Industry
                  </Label>
                  <Input
                    id="ai-industry"
                    value={inputs.industry}
                    onChange={(e) => patchInputs({ industry: e.target.value })}
                    placeholder="custom kitchens, auto repair, cafe…"
                    disabled={generating}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="ai-town" className="text-xs">
                    Town
                  </Label>
                  <Input
                    id="ai-town"
                    value={inputs.town}
                    onChange={(e) => patchInputs({ town: e.target.value })}
                    placeholder="New York, Los Angeles, …"
                    disabled={generating}
                  />
                </div>
              </div>

              {/* Services. Title + 1-line description per row. */}
              <div className="dash-panel dash-hairline space-y-2 rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Services</Label>
                  <span className="text-[11px] text-muted-foreground">
                    Title required, description optional but helps AI
                  </span>
                </div>
                <div className="space-y-2">
                  {inputs.services.map((s, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[1fr_2fr_auto] gap-2 items-start"
                    >
                      <Input
                        value={s.title}
                        onChange={(e) =>
                          patchService(i, { title: e.target.value })
                        }
                        placeholder="Service title"
                        className="text-sm"
                        disabled={generating}
                      />
                      <Input
                        value={s.description}
                        onChange={(e) =>
                          patchService(i, { description: e.target.value })
                        }
                        placeholder="One-line description (optional)"
                        className="text-sm"
                        disabled={generating}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeService(i)}
                        disabled={generating}
                        className="text-muted-foreground hover:text-destructive"
                        title="Remove service"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addService}
                    disabled={generating}
                    className="gap-1.5"
                  >
                    <Plus className="size-3.5" />
                    Add service
                  </Button>
                </div>
              </div>

              {/* Optional custom instruction. Steers the global
                  generation in the same way the per-section popover
                  does for a single section. Useful for overall tone
                  ("luxury", "family-friendly") or site-wide hints
                  ("mention 20 percent winter discount"). */}
              <div className="space-y-1.5">
                <Label htmlFor="ai-custom-prompt" className="text-xs">
                  Custom instruction (optional)
                </Label>
                <textarea
                  id="ai-custom-prompt"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="e.g. luxury tone, mention 20 percent winter discount, focus on speed"
                  rows={3}
                  disabled={generating}
                  className="w-full text-sm px-3 py-2 rounded-lg border bg-background transition focus:outline-none focus:ring-2 focus:ring-[--dash-accent]/30 focus:border-[--dash-accent]/40 resize-none disabled:opacity-50"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={generating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={generating || !inputs || loading}
            className="gap-1.5"
          >
            {generating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
