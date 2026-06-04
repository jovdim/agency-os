"use client";

/**
 * BannerConfigDialog — sales surface for the payment banner widget
 * that the deployed client site renders. Replaces the old one-click
 * banner toggle (per Peter 2026-05-10 v2): turning the banner ON
 * now requires confirming/adjusting the price + expiry pair that
 * visitors will actually see, instead of relying on whatever was
 * last set during Send-to-client.
 *
 * Three editable fields, all prefilled from the proposal row:
 *
 *   - Discount price   (proposals.discount_price)
 *   - Base price       (proposals.base_price, default $299)
 *   - Discount expiry  (proposals.discount_expires_at — date only;
 *                       persisted as end-of-day in Slovak time so
 *                       the banner stays "active" through the chosen
 *                       day from a visitor's perspective)
 *
 * Company name is read-only here — it's edited from the proposal
 * detail page. Showing it confirms what will appear on the banner.
 *
 * On Save:
 *
 *   1. PUT /api/proposals/[id] with { show_banner: true,
 *      discount_price, base_price, discount_expires_at }
 *   2. POST /api/sites/[id]/publish?silent=true to push the new
 *      HTML (including the script tag for the widget) to Cloudflare.
 *      Skipped if no site is linked yet — the flag still saves and
 *      kicks in on the next publish.
 *
 * Validation mirrors the server: discount ≥ $149, base ≥ discount,
 * expiry must parse. Any failure aborts before the API call so we
 * never half-commit (see feedback_atomic_operations.md).
 *
 * On publish failure we *keep the dialog open* so sales can click
 * Save again — the DB already has the new flags, the second click
 * is effectively a publish-only retry. Closing the dialog would
 * lose the form state and make recovery feel worse than it is.
 */

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Megaphone, AlertCircle, ExternalLink } from "lucide-react";
import {
  DEFAULT_BASE_PRICE,
  MIN_DISCOUNT_PRICE,
  DISCOUNT_WINDOW_DAYS,
} from "@/lib/payments/proposal-utils";
import type { TimelineProposal, TimelineSite } from "./timeline-steps";

interface BannerConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposal: TimelineProposal;
  site: TimelineSite | null;
  /**
   * Resolved live URL for the deployed site (custom domain when set,
   * otherwise the *.pages.dev subdomain). Computed by the launcher and
   * passed in so the success toast can offer a one-click "view on
   * live site" verification action — sales sees the banner with
   * their own eyes instead of just trusting the toast.
   */
  liveUrl: string | null;
}

/**
 * Convert an ISO timestamp (or null) to a YYYY-MM-DD string for the
 * native date input. Returns "" if the value is null/invalid.
 */
function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Use local-date components so the displayed date matches what the
  // user picked, not the UTC calendar date.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Take a YYYY-MM-DD value from the date input and produce an ISO
 * timestamp pinned to end-of-day in the user's local timezone (Slovak
 * time, in practice). The reasoning: when sales picks "May 24" they
 * mean "discount valid through end of May 24", not "expires at 2am on
 * May 24" — which is what plain new Date("2026-05-24").toISOString()
 * would give us (midnight UTC = 2am CEST).
 */
function dateInputToEndOfDayIso(value: string): string | null {
  if (!value) return null;
  // Construct as local time (no Z) so the JS engine applies the
  // user's tz offset on its own.
  const d = new Date(`${value}T23:59:59`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Compute a fallback expiry when the proposal has no
 * discount_expires_at yet (banner being turned on for the first
 * time, or row predates the column). Uses the same 14-day window the
 * Send-to-client flow does, anchored at "today" rather than at any
 * sent_at — this keeps the dialog usable even on un-sent proposals.
 */
function defaultExpiryDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + DISCOUNT_WINDOW_DAYS);
  return isoToDateInput(d.toISOString());
}

