"use client";

/**
 * Free "Contact support" message form. Sends a `change_requests` row
 * with `changes = [{ action: "message", ... }]` so the IT team sees it
 * in /tech/queue alongside real edit reviews. Free for ALL clients —
 * paid or unpaid — per Peter 2026-05-11: the support channel must
 * always be open, even before the initial site payment goes through.
 *
 * No credit-cost confirmation dialog. No "saved as draft" limbo for
 * unpaid clients. Just type, click Send, done.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PaperPlaneTilt as Send, CircleNotch as Loader2, CheckCircle } from "@phosphor-icons/react/ssr";

export function ClientMessageForm({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error("Write a message");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/change-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: siteId,
          changes: [
            {
              file_path: "message",
              css_path: "",
              action: "message",
              old_value: "",
              new_value: trimmed,
            },
          ],
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to send the message");
        return;
      }

      setMessage("");
      setSent(true);
      toast.success("Your message has been sent. We will get back to you as soon as possible.");
      setTimeout(() => setSent(false), 3000);
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border bg-card p-5 space-y-4"
    >
      <div>
        <textarea
          className="w-full h-32 rounded-lg border bg-background px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
          placeholder={`How can we help you?

For example:
• I have a question about my account or payment
• Something on my site isn't working
• I'm struggling with the editor
• I need a consultation`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={sending}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Our team will receive your message and we will get back to you as soon as possible.
        </p>
        <Button
          type="submit"
          disabled={sending || !message.trim()}
          className="gap-2 shrink-0"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : sent ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {sending ? "Sending..." : sent ? "Sent!" : "Send message"}
        </Button>
      </div>
    </form>
  );
}
