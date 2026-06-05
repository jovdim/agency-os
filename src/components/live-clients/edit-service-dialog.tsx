"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CircleNotch as Loader2 } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

/**
 * Edit-mode counterpart to AddServiceDialog. Lets the operator change
 * a service's display name, price, and active-since date after the
 * fact — without re-picking the catalog `type` (which would orphan
 * reporting / break "how long has this client had hosting?" lookups).
 *
 * Each field is independent; submitting only sends the fields that
 * actually differ from the original. price + starts_at can be cleared
 * by emptying the input (sent as null to the API).
 */
export function EditServiceDialog({
  open,
  onOpenChange,
  proposalId,
  service,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  /** The row currently being edited. When null the dialog renders
   *  blank — callers should only set this to a row when about to
   *  open() to avoid a flash of empty state. */
  service: {
    id: string;
    name: string;
    price: number | null;
    starts_at: string | null;
  } | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [startsAt, setStartsAt] = useState<string>("");

  // Reseed from the incoming service every time the dialog opens —
  // the operator may have edited a different row last time, so we
  // never want stale state from a previous open to bleed through.
  useEffect(() => {
    if (!open || !service) return;
    setName(service.name);
    setPrice(service.price != null ? String(service.price) : "");
    setStartsAt(service.starts_at ?? "");
    setError(null);
  }, [open, service]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !service) return;
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      return setError("Name cannot be empty.");
    }

    // Build a patch with only the fields that differ. Empty price /
    // date inputs become null (clear) rather than skipped — that's
    // how the operator "removes" a previously set price.
    const patch: Record<string, unknown> = {};

    if (trimmedName !== service.name) {
      patch.name = trimmedName;
    }

    const priceTrimmed = price.trim();
    if (priceTrimmed === "") {
      if (service.price != null) patch.price = null;
    } else {
      const n = Number(priceTrimmed);
      if (!Number.isFinite(n) || n < 0) {
        return setError("Price must be a non-negative number.");
      }
      if (n !== service.price) patch.price = n;
    }

    const startsAtTrimmed = startsAt.trim();
    if (startsAtTrimmed === "") {
      if (service.starts_at != null) patch.starts_at = null;
    } else if (startsAtTrimmed !== service.starts_at) {
      patch.starts_at = startsAtTrimmed;
    }

    if (Object.keys(patch).length === 0) {
      // Nothing changed — close silently rather than firing a no-op
      // request that returns a 400.
      onOpenChange(false);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/live-clients/${proposalId}/services/${service.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update service");
        return;
      }
      toast.success("Service updated");
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit service</DialogTitle>
            <DialogDescription>
              Change the name, price, or active-since date. Leave a
              field empty to clear it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-svc-name" className="text-xs">
                Display name
              </Label>
              <Input
                id="edit-svc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-svc-price" className="text-xs">
                  Price ($)
                </Label>
                <Input
                  id="edit-svc-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                  disabled={submitting}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-svc-starts" className="text-xs">
                  Active since
                </Label>
                <Input
                  id="edit-svc-starts"
                  type="date"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
              {submitting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
