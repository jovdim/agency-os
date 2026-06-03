"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { RichTextEditor } from "@/components/email/rich-text-editor";
import { toast } from "sonner";
import { Loader2, Replace, Send } from "lucide-react";
import {
  buildBusinessEmailSetupHtml,
  buildDefaultBusinessEmailBody,
  defaultBusinessEmailSubject,
  FALLBACK_BUSINESS_EMAIL,
  FALLBACK_BUSINESS_EMAIL_PASSWORD,
  FALLBACK_PERSONAL_EMAIL,
  CATCH_ALL_LOCAL_PART,
} from "@/lib/emails/business-email-setup";

/**
 * Default CC address pre-filled on every send so the agency always
 * keeps a copy of outgoing client emails in one inbox. Shown open in
 * the dialog so the operator sees it and can edit / clear it per send.
 * KEEP IN SYNC with the same constant in send-proposal-dialog.tsx.
 */
const DEFAULT_CC = "youragency@gmail.com";

/**
 * Gmail-style compose + preview dialog for the "Business email" timeline
 * step. Tech edits the message body in a rich-text editor on the left
 * tab, flips to Preview to see the exact HTML email the client will get
 * (rendered via the SAME shared template the server uses), then clicks
 * Send. The credentials box + footer are auto-rendered and not editable
 * — they shouldn't drift template to template.
 *
 * The dialog is fully controlled: parent owns `open`, `onOpenChange`,
 * and refreshes the timeline via `onSent` when the API succeeds.
 *
 * NOTE 2026-05-10: relocated from
 * src/app/(dashboard)/tech/proposals/[id]/business-email-dialog.tsx
 * to src/components/proposal-timeline/business-email-dialog.tsx so the
 * shared timeline component (used by both tech and sales) can keep all
 * its dependencies in one place. Behavior unchanged.
 */
interface BusinessEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  companyName: string;
  /**
   * Where the email gets delivered (the contact's primary email).
   * Also baked into Peter's Slovak template as `[personal email]`
   * — the gmail the visitor will reply from.
   */
  recipientEmail: string;
  /** Prefilled into the email field — saved value if any, else `info@<domain>`. */
  initialBusinessEmail: string;
  /** Prefilled into the password field — saved value if any. */
  initialBusinessEmailPassword: string;
  /** Already-sent timestamp (string) — flips the CTA label to "Re-send". */
  alreadySent: boolean;
  /** Called after a successful send so the parent can router.refresh(). */
  onSent?: () => void;
}

