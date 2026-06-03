"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface SendToClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  companyName: string;
  fileName: string;
  defaultRecipient: string;
  alreadySent: boolean;
}

export function SendToClientDialog({
  open,
  onOpenChange,
  requestId,
  companyName,
  fileName,
  defaultRecipient,
  alreadySent,
}: SendToClientDialogProps) {
  const router = useRouter();
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setRecipient(defaultRecipient);
      setMessage("");
    }
  }, [open, defaultRecipient]);

  async function handleSend() {
    if (!recipient.trim()) {
      toast.error("Enter the client's email");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(
        `/api/sales/invoice-requests/${requestId}/send-to-client`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient_email: recipient.trim(),
            message: message.trim() || undefined,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Sending failed");
      }
      toast.success("Invoice sent to the client");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sending failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            {alreadySent ? "Send invoice again" : "Send invoice to client"}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Invoice <span className="font-mono">{fileName}</span> for{" "}
            <span className="font-medium">{companyName}</span>
          </p>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Client email <span className="text-red-500">*</span>
            </Label>
            <Input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="client@company.com"
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Custom message{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="For example: Please find this month's invoice attached. It is due by…"
              rows={4}
              className="text-sm resize-none"
            />
            <p className="text-[10px] text-muted-foreground">
              It will be added to the email body below the standard text.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSend}
            disabled={sending || !recipient.trim()}
            className="gap-1.5"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
