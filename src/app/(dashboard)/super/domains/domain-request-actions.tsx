"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, MessageSquare, Loader2, Play } from "lucide-react";
import { toast } from "sonner";

interface DomainRequestActionsProps {
  siteId: string;
  currentNotes: string | null;
  currentStatus: string;
}

// Determine which "in progress" state this request should move to based on current
function inProgressStatusFor(current: string): string {
  if (current === "register_new") return "register_in_progress";
  if (current === "transfer") return "transfer_in_progress";
  return current;
}

const isQueued = (s: string) => s === "register_new" || s === "transfer";
const isInProgress = (s: string) => s === "register_in_progress" || s === "transfer_in_progress";

export function DomainRequestActions({
  siteId,
  currentNotes,
  currentStatus,
}: DomainRequestActionsProps) {
  const router = useRouter();
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackAction, setFeedbackAction] = useState<"approve" | "reject" | "note">("note");
  const [notes, setNotes] = useState(currentNotes || "");
  const [loading, setLoading] = useState(false);

  async function moveToInProgress() {
    const nextStatus = inProgressStatusFor(currentStatus);
    if (nextStatus === currentStatus) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/domain`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain_status: nextStatus }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to move to in progress");
        return;
      }
      toast.success("Moved to In Progress");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(action: "approve" | "reject", withNotes?: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/domain`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain_status: action === "approve" ? "active" : "rejected",
          domain_notes: withNotes || notes || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || `Failed to ${action}`);
        return;
      }
      toast.success(action === "approve" ? "Domain approved" : "Domain rejected");
      setShowFeedback(false);
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveNotes() {
    setLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/domain`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain_status: currentStatus,
          domain_notes: notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to save feedback");
        return;
      }
      toast.success("Feedback saved");
      setShowFeedback(false);
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (showFeedback) {
    return (
      <div className="w-full space-y-3 rounded-lg border bg-muted/30 p-3 mt-2">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={
            feedbackAction === "reject"
              ? "Reason for rejection (e.g. domain not available, try another name...)"
              : feedbackAction === "approve"
                ? "Optional note (e.g. domain registered, DNS propagating...)"
                : "Add feedback for the client..."
          }
          className="text-sm min-h-15"
        />
        <div className="flex items-center gap-2 justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => setShowFeedback(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          {feedbackAction === "note" && (
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={handleSaveNotes}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Save Feedback
            </Button>
          )}
          {feedbackAction === "reject" && (
            <Button
              size="sm"
              variant="destructive"
              className="h-8 text-xs"
              onClick={() => handleAction("reject", notes)}
              disabled={loading || !notes.trim()}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <X className="h-3.5 w-3.5 mr-1" />}
              Reject
            </Button>
          )}
          {feedbackAction === "approve" && (
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => handleAction("approve", notes)}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
              Approve
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs gap-1"
        onClick={() => { setFeedbackAction("note"); setShowFeedback(true); }}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Feedback
      </Button>

      {/* Queue → Start Processing */}
      {isQueued(currentStatus) && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs gap-1 border-amber-500/50 text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
          onClick={moveToInProgress}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Start Processing
        </Button>
      )}

      {/* Reject — available in queue and in-progress */}
      {(isQueued(currentStatus) || isInProgress(currentStatus)) && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
          onClick={() => { setFeedbackAction("reject"); setShowFeedback(true); }}
          disabled={loading}
        >
          <X className="h-3.5 w-3.5" />
          Reject
        </Button>
      )}

      {/* Mark as Done — only when in progress */}
      {isInProgress(currentStatus) && (
        <Button
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => { setFeedbackAction("approve"); setShowFeedback(true); }}
          disabled={loading}
        >
          <Check className="h-3.5 w-3.5" />
          Mark as Done
        </Button>
      )}
    </div>
  );
}
