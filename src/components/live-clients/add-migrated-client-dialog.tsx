"use client";

import { useState, useEffect } from "react";
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
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CircleNotch as Loader2 } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

/**
 * Two-step modal for backfilling an existing paying customer into the
 * CRM. POSTs to /api/admin/migrate-client which runs the whole creation
 * stack atomically.
 *
 *   Step 1 — Client details: company/contact info, domain, payment.
 *            Subdomain + price are both optional (the server
 *            auto-generates the subdomain and skips the price when
 *            blank).
 *   Step 2 — Welcome email: a deliberate handover step. At migration
 *            time you're only recording info — the site isn't rebuilt
 *            yet — so the email (which hands the client a login) is
 *            split out and defaults OFF. You typically send it later,
 *            once the new site is published.
 *
 * The default amount + credits + paid-on come from the most common
 * case: $299 plan, paid today, $50 starting credits — all overridable.
 */
interface AddMigratedClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddMigratedClientDialog({
  open,
  onOpenChange,
}: AddMigratedClientDialogProps) {
  const router = useRouter();

  const [companyName, setCompanyName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [town, setTown] = useState("");
  const [industry, setIndustry] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  // Existing business email the client arrived with (e.g. info@acme.com),
  // plus its mailbox password. We capture both because migrated clients
  // typically hand over a working mailbox we then manage — writing them to
  // profiles.business_email / profiles.business_email_password lights up
  // the client zone's "already set up" state (domain/email page) and shows
  // the client their copyable credentials. Both optional: blank => the
  // client gets the normal set-up steps later.
  const [businessEmail, setBusinessEmail] = useState("");
  const [businessEmailPassword, setBusinessEmailPassword] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [amountPaid, setAmountPaid] = useState("299");
  // <input type="date"> wants YYYY-MM-DD without timezone shifts.
  const todayIso = new Date().toISOString().split("T")[0];
  const [paidOn, setPaidOn] = useState(todayIso);
  const [startingCredits, setStartingCredits] = useState("50");
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(false);

  // Two-step wizard: step 1 = client details (company + domain +
  // payment), step 2 = the welcome-email handover. Split out because at
  // migration time you're only recording info — the site isn't rebuilt
  // yet, so the email (which hands the client a login) belongs to a
  // deliberate later step, not the data-entry screen.
  const [step, setStep] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Always start on step 1 when the dialog opens.
  useEffect(() => {
    if (open) {
      setStep(1);
      setError(null);
    }
  }, [open]);

  /**
   * Auto-suggest the subdomain from the company name as the user
   * types — same slugification the API does. They can override
   * before submit. We only auto-fill when the field is empty so we
   * don't trample an explicit edit.
   */
  function handleCompanyChange(next: string) {
    setCompanyName(next);
    if (!subdomain.trim()) {
      const auto = slugify(next);
      if (auto) setSubdomain(auto);
    }
  }

  /**
   * Validate the step-1 data fields. Returns an error string, or null
   * when everything is good. Mirrors the API contract — the server runs
   * the same checks, this just keeps the round trip cheap.
   */
  function validateDetails(): string | null {
    const sub = subdomain.trim();
    const amountStr = amountPaid.trim();
    const amount = amountStr ? Number(amountStr) : undefined;
    const credits = Number(startingCredits);
    if (!companyName.trim()) return "Company name is required.";
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return "Valid email is required.";
    // Subdomain is OPTIONAL — migrated clients use their own domain, so
    // the pages.dev subdomain is just an internal hosting handle. Left
    // blank, the server auto-generates one from the company name.
    if (sub && !/^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/.test(sub))
      return "Subdomain must be lowercase letters, digits, hyphens.";
    // Business email is OPTIONAL, but if given it must be a real address.
    const bizEmail = businessEmail.trim();
    if (bizEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bizEmail))
      return "Business email must be a valid address, or leave it blank.";
    // Price is OPTIONAL — the historical amount is sometimes unknown.
    if (amountStr && (!Number.isFinite(amount) || (amount as number) <= 0))
      return "Amount paid must be a positive number, or leave it blank.";
    if (!Number.isFinite(credits) || credits < 0)
      return "Starting credits must be 0 or higher.";
    return null;
  }

  // Step 1 → step 2. Validate the details before advancing so errors
  // surface on the screen that owns the offending field.
  function goNext() {
    const err = validateDetails();
    if (err) return setError(err);
    setError(null);
    setStep(2);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    // Enter on a step-1 field submits the form — treat that as "Next"
    // rather than a premature create.
    if (step === 1) return goNext();

    const err = validateDetails();
    if (err) {
      setStep(1);
      return setError(err);
    }
    setError(null);

    const sub = subdomain.trim();
    const amountStr = amountPaid.trim();
    const amount = amountStr ? Number(amountStr) : undefined;
    const credits = Number(startingCredits);

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/migrate-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName.trim(),
          contact_person: contactPerson.trim() || undefined,
          email: email.trim(),
          // Phone is stored with no spaces — a single run of digits so it
          // feeds tel: links + brand-contact autofill cleanly.
          phone: phone.replace(/\s+/g, "") || undefined,
          town: town.trim() || undefined,
          industry: industry.trim() || undefined,
          custom_domain: customDomain.trim() || undefined,
          // Existing mailbox the client brought with them. Written to
          // profiles.business_email / business_email_password by the
          // server so the client zone shows the email step as done.
          business_email: businessEmail.trim() || undefined,
          business_email_password: businessEmailPassword || undefined,
          // Both optional — omitted keys let the server auto-generate the
          // subdomain and skip recording a price.
          subdomain: sub || undefined,
          amount_paid: amount,
          paid_on: paidOn,
          starting_credits: credits,
          send_welcome_email: sendWelcomeEmail,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Migration failed.");
        return;
      }

      toast.success(`Migrated ${companyName.trim()}`, {
        description: sendWelcomeEmail
          ? `Welcome email sent to ${email.trim()}. Opening composer...`
          : `Login: ${email.trim()} · temp password: ${data.temp_password}`,
        duration: 7000,
      });

      // Redirect straight into the composer so tech can start
      // rebuilding the site immediately — matches the same flow
      // organic proposals follow after submission.
      if (data.redirect_to) {
        router.push(data.redirect_to);
      } else {
        router.refresh();
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? "Add migrated client" : "Welcome email"}
          </DialogTitle>
          <DialogDescription>
            {step === 1 ? (
              <>
                Step 1 of 2 · Client details. Records an existing paying
                customer: contact + paid proposal + login account + an
                empty composer site + credits. Their live website keeps
                running wherever it is — you&apos;ll rebuild it in the
                composer afterwards.
              </>
            ) : (
              <>
                Step 2 of 2 · You&apos;re only setting up info right now,
                so there&apos;s usually nothing to send the client yet.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* ── Step 1: client details ── */}
          {step === 1 && (
          <>
          {/* Company info */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Company
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Company name *" htmlFor="mc-company">
                <Input
                  id="mc-company"
                  value={companyName}
                  onChange={(e) => handleCompanyChange(e.target.value)}
                  placeholder="Acme Inc."
                  required
                  disabled={submitting}
                />
              </Field>
              <Field label="Contact person" htmlFor="mc-contact">
                <Input
                  id="mc-contact"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  placeholder="John Smith"
                  disabled={submitting}
                />
              </Field>
              <Field label="Email * (login)" htmlFor="mc-email">
                <Input
                  id="mc-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="info@acme.com"
                  required
                  disabled={submitting}
                />
              </Field>
              <Field label="Phone" htmlFor="mc-phone">
                <Input
                  id="mc-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="5550000000"
                  disabled={submitting}
                />
              </Field>
              <Field label="Town" htmlFor="mc-town">
                <Input
                  id="mc-town"
                  value={town}
                  onChange={(e) => setTown(e.target.value)}
                  placeholder="Springfield"
                  disabled={submitting}
                />
              </Field>
              <Field label="Industry" htmlFor="mc-industry">
                <Input
                  id="mc-industry"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="construction"
                  disabled={submitting}
                />
              </Field>
            </div>
          </fieldset>

          {/* Domain */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Domain
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Subdomain (on pages.dev)" htmlFor="mc-subdomain">
                <div className="flex items-center gap-1">
                  <Input
                    id="mc-subdomain"
                    value={subdomain}
                    onChange={(e) =>
                      setSubdomain(e.target.value.toLowerCase())
                    }
                    placeholder="auto from company name"
                    disabled={submitting}
                    className="flex-1"
                  />
                  <span className="text-xs text-muted-foreground">
                    .pages.dev
                  </span>
                </div>
              </Field>
              <Field
                label="Custom domain (optional)"
                htmlFor="mc-custom-domain"
              >
                <Input
                  id="mc-custom-domain"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="acme.com"
                  disabled={submitting}
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              The subdomain is just an internal hosting address on
              pages.dev — migrated clients use their own domain, so you
              can leave it blank and we&apos;ll generate one from the
              company name. If they own a real domain, enter it under
              Custom domain (DNS still has to be pointed at Cloudflare
              separately, but the domain status flips to active).
            </p>
          </fieldset>

          {/* Business email — the existing mailbox the client arrived
              with. Filling these in marks the email step "done" in the
              client zone and surfaces the credentials to the client.
              Both optional. */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Business email
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Business email (existing, optional)"
                htmlFor="mc-business-email"
              >
                <Input
                  id="mc-business-email"
                  type="email"
                  value={businessEmail}
                  onChange={(e) => setBusinessEmail(e.target.value)}
                  placeholder="info@acme.com"
                  disabled={submitting}
                />
              </Field>
              <Field
                label="Email password (optional)"
                htmlFor="mc-business-email-password"
              >
                <Input
                  id="mc-business-email-password"
                  value={businessEmailPassword}
                  onChange={(e) => setBusinessEmailPassword(e.target.value)}
                  placeholder="mailbox password"
                  disabled={submitting}
                  autoComplete="off"
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              If the client already has a working business email, enter it
              here (and its password). The client zone will show it as set
              up, with the login and a webmail link. Leave blank if they
              don&apos;t have one yet — they can set it up later.
            </p>
          </fieldset>

          {/* Payment */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Payment
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Amount paid ($, optional)" htmlFor="mc-amount">
                <Input
                  id="mc-amount"
                  type="number"
                  min="0"
                  step="1"
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                  placeholder="leave blank if unknown"
                  disabled={submitting}
                />
              </Field>
              <Field label="Paid on" htmlFor="mc-paid-on">
                <Input
                  id="mc-paid-on"
                  type="date"
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                  disabled={submitting}
                />
              </Field>
              <Field label="Starting credits ($)" htmlFor="mc-credits">
                <Input
                  id="mc-credits"
                  type="number"
                  min="0"
                  step="1"
                  value={startingCredits}
                  onChange={(e) => setStartingCredits(e.target.value)}
                  disabled={submitting}
                />
              </Field>
            </div>
          </fieldset>
          </>
          )}

          {/* ── Step 2: welcome-email handover ── */}
          {step === 2 && (
            <div className="rounded-md border bg-muted/30 p-4 space-y-4">
              <p className="text-sm leading-snug">
                You&apos;re just setting up the client&apos;s info right
                now — their website isn&apos;t rebuilt yet, so there&apos;s
                usually nothing for them to log in to. Most migrations
                skip the email here and send it later, once the new site
                is published in the composer.
              </p>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  id="mc-welcome"
                  type="checkbox"
                  checked={sendWelcomeEmail}
                  onChange={(e) => setSendWelcomeEmail(e.target.checked)}
                  disabled={submitting}
                  className="mt-0.5"
                />
                <span className="text-sm leading-snug">
                  <span className="font-medium">
                    Send the welcome email now anyway
                  </span>
                  <br />
                  <span className="text-xs text-muted-foreground">
                    Emails {email.trim() || "the client"} their login and a
                    temporary password immediately.
                  </span>
                </span>
              </label>
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded px-3 py-2">
              {error}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            {step === 1 ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={goNext}>
                  Next
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setStep(1);
                  }}
                  disabled={submitting}
                >
                  Back
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create + open composer"
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}
