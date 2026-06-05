"use client";

/**
 * Shared QR + bank-info renderer for the initial-site-payment BySquare flow.
 *
 * Used by:
 *   1. composer publish-menu — payment dialog that opens when an unpaid
 *      client clicks Publish (revealed on a second click via the soft
 *      intro step, not shown by default).
 *   2. (future) sales-side preview of what the client sees.
 *
 * Pulls from the same `proposals.qr_image_cache` / pricing
 * columns + the server's `BYSQUARE_IBAN` / `BYSQUARE_BENEFICIARY` env
 * vars, so updating the price via the sales banner-config dialog
 * cascades to every surface on next read.
 *
 * Pricing logic mirrors src/lib/payments/proposal-utils.ts (active
 * price = discount_price while discount window open, else base_price).
 * Keep it in sync if that file ever changes.
 */

import { useState } from "react";
import { Copy, Check, Sparkle as Sparkles } from "@phosphor-icons/react/ssr";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface BySquarePaymentDetailsProps {
  basePrice: number | null;
  discountPrice: number | null;
  discountExpiresAt: string | null;
  variableSymbol: string | null;
  iban: string | null;
  beneficiary: string | null;
  qrImageDataUrl: string | null;
  /** Visual tone — "amber" matches the dashboard card, "neutral" matches the
   *  publish-gate dialog. Affects the wrapper background only; QR + bank
   *  rows stay neutral so the data reads cleanly on either backdrop. */
  tone?: "amber" | "neutral";
}

export function BySquarePaymentDetails({
  basePrice,
  discountPrice,
  discountExpiresAt,
  variableSymbol,
  iban,
  beneficiary,
  qrImageDataUrl,
  tone = "neutral",
}: BySquarePaymentDetailsProps) {
  const discountActive = Boolean(
    discountPrice &&
      discountExpiresAt &&
      new Date(discountExpiresAt).getTime() > Date.now(),
  );
  const activePrice = discountActive
    ? discountPrice ?? basePrice ?? 0
    : basePrice ?? 0;
  const priceLabel = `$${activePrice.toFixed(2)}`;

  return (
    <div
      className={cn(
        "grid md:grid-cols-[auto_1fr] gap-5 p-4 rounded-lg",
        tone === "amber" && "bg-amber-50/40 dark:bg-amber-950/15",
        tone === "neutral" && "bg-muted/30",
      )}
    >
      {/* QR */}
      <div className="flex flex-col items-center md:items-start gap-2 mx-auto md:mx-0">
        {qrImageDataUrl ? (
          <div
            className={cn(
              "rounded-lg bg-white p-2 ring-1",
              tone === "amber" ? "ring-amber-200" : "ring-border",
            )}
          >
            <img
              src={qrImageDataUrl}
              alt="PAY by square QR code"
              className="h-40 w-40 block"
            />
          </div>
        ) : (
          <div
            className={cn(
              "h-40 w-40 rounded-lg flex items-center justify-center text-xs text-muted-foreground text-center p-4",
              tone === "amber"
                ? "bg-amber-100 dark:bg-amber-900/30"
                : "bg-muted",
            )}
          >
            QR code is being prepared…
          </div>
        )}
        <p className="text-[11px] text-muted-foreground text-center md:text-left max-w-40">
          Scan in your banking app
        </p>
      </div>

      {/* Bank details */}
      <div className="space-y-2 min-w-0">
        <p
          className={cn(
            "text-[11px] font-medium uppercase tracking-wide",
            tone === "amber"
              ? "text-amber-800/80 dark:text-amber-300/80"
              : "text-muted-foreground",
          )}
        >
          Or enter manually
        </p>

        <DetailRow
          label="Amount"
          value={priceLabel}
          copyValue={activePrice.toFixed(2)}
        />
        <DetailRow
          label="Reference"
          value={variableSymbol ?? "—"}
          copyValue={variableSymbol ?? undefined}
          mono
        />
        <DetailRow
          label="IBAN"
          value={iban ?? "—"}
          copyValue={iban ?? undefined}
          mono
        />
        <DetailRow
          label="Beneficiary"
          value={beneficiary ?? "—"}
          copyValue={beneficiary ?? undefined}
        />

        <p className="text-[11px] text-muted-foreground pt-1 flex items-start gap-1.5">
          <Sparkles
            className={cn(
              "h-3 w-3 mt-0.5 shrink-0",
              tone === "amber" ? "text-amber-600" : "text-primary",
            )}
          />
          <span>
            Payments are usually credited within 30 to 60 minutes. We launch
            your site right after confirmation.
          </span>
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// One row in the bank-details list with a copy-to-clipboard button.
// ────────────────────────────────────────────────────────────────────────────
function DetailRow({
  label,
  value,
  copyValue,
  mono,
}: {
  label: string;
  value: string;
  copyValue?: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Failed to copy");
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
          {label}
        </p>
        <p
          className={cn(
            "text-xs font-semibold text-foreground truncate leading-snug",
            mono && "font-mono",
          )}
        >
          {value}
        </p>
      </div>
      {copyValue && (
        <button
          onClick={copy}
          className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

/**
 * Pure helper to compute the active price the same way the rest of the
 * payment flow does. Exposed so non-React callsites (e.g. the publish
 * menu header label) can use it without duplicating the logic.
 */
export function getActiveBySquarePrice(
  basePrice: number | null,
  discountPrice: number | null,
  discountExpiresAt: string | null,
): number {
  const discountActive = Boolean(
    discountPrice &&
      discountExpiresAt &&
      new Date(discountExpiresAt).getTime() > Date.now(),
  );
  return discountActive ? discountPrice ?? basePrice ?? 0 : basePrice ?? 0;
}
