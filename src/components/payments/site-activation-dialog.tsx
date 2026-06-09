"use client";

/**
 * Site-activation paywall dialog — the "you haven't paid for your website yet"
 * conversation surface.
 *
 * Two stages:
 *   (1) Soft intro — short title + checkmark list of what the client will be
 *       able to do after paying. Primary CTA "Show payment details" reveals
 *       stage 2.
 *   (2) Reveal — lazy-fetches /api/sites/[id]/site-payment-info and shows the
 *       price + a Stripe "Pay by card" button (and a scan-to-pay QR). Card is
 *       the only payment method — BySquare bank transfer was retired
 *       2026-06-09; Stripe is the single gateway.
 *
 * Used by:
 *   - composer publish-menu (when an unpaid client tries to Publish)
 *   - /client dashboard (when an unpaid client clicks the "set up domain
 *     and business email" card)
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

/** Shape returned by /api/sites/[id]/site-payment-info — lazy-loaded the
 *  first time the user clicks "Show payment details". */
interface SitePaymentInfo {
  basePrice: number | null;
  discountPrice: number | null;
  discountExpiresAt: string | null;
  activePrice: number | null;
  payUrl: string | null;
  qrImageDataUrl: string | null;
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
  const [detailsRevealed, setDetailsRevealed] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<SitePaymentInfo | null>(null);
  const [paymentInfoLoading, setPaymentInfoLoading] = useState(false);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) setDetailsRevealed(false);
  }

  /** Reveal price + pay options (stage 2). Fires the lazy fetch on first
   *  call and caches the response. */
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
        activePrice: data.active_price ?? null,
        payUrl: data.pay_url ?? null,
        qrImageDataUrl: data.qr_image_data_url ?? null,
      });
    } catch {
      toast.error("Network error, please try again");
    } finally {
      setPaymentInfoLoading(false);
    }
  }, [siteId, paymentInfo, paymentInfoLoading]);

  const discountActive = Boolean(
    paymentInfo?.discountPrice &&
      paymentInfo?.discountExpiresAt &&
      new Date(paymentInfo.discountExpiresAt).getTime() > Date.now(),
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        {!detailsRevealed ? (
          // ── Stage 1 — soft intro.
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
                  <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" strokeWidth={3} />
                  <span>Register or transfer your domain</span>
                </li>
                <li className="flex items-start gap-2.5 text-sm">
                  <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" strokeWidth={3} />
                  <span>Set up your business email address</span>
                </li>
                <li className="flex items-start gap-2.5 text-sm">
                  <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" strokeWidth={3} />
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
          // ── Stage 2 — price + Stripe pay options.
          <>
            <DialogHeader>
              <DialogTitle>Pay for your website</DialogTitle>
              <DialogDescription>
                Pay securely by card. Your site goes live right after payment.
              </DialogDescription>
            </DialogHeader>

            {paymentInfoLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : paymentInfo?.payUrl && paymentInfo.activePrice != null ? (
              <div className="space-y-5 py-2">
                {/* Price */}
                <div className="text-center">
                  <div className="flex items-baseline justify-center gap-2">
                    {discountActive &&
                      paymentInfo.basePrice != null &&
                      paymentInfo.basePrice > (paymentInfo.activePrice ?? 0) && (
                        <span className="text-base text-muted-foreground line-through">
                          ${paymentInfo.basePrice.toFixed(2)}
                        </span>
                      )}
                    <span className="text-4xl font-bold tracking-tight">
                      ${paymentInfo.activePrice.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    One-time payment · domain &amp; hosting for the first year
                    included
                  </p>
                </div>

                {/* Pay by card — navigates to the Stripe Checkout entry point */}
                <Button asChild size="lg" className="w-full gap-2">
                  <a href={paymentInfo.payUrl}>
                    <CreditCard className="h-4 w-4" />
                    Pay by card
                  </a>
                </Button>

                {/* Scan-to-pay QR (same Stripe link, for paying on a phone) */}
                {paymentInfo.qrImageDataUrl && (
                  <div className="flex flex-col items-center gap-2 border-t pt-4">
                    <div className="rounded-lg bg-white p-2 ring-1 ring-border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={paymentInfo.qrImageDataUrl}
                        alt="Scan to pay by card"
                        className="h-36 w-36 block"
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground text-center">
                      Or scan to pay on your phone
                    </p>
                  </div>
                )}
              </div>
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
