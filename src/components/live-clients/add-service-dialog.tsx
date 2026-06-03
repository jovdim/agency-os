"use client";

import { useState, useEffect, useRef } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Service catalog the dropdown surfaces. Each entry has a stable
 * `type` (used by reporting / filters later) + a default display
 * name the operator can still override before saving. "custom" is
 * the escape hatch — the dropdown collapses the name field to a
 * blank free-text input.
 *
 * Keep this list short and additive: removing an entry is fine
 * (existing rows keep their `type` string in the DB), but renaming
 * a `type` would orphan historical rows. New entries can be added
 * any time without a migration.
 */
const SERVICE_CATALOG = [
  { type: "hosting", name: "Website hosting" },
  { type: "domain", name: "Custom domain" },
  { type: "business_email", name: "Business email" },
  { type: "seo", name: "SEO" },
  { type: "maintenance", name: "Website maintenance" },
  { type: "social_media", name: "Social media management" },
] as const;

const CUSTOM_VALUE = "custom";

export function AddServiceDialog({
  open,
  onOpenChange,
  proposalId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedType, setSelectedType] = useState<string>(
    SERVICE_CATALOG[0].type,
  );
  const [name, setName] = useState<string>(SERVICE_CATALOG[0].name);
  const [price, setPrice] = useState<string>("");
  const [startsAt, setStartsAt] = useState<string>("");

  // Used to autofocus the name input when the operator picks "Other".
  // autoFocus only fires on initial mount, so a controlled focus call
  // via ref is the only way to land the caret AFTER the dropdown
  // change re-renders the input.
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Reseed on open so the dialog always starts at "Website hosting"
  // with empty price + date, regardless of what the operator last
  // typed and bailed on.
  useEffect(() => {
    if (!open) return;
    setSelectedType(SERVICE_CATALOG[0].type);
    setName(SERVICE_CATALOG[0].name);
    setPrice("");
    setStartsAt("");
    setError(null);
  }, [open]);

  // Switching catalog entry overwrites the name with the entry's
  // default, but switching to "custom" clears it AND drops focus
  // into the name field so the operator can immediately type.
  function handleTypeChange(next: string) {
    setSelectedType(next);
    if (next === CUSTOM_VALUE) {
      setName("");
      // Focus after the input re-renders. requestAnimationFrame
      // beats a setTimeout(0) because it runs after React commits
      // — by the time it fires the input is mounted + empty.
      requestAnimationFrame(() => nameInputRef.current?.focus());
    } else {
      const entry = SERVICE_CATALOG.find((s) => s.type === next);
      setName(entry?.name ?? "");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      return setError("Service name is required.");
    }

    let priceValue: number | null = null;
    if (price.trim()) {
      const n = Number(price);
      if (!Number.isFinite(n) || n < 0) {
        return setError("Price must be a non-negative number.");
      }
      priceValue = n;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/live-clients/${proposalId}/services`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: selectedType,
            name: trimmedName,
            price: priceValue,
            starts_at: startsAt || undefined,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to add service");
        return;
      }
      toast.success(`Added: ${trimmedName}`);
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
            <DialogTitle>Add service</DialogTitle>
            <DialogDescription>
              Tracks an ongoing service this client is paying for.
              Pick from the catalog or choose &ldquo;Other&rdquo; for a
              custom label.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="svc-type" className="text-xs">
                Service
              </Label>
              <Select
                value={selectedType}
                onValueChange={handleTypeChange}
                disabled={submitting}
              >
                <SelectTrigger id="svc-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_CATALOG.map((s) => (
                    <SelectItem key={s.type} value={s.type}>
                      {s.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_VALUE}>Other…</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="svc-name" className="text-xs">
                Display name
              </Label>
              <Input
                id="svc-name"
                ref={nameInputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  selectedType === CUSTOM_VALUE
                    ? "e.g. Newsletter setup"
                    : ""
                }
                disabled={submitting}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="svc-price" className="text-xs">
                  Price (€)
                </Label>
                <Input
                  id="svc-price"
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
                <Label htmlFor="svc-starts" className="text-xs">
                  Active since
                </Label>
                <Input
                  id="svc-starts"
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
              {submitting ? "Adding…" : "Add service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
