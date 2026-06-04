"use client";

/**
 * Pipeline approval card for a client's pending publish request.
 *
 * Rendered in the `banner` slot of ProposalTimeline ONLY when the site
 * has a pending publish_requests row (the server page decides). This is
 * the single place IT approves/rejects client edits — keeping the action
 * inside the per-client pipeline page rather than a separate inbox
 * (Peter 2026-05-29). Discovery of which clients are waiting happens via
 * the bell badge on the Live Clients list.
 *
 * Charge model (Peter 2026-05-30): the client was already charged
 * $12.50 at submit. Approve runs publishSite() with NO further
 * charge. Reject refunds the $12.50 back to the client's balance.
 * Because the charge already happened, IT can always approve — the
 * client's current balance is irrelevant to the approval decision.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Bell, Check, X, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  siteId: string;
  /** ISO timestamp the request was created. */
  createdAt: string;
  /** Current credit balance on the site, in $ (POST-charge — the
   *  $12.50 has already been deducted at submit). Shown for context
   *  only; not used to gate approval. */
  balance: number;
  /** Per-publish charge in $ (12.50). Already charged at submit. */
  publishCost: number;
}

export function PublishRequestCard({
  siteId,
  createdAt,
  balance,
  publishCost,
}: Props) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  async function approve() {
    if (busy) return;
    setBusy("approve");
    try {
      const res = await fetch(`/api/sites/${siteId}/publish-request/approve`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Approve failed");
        return;
      }
      toast.success("Published live.", { duration: 6000 });
      startTransition(() => router.refresh());
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (busy) return;
    setBusy("reject");
    try {
      const res = await fetch(`/api/sites/${siteId}/publish-request/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_note: rejectNote.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Reject failed");
        return;
      }
      const refunded = Number(data.refunded_eur ?? 0);
      toast.success(
        refunded > 0
          ? `Request rejected. Refunded $${refunded.toFixed(2).replace(".", ",")} to the client.`
          : "Request rejected. The client sees the reason in their editor.",
        { duration: 6000 },
      );
      setRejecting(false);
      setRejectNote("");
      startTransition(() => router.refresh());
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(null);
    }
  }

  // Read-only render of the CURRENT (draft) composition — exactly what
  // would go live on approval. Opens in a new tab.
  const previewHref = `/api/sites/${siteId}/render?page=index.html`;

  return (
    <div className="rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50/60 dark:bg-amber-950/20 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Bell className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold">Client requested publish</h3>
            <span className="text-xs text-muted-foreground">
              {formatRelative(createdAt)}
            </span>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            Client already paid ${publishCost.toFixed(2).replace(".", ",")}
            at submit · Approve to publish, reject to refund · Balance{" "}
            ${balance.toFixed(2).replace(".", ",")}
          </p>

          {rejecting && (
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Reason (shown to the client)…"
              rows={2}
              maxLength={1000}
              disabled={busy === "reject"}
              className="mt-3 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" asChild>
              <a href={previewHref} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" />
                Preview
              </a>
            </Button>

            {rejecting ? (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={reject}
                  disabled={busy !== null}
                >
                  {busy === "reject" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <X className="size-3.5" />
                  )}
                  Confirm reject
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRejecting(false)}
                  disabled={busy !== null}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  onClick={approve}
                  disabled={busy !== null || refreshing}
                  title="Approve and publish live"
                >
                  {busy === "approve" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  Approve &amp; publish
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRejecting(true)}
                  disabled={busy !== null}
                >
                  <X className="size-3.5" />
                  Reject
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Just now", "5 min ago", "3 h ago", "Today 14:23", or a date. */
function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} h ago`;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
