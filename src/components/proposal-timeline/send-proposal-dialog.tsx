"use client";

/**
 * Send-to-client dialog. Modeled on BusinessEmailDialog so the two
 * "compose-an-email" surfaces in this app feel identical: same Tabs
 * (Compose / Preview), same rich-text editor, same live HTML preview
 * iframe, same Reset-body button. The only thing unique to this
 * dialog is the pricing block — the email landing page on
 * `clientname.pages.dev` shows a 14-day discount price + crossed-out
 * base price, both controlled here.
 *
 * On Send we PUT to /api/proposals/[id]:
 *   { status: "sent", greeting_text, email_subject,
 *     discount_price, base_price }
 *
 * The "To" row is an editable recipient input, pre-filled with the
 * linked contact's email. We send it as `recipient_email`; the API
 * uses it when present and falls back to the contact's stored email
 * otherwise. "Edit contact" still links out to permanently change
 * the contact's address.
 *
 * NOTE 2026-05-10: this is the rewrite per Peter's "make this look
 * like the business email one" feedback. The old version had a
 * toggle (not Tabs), a separate email-confirm sub-screen, and a
 * pricing card that fought the surrounding layout. Behavior + API
 * shape are unchanged.
 */
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RichTextEditor } from "@/components/email/rich-text-editor";
import { toast } from "sonner";
import { Send, Loader2, Mail, RotateCcw, AlertCircle } from "lucide-react";

const DEFAULT_SUBJECT = "Website for {company}, Your Agency";

/**
 * Default CC address pre-filled on every send so the agency always
 * keeps a copy of outgoing client emails in one inbox. Shown open in
 * the dialog so the operator sees it and can edit / clear it per send.
 * KEEP IN SYNC with the same constant in business-email-dialog.tsx.
 */
const DEFAULT_CC = "youragency@gmail.com";

/**
 * Default Slovak proposal email — long, info-rich template that
 * walks the client through what their new site is, how to look at
 * it, how the pricing/discount window works, how to pay, and what
 * happens after. The salesperson composes from this default; if
 * they trim sections away, the agency footer at the bottom stays
 * (it's a legal-attribution line per Peter's existing convention
 * in business-email-setup.ts).
 *
 * Two mustache-style placeholders get replaced server-side when
 * the email actually goes out (see resolvePlaceholders in
 * src/lib/email.ts):
 *
 *   {website_link}     → the live URL (e.g. https://nexedge77.pages.dev)
 *   {salesperson_name} → the assigned sales rep's full_name, or
 *                        "Your Agency Team" as a generic fallback
 *
 * In the preview iframe we substitute placeholder example values
 * so sales sees something realistic instead of `{website_link}`
 * literals — see substitutePreviewPlaceholders below.
 */
const DEFAULT_BODY = `<p>Hello,</p>

<p>We have good news: your new website is <strong>online and live</strong>. We built it according to your requirements, and your customers can now view it as well.</p>

<p>The website is available here: <a href="{website_link}">{website_link}</a></p>

<p><strong>What your new website includes:</strong></p>
<ul>
<li>Modern, responsive design that works the same on mobile, tablet, and desktop</li>
<li>Fast loading and search engine optimization (SEO basics)</li>
<li>Contact form, messages go straight to your email inbox</li>
</ul>

<p><strong>Your client zone:</strong></p>

<p>Along with the website, you also received access to your <strong>client zone</strong>, your personal online space where you can manage your website and communicate with us. Here you can:</p>
<ul>
<li>Edit the text and images on your site yourself (via the visual editor)</li>
<li>Send us change requests for anything you can't handle on your own</li>
<li>Review your change history and communication with us</li>
<li>Manage your credit and invoices</li>
</ul>

<p><strong>Login details:</strong><br>
Login: <a href="https://client.youragency.com">client.youragency.com</a><br>
Email: <strong>{client_email}</strong><br>
Password: <strong>{client_password}</strong></p>

<p>If you're also interested in your own domain (e.g. <em>yourcompany.com</em>) and a business email, we'll take care of those steps too, just let us know.</p>

<p>If you have any questions, don't hesitate to contact me by email or phone.</p>

<p>Best regards,<br>
<strong>Your Agency</strong></p>`;

/**
 * Stand-in values used to fill the body's `{website_link}` /
 * `{salesperson_name}` placeholders inside the Preview iframe.
 * The actual sent email gets the real values resolved server-side.
 *
 * We use a non-public-looking host (`example.pages.dev`) for the URL
 * so sales doesn't accidentally think the preview link is the live
 * one.
 */
const PREVIEW_WEBSITE_LINK = "https://example.pages.dev";
const PREVIEW_SALESPERSON_NAME = "Your Agency Team";
const PREVIEW_CLIENT_EMAIL = "client@example.com";
const PREVIEW_CLIENT_PASSWORD = "482719";
const PREVIEW_LOGIN_URL = "https://youragency-zone.vercel.app/login";

