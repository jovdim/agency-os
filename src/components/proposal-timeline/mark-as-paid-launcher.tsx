"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Wallet } from "lucide-react";
import { MarkAsPaidWizard } from "./mark-as-paid-wizard";

/**
 * Mark-as-paid launcher — small wrapper that renders the trigger
 * button and owns the open/close state for the wizard. Lives on the
 * proposal timeline pages (/tech/proposals/[id] + /sales/proposals/
 * [id]) in the header area, alongside other proposal actions.
 *
 * Visibility rule: ONLY renders when the proposal isn't already in a
 * terminal paid state. Server pages pass the current status so this
 * decision is made on the right side (don't show a button that 409s
 * the moment it's clicked).
 */
interface MarkAsPaidLauncherProps {
  proposalId: string;
  companyName: string;
  /** Current proposal.status — button hides on `paid` / `archived`. */
  status: string;
  /** Best-guess price to prefill the wizard. Server picks active
   *  price (discount → base → price column fallback). */
  defaultAmount: number;
  // ── Welcome-email defaults (forwarded to the wizard) ──
  clientEmail?: string | null;
  clientFullName?: string | null;
  clientSiteUrl?: string | null;
  currentPassword?: string | null;
  // ── Handover defaults (forwarded to the wizard) ──
  /** Existing sites.domain — pre-fills the "Main domain" input on
   *  Step 1 so the operator confirms rather than re-types. */
  currentMainDomain?: string | null;
  /** Existing credit_balances.balance — pre-fills the starting credits
   *  input on Step 1. Default €50 in the wizard if not provided. */
  currentCreditBalance?: number | null;
}

export function MarkAsPaidLauncher({
  proposalId,
  companyName,
  status,
  defaultAmount,
  clientEmail,
  clientFullName,
  clientSiteUrl,
  currentPassword,
  currentMainDomain,
  currentCreditBalance,
}: MarkAsPaidLauncherProps) {
  const [open, setOpen] = useState(false);

  // Already-paid (or archived/cancelled) proposals can't be marked
  // paid again. Server-side route also 409s for safety, but hiding
  // the button removes the dead-end click entirely.
  if (status === "paid" || status === "archived" || status === "cancelled") {
    return null;
  }

  return (
    <>
      <Button
        variant="default"
        size="sm"
        onClick={() => setOpen(true)}
        className="bg-emerald-600 hover:bg-emerald-700 text-white"
      >
        <Wallet className="h-4 w-4 mr-1.5" />
        Mark as paid
      </Button>
      <MarkAsPaidWizard
        open={open}
        onOpenChange={setOpen}
        proposalId={proposalId}
        companyName={companyName}
        defaultAmount={defaultAmount}
        clientEmail={clientEmail}
        clientFullName={clientFullName}
        clientSiteUrl={clientSiteUrl}
        currentPassword={currentPassword}
        currentMainDomain={currentMainDomain}
        currentCreditBalance={currentCreditBalance}
      />
    </>
  );
}
