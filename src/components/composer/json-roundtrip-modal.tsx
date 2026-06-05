"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { WarningCircle as AlertCircle, ArrowLineDown as ArrowDownToLine, ArrowLineUp as ArrowUpFromLine, CheckCircle as CheckCircle2, Copy, DownloadSimple as Download, FileCode as FileJson, CircleNotch as Loader2 } from "@phosphor-icons/react/ssr";
import type { SiteComposition } from "@/lib/templates/render";
import {
  buildExportSnapshot,
  buildInstructionsBlock,
  buildTranslationInstructionsBlock,
  validateImportedJson,
  type JsonRoundtripTemplate,
  type JsonRoundtripPageContext,
  type RoundtripSnapshot,
} from "@/lib/composer/json-roundtrip";

/**
 * Manual AI Fill — JSON round-trip modal.
 *
 * Design philosophy: one big textarea per tab, minimal chrome. The
 * tech-admin's job is "copy this, paste into ChatGPT, paste the reply
 * back" — every pixel that isn't text content fights that job.
 *
 * Export tab → ONE combined textarea (instructions + JSON together,
 * exactly what gets pasted into ChatGPT). User can tweak before
 * copying. Two actions: Copy all (primary), Download as .json.
 *
 * Import tab → ONE paste textarea + validate/apply.
 *
 * Strict-by-design: validation rejects anything that doesn't match
 * the current composition exactly. No silent half-applies.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  composition: SiteComposition;
  templates: Map<string, JsonRoundtripTemplate>;
  brandCompanyName: string;
  /** Used to fetch real business context (industry / town / services)
   *  from the linked proposal via /api/composer/ai-inputs. Without
   *  this, ChatGPT only sees company name and invents the rest. */
  siteId: string;
  /**
   * Called when the user confirms a validated import. Shape matches
   * AiOverrides so the composer can pass this straight into the
   * existing applyAiOverrides path (zero new render code). In translate
   * mode the composer routes this into composition.i18n.translations
   * instead of the base composition.
   */
  onApply: (overrides: RoundtripSnapshot) => void;
  /**
   * "fill" (default) → content-creation prompt + copywriting guide,
   * import applies to the base composition.
   * "translate" → translation prompt + translation guide; the operator
   * pastes the export into ChatGPT, gets it back in `targetLocaleLabel`,
   * and the composer stores the import into the locale's translation slot.
   * The import VALIDATION is identical either way (a correct translation
   * keeps the same structure), so only the prompt + apply destination
   * differ. */
  mode?: "fill" | "translate";
  /** Language to translate INTO (e.g. "Español"). Required for translate mode. */
  targetLocaleLabel?: string;
  /** Language the content is currently in (e.g. "English"). Optional. */
  sourceLocaleLabel?: string;
  /** Page the round-trip targets (Peter 2026-05-30). Defaults to the
   *  home page when omitted — backward-compat for callers wired before
   *  subpage round-trips existed. The composer passes its activePagePath
   *  so opening the modal on a subpage exports THAT subpage, not home. */
  targetPagePath?: string;
  /** Per-page context for the instructions block. Composer resolves the
   *  page label, kind (home / service_subpage / custom_subpage), linked
   *  service title (if any), and a markdown dump of home content for
   *  reference, then hands the whole bundle to the modal. Omit for the
   *  home page — buildInstructionsBlock falls back to the unscoped
   *  intro automatically. */
  pageContext?: JsonRoundtripPageContext;
}

/** Shape returned by /api/composer/ai-inputs — mirrors the AiInputs
 *  type the paid AI Fill modal consumes. We only NEED industry, town,
 *  services for context; companyName is already on a separate prop. */
interface AiInputsResponse {
  companyName: string;
  industry: string;
  town: string;
  services: Array<{ title: string; description: string }>;
}

type Tab = "export" | "import";