function substitutePreviewPlaceholders(html: string): string {
  return html
    .replace(
      /(href\s*=\s*["'])\{website_link\}(["'])/g,
      `$1${PREVIEW_WEBSITE_LINK}$2`,
    )
    .replace(/\{website_link\}/g, PREVIEW_WEBSITE_LINK)
    .replace(/\{salesperson_name\}/g, PREVIEW_SALESPERSON_NAME)
    .replace(
      /(href\s*=\s*["'])\{login_url\}(["'])/g,
      `$1${PREVIEW_LOGIN_URL}$2`,
    )
    .replace(/\{login_url\}/g, PREVIEW_LOGIN_URL)
    .replace(/\{client_email\}/g, PREVIEW_CLIENT_EMAIL)
    .replace(/\{client_password\}/g, PREVIEW_CLIENT_PASSWORD);
}

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body_html: string;
}

interface SendProposalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  companyName: string;
  contactEmail: string | null;
}

/**
 * Client-side preview of the email body. Mirrors the server-side
 * plain-email shell in src/lib/email.ts (wrapPlainEmailShell) so
 * the Preview tab shows what the customer will actually receive,
 * minus the placeholder substitutions which we approximate locally
 * via substitutePreviewPlaceholders().
 *
 * No card, no auto-injected button, no auto-injected company-name
 * H1, no auto-injected agency footer — everything visible is in
 * the body itself. This matches buildBusinessEmailSetupHtml's
 * shape, on Peter's instruction (2026-05-10) to make the proposal
 * email feel like a real plain email instead of a marketing
 * landing page.
 *
 * `companyName` is unused on the new layout but we keep it in the
 * signature for compatibility with the call site in case we ever
 * want a context-aware preview detail later.
 */
function buildPreviewHtml(bodyHtml: string, _companyName: string): string {
  // Resolve {website_link} / {salesperson_name} placeholders to
  // example values so the preview reads naturally instead of
  // showing literal mustache tokens.
  const filled = substitutePreviewPlaceholders(bodyHtml);

  // Inline styles for Tiptap HTML — same shape as the server's
  // inlineStyleBody. If the server's version ever drifts we'll
  // get a "preview ≠ delivered email" gap, so they're worth
  // keeping in sync.
  const styledBody = filled
    .replace(
      /<p>/g,
      '<p style="margin:0 0 14px;font-size:14px;color:#1f1f1f;line-height:1.6">',
    )
    .replace(
      /<h1>/g,
      '<h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#111;line-height:1.3">',
    )
    .replace(
      /<h2>/g,
      '<h2 style="margin:0 0 14px;font-size:18px;font-weight:600;color:#111;line-height:1.3">',
    )
    .replace(
      /<h3>/g,
      '<h3 style="margin:14px 0 8px;font-size:15px;font-weight:600;color:#111">',
    )
    .replace(
      /<ul>/g,
      '<ul style="margin:8px 0 14px;padding-left:22px;color:#1f1f1f">',
    )
    .replace(
      /<ol>/g,
      '<ol style="margin:8px 0 14px;padding-left:22px;color:#1f1f1f">',
    )
    .replace(
      /<li>/g,
      '<li style="margin:4px 0;font-size:14px;line-height:1.6">',
    )
    .replace(/<a /g, '<a style="color:#2563eb;text-decoration:underline" ')
    .replace(
      /<blockquote>/g,
      '<blockquote style="margin:12px 0;padding:8px 16px;border-left:3px solid #ddd;color:#555;font-style:italic">',
    )
    .replace(
      /<strong>/g,
      '<strong style="font-weight:600;color:#111">',
    );

  // Credentials are now inside the editable body (see DEFAULT_BODY
  // — Peter 2026-05-23: salesperson should be able to edit them or
  // reorder them, and the WhatsApp variant needs the same shape).
  // Footer below mirrors the server-side auto-footer in
  // wrapPlainEmailShell — descriptive attribution + legal
  // address + youragency.com link. KEEP THIS IN SYNC with the
  // wrapPlainEmailShell version.
  const footerBlock = `
    <div style="margin-top:36px;padding:24px 20px 0;border-top:1px solid #eaeaea;font-size:11px;color:#888;text-align:center;line-height:1.7">
      <p style="margin:0 0 12px;line-height:1.7">
        <strong style="color:#555">[Your Agency]</strong> is a business consulting agency that helps small and medium-sized businesses go digital through affordable, professional web and marketing solutions.
      </p>
      <p style="margin:0;font-size:10px;color:#aaa;line-height:1.6">
        [Your Address] &nbsp;·&nbsp; <a href="https://youragency.com" style="color:#aaa;text-decoration:underline">youragency.com</a>
      </p>
    </div>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ffffff;color:#1f1f1f">
<div style="max-width:640px;margin:0 auto;padding:32px 24px;font-size:14px;line-height:1.6">
${styledBody}
${footerBlock}
</div>
</body>
</html>`;
}

export function SendProposalDialog({
  open,
  onOpenChange,
  proposalId,
  companyName,
  contactEmail,
}: SendProposalDialogProps) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState(
    DEFAULT_SUBJECT.replace("{company}", companyName),
  );
  const [bodyHtml, setBodyHtml] = useState(DEFAULT_BODY);
  // CC — comma/semicolon-separated. Pre-filled with the agency
  // default and shown open so the operator always sees who's copied
  // and can edit / clear it per send.
  const [cc, setCc] = useState(DEFAULT_CC);
  const [ccVisible, setCcVisible] = useState(true);
  // Recipient ("Pre") — editable. Pre-filled with the linked contact's
  // email, but the operator can override it for a one-off send. The API
  // accepts `recipient_email` and sends there instead of the stored
  // contact email. Reseeded from the prop each time the dialog opens.
  const [recipientEmail, setRecipientEmail] = useState(contactEmail ?? "");

  // Email templates from the agency's stored library. Optional.
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);

  // Force-remount the Tiptap editor when we apply a template or
  // reset the body — Tiptap holds internal state that ignores prop
  // changes after first mount, so a key bump is the cleanest reset.
  const [editorKey, setEditorKey] = useState(0);

  // Reseed everything when the dialog opens. Keeps the form fresh
  // each time and guards against stale state from a previous open
  // bleeding through (e.g., user opens, types something, closes,
  // re-opens — should see the default body, not their old draft).
  useEffect(() => {
    if (!open) return;
    setSubject(DEFAULT_SUBJECT.replace("{company}", companyName));
    setBodyHtml(DEFAULT_BODY);
    setCc(DEFAULT_CC);
    setCcVisible(true);
    setRecipientEmail(contactEmail ?? "");
    setEditorKey((k) => k + 1);
    fetch("/api/email-templates?category=proposal")
      .then((r) => r.json())
      .then((data) => setTemplates(data.templates ?? []))
      .catch(() => {
        // Templates are optional — silent failure is fine.
      });
    // companyName is deliberately excluded from the deps: we only
    // want to re-seed when the dialog opens, not when the parent
    // re-renders mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Live preview HTML — rebuilt every keystroke. Cheap (string ops)
  // so we don't bother memoizing harder than this.
  const previewHtml = useMemo(
    () => buildPreviewHtml(bodyHtml, companyName),
    [bodyHtml, companyName],
  );

  function applyTemplate(templateId: string) {
    if (templateId === "default") {
      setSubject(DEFAULT_SUBJECT.replace("{company}", companyName));
      setBodyHtml(DEFAULT_BODY);
      setEditorKey((k) => k + 1);
      return;
    }
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    setSubject(tpl.subject.replace("{company}", companyName));
    setBodyHtml(tpl.body_html);
    setEditorKey((k) => k + 1);
  }

  function handleResetBody() {
    setSubject(DEFAULT_SUBJECT.replace("{company}", companyName));
    setBodyHtml(DEFAULT_BODY);
    setEditorKey((k) => k + 1);
    toast.success("Reset to the default template.");
  }

  async function handleSend() {
    if (sending) return;
    const recipient = recipientEmail.trim();
    if (!recipient) {
      toast.error("Enter the recipient's email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      toast.error("Invalid recipient email address.");
      return;
    }
    if (!bodyHtml.trim() || bodyHtml === "<p></p>") {
      toast.error("Write the email content.");
      return;
    }
    if (!subject.trim()) {
      toast.error("Fill in the email subject.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "sent",
          greeting_text: bodyHtml,
          email_subject: subject,
          recipient_email: recipient,
          cc: cc.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to send the proposal.");
        return;
      }
      toast.success(`Proposal sent to ${recipient}.`);
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error("Network error: " + (err as Error).message);
    } finally {
      setSending(false);
    }
  }

  // Send is gated on a valid recipient (the editable "Pre" field), not
  // on whether the contact happened to have a stored email — the
  // operator can now type one in directly.
  const recipientTrimmed = recipientEmail.trim();
  const recipientValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientTrimmed);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Sticky-footer dialog layout. The default DialogContent uses
        `grid gap-4 p-6` which would push the body off-screen with
        a long default email + the rich-text editor's natural
        height; the Send button became unreachable (Peter saw this
        at 2026-05-10). Override:
          - flex-col + p-0 + gap-0 so we control padding ourselves
          - max-h-[90vh] caps the dialog so it never exceeds the
            viewport
          - inner scroll region (flex-1 overflow-y-auto) holds all
            the editable form fields and tabs
          - DialogHeader + DialogFooter stay shrink-0 with their
            own padding, so the title is always at the top and
            the Cancel + Send buttons are always at the bottom,
            no matter how tall the body grows.
      */}
      <DialogContent
        className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0"
        // Don't grab + select the "Pre" field when the dialog opens —
        // it made the recipient look like the thing you're meant to
        // change. Open passive; the user clicks where they want.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Mail className="size-5" />
            Send proposal — {companyName}
          </DialogTitle>
          <DialogDescription>
            The client receives a link to the website and their login
            details for the client zone. You set the price and discount
            with a separate button in the next step.
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable body. Everything between header + footer
            lives here. space-y-4 mirrors the gap-4 the default
            DialogContent provided before we overrode it. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-4">

        {/* To row — pre-filled with the contact's email. Editable for a
            one-off override (the API uses recipient_email when present),
            but styled as quiet text so it doesn't read as an "override
            this" field. "Cc" link reveals an optional CC input below. */}
        <div className="rounded-md border bg-muted/30 px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-xs text-muted-foreground shrink-0">To</span>
            <Input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="client@example.com"
              disabled={sending}
              // Quiet styling: looks like plain text at rest, reveals a
              // subtle border on hover/focus so it's discoverable as
              // editable without shouting "replace me".
              className="h-7 flex-1 min-w-40 font-mono text-sm bg-transparent border-transparent shadow-none px-1 hover:border-input focus-visible:border-input focus-visible:ring-0 focus-visible:bg-background"
            />
          </div>
          {!ccVisible && (
            <button
              type="button"
              onClick={() => setCcVisible(true)}
              className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              disabled={sending}
            >
              Add Cc
            </button>
          )}
        </div>

        {/* CC row — revealed by the "Add Cc" link above. Comma- or
            semicolon-separated; API validates each address. */}
        {ccVisible && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="sp-cc" className="text-xs">
                Cc
              </Label>
              <button
                type="button"
                onClick={() => {
                  setCc("");
                  setCcVisible(false);
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                disabled={sending}
              >
                Remove Cc
              </button>
            </div>
            <Input
              id="sp-cc"
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="colleague@company.com, boss@company.com"
              className="font-mono text-sm"
              disabled={sending}
            />
            <p className="text-[11px] text-muted-foreground">
              Separate multiple addresses with a comma. Cc recipients
              will see the client's address.
            </p>
          </div>
        )}

        {!recipientValid && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="size-3.5 shrink-0" />
            Enter a valid recipient email address above.
          </div>
        )}

        {/* Subject */}
        <div className="space-y-1.5">
          <Label htmlFor="sp-subject" className="text-xs">
            Subject
          </Label>
          <Input
            id="sp-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={sending}
            className="text-sm"
          />
        </div>

        {/* Optional: pre-saved template picker. Hidden when there
            are no templates — most agencies start with zero, so we
            don't want a permanent "select a template" affordance
            sitting empty. */}
        {templates.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Template</Label>
            <Select onValueChange={applyTemplate}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select a template…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Compose / Preview tabs — same layout as
            business-email-dialog.tsx so the two surfaces feel
            identical. The Reset button sits to the right of the
            tab list, mirroring the business email dialog's
            positioning. We removed the flex-1 fill behavior —
            since the outer wrapper handles scroll now, the Tabs
            just take their natural size and the body grows /
            shrinks the editor through its own min-h. */}
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
              title="Reset the subject and content to the default template"
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          </div>

          <TabsContent value="compose" className="mt-2">
            <RichTextEditor
              key={editorKey}
              content={bodyHtml}
              onChange={setBodyHtml}
              placeholder="Write a message for the client…"
              className="min-h-55"
            />
            <p className="text-[11px] text-muted-foreground mt-2">
              The website link ({"{website_link}"}), your name
              ({"{salesperson_name}"}), and the client zone login
              details are filled in automatically when sending.
            </p>
          </TabsContent>

          <TabsContent value="preview" className="mt-2">
            <div className="rounded-md border bg-muted/30 overflow-hidden">
              <iframe
                title="Email preview"
                srcDoc={previewHtml}
                className="w-full h-105 bg-white"
                sandbox="allow-same-origin"
              />
            </div>
            <p className="text-[11px] text-muted-foreground text-center mt-2">
              The actual website link, your name, and the client's
              login details (shown as placeholders) are filled in
              automatically when sending.
            </p>
          </TabsContent>
        </Tabs>

        </div>{/* /scrollable body */}

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
            disabled={sending || !recipientValid}
            className="gap-1.5"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            {sending ? "Sending…" : "Send email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
