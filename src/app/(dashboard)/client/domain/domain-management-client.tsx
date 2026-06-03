"use client";

import { useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Globe,
  ArrowRightLeft,
  ArrowRight,
  Loader2,
  CheckCircle,
  Search,
  XCircle,
  AlertCircle,
  Mail,
  Copy,
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  Clock as ClockIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { enGB } from "date-fns/locale";

interface SiteData {
  id: string;
  name: string;
  domain: string | null;
  domainStatus: string;
  requestedDomain: string | null;
  domainAuthCode: string | null;
  domainNotes: string | null;
  domainDecidedAt: string | null;
  /** Local part the client picked for their business email (e.g. "info").
   *  Combined with the active domain to form their full address. Tech
   *  reads it during email provisioning. Null until they pick one. */
  requestedEmailPrefix: string | null;
}

interface DomainManagementClientProps {
  site: SiteData;
  /** Provisioned business email address (e.g. info@acmecorp.sk). Null
   *  until tech has set up the Hostinger mailbox. */
  businessEmail: string | null;
  /** Plaintext password for the provisioned mailbox. Surfaced in the
   *  client zone so the client doesn't have to dig through the
   *  welcome email to find it again. RLS ensures only the owner can
   *  read this column. */
  businessEmailPassword: string | null;
}

type DomainOption = "register_new" | "transfer" | null;

/** Possible states a pipeline step can be in. Drives both the badge
 *  visual on the left of the step and the pill label on the right.
 *
 *  "pending" — soft "we'll get to it" state with a clock icon. Used by
 *  the credentials step while we wait for the team to provision the
 *  mailbox (~24h after the domain is active). Replaces what used to be
 *  a harder-feeling "locked" state with a padlock.
 */
type StepState =
  | "done"
  | "active"
  | "in_progress"
  | "rejected"
  | "pending";

export function DomainManagementClient({
  site,
  businessEmail,
  businessEmailPassword,
}: DomainManagementClientProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<DomainOption>(null);
  const [domain, setDomain] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Domain availability check state
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Business email prefix — the local part of the eventual address.
  // Saved independently from the domain decision via the prefix-only
  // path on PUT /api/sites/[id]/domain. Pre-filled from the persisted
  // value if the client picked one before; otherwise defaults to
  // "info" (the de-facto standard for business inboxes), so the
  // client can scan the suggested address, accept it as-is, or tweak
  // it. "info" is also the most common choice in Peter's existing
  // book, so this matches what the tech team would have picked anyway.
  const DEFAULT_EMAIL_PREFIX = "info";
  const [emailPrefix, setEmailPrefix] = useState(
    site.requestedEmailPrefix ?? DEFAULT_EMAIL_PREFIX,
  );
  const [savingPrefix, setSavingPrefix] = useState(false);
  // "Changed" when the current input differs from what's saved. For a
  // brand-new client (nothing saved) we still want Save enabled with
  // the default — comparing against null lets us treat the prefilled
  // "info" as an unsaved suggestion the client can confirm with one
  // click.
  const prefixChanged =
    emailPrefix.trim() !== (site.requestedEmailPrefix ?? "");

  /** Preview of the full email shown next to the input. Falls back to a
   *  placeholder until either the prefix or the domain is known. */
  const previewDomain =
    site.domain || site.requestedDomain || "yourdomain.com";
  const previewPrefix = emailPrefix.trim() || "info";
  const emailPreview = `${previewPrefix}@${previewDomain}`;

  async function savePrefix() {
    const trimmed = emailPrefix.trim().toLowerCase();
    setSavingPrefix(true);
    try {
      const res = await fetch(`/api/sites/${site.id}/domain`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requested_email_prefix: trimmed === "" ? null : trimmed,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to save the email name");
        return;
      }
      toast.success(
        trimmed
          ? `Email will be ${trimmed}@${previewDomain}`
          : "Email name cleared",
      );
      // Wrap router.refresh() in startTransition so React schedules the
      // server-data refresh without yanking nodes from under sonner's
      // portal animation — fixes the "Failed to execute 'removeChild'"
      // DOM error that fires when the conditional branches swap mid-
      // toast-mount. Same pattern applied to handleSubmit below.
      startTransition(() => {
        router.refresh();
      });
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSavingPrefix(false);
    }
  }

  const isPending =
    site.domainStatus === "register_new" || site.domainStatus === "transfer";
  const isActive = site.domainStatus === "active";
  // A domain counts as "done" when its status flips to active OR when a
  // custom domain is already attached to the site. The second case covers
  // migrated clients who arrived with their own domain: their
  // domain_status often still reads "none" (we never ran them through the
  // request pipeline), but the site already resolves on a real domain — so
  // the client must NOT be shown the register/transfer picker again.
  // Mirrors the staff-side `domainActive` check in
  // components/live-clients/client-detail-client.tsx.
  const domainDone = isActive || !!site.domain;
  const isDecidedLater = site.domainStatus === "decided_later";
  const isRejected = site.domainStatus === "rejected";

  // ── Pipeline step states ──────────────────────────────────────
  // Drive the badge + pill on each step.
  //
  //   Step 1 (Domain):  active until they choose, in_progress while
  //                     admin reviews, done once the domain is live,
  //                     rejected if admin sent it back.
  //
  //   Step 2 (Email):   LOCKED (pending) only while the client hasn't
  //                     submitted their domain choice yet — i.e. step 1
  //                     is in its initial "active" state, or was rejected.
  //                     Once they SUBMIT (step 1 → in_progress) or the
  //                     domain is active (step 1 → done), step 2 opens
  //                     for input. Peter 2026-05-11: the client should
  //                     NOT have to wait for the admin to approve the
  //                     domain before picking an email name — they can
  //                     pick it in parallel; admin pairs them on activation.
  //
  //   Step 3 (Access):  "pending" until the team provisions the
  //                     mailbox (~24h after domain activates). Soft
  //                     wait, not a hard lock — the client doesn't
  //                     have to do anything to unlock it.
  const step1State: StepState = domainDone
    ? "done"
    : isPending
      ? "in_progress"
      : isRejected
        ? "rejected"
        : "active";

  // A provisioned business email always reads "done" and locks the prefix
  // input — the client must NOT be able to request a new one once a
  // mailbox exists (or they arrived with their own). This takes priority
  // over the domain-gate below so the "already set up" state wins even in
  // the unusual case where an email exists but the domain step isn't done.
  const step2State: StepState = businessEmail
    ? "done"
    : step1State === "active" || step1State === "rejected"
      ? "pending"
      : site.requestedEmailPrefix
        ? "in_progress"
        : "active";

  const step3State: StepState = businessEmail ? "done" : "pending";

  // Password reveal toggle for the credentials section. Default hidden
  // so the password isn't visible to someone shoulder-surfing the screen.
  const [passwordRevealed, setPasswordRevealed] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);

  async function copyToClipboard(value: string, kind: "email" | "password") {
    try {
      await navigator.clipboard.writeText(value);
      if (kind === "email") {
        setEmailCopied(true);
        toast.success("Email copied");
        setTimeout(() => setEmailCopied(false), 1500);
      } else {
        setPasswordCopied(true);
        toast.success("Password copied");
        setTimeout(() => setPasswordCopied(false), 1500);
      }
    } catch {
      toast.error("Failed to copy");
    }
  }

  async function checkAvailability() {
    const d = domain.trim().toLowerCase();
    if (!d) {
      toast.error("Enter a domain name");
      return;
    }

    // Basic format check
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;
    if (!domainRegex.test(d)) {
      toast.error("Invalid domain format (e.g. mysite.com)");
      return;
    }

    setChecking(true);
    setAvailable(null);
    setCheckError(null);

    try {
      const res = await fetch(`/api/sites/${site.id}/domain/check?domain=${encodeURIComponent(d)}`);
      const data = await res.json();

      if (!res.ok) {
        setCheckError(data.error || "Failed to check availability");
        return;
      }

      setAvailable(data.available);
      if (!data.available) {
        setCheckError(data.reason || "Domain is not available");
      }
    } catch {
      setCheckError("Network error. Please try again.");
    } finally {
      setChecking(false);
    }
  }

  async function handleSubmit() {
    if (!selected) return;

    if (selected === "register_new" && !domain.trim()) {
      toast.error("Enter a domain name");
      return;
    }
    if (selected === "transfer" && (!domain.trim() || !authCode.trim())) {
      toast.error("Enter both the domain and the authorization code");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/sites/${site.id}/domain`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain_status: selected,
          requested_domain: domain.trim(),
          domain_auth_code: selected === "transfer" ? authCode.trim() : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to save");
        return;
      }

      toast.success("Domain request has been sent");
      // startTransition: see savePrefix() above — avoids the sonner
      // portal vs. React reconciliation removeChild race.
      startTransition(() => {
        router.refresh();
      });
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Webmail entry point — Hostinger's hosted webmail UI. Client logs in
  // with the provisioned business_email + business_email_password. We
  // link to the generic webmail.hostinger.com login rather than a deep
  // link because Hostinger's auto-login URLs change between plans.
  const webmailUrl = "https://webmail.hostinger.com/";

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Domain and business email
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set up your web address and business email in two steps.
          Once your mailbox is created, you will see your login details below.
        </p>
      </div>

      {/* ── Step 1: Domain ───────────────────────────────────────── */}
      <PipelineStep number={1} state={step1State} title="Domain">
        {step1State === "done" ? (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
            <span className="font-medium font-mono">
              {site.domain || site.requestedDomain}
            </span>
          </div>
        ) : step1State === "in_progress" ? (
          // Soft "request received, we'll handle it" body — deliberately
          // does NOT use active verbs like "Registrujeme" (We are
          // registering), because the team hasn't actually started yet:
          // Peter still has to manually purchase on Hostinger. Calm
          // clock icon, neutral language, no spinner that implies live
          // work in flight.
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              <ClockIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>
                Requested domain:{" "}
                <span className="font-medium font-mono">
                  {site.requestedDomain}
                </span>
              </span>
            </div>
            <p className="text-xs text-muted-foreground ml-6">
              {site.domainStatus === "register_new"
                ? "We've received your registration request. We'll set up the domain as soon as possible."
                : "We've received your transfer request. We'll set up the domain as soon as possible."}
            </p>
            {site.domainDecidedAt && (
              <p className="text-[11px] text-muted-foreground/80 ml-6">
                Sent{" "}
                {formatDistanceToNow(new Date(site.domainDecidedAt), {
                  addSuffix: true,
                  locale: enGB,
                })}
              </p>
            )}
            {site.domainNotes && (
              <p className="text-xs text-muted-foreground ml-6 italic">
                Note from the team: {site.domainNotes}
              </p>
            )}
          </div>
        ) : (
          // "active" (needs picking) and "rejected" (needs retry) share
          // the same body: the register/transfer picker. Rejected state
          // shows a red note above the picker so the client sees why
          // their previous choice was sent back.
          <div className="space-y-4">
            {step1State === "rejected" && (
              <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <span className="font-medium">
                    Your request was rejected
                  </span>
                </div>
                {site.domainNotes && (
                  <p className="text-sm text-muted-foreground ml-6">
                    {site.domainNotes}
                  </p>
                )}
                <p className="text-xs text-muted-foreground ml-6">
                  Please try a different domain.
                </p>
              </div>
            )}

            {isDecidedLater && step1State === "active" && (
              <p className="text-sm text-muted-foreground">
                You postponed your domain decision. You can come back to it
                anytime below.
              </p>
            )}

            {/* Option cards */}
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => {
                  setSelected("register_new");
                  setAvailable(null);
                  setCheckError(null);
                }}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-4 text-left transition-all",
                  selected === "register_new"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:border-muted-foreground/30 hover:bg-muted/30",
                )}
              >
                <div
                  className={cn(
                    "rounded-lg p-2 shrink-0",
                    selected === "register_new"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Globe className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-medium text-sm">Register a new one</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    We'll register a new domain for you
                  </p>
                </div>
              </button>

              <button
                onClick={() => {
                  setSelected("transfer");
                  setAvailable(null);
                  setCheckError(null);
                }}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-4 text-left transition-all",
                  selected === "transfer"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:border-muted-foreground/30 hover:bg-muted/30",
                )}
              >
                <div
                  className={cn(
                    "rounded-lg p-2 shrink-0",
                    selected === "transfer"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <ArrowRightLeft className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-medium text-sm">Transfer an existing one</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    We'll transfer your domain to us
                  </p>
                </div>
              </button>
            </div>

            {/* Register new domain form */}
            {selected === "register_new" && (
              <div className="space-y-3 rounded-xl border p-4 bg-muted/20">
                <div className="space-y-1.5">
                  <Label htmlFor="domain" className="text-sm">
                    Requested domain
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="domain"
                      placeholder="mysite.com"
                      value={domain}
                      onChange={(e) => {
                        setDomain(e.target.value);
                        setAvailable(null);
                        setCheckError(null);
                      }}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={checkAvailability}
                      disabled={checking || !domain.trim()}
                      className="shrink-0 h-9"
                    >
                      {checking ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                      <span className="ml-1.5">Check</span>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    For example mysite.com or mycompany.com
                  </p>
                </div>

                {/* Availability result */}
                {available === true && (
                  <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                    <CheckCircle className="h-4 w-4" />
                    <span>
                      Domain{" "}
                      <span className="font-medium font-mono">
                        {domain.trim().toLowerCase()}
                      </span>{" "}
                      is available
                    </span>
                  </div>
                )}
                {available === false && (
                  <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                    <XCircle className="h-4 w-4" />
                    <span>{checkError || "Domain is not available"}</span>
                  </div>
                )}
                {checkError && available === null && (
                  <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    <span>{checkError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Transfer domain form */}
            {selected === "transfer" && (
              <div className="space-y-3 rounded-xl border p-4 bg-muted/20">
                <div className="space-y-1.5">
                  <Label htmlFor="transfer-domain" className="text-sm">
                    Your current domain
                  </Label>
                  <Input
                    id="transfer-domain"
                    placeholder="mysite.com"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="authcode" className="text-sm">
                    Authorization code (EPP)
                  </Label>
                  <Input
                    id="authcode"
                    placeholder="Code from your current registrar"
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    You can get it from your current domain provider.
                  </p>
                </div>
              </div>
            )}

            {/* Submit button — gated by checks per option */}
            {selected &&
              (() => {
                if (selected === "register_new" && available !== true) {
                  return (
                    <p className="text-xs text-muted-foreground text-center">
                      First check the domain's availability by clicking "Check".
                    </p>
                  );
                }
                return (
                  <Button
                    className="w-full"
                    onClick={handleSubmit}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Sending
                      </>
                    ) : (
                      <>
                        {selected === "register_new"
                          ? "Yes, I want this domain"
                          : "Send request"}
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                );
              })()}
          </div>
        )}
      </PipelineStep>

      {/* ── Step 2: Business email ───────────────────────────────── */}
      <PipelineStep number={2} state={step2State} title="Business email">
        {step2State === "pending" ? (
          // Locked: step 1 (domain) isn't done yet. We don't show the
          // input form because the "@yourdomain.com" preview would be
          // a placeholder, which makes the client commit to something
          // they can't fully see. Once the domain is active, this step
          // unlocks automatically.
          <p className="text-sm text-muted-foreground italic">
            Once your domain is active, you'll be able to choose your business
            email name here.
          </p>
        ) : step2State === "done" ? (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
            <span className="font-medium font-mono">{businessEmail}</span>
          </div>
        ) : (
          // "active" (pick / confirm a prefix) and "in_progress" (prefix
          // saved, waiting for tech to provision) share the same input
          // UI. The header pill tells the client which state they're in.
          // Pre-filled with "info" as the standard so the client can
          // accept the default with one Save click, or type something else.
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email-prefix" className="text-sm">
                Name before @
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="email-prefix"
                  placeholder="info"
                  value={emailPrefix}
                  onChange={(e) =>
                    setEmailPrefix(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9._-]/g, "")
                        .slice(0, 32),
                    )
                  }
                  maxLength={32}
                  className="flex-1 font-mono"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap font-mono">
                  @{previewDomain}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono text-foreground">info</span> is the
                most common choice. If you want a different name (e.g. peter,
                contact), just overwrite it above.
              </p>
              <p className="text-xs text-muted-foreground">
                Preview:{" "}
                <span className="font-mono text-foreground">{emailPreview}</span>
              </p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm"
                onClick={savePrefix}
                disabled={savingPrefix || !prefixChanged || !emailPrefix.trim()}
              >
                {savingPrefix ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : null}
                Save
              </Button>
            </div>

            {step2State === "in_progress" && (
              <p className="text-xs text-muted-foreground italic">
                We'll create your mailbox once the domain is active. You'll
                see your login details in step 3 below.
              </p>
            )}
          </div>
        )}
      </PipelineStep>

      {/* ── Step 3: Email access ─────────────────────────────────── */}
      <PipelineStep
        number={3}
        state={step3State}
        title="Email access"
      >
        {step3State === "done" && businessEmail ? (
          <div className="space-y-3">
            <CredentialRow
              label="Email"
              value={businessEmail}
              copied={emailCopied}
              onCopy={() => copyToClipboard(businessEmail, "email")}
              mono
            />
            <CredentialRow
              label="Password"
              value={businessEmailPassword ?? ""}
              displayValue={
                passwordRevealed
                  ? (businessEmailPassword ?? "")
                  : "••••••••••••"
              }
              copied={passwordCopied}
              onCopy={() =>
                copyToClipboard(businessEmailPassword ?? "", "password")
              }
              onToggleReveal={() => setPasswordRevealed((v) => !v)}
              revealed={passwordRevealed}
              mono
            />
            <a
              href={webmailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Open webmail
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <p className="text-xs text-muted-foreground pt-1">
              We've also sent your login details to your personal email.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2.5">
            <ClockIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              We'll set up your mailbox once the domain is active, usually
              within 24 hours. Your login details will appear here and we'll
              also send them to your personal email.
            </p>
          </div>
        )}
      </PipelineStep>
    </div>
  );
}

// ============================================================================
// Pipeline-step helpers
// ============================================================================

/** One step in the vertical setup pipeline. Renders a card with a state-
 *  styled number badge on the left, the step title in the middle, and a
 *  state pill on the right. Content is the step's body, rendered by the
 *  caller based on the state. */
function PipelineStep({
  number,
  state,
  title,
  children,
}: {
  number: number;
  state: StepState;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border/60">
        <StepBadge number={number} state={state} />
        <h2 className="text-sm font-semibold leading-tight flex-1 min-w-0">
          {title}
        </h2>
        <StatePill state={state} />
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Circular step badge. Drops the number in favor of a state icon for
 *  done / rejected / in-progress / pending, so the badge always
 *  communicates the state visually before the pill confirms it verbally.
 *  "pending" uses a soft clock + muted gray (not the harsher dashed-
 *  padlock the old "locked" state used) since for the credentials step
 *  the client doesn't need to do anything — just wait. */
function StepBadge({ number, state }: { number: number; state: StepState }) {
  return (
    <div
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold shrink-0 transition-colors",
        state === "done" && "bg-emerald-500 text-white",
        state === "in_progress" &&
          "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 ring-1 ring-amber-300",
        state === "active" &&
          "bg-primary text-primary-foreground ring-4 ring-primary/15",
        state === "rejected" && "bg-red-500 text-white",
        state === "pending" &&
          "bg-muted/60 text-muted-foreground/80",
      )}
    >
      {state === "done" ? (
        <Check className="h-4 w-4" strokeWidth={3} />
      ) : state === "rejected" ? (
        <XCircle className="h-4 w-4" />
      ) : state === "in_progress" ? (
        // Check icon (not spinning loader) — a static loader looked
        // broken. Amber bg + "IN PROGRESS" pill carry the in-progress
        // meaning; the check just confirms "this step is recorded". The
        // emerald done state uses the same Check but with green colors,
        // so the two are still visually distinct.
        <Check className="h-4 w-4" strokeWidth={3} />
      ) : state === "pending" ? (
        <ClockIcon className="h-3.5 w-3.5" />
      ) : (
        number
      )}
    </div>
  );
}

/** Small uppercase pill on the right of each step header. Verbally
 *  confirms what the icon badge already signals visually. */
function StatePill({ state }: { state: StepState }) {
  const cfg: Record<StepState, { label: string; cls: string }> = {
    done: {
      label: "Done",
      cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    },
    in_progress: {
      label: "In progress",
      cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    },
    active: {
      label: "Your turn",
      cls: "bg-primary/15 text-primary",
    },
    rejected: {
      label: "Rejected",
      cls: "bg-red-500/15 text-red-700 dark:text-red-400",
    },
    pending: {
      label: "Waiting",
      cls: "bg-muted text-muted-foreground",
    },
  };
  const c = cfg[state];
  return (
    <span
      className={cn(
        "text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 shrink-0",
        c.cls,
      )}
    >
      {c.label}
    </span>
  );
}

/** One row in the credentials section — label + value + copy button,
 *  with an optional reveal toggle for masked fields (password). Shared
 *  between the email row (always visible) and the password row
 *  (default hidden behind dots). */
function CredentialRow({
  label,
  value,
  displayValue,
  copied,
  onCopy,
  revealed,
  onToggleReveal,
  mono,
}: {
  label: string;
  value: string;
  /** What's actually shown on screen — defaults to `value`. Override
   *  when masking (password row passes "••••" when not revealed). */
  displayValue?: string;
  copied: boolean;
  onCopy: () => void;
  revealed?: boolean;
  onToggleReveal?: () => void;
  mono?: boolean;
}) {
  const shown = displayValue ?? value;
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
          {label}
        </p>
        <p
          className={cn(
            "text-sm font-semibold text-foreground truncate leading-snug",
            mono && "font-mono",
          )}
        >
          {shown}
        </p>
      </div>
      {onToggleReveal && (
        <button
          onClick={onToggleReveal}
          className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label={revealed ? "Hide password" : "Show password"}
        >
          {revealed ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </button>
      )}
      <button
        onClick={onCopy}
        disabled={!value}
        className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
        aria-label={`Copy ${label.toLowerCase()}`}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
