"use client";

/**
 * WhatsApp follow-up dialog. Mirrors follow-up-email-dialog.tsx in
 * spirit but stripped to the basics — no rich text editor (WhatsApp
 * ignores HTML), no pricing block (follow-ups are nudges, not
 * re-offers), no banner gate (the proposal has already been sent
 * by the time follow-ups are an option).
 *
 * Differences from send-proposal-whatsapp-dialog.tsx (the initial
 * proposal-send dialog):
 *   - No pricing inputs. This is a "did you see my message?" ping,
 *     not a re-offer.
 *   - No `status: "sent"` transition. The proposal is already
 *     status=sent/viewed; this dialog only logs a follow-up row to
 *     proposal_emails (channel-marked) and opens wa.me.
 *   - No banner-config gate.
 *
 * Submit flow:
 *   1. POST /api/proposals/[id]/send-follow-up with channel="whatsapp"
 *      → server skips SMTP, just logs to proposal_emails.
 *   2. window.open(api.whatsapp.com/send?...) with prefilled message.
 */

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ChatCircle as MessageCircle, CircleNotch as Loader2, WarningCircle as AlertCircle } from "@phosphor-icons/react/ssr";

/**
 * Default Slovak WhatsApp follow-up — shorter than the initial-send
 * message because the client already has the link; this is just a
 * polite nudge. Uses the same `{website_link}` / `{salesperson_name}`
 * mustache placeholders, substituted in the browser at send-time.
 */
const DEFAULT_BODY = `Hello,

I'm reaching out with a quick reminder, a few days ago we sent you a website proposal.

As a reminder, you can view it here: {website_link}

If you have any questions, don't hesitate to contact me.

Best regards,
{salesperson_name}
Your Agency`;

const PREVIEW_WEBSITE_LINK = "https://example.pages.dev";
const PREVIEW_SALESPERSON_NAME = "Your Agency Team";

function substitutePlaceholders(
  text: string,
  link: string,
  name: string,
): string {
  return text
    .replace(/\{website_link\}/g, link)
    .replace(/\{salesperson_name\}/g, name);
}

/** Mirrors `toIntlDigits` in send-proposal-whatsapp-dialog.tsx and
 *  `buildWhatsappHref` in src/lib/templates/parser.ts:185. */
function toIntlDigits(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("0") ? "421" + digits.slice(1) : digits;
}

interface FollowUpWhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  companyName: string;
  contactPhone: string | null;
  liveUrl: string | null;
  salesPersonName: string | null;
  contactId?: string | null;
}

export function FollowUpWhatsAppDialog({
  open,
  onOpenChange,
  proposalId,
  companyName,
  contactPhone,
  liveUrl,
  salesPersonName,
  contactId,
}: FollowUpWhatsAppDialogProps) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [phone, setPhone] = useState(contactPhone || "");

  useEffect(() => {
    if (!open) return;
    setPhone(contactPhone || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const intlDigits = useMemo(() => toIntlDigits(phone), [phone]);
  const validPhone = intlDigits.length >= 7;

  // Message body is fixed to DEFAULT_BODY (Peter 2026-05-15 v3:
  // "remove the edit content"). Sales sees the substituted preview
  // and either sends or cancels — no per-send customization.
  // If sales needs custom copy, the placeholder + reset workflow
  // can be re-added later by restoring the Tabs/Textarea block.
  const previewLink = liveUrl || PREVIEW_WEBSITE_LINK;
  const previewName = salesPersonName || PREVIEW_SALESPERSON_NAME;
  const previewBody = useMemo(
    () => substitutePlaceholders(DEFAULT_BODY, previewLink, previewName),
    [previewLink, previewName],
  );

  async function handleSend() {
    if (sending) return;
    if (!validPhone) {
      toast.error("Enter a valid phone number.");
      return;
    }
    if (!liveUrl) {
      toast.error("The website is not deployed yet.");
      return;
    }

    setSending(true);
    try {
      // Log the follow-up server-side (channel-marked). No SMTP fires
      // — the API skips email send when channel="whatsapp" and just
      // records the row in proposal_emails for traceability.
      const res = await fetch(
        `/api/proposals/${proposalId}/send-follow-up`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: "whatsapp",
            body_html: DEFAULT_BODY,
            recipient_phone: phone,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to send the follow-up.");
        return;
      }

      // Open WhatsApp with prefilled message. api.whatsapp.com/send
      // (not wa.me) avoids local-AV blacklists — same reasoning as
      // send-proposal-whatsapp-dialog.tsx.
      const finalText = substitutePlaceholders(
        DEFAULT_BODY,
        liveUrl,
        salesPersonName || PREVIEW_SALESPERSON_NAME,
      );
      const waUrl = `https://api.whatsapp.com/send?phone=${intlDigits}&text=${encodeURIComponent(finalText)}`;
      window.open(waUrl, "_blank", "noopener,noreferrer");

      toast.success(
        "Follow-up logged. WhatsApp opened in a new tab.",
      );
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error("Network error: " + (err as Error).message);
    } finally {
      setSending(false);
    }
  }

  const noPhone = !contactPhone;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="size-5" />
            Follow-up via WhatsApp — {companyName}
          </DialogTitle>
          <DialogDescription>
            A short reminder for the client. WhatsApp will open in a
            new tab with the message pre-filled.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="fwa-phone" className="text-xs">
                Recipient number
              </Label>
              {contactId && (
                <Link
                  href={`/sales/contacts/${contactId}`}
                  className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  Edit contact
                </Link>
              )}
            </div>
            <Input
              id="fwa-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0911 234 567"
              disabled={sending}
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              {validPhone
                ? `WhatsApp will open for +${intlDigits}`
                : "Enter a valid local or international number."}
            </p>
          </div>

          {noPhone && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="size-3.5 shrink-0" />
              The contact has no saved phone number — add one in the
              contact detail for future follow-ups.
            </div>
          )}

          {/* Static preview — message body is fixed (Peter 2026-05-15
              v3: "remove the edit content"). Sales reviews and
              either sends or cancels. */}
          <div className="space-y-1.5">
            <Label className="text-xs">Message</Label>
            <div className="rounded-md border bg-muted/30 px-4 py-3 whitespace-pre-wrap text-sm leading-relaxed">
              {previewBody}
            </div>
            <p className="text-[11px] text-muted-foreground">
              This is exactly how the client will see the message in WhatsApp.
            </p>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 shrink-0 border-t bg-background gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || !validPhone || !liveUrl}
            className="gap-1.5"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MessageCircle className="size-4" />
            )}
            {sending ? "Sending…" : "Open WhatsApp"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
