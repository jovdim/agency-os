"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface AwaitingProposal {
  id: string;
  company_name: string;
  variable_symbol: string;
  active_price: number;
  contact_person: string | null;
  contact_email: string | null;
}

interface ConfirmPaymentDialogProps {
  proposal: AwaitingProposal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConfirmPaymentDialog({
  proposal,
  open,
  onOpenChange,
}: ConfirmPaymentDialogProps) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const expectedAmount = proposal?.active_price ?? 0;
  const enteredAmount = parseFloat(amount) || 0;
  const amountMismatch =
    amount !== "" && enteredAmount > 0 && enteredAmount !== expectedAmount;

  function handleOpen(isOpen: boolean) {
    if (isOpen && proposal) {
      setAmount(expectedAmount.toString());
      setNote("");
    }
    onOpenChange(isOpen);
  }

  async function handleConfirm() {
    if (!proposal || enteredAmount <= 0) return;

    setLoading(true);
    try {
      const res = await fetch("/api/admin/payments/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal_id: proposal.id,
          amount: enteredAmount,
          note: note.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to confirm payment");
        return;
      }

      toast.success(
        `Payment confirmed for ${proposal.company_name} — $${enteredAmount.toFixed(2)}`,
      );
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  if (!proposal) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Bank Transfer</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Proposal info */}
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Company</span>
              <span className="text-sm font-medium">
                {proposal.company_name}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">
                Variable Symbol (VS)
              </span>
              <span className="font-mono text-lg font-bold">
                {proposal.variable_symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">
                Expected Amount
              </span>
              <span className="text-sm font-medium">
                ${expectedAmount.toFixed(2)}
              </span>
            </div>
            {proposal.contact_person && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Contact</span>
                <span className="text-sm">{proposal.contact_person}</span>
              </div>
            )}
          </div>

          {/* Amount input */}
          <div className="space-y-2">
            <Label htmlFor="amount">Amount Received ($)</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={expectedAmount.toFixed(2)}
            />
          </div>

          {/* Warning if amount doesn't match */}
          {amountMismatch && (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-300 bg-yellow-50 p-3 dark:border-yellow-700 dark:bg-yellow-950">
              <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                Expected ${expectedAmount.toFixed(2)} but entering $
                {enteredAmount.toFixed(2)}. Are you sure?
              </p>
            </div>
          )}

          {/* Optional note */}
          <div className="space-y-2">
            <Label htmlFor="note">Note (optional)</Label>
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Bank ref #12345"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || enteredAmount <= 0}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
