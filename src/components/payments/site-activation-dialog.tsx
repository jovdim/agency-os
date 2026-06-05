"use client";

/**
 * Site-activation paywall dialog — the "you haven't paid for your website yet"
 * conversation surface.
 *
 * Two stages:
 *   (1) Soft intro — short title + breakdown + checkmark list of what the
 *       client will be able to do after paying. Primary CTA "Show
 *       payment details" reveals stage 2.
 *   (2) Reveal — lazy-fetches /api/sites/[id]/site-payment-info and renders
 *       the shared BySquare QR + bank info.
 *
 * Used by:
 *   - composer publish-menu (when an unpaid client tries to Publish)
 *   - /client dashboard (when an unpaid client clicks the "set up domain
 *     and business email" card)
 *
 * All copy + visuals + fetch logic live here so the two callsites stay
 * pixel-identical without code duplication. Reset-on-close ensures
 * re-opens always land on stage 1.
 */

import { useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, CreditCard, CircleNotch as Loader2 } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { BySquarePaymentDetails } from "@/components/payments/bysquare-payment-details";

/** Shape returned by /api/sites/[id]/site-payment-info — lazy-loaded the
 *  first time the user clicks "Show payment details". */
interface SitePaymentInfo {
  basePrice: number | null;
  discountPrice: number | null;
  discountExpiresAt: string | null;
  variableSymbol: string | null;
  qrImageDataUrl: string | null;
  iban: string | null;
  beneficiary: string | null;
}

export interface SiteActivationDialogProps {
  siteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SiteActivationDialog({
  siteId,
  open,
  onOpenChange,
}: SiteActivationDialogProps) {
  // Two-stage state. detailsRevealed flips to true when the user clicks
  // "Show payment details" in stage 1 — that's when we fetch the QR.
  const [detailsRevealed, setDetailsRevealed] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<SitePaymentInfo | null>(null);
  const [paymentInfoLoading, setPaymentInfoLoading] = useState(false);

  /** Handler for the dialog's "open" prop. Resets detailsRevealed on close
   *  so the next time the dialog opens, the client lands back on stage 1
   *  (soft intro) — not on whatever stage they left it at. */
  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) setDetailsRevealed(false);
  }

  /** Reveal QR + bank details (stage 2). Fires the lazy fetch on first
   *  call and caches the response — re-opens reuse the cached data
   *  (price / QR are effectively static for the lifetime of the session,
   *  only change when sales updates the proposal). */
  const revealPaymentDetails = useCallback(async () => {
    setDetailsRevealed(true);
    if (paymentInfo || paymentInfoLoading) return;
    setPaymentInfoLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/site-payment-info`);
      if (!res.ok) {
        toast.error("Failed to load payment details");
        return;
      }
      const data = await res.json();
      setPaymentInfo({
        basePrice: data.base_price ?? null,
        discountPrice: data.discount_price ?? null,
        discountExpiresAt: data.discount_expires_at ?? null,
        variableSymbol: data.variable_symbol ?? null,
        qrImageDataUrl: data.qr_image_data_url ?? null,
        iban: data.iban ?? null,
        beneficiary: data.beneficiary ?? null,
      });
    } catch {
      toast.error("Network error, please try again");
    } finally {
      setPaymentInfoLoading(false);
    }
  }, [siteId, paymentInfo, paymentInfoLoading]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        {!detailsRevealed ? (
          // ── Stage 1 — visually polished explanation.
          // Hero icon, centered title + description, minimalist checkmark
          // list of next-step actions, primary CTA to reveal stage 2.
          <>
            <DialogHeader className="items-center space-y-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                <CreditCard className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="text-center text-lg">
                Pay for your website first
              </DialogTitle>
              <DialogDescription className="text-center leading-relaxed">
                You haven&apos;t paid for your website yet. Your changes are
                saved and ready to publish once payment is complete.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground text-center">
                Once paid, you can
              </p>
              <ul className="mx-auto max-w-sm space-y-2">
                <li className="flex items-start gap-2.5 text-sm">
                  <Check
                    className="h-4 w-4 text-primary shrink-0 mt-0.5"
                    strokeWidth={3}
                  />
                  <span>Register or transfer your domain</span>
                </li>
                <li className="flex items-start gap-2.5 text-sm">
                  <Check
                    className="h-4 w-4 text-primary shrink-0 mt-0.5"
                    strokeWidth={3}
                  />
                  <span>Set up your business email address</span>
                </li>
                <li className="flex items-start gap-2.5 text-sm">
                  <Check
                    className="h-4 w-4 text-primary shrink-0 mt-0.5"
                    strokeWidth={3}
                  />
                  <span>Publish edits to your website</span>
                </li>
              </ul>
            </div>

            <Button
              size="lg"
              className="w-full gap-2"
              onClick={() => {
                void revealPaymentDetails();
              }}
            >
              <CreditCard className="h-4 w-4" />
              Show payment details
            </Button>
          </>
        ) : (
          // ── Stage 2 — QR + bank info reveal. Loading state covers the
          // first-fetch window; cached data on subsequent reveals.
          <>
            <DialogHeader>
              <DialogTitle>Payment details</DialogTitle>
              <DialogDescription>
                Scan the QR code in your banking app or enter the details
                manually. Payment is usually credited within 30 to 60 minutes.
              </DialogDescription>
            </DialogHeader>

            {paymentInfoLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : paymentInfo ? (
              <BySquarePaymentDetails
                basePrice={paymentInfo.basePrice}
                discountPrice={paymentInfo.discountPrice}
                discountExpiresAt={paymentInfo.discountExpiresAt}
                variableSymbol={paymentInfo.variableSymbol}
                iban={paymentInfo.iban}
                beneficiary={paymentInfo.beneficiary}
                qrImageDataUrl={paymentInfo.qrImageDataUrl}
                tone="neutral"
              />
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                We couldn&apos;t load the payment details. Please try again
                later, or contact us via Message us.
              </p>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
