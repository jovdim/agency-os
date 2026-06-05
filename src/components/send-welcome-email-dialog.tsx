"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CircleNotch as Loader2, Eye, PaperPlaneTilt as Send, ArrowsClockwise as RefreshCw } from "@phosphor-icons/react/ssr";

interface SendWelcomeEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Client's delivery email (where the welcome email is sent) */
  defaultTo: string;
  /** Email the client will use to log in (usually same as defaultTo) */
  defaultLoginEmail: string;
  /** Pre-filled temp password — can be edited or regenerated */
  defaultPassword: string;
  fullName: string;
  companyName?: string | null;
  siteUrl?: string | null;
}

export function SendWelcomeEmailDialog({
  open,
  onOpenChange,
  defaultTo,
  defaultLoginEmail,
  defaultPassword,
  fullName,
  companyName,
  siteUrl,
}: SendWelcomeEmailDialogProps) {
  const [emailTo, setEmailTo] = useState(defaultTo);
  const [emailLoginEmail, setEmailLoginEmail] = useState(defaultLoginEmail);
  const [emailPassword, setEmailPassword] = useState(defaultPassword);
  const [emailCustomMsg, setEmailCustomMsg] = useState("");
  const [emailPreviewHtml, setEmailPreviewHtml] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function loadPreview() {
    setLoadingPreview(true);
    try {
      const params = new URLSearchParams({
        full_name: fullName,
        login_email: emailLoginEmail || emailTo || "",
        login_password: emailPassword || "********",
        ...(companyName && { company_name: companyName }),
        ...(siteUrl && { site_url: siteUrl }),
        ...(emailCustomMsg && { custom_message: emailCustomMsg }),
      });
      const res = await fetch(`/api/admin/clients/send-welcome?${params}`);
      if (res.ok) {
        setEmailPreviewHtml(await res.text());
      } else {
        toast.error("Failed to load preview");
      }
    } catch {
      toast.error("Preview error");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function sendEmail() {
    if (!emailTo) {
      toast.error("Enter the client's email address");
      return;
    }
    if (!emailPassword) {
      toast.error("Enter the client's password");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/admin/clients/send-welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emailTo,
          full_name: fullName,
          company_name: companyName || undefined,
          login_email: emailLoginEmail || emailTo,
          login_password: emailPassword,
          site_url: siteUrl || undefined,
          site_name: companyName || undefined,
          custom_message: emailCustomMsg || undefined,
        }),
      });
      if (res.ok) {
        setSent(true);
        toast.success("Welcome email sent!");
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to send email");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSending(false);
    }
  }

  function generatePassword() {
    const chars = "abcdefghijkmnpqrstuvwxyz23456789";
    let pw = "";
    for (let i = 0; i < 8; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    setEmailPassword(pw);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>Send Welcome Email</DialogTitle>
          <DialogDescription>
            Send login credentials for the client zone to your client.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {sent && (
            <div className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                Email sent to {emailTo}
              </p>
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Send To *</label>
            <Input
              type="email"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder="client@example.com"
              className="mt-1"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Where the welcome email will be delivered.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium">Login Email *</label>
            <Input
              type="email"
              value={emailLoginEmail}
              onChange={(e) => setEmailLoginEmail(e.target.value)}
              placeholder="client@example.com"
              className="mt-1"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              The email shown in the email — client uses this to log in.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium">Client Password *</label>
            <div className="flex gap-2 mt-1">
              <Input
                type="text"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                placeholder="Enter current or new password"
                className="flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 h-9"
                onClick={generatePassword}
              >
                Generate
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              This password will be shown in the email.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium">Custom Message (optional)</label>
            <textarea
              className="w-full h-16 mt-1 rounded-lg border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Add a personal note..."
              value={emailCustomMsg}
              onChange={(e) => setEmailCustomMsg(e.target.value)}
            />
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={loadPreview}
            disabled={loadingPreview}
          >
            {loadingPreview ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {emailPreviewHtml ? "Refresh Preview" : "Preview Email"}
          </Button>

          {emailPreviewHtml && (
            <div className="rounded-lg border overflow-hidden">
              <iframe
                srcDoc={emailPreviewHtml}
                className="w-full bg-white"
                style={{ height: 520, border: "none" }}
                title="Email preview"
              />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="flex-1 gap-1.5"
              onClick={sendEmail}
              disabled={sending || !emailTo || !emailPassword}
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : sent ? (
                <RefreshCw className="h-3.5 w-3.5" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {sending ? "Sending..." : sent ? "Send Again" : "Send Email"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              {sent ? "Done" : "Cancel"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
