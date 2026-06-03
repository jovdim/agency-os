"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Wallet,
  Globe,
  Coins,
  Mail,
  CheckCircle2,
  AlertTriangle,
  Eye,
  ChevronLeft,
  ChevronRight,
  Send,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Mark-as-paid wizard — 3-step replacement for the previous flat
 * MarkAsPaidDialog. Walks the operator through:
 *
 *   Step 1 (Payment & handover details)
 *     amount, paid_on, payment_method (+ Other descriptor), internal
 *     note, main domain (sites.domain), starting credit balance
 *
 *   Step 2 (Welcome email)
 *     recipient, login email, password (regenerate button), custom
 *     message, live HTML preview iframe, "skip welcome email" toggle
 *     for cases where the site isn't ready or credentials go via
 *     another channel
 *
 *   Step 3 (Review & confirm)
 *     read-only summary of everything that's about to happen, single
 *     "Confirm & send" button → ONE atomic POST to /mark-paid
 *
 * The final POST does mark-paid + invoice + commission + domain update
 * + credits + welcome email in one transaction (see route handler).
 * On success the wizard switches to an inline "Done" view showing
 * what landed; if the welcome email step inside the API errored
 * (SMTP hiccup, bad recipient) the payment is still committed and
 * a "Retry email" button is offered so the operator can re-send
 * without re-recording the payment.
 */

interface MarkAsPaidWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  companyName: string;
  defaultAmount: number;
  // ── Welcome email pre-fill ──
  clientEmail?: string | null;
  clientFullName?: string | null;
  clientSiteUrl?: string | null;
  currentPassword?: string | null;
  // ── Handover defaults (new) ──
  /** Existing sites.domain — surfaced in Step 1 so operator can confirm
   *  or edit the customer-facing main domain (e.g. balkar.sk). */
  currentMainDomain?: string | null;
  /** Existing credit_balances.balance — shows as default in Step 1. */
  currentCreditBalance?: number | null;
}

const PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "invoice", label: "Invoice (paid by bank)" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
] as const;

type Step = 1 | 2 | 3;

interface SubmitResult {
  success: boolean;
  payment_id?: string;
  invoice_number?: string;
  welcome_email_sent?: boolean;
  welcome_email_error?: string | null;
  error?: string;
}

