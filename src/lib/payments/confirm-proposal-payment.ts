/**
 * Shared "a proposal got paid" side-effects.
 *
 * Single source of truth for everything that must happen when a proposal
 * payment is confirmed, regardless of HOW the money arrived:
 *   - Stripe Checkout  → POST /api/payments/stripe/webhook (metadata.kind = "proposal")
 *   - Manual handover  → POST /api/proposals/[id]/mark-paid
 *
 * Behaviours are identical across both surfaces on purpose so revenue
 * reporting, commission accrual, invoice numbering + the welcome email
 * all stay consistent. If you change a side-effect here it applies to
 * every payment path at once — that's the point of this module (it
 * replaced the copy-paste drift that used to live in mark-paid and the
 * old admin/payments/confirm route).
 *
 * What it does, in order:
 *   1. Record / confirm the `payments` row (status = confirmed)
 *   2. Flip the proposal to `paid` (paid_at set, banner switched off)
 *   3. Silent republish so the deployed HTML drops the payment banner
 *   4. Dismiss all open follow-up reminders
 *   5. Generate the invoice (FV-YYYYMMDD-NNN)
 *   6. Mark the site paid + set the 12-month billing cycle
 *   7. Convert the contact to a client
 *   8. Accrue the salesperson commission
 *   9. (optional) send the client welcome email with login credentials
 *
 * Callers own input validation + their own audit-log entry (the action
 * name + actor differ between the manual and Stripe surfaces).
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { generateVariableSymbol } from "@/lib/payments/proposal-utils";
import { publishSite } from "@/lib/templates/publish";
import { sendEmail, buildClientWelcomeEmailHtml } from "@/lib/email";

type Admin = ReturnType<typeof createAdminClient>;

export interface WelcomeEmailInput {
  send: boolean;
  /** Recipient — defaults to the contact's email. */
  to?: string;
  /** Login email shown in the email + synced to the auth user. */
  login_email?: string;
  /** Login password shown in the email + synced to the auth user. */
  login_password?: string;
  /** Free-text appended to the email body. */
  custom_message?: string;
}

export interface ConfirmProposalPaymentInput {
  proposalId: string;
  /** Amount actually paid (EUR). */
  amount: number;
  /** "card" | "bank_transfer" | "invoice" | "cash" | "other". */
  paymentMethod: string;
  /** ISO timestamp the payment landed. Caller defaults this (usually now). */
  paidOnIso: string;
  /** Operator note / Stripe session reference for the payment description. */
  note?: string;
  /**
   * When set, this PENDING `payments` row is flipped to confirmed instead
   * of inserting a new one. Used by the Stripe path, where create-session
   * already inserted the row so its UUID could ride along in Stripe
   * metadata.
   */
  existingPaymentId?: string;
  /** Attribution for the silent republish. Defaults to the site owner. */
  actorUserId?: string;
  /** sites.domain — undefined = no change, null = clear, string = set + activate. */
  mainDomain?: string | null;
  /** Upsert credit_balances.balance to this value. undefined = leave alone. */
  startingCredits?: number;
  /** Silent republish to strip the banner. Default true. */
  republish?: boolean;
  /** Welcome email. Omit to skip. */
  welcomeEmail?: WelcomeEmailInput;
}

export type ConfirmProposalPaymentResult =
  | {
      ok: true;
      paymentId: string;
      invoiceNumber: string;
      variableSymbol: string;
      siteId: string;
      siteOwnerId: string;
      fromStatus: string;
      companyName: string | null;
      welcomeEmailSent: boolean;
      welcomeEmailError: string | null;
    }
  | {
      ok: false;
      status: number;
      error: string;
      /** Machine-readable reason so callers can branch without string-matching. */
      code?:
        | "not_found"
        | "already_paid"
        | "no_site"
        | "db_error"
        | "duplicate_charge";
      /** Set with code "duplicate_charge": the confirmed payment row for the
       *  SECOND real charge, so the caller can surface it for a refund. */
      paymentId?: string;
    };

