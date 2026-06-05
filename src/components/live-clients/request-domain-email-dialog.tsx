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
import { CircleNotch as Loader2, Globe, ArrowsLeftRight as ArrowRightLeft, Envelope as Mail, Info } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

/**
 * Two compact dialogs for staff (tech / sales / super) to submit
 * domain + business-email setup requests on behalf of a paying
 * client. Both POST to `PUT /api/sites/[id]/domain` (the same
 * endpoint the client zone uses), so when super then opens
 * /super/domains to fulfill the request, the flow looks identical to
 * a client-submitted one — except super sees who requested it.
 *
 * Designed as "minimal forms" (one or two inputs, no pipeline UI)
 * because staff aren't waiting on their own request — they kick it
 * off and the `staff_notifications` table pings them when super
 * marks it active.
 *
 * Both dialogs support a `lang` prop so the same components ship
 * cleanly on /sales/live-clients/[id] as well.
 */

type Lang = "en" | "sk";

const STRINGS = {
  en: {
    // Domain dialog
    domainTitle: "Request domain setup",
    domainDescription:
      "Submit a request for super_admin to register a new domain or transfer an existing one. You'll get a banner on your dashboard when it goes active.",
    domainKindLabel: "Action",
    domainKindRegister: "Register new",
    domainKindRegisterHint:
      "Super buys the domain (e.g. on Hostinger) and points it at the site.",
    domainKindTransfer: "Transfer existing",
    domainKindTransferHint:
      "Client already owns the domain elsewhere; super initiates a transfer.",
    domainNameLabel: "Domain name",
    domainNamePlaceholder: "example.com",
    authCodeLabel: "EPP / authorization code",
    authCodePlaceholder: "Required for transfers",
    submit: "Submit request",
    submitting: "Submitting…",
    cancel: "Cancel",
    domainSuccess: "Domain request submitted",
    domainError: "Failed to submit",
    domainInvalid: "Invalid domain (e.g. acme.com)",
    transferAuthRequired: "Authorization code is required for transfers",
    // Email dialog
    emailTitle: "Request business email",
    emailDescription:
      "Pick the local part for the client's business mailbox (e.g. \"info\"). Super provisions it via Hostinger once the domain is active and you'll get a banner when it's ready.",
    emailPrefixLabel: "Email prefix",
    emailPrefixHint: "Lowercase letters, digits, dots. Max 32 characters.",
    emailPreviewLabel: "Will become",
    emailDomainHint: "Active domain is set on the site.",
    emailNoDomainWarning:
      "No active domain yet — the email can't be provisioned until super marks the domain active.",
    emailSuccess: "Business email request submitted",
    emailInvalid: "Prefix can only contain lowercase letters, digits, dots",
  },
  sk: {
    domainTitle: "Request domain setup",
    domainDescription:
      "Submit a request for super_admin to register a new domain or transfer an existing one. You'll get a notification on your dashboard when it goes active.",
    domainKindLabel: "Action",
    domainKindRegister: "Register new",
    domainKindRegisterHint:
      "Super buys the domain (e.g. on Hostinger) and points it at the site.",
    domainKindTransfer: "Transfer existing",
    domainKindTransferHint:
      "Client already owns the domain elsewhere; super initiates a transfer.",
    domainNameLabel: "Domain name",
    domainNamePlaceholder: "example.com",
    authCodeLabel: "EPP / authorization code",
    authCodePlaceholder: "Required for transfers",
    submit: "Submit request",
    submitting: "Submitting…",
    cancel: "Cancel",
    domainSuccess: "Domain request submitted",
    domainError: "Failed to submit",
    domainInvalid: "Invalid domain (e.g. acme.com)",
    transferAuthRequired: "Authorization code is required for transfers",
    emailTitle: "Request business email",
    emailDescription:
      "Pick the local part for the client's business mailbox (e.g. \"info\"). Super provisions it via Hostinger once the domain is active and you'll get a notification when it's ready.",
    emailPrefixLabel: "Email prefix",
    emailPrefixHint:
      "Lowercase letters, digits, dots. Max 32 characters.",
    emailPreviewLabel: "Will become",
    emailDomainHint: "Active domain is set on the site.",
    emailNoDomainWarning:
      "No active domain yet — the email can't be provisioned until super marks the domain active.",
    emailSuccess: "Business email request submitted",
    emailInvalid: "Prefix can only contain lowercase letters, digits, dots",
  },
} as const;

const DOMAIN_REGEX =
  /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;

