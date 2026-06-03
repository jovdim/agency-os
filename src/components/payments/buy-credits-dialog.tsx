"use client";

/**
 * Top-up dialog for the client's credit balance.
 *
 * Visual style — flat, type-led, no gradients/glow/blur. Uses solid
 * colors and intentional borders to build hierarchy.
 *
 * Payment methods — bank transfer (BySquare QR) is the only active
 * path right now (Peter 2026-05-30). Stripe card checkout is rendered
 * disabled with a "Coming soon" badge — the API routes + payByCard
 * handler are intentionally kept so re-enabling later is one edit.
 *
 * Layout:
 *   1. Compact header — title + site name + close
 *   2. Package picker — 5 preset amounts, one marked featured
 *   3. Summary line — total + publish count
 *   4. Payment method cards (solid, bordered):
 *      a) BySquare (bank transfer via QR) — primary, with explicit
 *         "Credited within 30-60 min" notice. Wires to /api/payments/qr.
 *      b) Stripe (card payment) — DISABLED + "Coming soon" badge.
 *   5. QR view — shown after the BySquare path generates a QR
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  X,
  Check,
  Clock,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";

// Per-publish cost in € — matches the publish-charge constant in the API
// (src/app/api/sites/[id]/publish/route.ts) and the publish-menu UI.
const COST_PER_CHANGE = 12.5;

interface Preset {
  eur: number;
  publishes: number;
  badge?: string;
  popular?: boolean;
}

const PRESETS: Preset[] = [
  { eur: 25, publishes: 2 },
  { eur: 50, publishes: 4 },
  { eur: 75, publishes: 6, badge: "Best value", popular: true },
  { eur: 100, publishes: 8 },
  { eur: 200, publishes: 16 },
];

/** English pluralization for "publish". */
function pluralPub(n: number): string {
  return n === 1 ? "publish" : "publishes";
}

interface BuyCreditsDialogProps {
  siteId: string;
  siteName: string;
  onClose: () => void;
}

