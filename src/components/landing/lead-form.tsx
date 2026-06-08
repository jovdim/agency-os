"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  PaperPlaneTilt,
  CircleNotch,
  WarningCircle,
} from "@phosphor-icons/react/ssr";

type Status = "idle" | "loading" | "done" | "error";

const FIELD =
  "w-full rounded-lg border border-white/15 bg-[color:var(--lp-bg)] px-3.5 py-2.5 text-sm text-white shadow-sm outline-none transition-colors placeholder:text-white/35 focus-visible:border-[color:var(--brand)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--brand)_45%,transparent)]";
const LABEL = "text-xs font-medium text-white/60";

/** Required-field marker. */
function Star() {
  return <span className="ml-0.5 text-[color:var(--brand-accent)]">*</span>;
}

export function LeadForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Honeypot — a real human never fills this hidden field.
    if ((fd.get("company_website") as string)?.trim()) {
      setStatus("done");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/public/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name"),
          email: fd.get("email"),
          phone: fd.get("phone"),
          business: fd.get("business"),
          message: fd.get("message"),
          company_website: fd.get("company_website"),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error || "Something went wrong. Please try again.");
      }
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-[color-mix(in_oklab,var(--brand)_35%,transparent)] bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] px-6 py-12 text-center">
        <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-[color:var(--brand-accent)]">
          <CheckCircle className="h-7 w-7" weight="fill" />
        </span>
        <h3 className="text-xl font-bold tracking-tight text-white">Proposal on its way</h3>
        <p className="mt-2 max-w-sm text-sm text-white/65">
          Thanks, we&apos;ve got your details. Expect a tailored proposal for your
          website within one business day, with no strings attached.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3.5">
      {/* Honeypot — visually hidden, off the tab order */}
      <div aria-hidden className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Company website
          <input name="company_website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="lf-name" className={LABEL}>Your name<Star /></label>
          <input id="lf-name" name="name" required placeholder="Jane Doe" className={FIELD} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="lf-business" className={LABEL}>Business name<Star /></label>
          <input id="lf-business" name="business" required placeholder="Doe &amp; Co." className={FIELD} />
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="lf-email" className={LABEL}>Email<Star /></label>
          <input id="lf-email" name="email" type="email" required placeholder="jane@business.com" className={FIELD} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="lf-phone" className={LABEL}>Phone<Star /></label>
          <input id="lf-phone" name="phone" type="tel" required placeholder="+1 555 123 4567" className={FIELD} />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="lf-message" className={LABEL}>What do you need?<Star /></label>
        <textarea
          id="lf-message"
          name="message"
          required
          rows={3}
          placeholder="A few lines about your business and what the site should do."
          className={`${FIELD} resize-none`}
        />
      </div>

      {status === "error" && (
        <p className="flex items-center gap-1.5 text-sm text-red-300">
          <WarningCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={status === "loading"} className="w-full gap-2">
        {status === "loading" ? (
          <>
            <CircleNotch className="h-4 w-4 animate-spin" />
            Sending
          </>
        ) : (
          <>
            <PaperPlaneTilt className="h-4 w-4" weight="fill" />
            Get my free proposal
          </>
        )}
      </Button>
    </form>
  );
}