export function MarkAsPaidWizard({
  open,
  onOpenChange,
  proposalId,
  companyName,
  defaultAmount,
  clientEmail,
  clientFullName,
  clientSiteUrl,
  currentPassword,
  currentMainDomain,
  currentCreditBalance,
}: MarkAsPaidWizardProps) {
  const router = useRouter();
  const todayIso = new Date().toISOString().split("T")[0];

  // ── Step state ──
  const [step, setStep] = useState<Step>(1);

  // ── Step 1: Payment & handover ──
  const [amount, setAmount] = useState(String(defaultAmount || 299));
  const [paidOn, setPaidOn] = useState(todayIso);
  const [paymentMethod, setPaymentMethod] =
    useState<string>("bank_transfer");
  const [otherDetail, setOtherDetail] = useState("");
  const [note, setNote] = useState("");
  const [mainDomain, setMainDomain] = useState(currentMainDomain ?? "");
  const [startingCredits, setStartingCredits] = useState(
    String(currentCreditBalance ?? 50),
  );

  // ── Step 2: Welcome email ──
  const [sendWelcome, setSendWelcome] = useState(!!clientEmail);
  const [emailTo, setEmailTo] = useState(clientEmail ?? "");
  const [loginEmail, setLoginEmail] = useState(clientEmail ?? "");
  const [loginPassword, setLoginPassword] = useState(
    currentPassword ?? "",
  );
  const [customMessage, setCustomMessage] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  // ── Submission ──
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [retryingEmail, setRetryingEmail] = useState(false);

  // Reset everything when the dialog re-opens so a second mark-paid
  // doesn't carry over stale state from a previous proposal (the
  // launcher remounts but the dialog component is keyed by open).
  useEffect(() => {
    if (open) {
      setStep(1);
      setAmount(String(defaultAmount || 299));
      setPaidOn(todayIso);
      setPaymentMethod("bank_transfer");
      setOtherDetail("");
      setNote("");
      setMainDomain(currentMainDomain ?? "");
      setStartingCredits(String(currentCreditBalance ?? 50));
      setSendWelcome(!!clientEmail);
      setEmailTo(clientEmail ?? "");
      setLoginEmail(clientEmail ?? "");
      setLoginPassword(currentPassword ?? "");
      setCustomMessage("");
      setPreviewHtml("");
      setSubmitResult(null);
      setStepError(null);
    }
    // currentMainDomain/currentCreditBalance etc are stable props per
    // mount; intentional dep list keeps reset tied to open-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-load preview when entering Step 2 (and refresh on key edits).
  // Debounced to avoid pelting the preview endpoint while the operator
  // is typing.
  useEffect(() => {
    if (step !== 2 || !sendWelcome) return;
    const timer = setTimeout(() => {
      void loadPreview();
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sendWelcome, emailTo, loginEmail, loginPassword, customMessage]);

  async function loadPreview() {
    setPreviewLoading(true);
    try {
      const params = new URLSearchParams({
        full_name: clientFullName || companyName,
        login_email: loginEmail || emailTo || "",
        login_password: loginPassword || "********",
        ...(companyName && { company_name: companyName }),
        ...(clientSiteUrl && { site_url: clientSiteUrl }),
        ...(customMessage && { custom_message: customMessage }),
      });
      const res = await fetch(`/api/admin/clients/send-welcome?${params}`);
      if (res.ok) {
        setPreviewHtml(await res.text());
      }
    } finally {
      setPreviewLoading(false);
    }
  }

  function generatePassword() {
    // Lower-case-only alphanumeric minus ambiguous chars (l/I/O/0).
    // Matches the convention in SendWelcomeEmailDialog so the password
    // shape stays familiar.
    const chars = "abcdefghijkmnpqrstuvwxyz23456789";
    let pw = "";
    for (let i = 0; i < 8; i++)
      pw += chars[Math.floor(Math.random() * chars.length)];
    setLoginPassword(pw);
  }

  // ── Step 1 validation ──
  function validateStep1(): string | null {
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return "Amount must be a positive number.";
    }
    if (paymentMethod === "other" && !otherDetail.trim()) {
      return "Describe the payment channel (e.g. PayPal, split-pay).";
    }
    const parsedCredits = Number(startingCredits);
    if (!Number.isFinite(parsedCredits) || parsedCredits < 0) {
      return "Starting credits must be 0 or higher.";
    }
    if (mainDomain.trim()) {
      // Soft check — main_domain accepts protocol-prefixed strings on
      // the API side (it cleans them), but the wizard should still
      // flag obvious typos before round-tripping to the server.
      const cleaned = mainDomain
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "");
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(cleaned)) {
        return "Main domain looks invalid (expected e.g. balkar.sk).";
      }
    }
    return null;
  }

  // ── Step 2 validation (only when sending) ──
  function validateStep2(): string | null {
    if (!sendWelcome) return null;
    if (!emailTo.trim()) return "Recipient email is required.";
    if (!loginEmail.trim()) return "Login email is required.";
    if (!loginPassword.trim()) return "Password is required.";
    return null;
  }

  function handleNext() {
    setStepError(null);
    if (step === 1) {
      const err = validateStep1();
      if (err) return setStepError(err);
      setStep(2);
    } else if (step === 2) {
      const err = validateStep2();
      if (err) return setStepError(err);
      setStep(3);
    }
  }

  function handleBack() {
    setStepError(null);
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  }

  // ── Final submit ──
  async function handleConfirm() {
    if (submitting) return;
    setStepError(null);
    setSubmitting(true);

    const parsedAmount = Number(amount);
    const parsedCredits = Number(startingCredits);

    const finalNote = (() => {
      const trimmed = note.trim();
      if (paymentMethod === "other" && otherDetail.trim()) {
        const detail = otherDetail.trim();
        return trimmed ? `Other: ${detail} · ${trimmed}` : `Other: ${detail}`;
      }
      return trimmed || undefined;
    })();

    try {
      const res = await fetch(`/api/proposals/${proposalId}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parsedAmount,
          paid_on: paidOn,
          payment_method: paymentMethod,
          note: finalNote,
          main_domain: mainDomain.trim() || null,
          starting_credits: parsedCredits,
          welcome_email: {
            send: sendWelcome,
            to: emailTo.trim() || undefined,
            login_email: loginEmail.trim() || undefined,
            login_password: loginPassword || undefined,
            custom_message: customMessage.trim() || undefined,
          },
        }),
      });
      const data: SubmitResult = await res.json();
      if (!res.ok) {
        setStepError(data.error || "Failed to mark as paid");
        setSubmitting(false);
        return;
      }
      setSubmitResult(data);
      router.refresh();
      toast.success(`${companyName} marked as paid`, {
        description: `Invoice ${data.invoice_number}`,
        duration: 5000,
      });
    } catch (err) {
      setStepError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  // Retry just the email after a successful mark-paid with email
  // failure. Uses the standalone send-welcome endpoint because the
  // payment side is already done.
  async function handleRetryEmail() {
    setRetryingEmail(true);
    try {
      const res = await fetch("/api/admin/clients/send-welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emailTo,
          full_name: clientFullName || companyName,
          company_name: companyName || undefined,
          login_email: loginEmail || emailTo,
          login_password: loginPassword,
          site_url: clientSiteUrl || undefined,
          site_name: companyName || undefined,
          custom_message: customMessage || undefined,
        }),
      });
      if (res.ok) {
        setSubmitResult((prev) =>
          prev
            ? { ...prev, welcome_email_sent: true, welcome_email_error: null }
            : prev,
        );
        toast.success("Welcome email sent");
      } else {
        const data = await res.json();
        toast.error(data.error || "Email retry failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setRetryingEmail(false);
    }
  }

  // ── Success view (after mark-paid lands) ──
  if (submitResult?.success) {
    const emailFailed =
      sendWelcome && !submitResult.welcome_email_sent;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Done
            </DialogTitle>
            <DialogDescription>
              {companyName} is now marked as paid.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <SummaryRow
              label="Invoice"
              value={submitResult.invoice_number ?? "—"}
            />
            <SummaryRow label="Amount" value={`€${amount}`} />
            <SummaryRow
              label="Main domain"
              value={mainDomain.trim() || "Not recorded"}
              muted={!mainDomain.trim()}
            />
            <SummaryRow
              label="Starting credits"
              value={`€${startingCredits}`}
            />
            {sendWelcome ? (
              emailFailed ? (
                <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3 space-y-2">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" />
                    Welcome email didn&apos;t send
                  </p>
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    {submitResult.welcome_email_error ||
                      "Unknown SMTP error"}
                    . Payment is recorded; you can resend the email
                    without re-running the payment.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRetryEmail}
                    disabled={retryingEmail}
                    className="gap-1.5"
                  >
                    {retryingEmail ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Retry welcome email
                  </Button>
                </div>
              ) : (
                <SummaryRow
                  label="Welcome email"
                  value={`Sent to ${emailTo}`}
                />
              )
            ) : (
              <SummaryRow
                label="Welcome email"
                value="Skipped"
                muted
              />
            )}
            <Button
              className="w-full"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !submitting && onOpenChange(o)}
    >
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-emerald-600" />
            Mark as paid — {companyName}
          </DialogTitle>
          <DialogDescription>
            <StepStrip step={step} />
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 pr-1 -mr-1 mt-2">
          {step === 1 && (
            <Step1Payment
              amount={amount}
              setAmount={setAmount}
              paidOn={paidOn}
              setPaidOn={setPaidOn}
              paymentMethod={paymentMethod}
              setPaymentMethod={setPaymentMethod}
              otherDetail={otherDetail}
              setOtherDetail={setOtherDetail}
              note={note}
              setNote={setNote}
              mainDomain={mainDomain}
              setMainDomain={setMainDomain}
              startingCredits={startingCredits}
              setStartingCredits={setStartingCredits}
              disabled={submitting}
            />
          )}
          {step === 2 && (
            <Step2Welcome
              hasClientEmail={!!clientEmail}
              sendWelcome={sendWelcome}
              setSendWelcome={setSendWelcome}
              emailTo={emailTo}
              setEmailTo={setEmailTo}
              loginEmail={loginEmail}
              setLoginEmail={setLoginEmail}
              loginPassword={loginPassword}
              setLoginPassword={setLoginPassword}
              customMessage={customMessage}
              setCustomMessage={setCustomMessage}
              generatePassword={generatePassword}
              previewHtml={previewHtml}
              previewLoading={previewLoading}
              loadPreview={loadPreview}
              disabled={submitting}
            />
          )}
          {step === 3 && (
            <Step3Review
              companyName={companyName}
              amount={amount}
              paidOn={paidOn}
              paymentMethod={paymentMethod}
              otherDetail={otherDetail}
              note={note}
              mainDomain={mainDomain}
              currentMainDomain={currentMainDomain ?? null}
              startingCredits={startingCredits}
              currentCreditBalance={currentCreditBalance ?? null}
              sendWelcome={sendWelcome}
              emailTo={emailTo}
              loginEmail={loginEmail}
              loginPassword={loginPassword}
            />
          )}

          {stepError && (
            <div className="mt-3 text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded px-3 py-2 flex items-start gap-2">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{stepError}</span>
            </div>
          )}
        </div>

        {/* Footer — Back / Next or Confirm */}
        <div className="shrink-0 mt-3 flex items-center justify-between gap-2 pt-3 border-t">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (step === 1) onOpenChange(false);
              else handleBack();
            }}
            disabled={submitting}
            className="gap-1.5"
          >
            {step === 1 ? (
              "Cancel"
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                Back
              </>
            )}
          </Button>
          <div className="text-xs text-muted-foreground">
            Step {step} of 3
          </div>
          {step < 3 ? (
            <Button
              type="button"
              onClick={handleNext}
              disabled={submitting}
              className="gap-1.5"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Confirming...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm &amp; send
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────
// Step strip — visual progress indicator inside the description slot
// ────────────────────────────────────────────────────────────────────
function StepStrip({ step }: { step: Step }) {
  const steps = [
    { n: 1, label: "Payment", icon: Wallet },
    { n: 2, label: "Welcome email", icon: Mail },
    { n: 3, label: "Review", icon: CheckCircle2 },
  ] as const;
  return (
    <div className="flex items-center gap-1.5 mt-1.5">
      {steps.map((s, idx) => {
        const Icon = s.icon;
        const isActive = step === s.n;
        const isDone = step > s.n;
        return (
          <div key={s.n} className="flex items-center gap-1.5">
            <div
              className={[
                "flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium",
                isActive
                  ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                  : isDone
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground",
              ].join(" ")}
            >
              <Icon className="h-3.5 w-3.5" />
              {s.label}
            </div>
            {idx < steps.length - 1 && (
              <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Step 1 — Payment & handover details
// ────────────────────────────────────────────────────────────────────
function Step1Payment(props: {
  amount: string;
  setAmount: (v: string) => void;
  paidOn: string;
  setPaidOn: (v: string) => void;
  paymentMethod: string;
  setPaymentMethod: (v: string) => void;
  otherDetail: string;
  setOtherDetail: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  mainDomain: string;
  setMainDomain: (v: string) => void;
  startingCredits: string;
  setStartingCredits: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldShell label="Amount paid (€) *">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={props.amount}
            onChange={(e) => props.setAmount(e.target.value)}
            disabled={props.disabled}
          />
        </FieldShell>
        <FieldShell label="Paid on">
          <Input
            type="date"
            value={props.paidOn}
            onChange={(e) => props.setPaidOn(e.target.value)}
            disabled={props.disabled}
          />
        </FieldShell>
      </div>

      <FieldShell label="Payment method">
        <Select
          value={props.paymentMethod}
          onValueChange={props.setPaymentMethod}
          disabled={props.disabled}
        >
          <SelectTrigger className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_METHODS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldShell>

      {props.paymentMethod === "other" && (
        <FieldShell
          label="Describe the channel *"
          hint="Gets stored on the payment + invoice description for bookkeeping."
        >
          <Input
            value={props.otherDetail}
            onChange={(e) => props.setOtherDetail(e.target.value)}
            placeholder="e.g. PayPal, Revolut, split payment"
            disabled={props.disabled}
          />
        </FieldShell>
      )}

      <FieldShell label="Internal note (optional)">
        <Textarea
          value={props.note}
          onChange={(e) => props.setNote(e.target.value)}
          placeholder="e.g. VS confirmed against bank statement 2026-05-12"
          rows={2}
          disabled={props.disabled}
          className="text-sm"
        />
      </FieldShell>

      {/* Handover section visually separated so it doesn't read as
          "more payment fields" — these are about the customer's site
          state, not the bookkeeping. */}
      <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Handover details
        </p>
        <FieldShell
          label={
            <span className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" />
              Main domain
            </span>
          }
          hint="The customer-facing domain the client uses (e.g. balkar.sk). Leave blank if not decided yet — you can set it later from Live Clients."
        >
          <Input
            value={props.mainDomain}
            onChange={(e) => props.setMainDomain(e.target.value)}
            placeholder="balkar.sk"
            disabled={props.disabled}
          />
        </FieldShell>
        <FieldShell
          label={
            <span className="flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5" />
              Starting credits (€)
            </span>
          }
          hint="Credit balance for change requests + composer publishes. Default €50."
        >
          <Input
            type="number"
            min="0"
            step="1"
            value={props.startingCredits}
            onChange={(e) => props.setStartingCredits(e.target.value)}
            disabled={props.disabled}
          />
        </FieldShell>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Step 2 — Welcome email
// ────────────────────────────────────────────────────────────────────
function Step2Welcome(props: {
  hasClientEmail: boolean;
  sendWelcome: boolean;
  setSendWelcome: (v: boolean) => void;
  emailTo: string;
  setEmailTo: (v: string) => void;
  loginEmail: string;
  setLoginEmail: (v: string) => void;
  loginPassword: string;
  setLoginPassword: (v: string) => void;
  customMessage: string;
  setCustomMessage: (v: string) => void;
  generatePassword: () => void;
  previewHtml: string;
  previewLoading: boolean;
  loadPreview: () => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Skip toggle — first thing so operator sees it before being
          asked to fill anything. */}
      <label className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 cursor-pointer">
        <input
          type="checkbox"
          checked={props.sendWelcome}
          onChange={(e) => props.setSendWelcome(e.target.checked)}
          disabled={props.disabled || !props.hasClientEmail}
          className="mt-0.5"
        />
        <span className="text-sm leading-snug">
          <span className="font-medium">Send welcome email now</span>
          <br />
          <span className="text-xs text-muted-foreground">
            {props.hasClientEmail
              ? "Ships login credentials + dashboard link to the client. Untick to mark paid only — you can send credentials later from Live Clients."
              : "No client email on file — can't send automatically. Mark paid first, then add an email from Live Clients."}
          </span>
        </span>
      </label>

      {props.sendWelcome && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldShell
              label="Send to *"
              hint="Where the welcome email will be delivered."
            >
              <Input
                type="email"
                value={props.emailTo}
                onChange={(e) => props.setEmailTo(e.target.value)}
                disabled={props.disabled}
              />
            </FieldShell>
            <FieldShell
              label="Login email *"
              hint="Shown in the email — client uses this to log in."
            >
              <Input
                type="email"
                value={props.loginEmail}
                onChange={(e) => props.setLoginEmail(e.target.value)}
                disabled={props.disabled}
              />
            </FieldShell>
          </div>

          <FieldShell
            label="Password *"
            hint="Shown in the email — synced to the auth user when sent."
          >
            <div className="flex gap-2">
              <Input
                type="text"
                value={props.loginPassword}
                onChange={(e) => props.setLoginPassword(e.target.value)}
                placeholder="Enter current or new password"
                disabled={props.disabled}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={props.generatePassword}
                disabled={props.disabled}
              >
                Generate
              </Button>
            </div>
          </FieldShell>

          <FieldShell
            label="Custom message (optional)"
            hint="Appended to the email body. Use it for personal notes — e.g. when you'll set up the domain, next steps."
          >
            <Textarea
              value={props.customMessage}
              onChange={(e) => props.setCustomMessage(e.target.value)}
              rows={3}
              disabled={props.disabled}
              placeholder="Dear client, I'll connect your domain sometime tomorrow…"
              className="text-sm"
            />
          </FieldShell>

          {/* Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" />
                Email preview
              </Label>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-xs"
                onClick={props.loadPreview}
                disabled={props.previewLoading}
              >
                {props.previewLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Refresh
              </Button>
            </div>
            <div className="rounded-md border bg-white overflow-hidden">
              {props.previewHtml ? (
                <iframe
                  srcDoc={props.previewHtml}
                  className="w-full bg-white"
                  style={{ height: 360, border: "none" }}
                  title="Welcome email preview"
                />
              ) : (
                <div className="h-[360px] flex items-center justify-center text-xs text-muted-foreground">
                  {props.previewLoading
                    ? "Loading preview…"
                    : "Edit a field to load preview"}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Step 3 — Review & confirm
// ────────────────────────────────────────────────────────────────────
function Step3Review(props: {
  companyName: string;
  amount: string;
  paidOn: string;
  paymentMethod: string;
  otherDetail: string;
  note: string;
  mainDomain: string;
  currentMainDomain: string | null;
  startingCredits: string;
  currentCreditBalance: number | null;
  sendWelcome: boolean;
  emailTo: string;
  loginEmail: string;
  loginPassword: string;
}) {
  const methodLabel =
    PAYMENT_METHODS.find((m) => m.value === props.paymentMethod)?.label ??
    props.paymentMethod;
  const domainChanged =
    (props.mainDomain.trim() || null) !== (props.currentMainDomain || null);
  const creditsChanged =
    Number(props.startingCredits) !== (props.currentCreditBalance ?? 50);

  const sideEffects = useMemo(() => {
    const list: string[] = [
      "Create payment + invoice",
      "Flip proposal to paid + dismiss reminders",
      "Republish site (banner off)",
      "Accrue commission to salesperson",
      "Set site.is_paid + billing dates",
    ];
    if (domainChanged) list.push("Update main domain on the site");
    if (creditsChanged) list.push("Adjust starting credit balance");
    if (props.sendWelcome) list.push("Send welcome email + sync password");
    return list;
  }, [domainChanged, creditsChanged, props.sendWelcome]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3 space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
          Payment
        </p>
        <SummaryRow label="Amount" value={`€${props.amount}`} />
        <SummaryRow label="Paid on" value={props.paidOn} />
        <SummaryRow
          label="Method"
          value={
            props.paymentMethod === "other"
              ? `${methodLabel} (${props.otherDetail})`
              : methodLabel
          }
        />
        {props.note && <SummaryRow label="Note" value={props.note} />}
      </div>

      <div className="rounded-lg border p-3 space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
          Handover
        </p>
        <SummaryRow
          label="Main domain"
          value={props.mainDomain.trim() || "Not set"}
          muted={!props.mainDomain.trim()}
        />
        <SummaryRow
          label="Starting credits"
          value={`€${props.startingCredits}`}
        />
      </div>

      <div className="rounded-lg border p-3 space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
          Welcome email
        </p>
        {props.sendWelcome ? (
          <>
            <SummaryRow label="To" value={props.emailTo} />
            <SummaryRow label="Login email" value={props.loginEmail} />
            <SummaryRow
              label="Password"
              value={props.loginPassword.replace(/./g, "•")}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Skipped — no email will be sent.
          </p>
        )}
      </div>

      <div className="rounded-md border border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/30 p-3">
        <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300 uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Send className="h-3 w-3" />
          On confirm
        </p>
        <ul className="space-y-1">
          {sideEffects.map((effect) => (
            <li
              key={effect}
              className="text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5"
            >
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              {effect}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Tiny shared bits
// ────────────────────────────────────────────────────────────────────
function FieldShell({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && (
        <p className="text-[11px] text-muted-foreground leading-snug">
          {hint}
        </p>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground text-xs shrink-0">{label}</span>
      <span
        className={[
          "text-right break-all",
          muted ? "text-muted-foreground italic" : "font-medium",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