export function BuyCreditsDialog({ siteId, siteName, onClose }: BuyCreditsDialogProps) {
  // Two input modes share one effective amount — clicking a preset
  // sets `mode='preset'`, typing in the custom field sets `mode='custom'`.
  // Whichever was touched last wins. Server-side validation (multiple
  // of 12.50, ≤ 1000) catches anything the UI lets slip.
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [presetSelected, setPresetSelected] = useState(75);
  const [customRaw, setCustomRaw] = useState("");
  const [loadingMethod, setLoadingMethod] = useState<"stripe" | "bysquare" | null>(null);
  const [qrData, setQrData] = useState<{
    qrImageDataUrl: string;
    variableSymbol: string;
    amount: number;
    iban: string;
  } | null>(null);

  // Custom input is a publish COUNT (positive integer). Client types
  // "I want 12 publishes" — we multiply by 12.50 € to get the price.
  // Better mental model than typing euros (no "must be multiple of
  // 12.50" gotcha; the count is always inherently a valid quantity).
  // Cap at 80 publishes (= 1000 €), matching the server cap.
  const MAX_CUSTOM_PUBLISHES = 80;

  const customCount = (() => {
    const cleaned = customRaw.trim();
    if (!cleaned) return null;
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const customValid =
    customCount !== null && customCount <= MAX_CUSTOM_PUBLISHES;

  // Effective amount depends on mode. In custom mode an invalid value
  // collapses to 0, which disables the payment buttons.
  const selected =
    mode === "custom"
      ? customValid
        ? (customCount as number) * COST_PER_CHANGE
        : 0
      : presetSelected;
  const publishCount = Math.floor(selected / COST_PER_CHANGE);

  // Input handlers — set both mode + value together so the active
  // selection is unambiguous.
  function handlePresetClick(eur: number) {
    setMode("preset");
    setPresetSelected(eur);
  }
  function handleCustomChange(value: string) {
    // Digits only, max 3 (covers 1–999 — server cap kicks in earlier).
    const sanitized = value.replace(/[^0-9]/g, "").slice(0, 3);
    setCustomRaw(sanitized);
    setMode("custom");
  }

  // Stripe path is disabled in the UI (Peter 2026-05-30 — bank
  // transfer only for now). Kept so re-enabling is a one-button-edit;
  // see the "Payment method" section.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function payByCard() {
    if (publishCount <= 0) return;
    setLoadingMethod("stripe");
    try {
      const res = await fetch("/api/payments/stripe/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: siteId, credits: publishCount }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        // 503 = Stripe not configured server-side. Surface a clean
        // explanation rather than the technical error.
        if (res.status === 503) {
          toast.error(
            "Card payment is currently unavailable. Please use the QR code below.",
          );
        } else {
          toast.error(data?.error || "Failed to start card payment");
        }
        return;
      }
      // Redirect the whole page to Stripe-hosted Checkout. They'll come
      // back to /client/balance?topup=success when done.
      window.location.href = data.url as string;
    } catch (err) {
      toast.error(
        err instanceof Error ? `Network error: ${err.message}` : "Network error",
      );
    } finally {
      setLoadingMethod(null);
    }
  }

  async function payByBank() {
    setLoadingMethod("bysquare");
    try {
      const res = await fetch("/api/payments/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: siteId, credits: publishCount }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to generate QR code");
        return;
      }
      setQrData(data);
    } catch {
      toast.error("Network error");
    } finally {
      setLoadingMethod(null);
    }
  }

  const ibanFormatted = qrData?.iban
    ? qrData.iban.replace(/(.{4})/g, "$1 ").trim()
    : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 cursor-pointer"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-lg border bg-card shadow-xl overflow-hidden max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────── */}
        <div className="px-5 pt-5 pb-4 border-b">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">
                Top up balance
              </h2>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {siteName}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 hover:bg-muted transition-colors -mt-1 -mr-1"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-5 space-y-5">
          {!qrData ? (
            <>
              {/* ── Package picker ─────────────────────────── */}
              <section className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Choose a package
                </p>
                {/* Top row — 4 small cards */}
                <div className="grid grid-cols-4 gap-2">
                  {PRESETS.filter((p) => !p.popular).map((p) => (
                    <PresetCard
                      key={p.eur}
                      preset={p}
                      isSelected={mode === "preset" && presetSelected === p.eur}
                      onClick={() => handlePresetClick(p.eur)}
                    />
                  ))}
                </div>
                {/* Featured row — full width */}
                {PRESETS.filter((p) => p.popular).map((p) => (
                  <FeaturedPresetCard
                    key={p.eur}
                    preset={p}
                    isSelected={mode === "preset" && presetSelected === p.eur}
                    onClick={() => handlePresetClick(p.eur)}
                  />
                ))}

                {/* Custom count input — client types HOW MANY publishes
                    they want, we compute the price. No "must be multiple
                    of 12.50" gotcha because count is inherently valid. */}
                <div
                  className={`relative rounded-md border transition-colors ${
                    mode === "custom"
                      ? customValid
                        ? "border-primary bg-primary/5"
                        : "border-destructive/60 bg-destructive/5"
                      : "border-input hover:border-foreground/40"
                  }`}
                >
                  <label className="flex items-center gap-2 px-4 py-3">
                    <span className="text-xs text-muted-foreground shrink-0">
                      Custom amount
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="e.g. 12"
                      value={customRaw}
                      onChange={(e) => handleCustomChange(e.target.value)}
                      onFocus={() => setMode("custom")}
                      className="flex-1 bg-transparent text-base font-semibold tabular-nums text-right outline-none placeholder:text-muted-foreground/40 placeholder:font-normal"
                      aria-label="Custom number of publishes"
                    />
                    <span className="text-base font-semibold text-muted-foreground shrink-0 min-w-20 text-left">
                      {customCount === null
                        ? "publishes"
                        : pluralPub(customCount)}
                    </span>
                  </label>
                  {/* Inline status line — only shows when there's input. */}
                  {customRaw && (
                    <p
                      className={`text-[11px] px-4 pb-2 -mt-1 ${
                        customValid ? "text-muted-foreground" : "text-destructive"
                      }`}
                    >
                      {customValid
                        ? `= €${selected.toFixed(2)}`
                        : `Maximum is ${MAX_CUSTOM_PUBLISHES} publishes`}
                    </p>
                  )}
                </div>
              </section>

              {/* ── Summary ─────────────────────────────────── */}
              <div className="flex items-baseline justify-between border-y py-3 -mx-5 px-5">
                <div className="text-xs text-muted-foreground">
                  {publishCount} {pluralPub(publishCount)} ×{" "}
                  €{COST_PER_CHANGE.toFixed(2)}
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  €{selected}
                </div>
              </div>

              {/* ── Payment methods ───────────────────────────
                  Order is intentional — primary action first.
                  BySquare (bank transfer) is the only active method;
                  Stripe is rendered disabled with a "Coming soon" badge.
                  When Stripe re-launches, swap the two buttons back
                  to their previous styling and remove the disabled
                  state — payByCard + the API route still work. */}
              <section className="space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Payment method
                </p>

                {/* BySquare — primary (solid emerald) */}
                <button
                  type="button"
                  onClick={payByBank}
                  disabled={loadingMethod !== null || selected <= 0}
                  className="group w-full rounded-md border border-emerald-700 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm font-semibold">
                        Bank transfer (QR code)
                      </span>
                      <p className="text-[11px] text-emerald-50/90 mt-0.5">
                        PAY by square · credited within 30–60 min
                      </p>
                    </div>
                    {loadingMethod === "bysquare" ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-90" />
                    ) : (
                      <ArrowRight className="h-4 w-4 shrink-0 opacity-80 group-hover:translate-x-0.5 transition-transform" />
                    )}
                  </div>
                </button>

                {/* Stripe — disabled, "Coming soon" badge. Kept visible
                    so clients know card payment is coming. */}
                <button
                  type="button"
                  disabled
                  title="Card payment will be available soon"
                  className="group w-full rounded-md border border-dashed border-input bg-muted/30 text-muted-foreground px-4 py-3 text-left cursor-not-allowed"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">
                          Pay by card
                        </span>
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded border">
                          Coming soon
                        </span>
                      </div>
                      <p className="text-[11px] mt-0.5">
                        Visa, Mastercard, Apple Pay
                      </p>
                    </div>
                  </div>
                </button>
              </section>
            </>
          ) : (
            // ── QR view (BySquare path) ───────────────────────
            <div className="space-y-4">
              <div className="flex flex-col items-center pt-1">
                <div className="rounded-md border bg-white p-3 mb-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrData.qrImageDataUrl}
                    alt="PAY by square QR"
                    width={200}
                    height={200}
                  />
                </div>
                <p className="text-sm font-semibold">
                  Scan in your banking app
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  PAY by square · bank transfer
                </p>
              </div>

              <div className="rounded-md border bg-muted/30 px-4 py-3 space-y-2 text-sm">
                <Row label="IBAN" value={ibanFormatted} mono />
                <Row label="Amount" value={`€${qrData.amount}`} bold />
                <Row label="VS" value={qrData.variableSymbol} mono />
                <Row label="Number of publishes" value={String(publishCount)} />
              </div>

              <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 flex items-start gap-2">
                <Clock className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-snug">
                  Once the payment is received by the bank, your balance is
                  credited automatically within 30–60 minutes.
                </p>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1 gap-1.5"
                  onClick={() => setQrData(null)}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
                <Button className="flex-1" onClick={onClose}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────── */

function PresetCard({
  preset,
  isSelected,
  onClick,
}: {
  preset: Preset;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-center py-2.5 px-1 rounded-md border transition-colors ${
        isSelected
          ? "border-primary bg-primary/5"
          : "border-input hover:border-foreground/40 hover:bg-muted/30"
      }`}
    >
      <span
        className={`text-base font-semibold tabular-nums ${
          isSelected ? "text-primary" : ""
        }`}
      >
        {preset.eur} €
      </span>
      <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
        {preset.publishes} {pluralPub(preset.publishes)}
      </span>
      {isSelected && (
        <div className="absolute -top-1.5 -right-1.5 rounded-full bg-primary p-0.5">
          <Check className="h-2.5 w-2.5 text-primary-foreground" />
        </div>
      )}
    </button>
  );
}

function FeaturedPresetCard({
  preset,
  isSelected,
  onClick,
}: {
  preset: Preset;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full flex items-center justify-between py-3 px-4 rounded-md border transition-colors ${
        isSelected
          ? "border-primary bg-primary/5"
          : "border-input hover:border-foreground/40 hover:bg-muted/30"
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={`text-base font-semibold tabular-nums ${
            isSelected ? "text-primary" : ""
          }`}
        >
          {preset.eur} €
        </span>
        <span className="text-xs text-muted-foreground">
          {preset.publishes} {pluralPub(preset.publishes)}
        </span>
      </div>
      {preset.badge && (
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {preset.badge}
        </span>
      )}
      {isSelected && (
        <div className="absolute -top-1.5 -right-1.5 rounded-full bg-primary p-0.5">
          <Check className="h-2.5 w-2.5 text-primary-foreground" />
        </div>
      )}
    </button>
  );
}

function Row({
  label,
  value,
  mono = false,
  bold = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span
        className={`${mono ? "font-mono text-xs" : ""} ${bold ? "font-semibold" : "font-medium"}`}
      >
        {value}
      </span>
    </div>
  );
}
