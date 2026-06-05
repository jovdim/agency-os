"use client";

/**
 * Dashboard tile shown to unpaid clients in place of the "Domain and
 * business email" Link.
 *
 * Visually similar to the paid version with one tweak: a small pulsing
 * amber dot in the corner of the Mail icon. Signals "this needs your
 * attention" the same way an unread-notification badge does, without
 * any "you haven't paid" copy on the tile itself. The conversation
 * about WHY happens inside the modal that opens on click.
 *
 * The click handler differs from the paid version: instead of
 * navigating to /client/domain, it opens the shared
 * <SiteActivationDialog> — the same dialog the composer publish flow
 * uses when an unpaid client tries to publish. One paywall message,
 * surfaced from three entry points (publish, this card, future).
 */

import { useState } from "react";
import { Envelope as Mail } from "@phosphor-icons/react/ssr";
import { SiteActivationDialog } from "@/components/payments/site-activation-dialog";

interface UnpaidDomainEmailCardProps {
  siteId: string;
}

export function UnpaidDomainEmailCard({ siteId }: UnpaidDomainEmailCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="group rounded-lg border bg-card p-5 text-left transition-all hover:border-primary/50 hover:shadow-sm"
      >
        <div className="flex items-start gap-4">
          {/* Mail icon with a small pulsing amber dot overlay — signals
              "this needs your attention" the same way a notification
              badge does. Subtle on purpose: the conversation about WHY
              lives inside the modal, not in a screaming label here. */}
          <div className="relative shrink-0">
            <div className="rounded-lg bg-muted p-2.5 group-hover:bg-muted/80 transition-colors">
              <Mail className="h-5 w-5 text-muted-foreground" />
            </div>
            <span
              className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5"
              aria-hidden
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-card" />
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Domain and business email</p>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              Set up your own domain and choose your business email address.
            </p>
          </div>
        </div>
      </button>

      <SiteActivationDialog
        siteId={siteId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
