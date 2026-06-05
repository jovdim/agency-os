"use client";

import { useState } from "react";
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
 * Three small edit dialogs for the Live Clients detail page — share
 * one file because the form is essentially the same shape (one input,
 * one save), differing only in label / API path / validation. Keeping
 * them together makes the "field maintenance" surface easy to find
 * and lets a future fourth (phone? business email?) drop in cleanly.
 *
 * All three POST to `/api/admin/live-clients/[id]/<field>` (the
 * "admin" prefix matches /api/admin/migrate-client + the rest of the
 * live-clients tooling). Server enforces role + sales-ownership; UI
 * just trusts the response.
 */

// ─── Subdomain ─────────────────────────────────────────────────────────────

export function EditSubdomainDialog({
  open,
  onOpenChange,
  proposalId,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  /** Existing subdomain (without .pages.dev) — pre-fills the input.
   *  Empty / null when the site hasn't been published yet. */
  current: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const trimmed = value.trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/.test(trimmed)) {
      return setError(
        "Lowercase letters, digits, hyphens; no leading/trailing hyphen.",
      );
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/live-clients/${proposalId}/subdomain`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdomain: trimmed }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Update failed");
        return;
      }
      toast.success(
        data.unchanged
          ? "Subdomain unchanged"
          : `Subdomain updated → ${data.live_url}`,
      );
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !submitting && onOpenChange(o)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change subdomain</DialogTitle>
          <DialogDescription>
            Updates both the database and the Cloudflare custom-domain
            mapping. The new URL becomes live as soon as Cloudflare
            confirms — usually a few seconds. Old URL is detached.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="es-subdomain" className="text-xs">
              New subdomain *
            </Label>
            <div className="flex items-center gap-1">
              <Input
                id="es-subdomain"
                value={value}
                onChange={(e) =>
                  setValue(e.target.value.toLowerCase())
                }
                placeholder="balkar"
                disabled={submitting}
                required
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground">
                .pages.dev
              </span>
            </div>
          </div>
          {error && (
            <div className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded px-3 py-2">
              {error}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Updating Cloudflare...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Custom domain ─────────────────────────────────────────────────────────

export function EditDomainDialog({
  open,
  onOpenChange,
  proposalId,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  current: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/live-clients/${proposalId}/domain`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          // Pass an empty string deliberately when value is empty — the
          // API treats empty as "clear the domain" and flips
          // domain_status back to "none".
          body: JSON.stringify({ domain: value.trim() }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Update failed");
        return;
      }
      toast.success(
        data.domain ? `Custom domain set to ${data.domain}` : "Custom domain cleared",
      );
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !submitting && onOpenChange(o)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change custom domain</DialogTitle>
          <DialogDescription>
            Updates the stored custom domain + flips domain status to
            active. <strong>Doesn&apos;t touch DNS</strong> — the
            heavier nameserver + certificate flow lives in /super/domains.
            Use this when the client&apos;s domain is already set up
            elsewhere and you just need the CRM to reflect it. Leave
            empty + save to clear.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="ed-domain" className="text-xs">
              Custom domain
            </Label>
            <Input
              id="ed-domain"
              value={value}
              onChange={(e) => setValue(e.target.value.toLowerCase())}
              placeholder="yourcompany.com"
              disabled={submitting}
            />
            <p className="text-[11px] text-muted-foreground leading-snug">
              Bare hostname (no http://, no trailing slash). Lowercase.
            </p>
          </div>
          {error && (
            <div className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded px-3 py-2">
              {error}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Login email ───────────────────────────────────────────────────────────

export function EditLoginEmailDialog({
  open,
  onOpenChange,
  proposalId,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  current: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const trimmed = value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return setError("Valid email required.");
    }
    if (trimmed === (current ?? "").toLowerCase()) {
      return setError("That's already the current login email.");
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/live-clients/${proposalId}/login-email`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Update failed");
        return;
      }
      toast.success(`Login email updated → ${data.email}`, {
        description:
          "Existing sessions stay logged in until token expiry. Send the welcome email if the client needs new credentials.",
        duration: 8000,
      });
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !submitting && onOpenChange(o)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change login email</DialogTitle>
          <DialogDescription>
            Updates both the auth account and the CRM contact in one
            step. The client uses the new email next time they log in.
            Existing sessions stay valid until their token expires —
            no force-logout. If they need fresh credentials, open the
            welcome email dialog after saving.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="el-email" className="text-xs">
              New login email *
            </Label>
            <Input
              id="el-email"
              type="email"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="info@yourcompany.com"
              disabled={submitting}
              required
            />
          </div>
          {error && (
            <div className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded px-3 py-2">
              {error}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
