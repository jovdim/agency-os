"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CircleNotch as Loader2, FloppyDisk as Save, ArrowCounterClockwise as RotateCcw, ArrowSquareOut as ExternalLink } from "@phosphor-icons/react/ssr";
import {
  MODELS_BY_PROVIDER,
  PROVIDERS,
  findModelOption,
  getDefaultModel,
} from "@/lib/ai/models";
import type { ProviderId } from "@/lib/ai/types";

/**
 * AI settings editor.
 *
 * The copywriting guide is the only big-text field here , everything
 * else (provider, model) is a small select / input. Save POSTs to
 * /api/admin/ai-settings and refreshes server props on success so
 * the "last updated" timestamp stays accurate without a full reload.
 *
 * "Dirty" indicator + an explicit Save button (no autosave) , these
 * are platform-wide settings and a stray keystroke shouldn't go live
 * to every composer instance.
 */

interface Settings {
  id: string;
  copywriting_guide: string;
  provider: string;
  model: string;
  is_active: boolean;
  updated_at: string;
}

interface Usage {
  last30DaysTotal: number;
  last30DaysSuccess: number;
  last30DaysCostUsd: number;
}

export interface RecentGeneration {
  id: string;
  site_id: string;
  site_name: string | null;
  mode: "all" | "section";
  section_id: string | null;
  status: "success" | "parse_retry" | "failed";
  error: string | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

interface Props {
  initialSettings: Settings | null;
  usage: Usage;
  recentGenerations?: RecentGeneration[];
}

export function AiSettingsClient({
  initialSettings,
  usage,
  recentGenerations = [],
}: Props) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(initialSettings);
  // Track the last-saved state separately so we can show a "dirty"
  // indicator + a "Discard" button without a full re-fetch.
  const [savedSettings, setSavedSettings] = useState<Settings | null>(
    initialSettings,
  );
  const [saving, setSaving] = useState(false);

