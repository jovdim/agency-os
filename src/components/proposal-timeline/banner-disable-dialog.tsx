"use client";

/**
 * BannerDisableDialog — confirmation step before turning the
 * payment banner OFF on the live client site.
 *
 * Per Peter 2026-05-10: turning the banner *on* requires a config
 * dialog (price + expiry), and turning it *off* requires a
 * confirmation. The asymmetry is intentional — disabling makes the
 * banner immediately disappear from a customer-facing site, and we
 * want to make that hard to fat-finger.
 *
 * On confirm:
 *
 *   1. PUT /api/proposals/[id] with { show_banner: false }
 *   2. POST /api/sites/[id]/publish?silent=true so the deployed
 *      HTML loses the script tag. Skipped when no site is linked.
 *
 * Same single-toast UX as BannerConfigDialog. Keep the dialog open
 * on publish failure so sales can retry without re-opening.
 */

import { useState, useTransition } from "react";
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
import { toast } from "sonner";
import { Loader2, EyeOff, AlertCircle } from "lucide-react";
import type { TimelineProposal, TimelineSite } from "./timeline-steps";

interface BannerDisableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposal: TimelineProposal;
  site: TimelineSite | null;
}

export function BannerDisableDialog({
  open,
  onOpenChange,
  proposal,
  site,
}: BannerDisableDialogProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    if (saving) return;
    setSaving(true);

    // ── 1. Flip the flag off ──────────────────────────────────
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ show_banner: false }),
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

    startTransition(() => router.refresh());

    // ── 2. Republish so the live HTML loses the widget tag ────
    if (!site?.id) {
      toast.success("Banner disabled.", {
        description:
          "The site isn't published yet — the change takes effect on the first publish.",
        duration: 4000,
      });
      setSaving(false);
      onOpenChange(false);
      return;
    }

    const publishingToastId = toast.loading("Updating the site…", {
      description: "This takes about 5 to 15 seconds.",
    });
    try {
      const pubRes = await fetch(
        `/api/sites/${site.id}/publish?silent=true`,
        { method: "POST" },
      );
      if (!pubRes.ok) {
        const data = await pubRes.json().catch(() => ({}));
        toast.error("The site wasn't updated — please try again.", {
          id: publishingToastId,
          description: data.error || "Cloudflare unavailable or another error.",
          duration: 8000,
        });
        setSaving(false);
        return;
      }
      toast.success("Banner disabled ✓", {
        id: publishingToastId,
        description: "Site updated.",
        duration: 4000,
      });
      startTransition(() => router.refresh());
      setSaving(false);
      onOpenChange(false);
    } catch (err) {
      toast.error("The site wasn't updated — please try again.", {
        id: publishingToastId,
        description: "Network error: " + (err as Error).message,
        duration: 8000,
      });
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <EyeOff className="size-4 text-amber-500" />
            Disable payment banner?
          </DialogTitle>
          <DialogDescription>
            The banner will immediately disappear from the website of client{" "}
            <span className="font-medium">{proposal.company_name}</span>.
            Site visitors will no longer see the price or the payment QR code.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
          <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
          <span>
            You can re-enable the banner anytime with the "Configure
            banner" button — the price and date settings stay saved.
          </span>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Disabling…
              </>
            ) : (
              <>
                <EyeOff className="size-4" />
                Disable banner
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