// ────────────────────────────────────────────────────────────────────
// RequestDomainDialog — register-new OR transfer toggle + one input
// ────────────────────────────────────────────────────────────────────
export function RequestDomainDialog({
  open,
  onOpenChange,
  siteId,
  currentDomain,
  currentStatus,
  currentAuthCode,
  lang = "en",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  /** Pre-fills the input when editing a pending request. */
  currentDomain: string | null;
  /** "none" | "register_new" | "transfer" | "decided_later" | "active".
   *  Drives kind toggle pre-selection. */
  currentStatus: string | null;
  /** Pre-fills EPP when editing a pending transfer. */
  currentAuthCode: string | null;
  lang?: Lang;
}) {
  const router = useRouter();
  const t = STRINGS[lang];

  type Kind = "register_new" | "transfer";
  const [kind, setKind] = useState<Kind>(
    currentStatus === "transfer" ? "transfer" : "register_new",
  );
  const [domain, setDomain] = useState(currentDomain ?? "");
  const [authCode, setAuthCode] = useState(currentAuthCode ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const cleaned = domain.trim().toLowerCase();
    if (!DOMAIN_REGEX.test(cleaned)) {
      return setError(t.domainInvalid);
    }
    if (kind === "transfer" && !authCode.trim()) {
      return setError(t.transferAuthRequired);
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/domain`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain_status: kind,
          requested_domain: cleaned,
          ...(kind === "transfer" && { domain_auth_code: authCode.trim() }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t.domainError);
        return;
      }
      toast.success(t.domainSuccess);
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.domainError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            {t.domainTitle}
          </DialogTitle>
          <DialogDescription>{t.domainDescription}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Kind toggle — two side-by-side options with a hint */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t.domainKindLabel}</Label>
            <div className="grid grid-cols-2 gap-2">
              <KindOption
                active={kind === "register_new"}
                onClick={() => setKind("register_new")}
                icon={<Globe className="h-4 w-4" />}
                label={t.domainKindRegister}
                hint={t.domainKindRegisterHint}
                disabled={submitting}
              />
              <KindOption
                active={kind === "transfer"}
                onClick={() => setKind("transfer")}
                icon={<ArrowRightLeft className="h-4 w-4" />}
                label={t.domainKindTransfer}
                hint={t.domainKindTransferHint}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rd-domain" className="text-xs">
              {t.domainNameLabel}
            </Label>
            <Input
              id="rd-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={t.domainNamePlaceholder}
              disabled={submitting}
              autoFocus
            />
          </div>

          {kind === "transfer" && (
            <div className="space-y-1.5">
              <Label htmlFor="rd-auth" className="text-xs">
                {t.authCodeLabel}
              </Label>
              <Input
                id="rd-auth"
                value={authCode}
                onChange={(e) => setAuthCode(e.target.value)}
                placeholder={t.authCodePlaceholder}
                disabled={submitting}
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded px-3 py-2">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t.cancel}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  {t.submitting}
                </>
              ) : (
                t.submit
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────
// RequestBusinessEmailDialog — just the prefix
// ────────────────────────────────────────────────────────────────────
export function RequestBusinessEmailDialog({
  open,
  onOpenChange,
  siteId,
  currentPrefix,
  /** Active domain on the site — drives the preview ("info@balkar.sk").
   *  Pass null/empty to render the no-domain warning. */
  activeDomain,
  lang = "en",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  currentPrefix: string | null;
  activeDomain: string | null;
  lang?: Lang;
}) {
  const router = useRouter();
  const t = STRINGS[lang];

  // Default "info" matches the client-zone fallback so the experience
  // is consistent across surfaces (Peter's standard pick).
  const [prefix, setPrefix] = useState(currentPrefix ?? "info");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = `${(prefix || "info").toLowerCase().replace(/[^a-z0-9._-]/g, "")}@${
    activeDomain || "yourdomain.com"
  }`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    // Block submission when no active domain. Button is disabled but
    // Enter-to-submit (or browser autofill that triggers submit) would
    // otherwise sneak through — same reason we set the title attr on
    // the disabled button.
    if (!activeDomain) {
      return setError(t.emailNoDomainWarning);
    }

    const cleaned = prefix
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "")
      .slice(0, 32);
    if (!cleaned) return setError(t.emailInvalid);

    setSubmitting(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/domain`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Prefix-only payload — the existing endpoint has a fast path
        // for this shape that skips the status validation + the admin
        // notification email.
        body: JSON.stringify({ requested_email_prefix: cleaned }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t.domainError);
        return;
      }
      toast.success(t.emailSuccess);
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.domainError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            {t.emailTitle}
          </DialogTitle>
          <DialogDescription>{t.emailDescription}</DialogDescription>
        </DialogHeader>

        {!activeDomain && (
          <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3 flex items-start gap-2 text-xs text-amber-900 dark:text-amber-300">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{t.emailNoDomainWarning}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rb-prefix" className="text-xs">
              {t.emailPrefixLabel}
            </Label>
            <Input
              id="rb-prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="info"
              disabled={submitting}
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              {t.emailPrefixHint}
            </p>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t.emailPreviewLabel}
            </p>
            <p className="font-mono text-sm break-all">{preview}</p>
          </div>

          {error && (
            <p className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded px-3 py-2">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t.cancel}
            </Button>
            <Button
              type="submit"
              disabled={submitting || !activeDomain}
              title={!activeDomain ? t.emailNoDomainWarning : undefined}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  {t.submitting}
                </>
              ) : (
                t.submit
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────
// KindOption — register vs transfer card
// ────────────────────────────────────────────────────────────────────
function KindOption({
  active,
  onClick,
  icon,
  label,
  hint,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "text-left p-3 rounded-md border transition-colors " +
        (active
          ? "border-primary bg-primary/5"
          : "border-input hover:bg-muted/50")
      }
    >
      <div className="flex items-center gap-1.5 text-sm font-medium mb-1">
        {icon}
        {label}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        {hint}
      </p>
    </button>
  );
}