  if (!settings) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          No AI settings row found. Apply{" "}
          <code>supabase/migrations/00053_composer_ai.sql</code> and reload
          this page.
        </CardContent>
      </Card>
    );
  }

  const dirty =
    !savedSettings ||
    settings.copywriting_guide !== savedSettings.copywriting_guide ||
    settings.provider !== savedSettings.provider ||
    settings.model !== savedSettings.model;

  // Used by the "Estimated spend" card to deep-link the user to the
  // current provider's usage/billing page , one click instead of
  // hunting the right URL. Falls back to OpenAI if the saved provider
  // somehow isn't in the registry (shouldn't happen, but safe).
  const currentProviderMeta =
    PROVIDERS.find((p) => p.id === settings.provider) ??
    PROVIDERS.find((p) => p.id === "openai");

  async function handleSave() {
    if (!settings || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/ai-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          copywriting_guide: settings.copywriting_guide,
          provider: settings.provider,
          model: settings.model,
        }),
      });
      const data = (await res.json()) as
        | { settings: Settings }
        | { error: string };
      if (!res.ok || "error" in data) {
        toast.error(("error" in data && data.error) || "Save failed");
        return;
      }
      setSettings(data.settings);
      setSavedSettings(data.settings);
      toast.success("AI settings saved.");
      router.refresh();
    } catch (err) {
      toast.error("Network error: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    if (!savedSettings) return;
    setSettings(savedSettings);
  }

  return (
    <div className="space-y-4">
      {/* Provider + usage at a glance */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Provider
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">{settings.provider}</span>
              <Badge variant="secondary" className="text-[10px]">
                {settings.model}
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Last 30 days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              <span className="font-semibold">{usage.last30DaysTotal}</span>{" "}
              generations
              <span className="text-muted-foreground">
                {" "}
                · {usage.last30DaysSuccess} success
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Estimated spend (30d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-semibold">
              ${usage.last30DaysCostUsd.toFixed(2)}
            </div>
            {/* Deep-link to the active provider's billing page. We
                can't show actual credit balance via API (vendors don't
                expose that to API keys), so this is the one-click
                escape hatch when Peter wants to see the real number. */}
            {currentProviderMeta && (
              <a
                href={currentProviderMeta.dashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 mt-0.5"
              >
                Check exact on {currentProviderMeta.label}
                <ExternalLink className="size-3" />
              </a>
            )}
          </CardContent>
        </Card>
      </div>

      {/* The big editor */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Copywriting guide</CardTitle>
          <p className="text-xs text-muted-foreground">
            This entire block is sent as the AI&rsquo;s system prompt on every
            generation. Keep rules concrete (do/don&rsquo;t lists work better
            than philosophy). Save applies immediately to every composer
            session.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            value={settings.copywriting_guide}
            onChange={(e) =>
              setSettings({ ...settings, copywriting_guide: e.target.value })
            }
            className="w-full min-h-100 rounded-md border bg-background px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="Write your copywriting rules here..."
            spellCheck={false}
          />

          {/* Provider + model picker. Both dropdowns , model list
              filters to the selected provider, and switching provider
              auto-snaps the model to that provider's recommended
              default. No more retyping "gpt-4o-mini" by hand. */}
          <ProviderModelPicker
            provider={settings.provider as ProviderId}
            model={settings.model}
            onChange={(provider, model) =>
              setSettings({ ...settings, provider, model })
            }
          />

          <div className="flex items-center gap-2 pt-1">
            <Button onClick={handleSave} disabled={!dirty || saving}>
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save changes
            </Button>
            <Button
              variant="ghost"
              onClick={handleDiscard}
              disabled={!dirty || saving}
              className="gap-1.5"
            >
              <RotateCcw className="size-3.5" />
              Discard
            </Button>
            <span className="text-[11px] text-muted-foreground ml-auto">
              Last saved{" "}
              {savedSettings
                ? new Date(savedSettings.updated_at).toLocaleString()
                : "never"}
              {dirty && (
                <span className="ml-2 text-amber-600 dark:text-amber-400">
                  · unsaved changes
                </span>
              )}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Recent generations table. Server-rendered (no client fetch),
          last 20 calls across all sites. Includes status, mode,
          duration, token counts, first ~60 chars of any error. Lets
          the agency see at a glance whether AI calls are succeeding
          and where they're going slow. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent generations</CardTitle>
          <p className="text-xs text-muted-foreground">
            Last 20 AI calls across all sites. Click a site to open it.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {recentGenerations.length === 0 ? (
            <div className="px-6 py-8 text-sm text-muted-foreground text-center">
              No generations yet. Open a composer and click Generate content.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b bg-muted/30">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-4 py-2 font-medium">Site</th>
                    <th className="px-4 py-2 font-medium">Mode</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Time</th>
                    <th className="px-4 py-2 font-medium">Tokens</th>
                    <th className="px-4 py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {recentGenerations.map((g) => (
                    <RecentRow key={g.id} g={g} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Provider + model picker. Two dropdowns side-by-side with a small
 * description panel underneath showing cost + quality hint for the
 * currently-selected model. Picking a different provider auto-resets
 * the model to that provider's recommended default , prevents stale
 * "gemini-2.0-flash" hanging around when you switch to OpenAI.
 *
 * Read-only model names are gone , every option is a known-good
 * value from `MODELS_BY_PROVIDER`. To add a new model: edit
 * src/lib/ai/models.ts.
 */
function ProviderModelPicker({
  provider,
  model,
  onChange,
}: {
  provider: ProviderId;
  model: string;
  onChange: (provider: ProviderId, model: string) => void;
}) {
  const modelList = MODELS_BY_PROVIDER[provider] ?? [];
  const selectedModel = findModelOption(provider, model);

  // Provider-level metadata , the dropdown labels show "OpenAI"
  // plain, but we surface the status note below as a small chip so
  // the user knows whether the provider is ready to fire or still
  // needs setup (e.g. OpenAI before the API key is added).
  const providerMeta = PROVIDERS.find((p) => p.id === provider);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ai-provider" className="text-xs">
            Provider
          </Label>
          <select
            id="ai-provider"
            value={provider}
            onChange={(e) => {
              const next = e.target.value as ProviderId;
              // Snap to the new provider's recommended model so the
              // user doesn't end up with a stale model string.
              onChange(next, getDefaultModel(next));
            }}
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ai-model" className="text-xs">
            Model
          </Label>
          <select
            id="ai-model"
            value={model}
            onChange={(e) => onChange(provider, e.target.value)}
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
          >
            {modelList.length === 0 && (
              <option value="">(no models available)</option>
            )}
            {modelList.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
                {m.recommended ? " ★ recommended" : ""}
                {" — "}
                {m.cost}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Description panel , one source-of-truth read-out of what the
          current selection means. Shows provider status badge + the
          selected model's cost + hint. Updates live as the user
          flips dropdowns. */}
      <div className="rounded-md border bg-muted/30 px-3 py-2.5 space-y-1.5">
        <div className="flex items-center gap-2 text-xs">
          {providerMeta && (
            <Badge
              variant={
                providerMeta.status === "ready"
                  ? "default"
                  : providerMeta.status === "needs_key"
                    ? "secondary"
                    : "destructive"
              }
              className="text-[10px]"
            >
              {providerMeta.status === "ready"
                ? "Ready"
                : providerMeta.status === "needs_key"
                  ? "Needs API key"
                  : "Not wired"}
            </Badge>
          )}
          <span className="text-muted-foreground">{providerMeta?.note}</span>
        </div>
        {selectedModel && (
          <div className="text-xs">
            <span className="font-medium">{selectedModel.label}</span>
            <span className="text-muted-foreground"> · {selectedModel.cost}</span>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {selectedModel.hint}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function RecentRow({ g }: { g: RecentGeneration }) {
  const time = new Date(g.created_at);
  const timeLabel = time.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const statusVariant =
    g.status === "success"
      ? "default"
      : g.status === "parse_retry"
        ? "secondary"
        : "destructive";
  const tokensLabel =
    g.input_tokens != null && g.output_tokens != null
      ? `${g.input_tokens} / ${g.output_tokens}`
      : ",";
  return (
    <tr data-interactive="true" className="border-b last:border-0 hover:bg-muted/20">
      <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
        {timeLabel}
      </td>
      <td className="px-4 py-2 truncate max-w-40 font-mono">
        {g.site_name ?? g.site_id.slice(0, 8)}
      </td>
      <td className="px-4 py-2">
        {g.mode === "all" ? "All" : `Section`}
      </td>
      <td className="px-4 py-2">
        <Badge variant={statusVariant} className="text-[10px] capitalize">
          {g.status === "parse_retry" ? "Retry OK" : g.status}
        </Badge>
      </td>
      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
        {g.duration_ms != null ? `${(g.duration_ms / 1000).toFixed(1)}s` : ","}
      </td>
      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap font-mono">
        {tokensLabel}
      </td>
      <td className="px-4 py-2 max-w-80 truncate text-destructive">
        {g.error ?? ""}
      </td>
    </tr>
  );
}