const METHOD_LABEL: Record<string, string> = {
  bank_transfer: "Bank transfer payment",
  invoice: "Invoice payment",
  cash: "Cash payment",
  card: "Card payment",
  // "Other" stays the neutral "Payment" so the invoice description reads
  // cleanly; the operator note carries the actual channel.
  other: "Payment",
};

export async function confirmProposalPayment(
  admin: Admin,
  input: ConfirmProposalPaymentInput,
): Promise<ConfirmProposalPaymentResult> {
  const {
    proposalId,
    amount,
    paymentMethod,
    paidOnIso,
    note = "",
    existingPaymentId,
    mainDomain,
    startingCredits,
    republish = true,
    welcomeEmail,
  } = input;

  // ── Fetch proposal + contact ──
  const { data: proposal } = await admin
    .from("proposals")
    .select(
      `
        id,
        slug,
        company_name,
        status,
        sales_person_id,
        contact_id,
        variable_symbol,
        client_temp_password,
        contacts(contact_person, email, company_name)
      `,
    )
    .eq("id", proposalId)
    .maybeSingle();

  if (!proposal) {
    return { ok: false, status: 404, error: "Proposal not found", code: "not_found" };
  }

  // Idempotency — a paid proposal can't be paid again.
  if (proposal.status === "paid") {
    return {
      ok: false,
      status: 409,
      error: "This proposal is already marked as paid",
      code: "already_paid",
    };
  }

  // ── Linked site (must exist) ──
  // A proposal can have more than one site row (legacy composer
  // auto-create dups) and sites.proposal_id is NOT unique — prefer the
  // most-recently-published one, same convention as ensure-client-zone.
  // Plain .maybeSingle() would error on >1 row and falsely report no site.
  const { data: site } = await admin
    .from("sites")
    .select("id, owner_id")
    .eq("proposal_id", proposalId)
    .order("last_published_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!site) {
    return {
      ok: false,
      status: 400,
      error:
        "No site linked to this proposal yet. Build the site (or send the proposal so the client zone gets created) before marking paid.",
      code: "no_site",
    };
  }

  // NOTE: there is deliberately NO "does a confirmed payment already
  // exist?" SELECT guard here. Such a guard would short-circuit the
  // db_error RETRY path — after a transient flip failure the payment row
  // is already confirmed, so the guard would bail on retry and leave the
  // proposal permanently unpaid. Idempotency is instead enforced by the
  // atomic proposal flip below (and the proposal.status fast-path above);
  // duplicate/second-charge detection happens AFTER the flip via the
  // otherConfirmed lookup, which excludes our own row.

  const actorUserId = input.actorUserId || site.owner_id;
  const variableSymbol =
    proposal.variable_symbol || generateVariableSymbol(proposal.id);
  const description = `${METHOD_LABEL[paymentMethod] ?? "Payment"} - VS: ${variableSymbol}${note ? ` · ${note}` : ""}`;

  // ── Record the payment row up front ──
  // Stripe path: confirm the pending row the pay endpoint created
  // (idempotent overwrite — safe to repeat if Stripe redelivers).
  // Manual path: insert a fresh confirmed row.
  let paymentId: string;
  if (existingPaymentId) {
    const { data: updated, error: updErr } = await admin
      .from("payments")
      .update({
        status: "confirmed",
        proposal_id: proposal.id,
        site_id: site.id,
        amount,
        payment_method: paymentMethod,
        description,
      })
      .eq("id", existingPaymentId)
      .select("id")
      .single();
    if (updErr || !updated) {
      return {
        ok: false,
        status: 500,
        error: updErr?.message || "Failed to confirm pending payment row",
        code: "db_error",
      };
    }
    paymentId = updated.id;
  } else {
    const { data: inserted, error: insErr } = await admin
      .from("payments")
      .insert({
        profile_id: site.owner_id,
        site_id: site.id,
        proposal_id: proposal.id,
        amount,
        currency: "USD",
        payment_method: paymentMethod,
        status: "confirmed",
        description,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      return {
        ok: false,
        status: 500,
        error: insErr?.message || "Failed to create payment row",
        code: "db_error",
      };
    }
    paymentId = inserted.id;
  }

  // ── ATOMIC GATE: flip the proposal to paid exactly once ──
  // This single conditional UPDATE (status <> 'paid') is the ONE
  // serialization point that guards every run-once side-effect below
  // (invoice, commission, welcome email). Postgres row-locks the UPDATE,
  // so of any number of concurrent confirmations exactly one matches a
  // not-yet-paid row and proceeds; the rest match zero rows and bail out
  // BEFORE the side-effects. This is what actually makes the flow safe
  // against Stripe's documented duplicate / concurrent webhook delivery —
  // the earlier SELECT-then-act guards only cover the sequential case.
  const { data: flipped, error: flipErr } = await admin
    .from("proposals")
    .update({ status: "paid", paid_at: paidOnIso, show_banner: false })
    .eq("id", proposal.id)
    .neq("status", "paid")
    .select("id")
    .maybeSingle();

  if (flipErr) {
    // Transient failure flipping the proposal — the payment row is
    // confirmed but the proposal isn't paid yet. Return db_error so the
    // Stripe webhook responds non-2xx and Stripe retries; the retry re-runs
    // cleanly (this UPDATE is idempotent and the side-effects are gated by
    // it). The Stripe path reuses the same row by id on retry, so nothing
    // to clean up there. The manual path inserted a FRESH confirmed row
    // above and retries with another insert, so drop this one to avoid
    // leaking an orphan confirmed payment with no invoice/paid proposal.
    if (!existingPaymentId) {
      await admin.from("payments").delete().eq("id", paymentId);
    }
    return { ok: false, status: 500, error: flipErr.message, code: "db_error" };
  }

  if (!flipped) {
    // Lost the race — another confirmation already flipped this proposal
    // to paid, so the run-once side-effects already ran for it.
    if (existingPaymentId) {
      // Same charge redelivered, or a genuinely different second charge?
      // If a DIFFERENT confirmed payment exists for the proposal, the
      // customer was charged twice (e.g. paid in two tabs) — flag our row
      // so an operator can refund it. Otherwise it's a benign redelivery.
      const { data: otherConfirmed } = await admin
        .from("payments")
        .select("id")
        .eq("proposal_id", proposal.id)
        .eq("status", "confirmed")
        .neq("id", existingPaymentId)
        .limit(1)
        .maybeSingle();
      if (otherConfirmed) {
        await admin
          .from("payments")
          .update({ description: `${description} [DUPLICATE — refund required]` })
          .eq("id", existingPaymentId);
        return {
          ok: false,
          status: 409,
          error:
            "Proposal already paid by a different payment — possible double charge",
          code: "duplicate_charge",
          paymentId: existingPaymentId,
        };
      }
      return {
        ok: false,
        status: 409,
        error: "This proposal is already marked as paid",
        code: "already_paid",
      };
    }
    // Manual path lost a race (operator double-submit) — drop the spurious
    // row we just inserted so it isn't counted as a second payment.
    await admin.from("payments").delete().eq("id", paymentId);
    return {
      ok: false,
      status: 409,
      error: "This proposal is already marked as paid",
      code: "already_paid",
    };
  }

  // ── Silent republish so the deployed HTML loses the payment banner ──
  // Fire-and-forget; a republish hiccup never invalidates the payment.
  if (republish) {
    publishSite(site.id, actorUserId, "auto_banner_toggle", new Map(), {
      silent: true,
    }).catch((err) => {
      console.error(
        "[ConfirmProposalPayment] Banner republish failed (non-fatal):",
        err instanceof Error ? err.message : err,
      );
    });
  }

  // ── Dismiss open reminders ──
  await admin
    .from("proposal_reminders")
    .update({ is_dismissed: true })
    .eq("proposal_id", proposal.id)
    .eq("is_dismissed", false);

  // ── Invoice (FV-YYYYMMDD-NNN, numbered against the paid date) ──
  // The number is assigned app-side, so two payments confirmed on the same
  // day can compute the same sequence. invoices.invoice_number is UNIQUE,
  // so the loser's insert raises a 23505 — retry with the next sequence
  // rather than dropping the invoice (which would leave a paid order with
  // no invoice in the accounting trail).
  const dateBase = new Date(paidOnIso);
  const dateStr =
    dateBase.getFullYear().toString() +
    String(dateBase.getMonth() + 1).padStart(2, "0") +
    String(dateBase.getDate()).padStart(2, "0");
  const prefix = `FV-${dateStr}-`;

  let invoiceNumber = "";
  let invoiceCreated = false;
  for (let attempt = 0; attempt < 6 && !invoiceCreated; attempt++) {
    const { data: lastInvoice } = await admin
      .from("invoices")
      .select("invoice_number")
      .like("invoice_number", `${prefix}%`)
      .order("invoice_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    let seq = 1;
    if (lastInvoice?.invoice_number) {
      const lastSeq = parseInt(lastInvoice.invoice_number.replace(prefix, ""), 10);
      if (!isNaN(lastSeq)) seq = lastSeq + 1;
    }
    invoiceNumber = `${prefix}${String(seq).padStart(3, "0")}`;

    const { error: invoiceErr } = await admin.from("invoices").insert({
      invoice_number: invoiceNumber,
      type: "invoice",
      profile_id: site.owner_id,
      site_id: site.id,
      payment_id: paymentId,
      amount,
      vat_amount: 0,
      line_items: [
        {
          description: `Website creation - ${proposal.company_name}`,
          quantity: 1,
          unit_price: amount,
          vat_rate: 0,
          total: amount,
        },
      ],
      issued_at: paidOnIso,
      paid_at: paidOnIso,
    });

    if (!invoiceErr) {
      invoiceCreated = true;
      break;
    }
    // Unique-violation on invoice_number → another invoice grabbed this
    // number first; recompute and retry. Any other error is non-blocking
    // (payment is already confirmed) — log and stop.
    const isUniqueViolation =
      invoiceErr.code === "23505" ||
      /duplicate|unique/i.test(invoiceErr.message || "");
    if (!isUniqueViolation) {
      console.error("[ConfirmProposalPayment] Invoice creation failed:", invoiceErr);
      break;
    }
  }
  if (!invoiceCreated) {
    console.error(
      `[ConfirmProposalPayment] Invoice not created after retries (last tried ${invoiceNumber})`,
    );
  }

  // ── Site: paid + 12-month billing cycle (+ optional main domain) ──
  const liveDate = new Date(paidOnIso);
  const nextBilling = new Date(paidOnIso);
  nextBilling.setFullYear(nextBilling.getFullYear() + 1);

  const siteUpdate: Record<string, unknown> = {
    is_paid: true,
    website_live_date: liveDate.toISOString().split("T")[0],
    next_billing_date: nextBilling.toISOString().split("T")[0],
    billing_cycle_months: 12,
  };
  if (mainDomain !== undefined) {
    siteUpdate.domain = mainDomain;
    if (mainDomain) {
      siteUpdate.domain_status = "active";
      siteUpdate.domain_decided_at = new Date().toISOString();
    }
  }
  await admin.from("sites").update(siteUpdate).eq("id", site.id);

  // ── Starting credits override (manual wizard) ──
  if (startingCredits !== undefined) {
    await admin
      .from("credit_balances")
      .upsert(
        { site_id: site.id, balance: startingCredits },
        { onConflict: "site_id" },
      );
  }

  // ── Mark contact as client + converted ──
  if (proposal.contact_id) {
    await admin
      .from("contacts")
      .update({ client_status: "client", status: "converted" })
      .eq("id", proposal.contact_id);
  }

  // ── Auto-create commission for the salesperson ──
  if (proposal.sales_person_id) {
    const { data: rateData } = await admin
      .from("commission_rates")
      .select("rate")
      .eq("sales_person_id", proposal.sales_person_id)
      .maybeSingle();
    const rate = rateData?.rate || 0.1;
    const commissionAmount = Math.round(amount * rate * 100) / 100;
    if (commissionAmount > 0) {
      await admin.from("commissions").insert({
        sales_person_id: proposal.sales_person_id,
        proposal_id: proposal.id,
        payment_id: paymentId,
        amount: commissionAmount,
        is_paid: false,
      });
    }
  }

  // ── Welcome email (login credentials) ──
  // Operator-edited fields (manual wizard) take priority; otherwise we
  // fall back to the contact email + the stored temp password so the
  // automated Stripe path can still hand over access unattended.
  let welcomeEmailSent = false;
  let welcomeEmailError: string | null = null;
  if (welcomeEmail?.send) {
    try {
      const contact = Array.isArray(proposal.contacts)
        ? proposal.contacts[0]
        : proposal.contacts;
      const fallbackRecipient = contact?.email ?? null;
      const recipientEmail = welcomeEmail.to || fallbackRecipient || null;
      const loginEmail =
        welcomeEmail.login_email || recipientEmail || fallbackRecipient || null;
      const loginPassword =
        welcomeEmail.login_password || proposal.client_temp_password || null;
      const fullName =
        contact?.contact_person ||
        contact?.company_name ||
        recipientEmail ||
        proposal.company_name;

      if (!recipientEmail) {
        welcomeEmailError = "No recipient email on file";
      } else if (!loginPassword) {
        welcomeEmailError = "No login password to share";
      } else {
        const dashboardUrl =
          process.env.NEXT_PUBLIC_CLIENT_URL ||
          process.env.NEXT_PUBLIC_SITE_URL ||
          "https://client.pages.dev";
        const loginUrl = `${dashboardUrl}/login`;

        const { data: siteRow } = await admin
          .from("sites")
          .select("site_url, name")
          .eq("id", site.id)
          .single();

        const html = buildClientWelcomeEmailHtml({
          fullName,
          companyName: proposal.company_name || undefined,
          loginEmail,
          loginPassword,
          siteUrl: siteRow?.site_url || undefined,
          loginUrl,
          customMessage: welcomeEmail.custom_message || undefined,
        });

        const subject = `Your client zone — ${proposal.company_name || siteRow?.name || "Your Agency"}`;
        const result = await sendEmail({
          to: recipientEmail,
          subject,
          html,
          type: "client",
        });

        if (result.success) {
          welcomeEmailSent = true;
          await admin.from("proposal_emails").insert({
            proposal_id: proposal.id,
            sent_by: actorUserId,
            email_type: "welcome",
            subject,
            body_html: html,
            recipient_email: recipientEmail,
          });

          // Sync the chosen login/password to the auth user so the
          // client can log in with exactly what the email shows.
          if (loginEmail && loginPassword) {
            try {
              const normalizedEmail = loginEmail.toLowerCase();
              const { data: usersList } = await admin.auth.admin.listUsers({
                perPage: 1000,
              });
              const match = usersList?.users?.find(
                (u) => u.email?.toLowerCase() === normalizedEmail,
              );
              if (match) {
                await admin.auth.admin.updateUserById(match.id, {
                  password: loginPassword,
                });
              }
              await admin
                .from("proposals")
                .update({ client_temp_password: loginPassword })
                .eq("id", proposal.id);
            } catch (syncErr) {
              console.error(
                "[ConfirmProposalPayment] Welcome email password sync failed (non-fatal):",
                syncErr,
              );
            }
          }
        } else {
          welcomeEmailError = result.error || "SMTP send failed";
        }
      }
    } catch (err) {
      welcomeEmailError =
        err instanceof Error ? err.message : "Unknown email send error";
      console.error("[ConfirmProposalPayment] Welcome email send failed:", err);
      // Non-blocking — payment is already confirmed.
    }
  }

  return {
    ok: true,
    paymentId,
    invoiceNumber,
    variableSymbol,
    siteId: site.id,
    siteOwnerId: site.owner_id,
    fromStatus: proposal.status,
    companyName: proposal.company_name,
    welcomeEmailSent,
    welcomeEmailError,
  };
}