export function BusinessEmailDialog({
  open,
  onOpenChange,
  proposalId,
  companyName,
  recipientEmail,
  initialBusinessEmail,
  initialBusinessEmailPassword,
  alreadySent,
  onSent,
}: BusinessEmailDialogProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Form state — initialised from props every time the dialog opens so
  // the user always sees the current saved creds, not stale state from
  // a previous open.
  // `to` is the recipient address — defaults to the contact's primary
  // email but is fully editable. Same value is also baked in as the
  // `[personal email]` placeholder of Peter's Slovak template (the
  // gmail the client replies from), so changing one updates the other
  // on Reset body. Tech sees + can override before sending.
  const [to, setTo] = useState(recipientEmail);
  // CC — comma- or semicolon-separated addresses; the API splits +
  // validates them. Pre-filled with the agency default and shown
  // open so the operator always sees who's copied and can edit /
  // clear it per send.
  const [cc, setCc] = useState(DEFAULT_CC);
  const [ccVisible, setCcVisible] = useState(true);
  const [email, setEmail] = useState(initialBusinessEmail);
  const [password, setPassword] = useState(initialBusinessEmailPassword);
  const [subject, setSubject] = useState(defaultBusinessEmailSubject(companyName));

  /**
   * Build the default body from CURRENT email/password values + the
   * current `to` address (used as `[personal email]` in Peter's
   * Slovak template). Called when the dialog opens, and again when
   * the tech clicks "Reset body". After that the body floats free
   * — editing the input fields no longer touches the body, so a stray
   * keystroke can't clobber a polished draft.
   */
  function makeDefaultBody(args: {
    businessEmail: string;
    businessEmailPassword: string;
    toEmail: string;
  }) {
    return buildDefaultBusinessEmailBody({
      contactPersonalEmail: args.toEmail,
      businessEmail: args.businessEmail || "info@yourcompany.sk",
      businessEmailPassword: args.businessEmailPassword || "",
    });
  }

  const [bodyHtml, setBodyHtml] = useState(() =>
    makeDefaultBody({
      businessEmail: initialBusinessEmail,
      businessEmailPassword: initialBusinessEmailPassword,
      toEmail: recipientEmail,
    }),
  );
  // Force-remount the editor when we reset the body (otherwise Tiptap
  // keeps its internal state and ignores prop changes).
  const [editorKey, setEditorKey] = useState(0);

  // Track the cred values that are currently baked into the body so
  // "Sync values" knows what literals to find-and-replace. Ref (not
  // state) — every replace updates the snapshot but doesn't re-render.
  const lastSyncedRef = useRef({
    email: initialBusinessEmail,
    password: initialBusinessEmailPassword,
    to: recipientEmail,
  });

  useEffect(() => {
    if (open) {
      setTo(recipientEmail);
      setCc(DEFAULT_CC);
      setCcVisible(true);
      setEmail(initialBusinessEmail);
      setPassword(initialBusinessEmailPassword);
      setSubject(defaultBusinessEmailSubject(companyName));
      setBodyHtml(
        makeDefaultBody({
          businessEmail: initialBusinessEmail,
          businessEmailPassword: initialBusinessEmailPassword,
          toEmail: recipientEmail,
        }),
      );
      setEditorKey((k) => k + 1);
      lastSyncedRef.current = {
        email: initialBusinessEmail,
        password: initialBusinessEmailPassword,
        to: recipientEmail,
      };
    }
    // We deliberately re-seed only when `open` flips to true. If we
    // also depended on the prop values, every parent re-render would
    // wipe the user's in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Find-and-replace the previously-baked credential values with the
   * current input values. Preserves any custom edits the tech made to
   * the body — the default template gets seeded once on open, and after
   * that the body only changes via this targeted replace path or the
   * tech's own keystrokes.
   *
   * Replaces both the HTML-escaped form (what the builder writes) and
   * the raw form (in case the tech typed it manually after editing).
   * Tracks the last-synced values in a ref so subsequent clicks always
   * replace what's CURRENTLY in the body, not the original initial
   * values.
   */
  /**
   * Core sync routine — shared by the manual button and the
   * debounced auto-sync effect below. Returns the list of fields it
   * actually updated so the caller can decide whether to surface a
   * toast or stay quiet (auto-sync stays quiet to avoid spamming).
   */
  function runSync(): string[] {
    const prev = lastSyncedRef.current;
    const nextEmail = email.trim();
    const nextPassword = password.trim();
    const nextTo = to.trim();
    const changes: string[] = [];

    // When a field was empty at body-build time, the default builder
    // baked in the fallback literal (FALLBACK_BUSINESS_EMAIL, the
    // dots placeholder, etc.) — so the find-replace target on the
    // first sync is that fallback, not the empty string. Without
    // this, the first-send dialog left "••••••" and the wrong
    // mailbox in the body even after the tech typed real values
    // (Peter 2026-05-27).
    const prevEmail = prev.email || FALLBACK_BUSINESS_EMAIL;
    const prevPassword = prev.password || FALLBACK_BUSINESS_EMAIL_PASSWORD;
    const prevTo = prev.to || FALLBACK_PERSONAL_EMAIL;

    let next = bodyHtml;
    if (nextEmail && prevEmail !== nextEmail) {
      // 1. Replace the full mailbox string first (e.g.
      //    "info@mmstrechy.sk" → "info@newdomain.sk")
      next = replaceAllForms(next, prevEmail, nextEmail);
      // 2. Then update the catch-all example
      //    ("objednavky@<prev-domain>" → "objednavky@<next-domain>")
      //    so the upsell paragraph follows the domain switch. We
      //    target THIS exact pair instead of a blanket
      //    "@prev-domain" → "@next-domain" sweep — the blanket form
      //    used to mangle the recipient's personal email when its
      //    domain happened to match (e.g. tileconsk@gmail.com →
      //    tileconsk@tilecon.sk when switching mailbox from
      //    @gmail.com to @tilecon.sk). Peter caught 2026-05-27.
      const prevDomain = prevEmail.split("@")[1] || "";
      const nextDomain = nextEmail.split("@")[1] || "";
      if (prevDomain && nextDomain && prevDomain !== nextDomain) {
        next = replaceAllForms(
          next,
          `${CATCH_ALL_LOCAL_PART}@${prevDomain}`,
          `${CATCH_ALL_LOCAL_PART}@${nextDomain}`,
        );
      }
      changes.push("mailbox");
    }
    if (nextPassword && prevPassword !== nextPassword) {
      next = replaceAllForms(next, prevPassword, nextPassword);
      changes.push("password");
    }
    if (nextTo && prevTo !== nextTo) {
      next = replaceAllForms(next, prevTo, nextTo);
      changes.push("recipient");
    }

    if (changes.length === 0) return [];

    setBodyHtml(next);
    setEditorKey((k) => k + 1);
    lastSyncedRef.current = {
      email: nextEmail,
      password: nextPassword,
      to: nextTo,
    };
    return changes;
  }

  function handleSyncValues() {
    const changes = runSync();
    if (changes.length === 0) {
      toast.info("Nothing to update — body already matches the inputs.");
      return;
    }
    toast.success(`Updated ${changes.join(", ")} in body.`);
  }

  /**
   * Debounced auto-sync. Fires ~500ms after the operator stops
   * typing in any of the input fields. Two guards:
   *
   *   - The dialog must be open (no work on closed dialogs).
   *   - The mailbox must look like a valid email — without an `@`,
   *     the domain sweep in runSync() can't determine a new domain
   *     and would skip the catch-all example, producing the
   *     "static-looking preview" Peter hit on 2026-05-19.
   *
   * Stays silent (no toast) — the pulse indicator on the Sync button
   * already shows when there are unsynced changes; auto-sync just
   * makes those pulses disappear without operator action. The Sync
   * button remains for the manual-edit case (operator typed inside
   * the body and wants to push the input values back in).
   */
  useEffect(() => {
    if (!open || busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return;
    const snap = lastSyncedRef.current;
    const stale =
      email.trim() !== snap.email.trim() ||
      password.trim() !== snap.password.trim() ||
      to.trim() !== snap.to.trim();
    if (!stale) return;

    const t = setTimeout(() => {
      runSync();
    }, 500);
    return () => clearTimeout(t);
    // bodyHtml deliberately not in deps — editor keystrokes shouldn't
    // re-trigger auto-sync. Only input-field changes should.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password, to, open, busy]);

  /** The full email HTML — rebuilt live for the Preview tab. */
  const previewHtml = useMemo(
    () =>
      buildBusinessEmailSetupHtml({
        companyName,
        bodyHtml,
      }),
    [companyName, bodyHtml],
  );

  async function handleSend() {
    if (busy) return;
    if (!to.trim()) {
      toast.error("Recipient (To) is required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
      toast.error("Recipient looks invalid — check the email format.");
      return;
    }
    if (!email.trim() || !password.trim()) {
      toast.error("Both mailbox and password are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/proposals/${proposalId}/send-business-email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to_email: to,
            cc: cc.trim() || undefined,
            business_email: email,
            business_email_password: password,
            subject,
            body_html: bodyHtml,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Send failed");
        return;
      }
      toast.success(`Setup email sent to ${data.delivered_to}.`);
      onOpenChange(false);
      onSent?.();
      router.refresh();
    } catch (err) {
      toast.error("Network error: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // True when the input fields hold values that haven't been pushed
  // into the body yet — drives the subtle pulse on "Sync values" so
  // the tech notices there's pending work without the indicator
  // shouting. Recomputed per render; the ref snapshot is the floor.
  const snap = lastSyncedRef.current;
  const hasUnsyncedChanges =
    email.trim() !== snap.email.trim() ||
    password.trim() !== snap.password.trim() ||
    to.trim() !== snap.to.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-3">
        <DialogHeader className="shrink-0">
          <DialogTitle>Send Hostinger mailbox login</DialogTitle>
          <DialogDescription>
            Edit the recipient, message, and preview before sending.
          </DialogDescription>
        </DialogHeader>

        {/* ── Scrollable middle ──
            Everything between header and footer lives in a single
            overflow-y-auto region so the footer stays pinned at the
            bottom of the dialog and never floats over the editor on
            narrow viewports. The form fields + tabs grow to their
            natural height; the scrollbar appears only when the
            combined height exceeds the available space. */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1 space-y-3">
          {/* To: row — primary destination (defaults to contact email).
              The "Cc" link on the right reveals an optional CC input
              below when the operator wants to loop someone in (Gmail-
              style — hidden by default to keep the dialog uncluttered). */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="be-to" className="text-xs">
                To
              </Label>
              {!ccVisible && (
                <button
                  type="button"
                  onClick={() => setCcVisible(true)}
                  className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  disabled={busy}
                >
                  Cc
                </button>
              )}
            </div>
            <Input
              id="be-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@gmail.com"
              className="font-mono text-sm"
              disabled={busy}
            />
          </div>

          {/* CC row — revealed by the "Cc" link above. Comma- or
              semicolon-separated; the API validates each address. */}
          {ccVisible && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="be-cc" className="text-xs">
                  Cc
                </Label>
                <button
                  type="button"
                  onClick={() => {
                    setCc("");
                    setCcVisible(false);
                  }}
                  className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  disabled={busy}
                >
                  Remove Cc
                </button>
              </div>
              <Input
                id="be-cc"
                type="text"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="boss@company.com, colleague@company.com"
                className="font-mono text-sm"
                disabled={busy}
              />
              <p className="text-[11px] text-muted-foreground">
                Multiple addresses — separate with commas. CC recipients
                see the To address.
              </p>
            </div>
          )}

          {/* Mailbox + Hostinger password — what we provisioned in
              Hostinger and what we're sharing with the client. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="be-email" className="text-xs">
                New mailbox
              </Label>
              <Input
                id="be-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="info@yourcompany.sk"
                className="font-mono text-sm"
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="be-pass" className="text-xs">
                Hostinger password
              </Label>
              <Input
                id="be-pass"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Paste from Hostinger"
                className="font-mono text-sm"
                disabled={busy}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="be-subject" className="text-xs">
              Subject
            </Label>
            <Input
              id="be-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={busy}
            />
          </div>

          <Tabs defaultValue="compose" className="flex flex-col">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <TabsList>
                <TabsTrigger value="compose">Compose</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleSyncValues}
                disabled={busy}
                className={
                  "gap-1.5 whitespace-nowrap transition-colors " +
                  (hasUnsyncedChanges
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
                title="Replace the email/password currently in the body with the input values. Keeps any custom edits you made."
              >
                {hasUnsyncedChanges && (
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full bg-amber-500 animate-pulse"
                  />
                )}
                <Replace className="size-3.5" />
                Sync values
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
                You write the whole email — heading, message, login details,
                closing. The credentials are pre-filled in the default body;
                edit anything you like. Only the agency footer is added
                automatically.
              </p>
            </TabsContent>

            <TabsContent value="preview" className="mt-2">
              <div className="rounded-md border bg-muted/30 overflow-hidden">
                <iframe
                  title="Email preview"
                  srcDoc={previewHtml}
                  className="w-full h-105 bg-white"
                  sandbox=""
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="shrink-0 gap-2 sm:gap-2 flex-wrap sm:flex-nowrap">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="whitespace-nowrap"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={busy}
            className="gap-1.5 whitespace-nowrap min-w-0"
          >
            {busy ? <Loader2 className="size-4 animate-spin shrink-0" /> : <Send className="size-4 shrink-0" />}
            <span className="truncate">
              {alreadySent ? "Re-send setup email" : "Send setup email"}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Replace every occurrence of `needle` (both raw and HTML-escaped forms)
 * with `replacement` (escaped to match what the body builder emits).
 * Split + join is the simplest "replace all" in JS without needing to
 * regex-escape the needle.
 */
function replaceAllForms(
  haystack: string,
  needle: string,
  replacement: string,
): string {
  if (!needle || needle === replacement) return haystack;
  const needleEscaped = escapeHtml(needle);
  const replacementEscaped = escapeHtml(replacement);
  let out = haystack;
  // Escaped form first so we don't double-replace inside <strong>info@…</strong>
  if (needleEscaped !== needle) {
    out = out.split(needleEscaped).join(replacementEscaped);
  }
  out = out.split(needle).join(replacement);
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
