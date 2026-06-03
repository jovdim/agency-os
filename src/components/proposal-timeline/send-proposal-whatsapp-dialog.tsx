"use client";

/**
 * WhatsApp variant of the Send-to-client dialog. Mirrors
 * send-proposal-dialog.tsx as closely as possible so sales reaches
 * for both surfaces with the same muscle memory — same pricing
 * block, same Compose/Preview tabs, same Reset behavior.
 *
 * Differences from the email dialog:
 *   - No subject, no rich-text editor — WhatsApp ignores HTML.
 *     Plain-text Textarea with `{website_link}` + `{salesperson_name}`
 *     placeholders substituted at send-time (client-side, since the
 *     wa.me link is built by the browser).
 *   - "To" is a phone number, not an email. Auto-filled from the
 *     contact's stored phone but editable — sales fixes typos here
 *     without leaving the dialog. The dialog shows the canonicalized
 *     `wa.me/<intl-digits>` URL so sales can sanity-check it before
 *     opening WhatsApp.
 *   - On submit, the server marks the proposal sent (creates
 *     reminders, sets sent_at, generates variable symbol) but skips
 *     SMTP — that's gated by `channel: "whatsapp"` in the PUT body.
 *     The browser then opens `https://wa.me/<digits>?text=<encoded>`
 *     in a new tab; the salesperson hits Send inside WhatsApp.
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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  MessageCircle,
  Loader2,
  RotateCcw,
  AlertCircle,
} from "lucide-react";

/**
 * Default Slovak WhatsApp message — mirrors the email dialog's
 * default body (Peter 2026-05-23: "let's have the same email we
 * have on the WhatsApp option too"). Plain text + WhatsApp markdown
 * (*bold*, • bullets) instead of HTML. Same placeholders as the
 * email dialog so the salesperson works with one mental model.
 *
 * All placeholders are substituted in the browser before opening
 * the wa.me link — no server-side template resolution. The parent
 * threads `clientEmail`, `clientPassword`, `liveUrl`, and
 * `salesPersonName` as props for substitution.
 */
const DEFAULT_BODY = `Hello,

We have good news: your new website is *online and live*. We built it according to your requirements, and your customers can now view it as well.

The website is available here: {website_link}

*What your new website includes:*
• Modern, responsive design that works the same on mobile, tablet, and desktop
• Fast loading and search engine optimization (SEO basics)
• Contact form, messages go straight to your email inbox

*Your client zone:*
Along with the website, you also received access to your *client zone*, your personal online space where you can manage your website and communicate with us. Here you can:
• Edit the text and images on your site yourself (via the visual editor)
• Send us change requests for anything you can't handle on your own
• Review your change history and communication with us
• Manage your credit and invoices

*Login details:*
Login: client.youragency.com
Email: {client_email}
Password: {client_password}

If you're also interested in your own domain (e.g. yourcompany.com) and a business email, we'll take care of those steps too, just let us know.

If you have any questions, don't hesitate to contact me.

Best regards,
Your Agency`;

// Stand-in values used inside the Preview tab when liveUrl /
// salesperson aren't known yet (e.g. proposal still building). The
// real values land at send-time. Matches the example.pages.dev
// convention used by send-proposal-dialog.tsx so sales can tell
// at a glance this isn't a real customer-visible link.
const PREVIEW_WEBSITE_LINK = "https://example.pages.dev";
const PREVIEW_SALESPERSON_NAME = "Your Agency Team";
const PREVIEW_CLIENT_EMAIL = "client@example.com";
const PREVIEW_CLIENT_PASSWORD = "482719";

function substitutePlaceholders(
  text: string,
  link: string,
  name: string,
  clientEmail: string,
  clientPassword: string,
): string {
  return text
    .replace(/\{website_link\}/g, link)
    .replace(/\{salesperson_name\}/g, name)
    .replace(/\{client_email\}/g, clientEmail)
    .replace(/\{client_password\}/g, clientPassword);
}

/**
 * Canonicalize a raw phone number into the digits-only international
 * form wa.me expects. Mirrors `buildWhatsappHref` in
 * src/lib/templates/parser.ts:185 (Slovak leading-0 → 421 fallback).
 *
 * Returns an empty string for unparseable input so the caller can
 * disable the Send button instead of opening a broken wa.me link.
 */
function toIntlDigits(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("0") ? "421" + digits.slice(1) : digits;
}

interface SendProposalWhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  companyName: string;
  contactPhone: string | null;
  /** Live URL of the deployed proposal site. Substituted into
   *  `{website_link}` in the WhatsApp body. Null while the site
   *  is still building — we fall back to the preview placeholder
   *  in the Preview tab but block sending until liveUrl arrives. */
  liveUrl: string | null;
  /** Salesperson's full name. Substituted into
   *  `{salesperson_name}`. Falls back to "Your Agency Team". */
  salesPersonName: string | null;
  /** Client zone login email (the site owner's auth email).
   *  Substituted into `{client_email}`. Falls back to a placeholder
   *  in the preview, sent as empty in the final WhatsApp message if
   *  the client zone isn't provisioned yet. */
  clientEmail: string | null;
  /** Client zone temp password (proposals.client_temp_password).
   *  Substituted into `{client_password}`. Falls back like
   *  clientEmail. */
  clientPassword: string | null;
  /** Optional id of the linked CRM contact for the
   *  "Edit contact" link. Hidden when null. */
  contactId?: string | null;
}