export function JsonRoundtripModal({
  open,
  onOpenChange,
  composition,
  templates,
  brandCompanyName,
  siteId,
  onApply,
  mode = "fill",
  targetLocaleLabel,
  sourceLocaleLabel,
  targetPagePath,
  pageContext,
}: Props) {
  const isTranslate = mode === "translate";
  const [tab, setTab] = useState<Tab>("export");

  // Copywriting guide — lazy-loaded on first open. Cached for the
  // life of this component instance.
  const [guide, setGuide] = useState<string | null>(null);
  const [guideLoading, setGuideLoading] = useState(false);

  // Real business context (industry / town / services) — same source
  // the paid AI Fill modal uses. Loaded in parallel with the
  // copywriting guide so opening the modal does one parallel fetch,
  // not two sequential ones. Null until loaded; the instructions
  // builder degrades gracefully (omits sections) when fields are
  // empty, so a missing or proposal-less site still works.
  const [aiInputs, setAiInputs] = useState<AiInputsResponse | null>(null);
  const [inputsLoading, setInputsLoading] = useState(false);

  useEffect(() => {
    if (!open || guide !== null) return;
    // Translate mode doesn't use the copywriting guide — it uses the
    // translation guide (baked default for now; settings-editable later).
    // Set guide to "" without a fetch so the combined-text effect isn't
    // blocked on a load that never happens.
    if (isTranslate) {
      setGuide("");
      return;
    }
    let cancelled = false;
    setGuideLoading(true);
    fetch("/api/composer/copywriting-guide")
      .then((r) => (r.ok ? r.json() : { guide: null }))
      .then((data: { guide: string | null }) => {
        if (cancelled) return;
        setGuide(data.guide ?? "");
        setGuideLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setGuide(""); // Degrade gracefully — workflow still works.
        setGuideLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, guide]);

  useEffect(() => {
    if (!open || aiInputs !== null) return;
    let cancelled = false;
    setInputsLoading(true);
    fetch(`/api/composer/ai-inputs?site_id=${encodeURIComponent(siteId)}`)
      .then((r) => (r.ok ? r.json() : { inputs: null }))
      .then((data: { inputs?: AiInputsResponse }) => {
        if (cancelled) return;
        // Fallback to empty inputs so the prompt still renders even
        // when the endpoint returns nothing (standalone site, no
        // linked proposal). Empty fields cause the builder to drop
        // their sections, keeping the prompt clean.
        setAiInputs(
          data.inputs ?? {
            companyName: brandCompanyName,
            industry: "",
            town: "",
            services: [],
          },
        );
        setInputsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setAiInputs({
          companyName: brandCompanyName,
          industry: "",
          town: "",
          services: [],
        });
        setInputsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, aiInputs, siteId, brandCompanyName]);

  // ── Export snapshot ──
  // targetPagePath is threaded through so opening the modal on a
  // subpage exports THAT subpage's sections, not the home page.
  // Undefined falls through to buildExportSnapshot's default (home).
  const snapshot: RoundtripSnapshot = useMemo(() => {
    if (!open) return {};
    return buildExportSnapshot({ composition, templates, targetPagePath });
  }, [open, composition, templates, targetPagePath]);

  const snapshotJson = useMemo(() => JSON.stringify(snapshot, null, 2), [snapshot]);

  // Combined editable text — instructions block + JSON. User can
  // tweak anything before copying. Re-derived when dialog opens or
  // either of the two parallel loads (guide / ai-inputs) finishes,
  // NOT on every keystroke (that'd clobber the user's edits).
  const [combined, setCombined] = useState("");
  useEffect(() => {
    if (!open || guideLoading || inputsLoading) return;
    const instructions = isTranslate
      ? buildTranslationInstructionsBlock({
          targetLanguageLabel: targetLocaleLabel ?? "",
          sourceLanguageLabel: sourceLocaleLabel,
          companyName: aiInputs?.companyName?.trim() || brandCompanyName,
          // translationGuide left undefined → builder uses the baked
          // DEFAULT_TRANSLATION_GUIDE. Settings-editable in a later step.
        })
      : buildInstructionsBlock({
          companyName: (aiInputs?.companyName?.trim() || brandCompanyName) ?? "",
          industry: aiInputs?.industry,
          town: aiInputs?.town,
          // Strip blank-titled services — the endpoint sometimes returns
          // empty placeholder rows when the proposal had nothing typed.
          services: aiInputs?.services.filter((s) => s.title.trim().length > 0),
          copywritingGuide: guide ?? undefined,
          // Subpage round-trips pass a populated context so the prompt
          // leads with "this page is about X service" + word targets +
          // home content reference. Home round-trips pass nothing (or
          // kind=home), keeping the old prompt shape.
          pageContext,
        });
    setCombined(`${instructions}${snapshotJson}\n`);
    // Don't depend on `combined` (would loop) or on `brandCompanyName`
    // during the modal's lifetime (would clobber user edits if brand
    // changes underneath). snapshotJson dependency keeps the JSON
    // half fresh when sections are added/removed underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, guide, guideLoading, aiInputs, inputsLoading, snapshotJson, isTranslate, targetLocaleLabel, sourceLocaleLabel, pageContext]);

  // Stats for the export header — count what's actually in scope.
  const exportStats = useMemo(() => {
    let sections = 0;
    let fields = 0;
    for (const sec of Object.values(snapshot)) {
      sections += 1;
      for (const v of Object.values(sec)) {
        if (Array.isArray(v)) {
          for (const item of v) fields += Object.keys(item).length;
        } else {
          fields += 1;
        }
      }
    }
    return { sections, fields };
  }, [snapshot]);

  /**
   * Split the combined editable text into its two logical halves:
   *   - rules: everything from the top down to (but not including)
   *     the JSON section
   *   - json:  the JSON snapshot itself, from the first lone `{` to
   *     the end
   *
   * The instructions builder emits a literal `## JSON na vyplnenie`
   * heading before the JSON, so the primary split point is that
   * marker. If the user has edited it out, we fall back to splitting
   * at the first opening `{` on its own line (the JSON.stringify
   * with indent=2 output always starts that way).
   *
   * Returns trimmed strings so each half pastes cleanly into ChatGPT
   * with no trailing whitespace.
   */
  function splitCombined(): { rules: string; json: string } {
    // Fill mode emits the "JSON na vyplnenie" marker; translate mode emits
    // the "JSON to translate" one. Recognize whichever is present; the
    // first-brace fallback below covers the case where the user edited the
    // heading out entirely.
    const markers = ["## JSON na vyplnenie", "## JSON to translate"];
    let markerIdx = -1;
    for (const m of markers) {
      const i = combined.indexOf(m);
      if (i >= 0) {
        markerIdx = i;
        break;
      }
    }
    let rules: string;
    let json: string;
    if (markerIdx > 0) {
      rules = combined.slice(0, markerIdx).trimEnd();
      // Skip past the marker line + the JSON now starts at the
      // first `{` after it.
      const afterMarker = combined.slice(markerIdx);
      const braceIdx = afterMarker.indexOf("{");
      json =
        braceIdx >= 0 ? afterMarker.slice(braceIdx).trimEnd() : "";
    } else {
      // Fallback: split at the first lone `{` (start of JSON block).
      const match = combined.match(/^\{/m);
      if (match && match.index !== undefined) {
        rules = combined.slice(0, match.index).trimEnd();
        json = combined.slice(match.index).trimEnd();
      } else {
        // No JSON found at all — treat the whole thing as rules.
        rules = combined.trimEnd();
        json = "";
      }
    }
    return { rules, json };
  }

  async function copyText(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      toast.error("Copy failed");
    }
  }

  const copyRules = useCallback(() => {
    const { rules } = splitCombined();
    void copyText(rules, "Rules copied");
    // splitCombined is a closure over `combined`; React's eslint
    // can't see that so we depend on combined explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combined]);

  const copyJsonOnly = useCallback(() => {
    const { json } = splitCombined();
    void copyText(json, "JSON copied");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combined]);

  const copyAll = useCallback(() => {
    void copyText(combined, "Copied — paste into ChatGPT");
  }, [combined]);

  const downloadJson = useCallback(() => {
    const blob = new Blob([snapshotJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `site-content-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [snapshotJson]);

  // ── Import side ──
  const [importRaw, setImportRaw] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importParsed, setImportParsed] = useState<RoundtripSnapshot | null>(null);
  const [importStats, setImportStats] = useState<{ sectionsChanged: number; fieldsChanged: number } | null>(null);

  // Auto-validate 350ms after typing stops. Saves the user from
  // having to find + click a Validate button — paste → instant
  // feedback. The validator is pure, runs in <1ms even for big
  // compositions, so no perf concern.
  useEffect(() => {
    if (!open || tab !== "import") return;
    if (!importRaw.trim()) {
      setImportErrors([]);
      setImportParsed(null);
      setImportStats(null);
      return;
    }
    const handle = setTimeout(() => {
      try {
        const result = validateImportedJson({
          raw: importRaw,
          composition,
          templates,
          // Same scoping as export: validate against the SUBPAGE's
          // expected shape when on a subpage, so home-page JSON pasted
          // into a subpage tab fails fast with "unknown section ids"
          // instead of silently writing to the wrong page.
          targetPagePath,
        });
        if (result.ok) {
          setImportErrors([]);
          setImportParsed(result.parsed ?? {});
          setImportStats(result.stats ?? null);
        } else {
          setImportErrors(result.errors);
          setImportParsed(null);
          setImportStats(null);
        }
      } catch (e) {
        // Unexpected validator error (shouldn't happen — validator is
        // defensive — but surface ANY failure as a visible error
        // instead of silently swallowing it).
        const msg = e instanceof Error ? e.message : String(e);
        setImportErrors([`Validator crashed: ${msg}`]);
        setImportParsed(null);
        setImportStats(null);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [importRaw, composition, templates, open, tab]);

  // Full reset when modal closes.
  useEffect(() => {
    if (open) return;
    setImportRaw("");
    setImportErrors([]);
    setImportParsed(null);
    setImportStats(null);
    setTab("export");
  }, [open]);

  const confirmApply = useCallback(() => {
    if (!importParsed) return;
    onApply(importParsed);
    toast.success(
      `Applied ${importStats?.fieldsChanged ?? 0} field${(importStats?.fieldsChanged ?? 0) === 1 ? "" : "s"} across ${importStats?.sectionsChanged ?? 0} section${(importStats?.sectionsChanged ?? 0) === 1 ? "" : "s"}`,
    );
    onOpenChange(false);
  }, [importParsed, importStats, onApply, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-4">
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="dash-chip inline-flex h-7 w-7 items-center justify-center rounded-lg">
              <FileJson className="h-4 w-4" />
            </span>
            {isTranslate
              ? `Translate → ${targetLocaleLabel ?? ""}`
              : "JSON workflow"}
            {/* Page badge — only shown for subpage round-trips so the
                tech-admin can't paste the wrong page's JSON. Home
                round-trips stay clean (the title alone is enough). */}
            {!isTranslate && pageContext && pageContext.kind !== "home" && (
              <span className="dash-chip ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
                /{pageContext.pagePath.replace(/\.html$/, "")}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isTranslate ? (
              <>
                Copy the prompt below into chatgpt.com (free). ChatGPT returns
                the same content translated into{" "}
                <strong>{targetLocaleLabel}</strong>. Paste the reply back via
                the Import tab — it&apos;s saved as that language version, the
                original content stays untouched.
              </>
            ) : pageContext && pageContext.kind === "service_subpage" ? (
              <>
                You are filling the <strong>{pageContext.pageLabel}</strong>{" "}
                subpage, dedicated to the service{" "}
                <strong>{pageContext.linkedServiceTitle ?? "—"}</strong>. The
                JSON below contains only this subpage&apos;s sections. Copy the
                prompt into chatgpt.com, paste the reply back via Import.
              </>
            ) : pageContext && pageContext.kind === "custom_subpage" ? (
              <>
                You are filling the <strong>{pageContext.pageLabel}</strong>{" "}
                subpage (custom — no linked service). The JSON below contains
                only this subpage&apos;s sections. Copy the prompt into
                chatgpt.com, paste the reply back via Import.
              </>
            ) : (
              <>
                Copy the prompt below into chatgpt.com (free). Paste
                ChatGPT&apos;s reply back via the Import tab. Same field-update
                path as the paid AI Fill button — zero API cost.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Tab switcher — pill-style for a softer look than underlines */}
        <div className="dash-subhead dash-hairline inline-flex w-fit items-center gap-1 rounded-lg border p-1">
          <button
            type="button"
            onClick={() => setTab("export")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              tab === "export"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ArrowUpFromLine className="h-3 w-3" />
            Export
          </button>
          <button
            type="button"
            onClick={() => setTab("import")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              tab === "import"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ArrowDownToLine className="h-3 w-3" />
            Import
          </button>
        </div>

        {tab === "export" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground tabular-nums">{exportStats.sections}</span> section{exportStats.sections === 1 ? "" : "s"} ·{" "}
                <span className="font-medium text-foreground tabular-nums">{exportStats.fields}</span> field{exportStats.fields === 1 ? "" : "s"} ready to export
              </div>
              <div className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3 w-3" />
                Don&apos;t add/remove sections between export and import
              </div>
            </div>

            {(guideLoading || inputsLoading) ? (
              <div className="dash-subhead dash-hairline h-105 flex items-center justify-center text-sm text-muted-foreground border rounded-xl">
                <Loader2 className="dash-accent h-4 w-4 animate-spin mr-2" />
                Loading copywriting guide + proposal context…
              </div>
            ) : (
              <Textarea
                value={combined}
                onChange={(e) => setCombined(e.target.value)}
                // [field-sizing:fixed] overrides shadcn's default
                // field-sizing-content so the textarea respects h-105
                // instead of growing with content and pushing the
                // footer offscreen. break-words handles long unbreakable
                // tokens (URLs in JSON values) cleanly.
                className="font-mono text-[11px] leading-relaxed h-105 resize-none field-sizing-fixed wrap-break-word overflow-y-auto rounded-xl"
                spellCheck={false}
              />
            )}

            {/* Minimalist three-copy footer (Peter 2026-05-13):
                Rules-only, JSON-only, and Both. All three use the
                same compact outline style; the primary (filled)
                button is reserved for the most common action,
                "Copy all". Download lives on the far left as the
                less-common "save to file" path. */}
            <div className="flex items-center gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={downloadJson}
                className="gap-1.5 text-muted-foreground"
                title="Download the JSON portion as a .json file"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={copyRules}
                className="gap-1.5"
                title="Copy ONLY the copywriting rules + brand context (no JSON)"
              >
                <Copy className="h-3.5 w-3.5" />
                Rules
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={copyJsonOnly}
                className="gap-1.5"
                title="Copy ONLY the JSON snapshot (no rules)"
              >
                <Copy className="h-3.5 w-3.5" />
                JSON
              </Button>
              <Button
                size="sm"
                onClick={copyAll}
                className="gap-1.5"
                title="Copy everything (rules + JSON) ready to paste into ChatGPT"
              >
                <Copy className="h-3.5 w-3.5" />
                All
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div>Paste ChatGPT&apos;s reply — validates automatically as you paste.</div>
              {/* Pulsing dot while there's input but no verdict yet —
                  reassures the user something IS happening. */}
              {importRaw.trim() && !importParsed && importErrors.length === 0 && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-(--dash-accent) animate-pulse" />
                  Validating…
                </div>
              )}
            </div>

            <Textarea
              value={importRaw}
              onChange={(e) => setImportRaw(e.target.value)}
              placeholder='Paste the JSON ChatGPT replied with here. Markdown code fences and "Sure! Here&apos;s the JSON:" preamble are stripped automatically.'
              // Same field-sizing fix as the export textarea — without
              // it, pasting a big JSON makes the textarea grow past
              // the modal viewport.
              className="font-mono text-[11px] leading-relaxed h-90 resize-none field-sizing-fixed wrap-break-word overflow-y-auto rounded-xl"
              spellCheck={false}
            />

            {importErrors.length > 0 && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-destructive mb-1">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span className="tabular-nums">{importErrors.length}</span> problem{importErrors.length === 1 ? "" : "s"} — fix in ChatGPT and re-paste
                </div>
                <ul className="text-[11px] text-destructive/90 space-y-0.5 max-h-32 overflow-y-auto font-mono">
                  {importErrors.map((err, i) => (
                    <li key={i}>• {err}</li>
                  ))}
                </ul>
              </div>
            )}

            {importParsed && importStats && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <div className="text-xs">
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">Valid.</span>{" "}
                  <span className="text-muted-foreground tabular-nums">
                    Will update {importStats.fieldsChanged} field{importStats.fieldsChanged === 1 ? "" : "s"} across {importStats.sectionsChanged} section{importStats.sectionsChanged === 1 ? "" : "s"}.
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={confirmApply}
                disabled={!importParsed}
                className="gap-1.5"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Apply to composition
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