export function BannerConfigDialog({
  open,
  onOpenChange,
  proposal,
  site,
  liveUrl,
}: BannerConfigDialogProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // ── Form state (prefilled from row, reset on open) ──────────
  const [discount, setDiscount] = useState("");
  const [base, setBase] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset form whenever the dialog re-opens — keeps the prefill in
  // sync with the latest server data the parent already loaded into
  // the proposal prop. (No second fetch — Next's router.refresh()
  // after a successful save flows new values through this prop.)
  useEffect(() => {
    if (!open) return;
    setDiscount(
      proposal.discount_price != null ? String(proposal.discount_price) : "",
    );
    setBase(
      proposal.base_price != null
        ? String(proposal.base_price)
        : String(DEFAULT_BASE_PRICE),
    );
    setExpiryDate(
      proposal.discount_expires_at
        ? isoToDateInput(proposal.discount_expires_at)
        : defaultExpiryDate(),
    );
  }, [
    open,
    proposal.discount_price,
    proposal.base_price,
    proposal.discount_expires_at,
  ]);

  const wasAlreadyOn = proposal.show_banner;
  const title = wasAlreadyOn ? "Edit payment banner" : "Enable payment banner";
  const cta = wasAlreadyOn ? "Save changes" : "Enable banner";

  async function handleSave() {
    if (saving) return;

    // ── Client-side validation (mirror of server-side checks) ──
    const discountNum = parseFloat(discount);
    if (!Number.isFinite(discountNum) || discountNum < MIN_DISCOUNT_PRICE) {
      toast.error(`The discount price must be at least $${MIN_DISCOUNT_PRICE}.`);
      return;
    }
    const baseNum = parseFloat(base);
    if (!Number.isFinite(baseNum) || baseNum < MIN_DISCOUNT_PRICE) {
      toast.error(`The price after expiry must be at least $${MIN_DISCOUNT_PRICE}.`);
      return;
    }
    if (baseNum < discountNum) {
      toast.error("The price after expiry must be greater than or equal to the discount price.");
      return;
    }
    const expiryIso = dateInputToEndOfDayIso(expiryDate);
    if (!expiryIso) {
      toast.error("Select an end date for the discount price.");
      return;
    }

    setSaving(true);

    // ── 1. Save flag + pricing on the proposal row ────────────
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          show_banner: true,
          discount_price: discountNum,
          base_price: baseNum,
          discount_expires_at: expiryIso,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to save.");
        setSaving(false);
        return;
      }
    } catch (err) {
      toast.error("Network error: " + (err as Error).message);
      setSaving(false);
      return;
    }

    // Refresh the timeline now so any other UI bound to the row
    // (e.g. the price preview) sees the new values even if the
    // republish step below fails.
    startTransition(() => router.refresh());

    // ── 2. Republish so the deployed HTML reflects the change ──
    // Skipped when no site is linked yet — the row is saved and
    // the toggle will take effect on the first publish.
    if (!site?.id) {
      toast.success(
        wasAlreadyOn ? "Changes saved." : "Banner enabled.",
        {
          description:
            "The site isn't published yet — the change takes effect on the first publish.",
          duration: 4000,
        },
      );
      setSaving(false);
      onOpenChange(false);
      return;
    }

    const publishingToastId = toast.loading(
      "Updating the site…",
      { description: "This takes about 5 to 15 seconds." },
    );
    try {
      const pubRes = await fetch(
        `/api/sites/${site.id}/publish?silent=true`,
        { method: "POST" },
      );
      if (!pubRes.ok) {
        const data = await pubRes.json().catch(() => ({}));
        toast.error(
          "The site wasn't updated — click Save again to retry.",
          {
            id: publishingToastId,
            description:
              data.error || "Cloudflare unavailable or another error.",
            duration: 8000,
          },
        );
        // Keep the dialog open — sales hits Save again and the
        // second click is effectively a publish-only retry.
        setSaving(false);
        return;
      }
      toast.success(
        wasAlreadyOn ? "Changes saved ✓" : "Banner enabled ✓",
        {
          id: publishingToastId,
          description: "Site updated.",
          // One-click verification: opens the live site so sales
          // can see the banner with their own eyes. The link only
          // appears when we actually have a URL — if the site
          // isn't published yet, the dialog already exited via
          // the !site.id branch above so liveUrl truthiness here
          // implies a real Cloudflare URL.
          action: liveUrl
            ? {
                label: "View on the site",
                onClick: () => window.open(liveUrl, "_blank", "noopener"),
              }
            : undefined,
          duration: 6000,
        },
      );
      startTransition(() => router.refresh());
      setSaving(false);
      onOpenChange(false);
    } catch (err) {
      toast.error(
        "The site wasn't updated — click Save again to retry.",
        {
          id: publishingToastId,
          description: "Network error: " + (err as Error).message,
          duration: 8000,
        },
      );
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="size-4 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>
            The banner appears at the top of the client's website with the
            current price and a QR code for payment. The fields are pre-filled
            from the proposal — adjust them as needed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Read-only company-name preview — confirms what'll appear
              on the banner without making it editable here. */}
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Company on the banner
            </div>
            <div className="text-sm font-medium">{proposal.company_name}</div>
          </div>

          {/* 2-col pricing grid — same layout as SendProposalDialog
              so the two surfaces feel related. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bc-discount" className="text-xs">
                Discount price ($)
              </Label>
              <Input
                id="bc-discount"
                type="number"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                min={MIN_DISCOUNT_PRICE}
                step="1"
                disabled={saving}
                className="font-mono text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Min. ${MIN_DISCOUNT_PRICE}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bc-base" className="text-xs">
                Price after expiry ($)
              </Label>
              <Input
                id="bc-base"
                type="number"
                value={base}
                onChange={(e) => setBase(e.target.value)}
                min={MIN_DISCOUNT_PRICE}
                step="1"
                disabled={saving}
                className="font-mono text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Standard price
              </p>
            </div>
          </div>

          {/* Expiry — own row because date pickers eat horizontal space
              awkwardly on mobile and we want the helper line under it. */}
          <div className="space-y-1.5">
            <Label htmlFor="bc-expiry" className="text-xs">
              Discount end date
            </Label>
            <Input
              id="bc-expiry"
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              disabled={saving}
              className="text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              After this date, the price on the banner reverts to the standard
              amount. It can be extended later.
            </p>
          </div>

          {!site?.id && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
              <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
              <span>
                The site isn't published yet. The setting will be saved
                and the banner will appear on the first publish.
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Megaphone className="size-4" />
                {cta}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
