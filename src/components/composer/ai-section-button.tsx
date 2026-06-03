"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import type { AiOverrides } from "./ai-generate-modal";

/**
 * Per-section ✨ button.
 *
 * Shown in the SectionCard header next to variant-swap + remove.
 * Click → small popover with an optional free-form custom prompt
 * ("shorter", "more luxury", "mention winter promotion") + a
 * Regenerate button.
 *
 * Unlike the global Generate (which only fills empty placeholders),
 * the per-section button ALWAYS overwrites the section's fields ,
 * the user opted in by clicking the button on this specific card.
 *
 * The endpoint side handles the inputs lookup itself (re-reads the
 * proposal data each call) so this button doesn't need the modal's
 * input-review flow. One click → re-roll with optional steering.
 */

interface Props {
  siteId: string;
  sectionId: string;
  /** Called with the overrides map once the API returns. */
  onApply: (overrides: AiOverrides) => void;
}

export function AiSectionButton({ siteId, sectionId, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    try {
      // We need the same `inputs` payload the global modal sends so
      // the AI has company name + services + town context, even for
      // a single-section regen. Fetch it on demand from the same
      // /api/composer/ai-inputs endpoint the modal uses , keeps the
      // contract identical and avoids passing 4 extra props through
      // SectionCard.
      const inputsRes = await fetch(
        `/api/composer/ai-inputs?site_id=${encodeURIComponent(siteId)}`,
      );
      const inputsJson = (await inputsRes.json()) as {
        inputs?: unknown;
        error?: string;
      };
      if (!inputsRes.ok || !inputsJson.inputs) {
        toast.error(inputsJson.error || "Failed to load proposal inputs");
        return;
      }

      const res = await fetch("/api/composer/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: siteId,
          mode: "section",
          section_id: sectionId,
          inputs: inputsJson.inputs,
          custom_prompt: customPrompt.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        overrides?: AiOverrides;
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
      onApply(overrides);
      toast.success(
        `Regenerated ${fieldCount} field${fieldCount === 1 ? "" : "s"} in this section.`,
      );
      // Clear the custom prompt + close so a second click on a
      // different section starts fresh, not with stale instructions.
      setCustomPrompt("");
      setOpen(false);
    } catch (err) {
      toast.error("Network error: " + (err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-primary"
          onClick={(e) => e.stopPropagation()}
          title="Regenerate this section's content with AI"
          aria-label="Regenerate this section with AI"
        >
          <Sparkles className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80"
        // stopPropagation so clicking inside the popover doesn't
        // toggle the section's expand/collapse via the row's
        // onSelect handler.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-primary" />
              Regenerate with AI
            </h4>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Overwrites every text field in this section. Add an optional
              hint below to steer the result.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`ai-prompt-${sectionId}`} className="text-xs">
              Custom instruction (optional)
            </Label>
            <textarea
              id={`ai-prompt-${sectionId}`}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="e.g. shorter, more luxury, mention 20% winter discount"
              rows={3}
              disabled={generating}
              className="w-full text-xs px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={generating}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={generating}
              className="gap-1.5"
            >
              {generating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              Regenerate
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