export function SendProposalWhatsAppDialog({
  open,
  onOpenChange,
  proposalId,
  companyName,
  contactPhone,
  liveUrl,
  salesPersonName,
  clientEmail,
  clientPassword,
  contactId,
}: SendProposalWhatsAppDialogProps) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [phone, setPhone] = useState(contactPhone || "");
  const [body, setBody] = useState(DEFAULT_BODY);

  // Reseed every time the dialog opens. Same rationale as the email
  // dialog: stale local state from a previous open shouldn't leak
  // back. We deliberately only depend on `open` so parent re-renders
  // don't blow away in-progress edits.
  useEffect(() => {
    if (!open) return;
    setPhone(contactPhone || "");
    setBody(DEFAULT_BODY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const intlDigits = useMemo(() => toIntlDigits(phone), [phone]);
  // wa.me click-to-chat requires at least a country code + 6 digits
  // in practice. We use 7 as a lower bound so sales doesn't fire
  // off a malformed number to a wrong recipient.
  const validPhone = intlDigits.length >= 7;

  // Preview substitution — uses example placeholders when real
  // values aren't available yet so the preview reads naturally
  // instead of dangling labels.
  const previewLink = liveUrl || PREVIEW_WEBSITE_LINK;
  const previewName = salesPersonName || PREVIEW_SALESPERSON_NAME;
  const previewEmail = clientEmail || PREVIEW_CLIENT_EMAIL;
  const previewPassword = clientPassword || PREVIEW_CLIENT_PASSWORD;
  const previewBody = useMemo(
    () =>
      substitutePlaceholders(
        body,
        previewLink,
        previewName,
        previewEmail,
        previewPassword,
      ),
    [body, previewLink, previewName, previewEmail, previewPassword],
  );

  function handleResetBody() {
    setBody(DEFAULT_BODY);
    toast.success("Reset to the default message.");
  }

  async function handleSend() {
    if (sending) return;
    if (!validPhone) {
      toast.error("Enter a valid phone number.");
      return;
    }
    if (!body.trim()) {
      toast.error("Write a message for the client.");
      return;
    }
    if (!liveUrl) {
      toast.error("The website is not deployed yet.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "sent",
          channel: "whatsapp",
          greeting_text: body,
          recipient_phone: phone,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to send the proposal.");
        return;
      }

      // Build the final message with substituted placeholders and
      // open WhatsApp. window.open with _blank lands in a new tab;
      // mobile devices intercept wa.me and route to the app. We
      // open BEFORE closing the dialog so the click-to-open isn't
      // blocked by popup heuristics (browsers tie the popup
      // permission to the originating user gesture; awaiting fetch
      // then opening usually still works but the dialog-close
      // micro-task ordering can drop the gesture context).
      const finalText = substitutePlaceholders(
        body,
        liveUrl,
        salesPersonName || PREVIEW_SALESPERSON_NAME,
        clientEmail ?? "",
        clientPassword ?? "",
      );
      // api.whatsapp.com/send is the older, longer-form click-to-chat
      // endpoint — does the same thing as wa.me but tends to dodge
      // local antivirus / proxy blacklists that flag the short form
      // (Peter hit ERR_CERT_AUTHORITY_INVALID on wa.me from his
      // machine; api.whatsapp.com bypassed it).
      const waUrl = `https://api.whatsapp.com/send?phone=${intlDigits}&text=${encodeURIComponent(finalText)}`;
      window.open(waUrl, "_blank", "noopener,noreferrer");

      toast.success(
        "Proposal marked as sent. WhatsApp opened in a new tab.",
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
      {/* Sticky-footer layout matches send-proposal-dialog.tsx — see
          that file for the rationale (long body would otherwise push
          the Send button off-screen on small viewports). */}
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="size-5" />
            Send via WhatsApp — {companyName}
          </DialogTitle>
          <DialogDescription>
            The client receives a link to the website and their login
            details for the client zone. You set the price and discount
            with a separate button in the next step.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-4">
          {/* Recipient phone — auto-filled from contact, editable.
              Per Peter 2026-05-15: "the number to where it is going
              to be send and changeable if ever client want to change
              the number." */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="wa-phone" className="text-xs">
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
              id="wa-phone"
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
              contact detail for future sends.
            </div>
          )}

          {/* Compose / Preview tabs — plain-text textarea instead of
              Tiptap because WhatsApp doesn't render HTML. The Preview
              tab shows the substituted message exactly as the client
              will see it in the chat. */}
          <Tabs defaultValue="compose">
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="compose">Edit</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleResetBody}
                disabled={sending}
                className="gap-1.5 text-muted-foreground hover:text-foreground"
                title="Reset the message to the default template"
              >
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            </div>

            <TabsContent value="compose" className="mt-2">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                disabled={sending}
                placeholder="Write a message for the client…"
                className="text-sm leading-relaxed resize-y"
              />
              <p className="text-[11px] text-muted-foreground mt-2">
                The website link, your name, and the client's login
                details are filled in automatically when WhatsApp opens.
              </p>
            </TabsContent>

            <TabsContent value="preview" className="mt-2">
              {/* translate="no" + the "notranslate" class block both
                  Google Translate and Edge's built-in translation
                  from rewriting this element. Without these guards
                  the browser translates the message body to the
                  user's locale AND collapses all newlines into
                  spaces — so the salesperson sees a wall of
                  English text and thinks the message format is
                  broken (Peter 2026-05-23). The actual WhatsApp
                  send is unaffected either way (the raw textarea
                  value is what's URL-encoded into wa.me), but the
                  preview should match reality. */}
              <div
                translate="no"
                className="notranslate rounded-md border bg-muted/30 px-4 py-3 whitespace-pre-wrap text-sm leading-relaxed min-h-70"
              >
                {previewBody}
              </div>
              <p className="text-[11px] text-muted-foreground text-center mt-2">
                This is exactly how the client will see the message in WhatsApp.
              </p>
            </TabsContent>
          </Tabs>
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
