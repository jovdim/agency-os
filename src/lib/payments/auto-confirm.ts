import { ImapFlow } from "imapflow";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * Atomic-ish flow to confirm a pending credit-purchase payment:
 *   1. Bump credit_balances.balance by the bank email's amount
 *   2. Insert credit_transactions row (type='purchase', payment_id link)
 *   3. Flip payments.status from 'pending' to 'confirmed'
 *   4. Audit log entry
 *
 * Returns ok=false with an error string if any step fails. We use the
 * email's actual amount (not the pending row's expected amount) so a
 * customer who manually edited the amount in their banking app still
 * gets credited what they actually paid — the amount mismatch surfaces
 * in the audit log for review.
 */
type PendingPaymentRow = {
  id: string;
  site_id: string | null;
  amount: number;
  profile_id: string;
  status: string;
};

async function confirmCreditPurchase(
  admin: ReturnType<typeof createAdminClient>,
  pendingPayment: PendingPaymentRow,
  paidAmountEur: number,
  senderName: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pendingPayment.site_id) {
    return { ok: false, error: "pending payment has no site_id" };
  }

  // 1. Bump balance — read current, add amount, write back. Round to
  // 2 decimals to dodge float drift on accumulated sums.
  const { data: balanceRow } = await admin
    .from("credit_balances")
    .select("balance")
    .eq("site_id", pendingPayment.site_id)
    .maybeSingle();
  const currentBalance = Number(balanceRow?.balance ?? 0);
  const newBalance = Number((currentBalance + paidAmountEur).toFixed(2));

  const upsertRes = balanceRow
    ? await admin
        .from("credit_balances")
        .update({ balance: newBalance })
        .eq("site_id", pendingPayment.site_id)
    : await admin
        .from("credit_balances")
        .insert({ site_id: pendingPayment.site_id, balance: newBalance });
  if (upsertRes.error) {
    return { ok: false, error: `balance update: ${upsertRes.error.message}` };
  }

  // 2. Log the credit transaction (type='purchase' is the right enum
  // value for "client paid for credits", which is exactly what this is).
  const { error: txErr } = await admin.from("credit_transactions").insert({
    site_id: pendingPayment.site_id,
    user_id: pendingPayment.profile_id,
    amount: paidAmountEur,
    type: "purchase",
    payment_id: pendingPayment.id,
    note: `Bank transfer · ${senderName || "Unknown sender"}`,
  });
  if (txErr) {
    return { ok: false, error: `tx insert: ${txErr.message}` };
  }

  // 3. Mark payment as confirmed.
  const { error: updErr } = await admin
    .from("payments")
    .update({ status: "confirmed" })
    .eq("id", pendingPayment.id);
  if (updErr) {
    return { ok: false, error: `payment update: ${updErr.message}` };
  }

  // 4. Audit log — pin to the buying user so it shows in their feed.
  await logAudit({
    userId: pendingPayment.profile_id,
    action: "auto_confirm_credit_purchase",
    entityType: "site",
    entityId: pendingPayment.site_id,
    details: {
      payment_id: pendingPayment.id,
      paid_amount_eur: paidAmountEur,
      expected_amount_eur: pendingPayment.amount,
      amount_matches:
        Math.abs(paidAmountEur - Number(pendingPayment.amount)) < 0.01,
      new_balance_eur: newBalance,
      sender_name: senderName,
    },
  });

  return { ok: true };
}

/**
 * Parse SLSP bank notification email for variable symbol and amount.
 *
 * SLSP format:
 *   Reference: /VS2604003/SS/KS
 *   Amount: 199,00 EUR (big green text in HTML)
 *   Sender: from the "Protiúčet" (counter-account) line
 */
interface ParsedPayment {
  variableSymbol: string;
  amount: number;
  senderName: string | null;
  rawText: string;
}

export function parseSLSPEmail(htmlOrText: string): ParsedPayment | null {
  // Strip HTML tags for text parsing
  const text = htmlOrText.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

  // Extract Variable Symbol from the reference line: /VS{number}/SS/KS
  const vsMatch = text.match(/\/VS(\d+)\//);
  if (!vsMatch) return null;
  const variableSymbol = vsMatch[1];

  // Extract amount — look for pattern like "199,00 EUR" or "49,00 EUR"
  // The amount in SLSP emails appears as a large number before "EUR"
  const amountMatch = text.match(/(\d{1,6}[.,]\d{2})\s*EUR/);
  if (!amountMatch) return null;
  const amount = parseFloat(amountMatch[1].replace(",", "."));

  // Extract sender name from the "Protiúčet" (counter-account) section
  // Pattern: IBAN (SK...) followed by name on next line
  const senderMatch = text.match(/Protiúčet[:\s].*?SK\d{22,26}\s+([A-ZÀ-Ža-zà-ž][\w\s.,\-]+)/i);
  const senderName = senderMatch ? senderMatch[1].trim() : null;

  return { variableSymbol, amount, senderName, rawText: text.slice(0, 500) };
}

/**
 * Check paid@youragency.com inbox for new SLSP bank notifications
 * and auto-confirm matching payments.
 */
export async function checkAndConfirmPayments(): Promise<{
  processed: number;
  confirmed: number;
  errors: string[];
}> {
  // Use IMAP host (reading), NOT SMTP host (sending). Hostinger: imap.hostinger.com
  const host = process.env.IMAP_HOST || "imap.hostinger.com";
  const user = process.env.SMTP_PAID_USER;
  // Defensive: strip dotenv-style backslash escapes. If the env var was pasted
  // from a .env file literally (e.g. "Vz\$s;6:In"), we unescape it back to its
  // real form ("Vz$s;6:In") so IMAP auth works regardless of how it was stored.
  const pass = process.env.SMTP_PAID_PASS?.replace(/\\(.)/g, "$1");

  if (!user || !pass) {
    return { processed: 0, confirmed: 0, errors: ["SMTP_PAID_USER or SMTP_PAID_PASS not configured"] };
  }

  const results = { processed: 0, confirmed: 0, errors: [] as string[] };

  const client = new ImapFlow({
    host,
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
    // Bumped 8s → 30s on 2026-05-11 v3 — Hostinger's IMAP server was
    // dropping idle connections faster than 8s, causing every cron run
    // to throw "Connection not available | code=NoConnection" during
    // the post-processing logout. 30s gives plenty of headroom for
    // multi-message runs without inflating Vercel function budget
    // (we still cap at 15 messages/run + the function maxDuration is 60s).
    socketTimeout: 30000,
  });

  try {
    await client.connect();

    // List mailboxes to find the correct inbox name (Hostinger sometimes uses "INBOX" or "Inbox")
    const mailboxes = await client.list();
    const inboxName =
      mailboxes.find((m) => m.path.toLowerCase() === "inbox")?.path || "INBOX";

    const lock = await client.getMailboxLock(inboxName);

    try {
      // Fetch unread messages from the last 14 days. Wider than strictly
      // necessary on a per-run basis (the cron fires every 10 min) but
      // gives us a 2-week safety net: if cron-job.org pauses, fails over,
      // or has any kind of outage, real bank emails that arrived during
      // that gap still get caught on the next successful run instead of
      // sitting unread forever just because they aged out of a tight
      // 3-day window. Bounded by MAX_PER_RUN=15 below so a wider window
      // doesn't blow the function budget.
      //
      // Bumped from 3 → 14 days on 2026-05-10 after we found unread
      // SLSP emails from earlier in the week that the original window
      // had already excluded.
      const since = new Date();
      since.setDate(since.getDate() - 14);

      // Search for matching UIDs first so we can cap how many we process.
      const searchUids = await client.search(
        { seen: false, since },
        { uid: true },
      );

      // Process at most 15 messages per run to stay well under the 10s budget.
      // Leftover messages will be picked up by the next cron run.
      const MAX_PER_RUN = 15;
      const uidsToProcess = (searchUids || []).slice(0, MAX_PER_RUN);

      if (uidsToProcess.length === 0) {
        // Nothing to process — release lock and exit cleanly.
        lock.release();
        await client.logout();
        return results;
      }

      // ── Drain the fetch FIRST, then process ────────────
      // Doing other IMAP commands (like messageFlagsAdd) while a
      // fetch iterator is still open destabilises the ImapFlow
      // connection on Hostinger — every run died with
      // "Connection not available" after the first message because of
      // this. Fix is to drain the iterator into a plain array, close
      // the fetch, THEN do per-message work + flag updates against a
      // healthy idle connection.
      const fetchedMessages: Array<{ uid: number; source: string }> = [];
      const messages = client.fetch(
        uidsToProcess,
        { source: true, envelope: true, flags: true, uid: true },
        { uid: true },
      );
      for await (const msg of messages) {
        fetchedMessages.push({
          uid: msg.uid,
          source: msg.source?.toString("utf-8") || "",
        });
      }

      const admin = createAdminClient();

      for (const msg of fetchedMessages) {
        results.processed++;

        try {
          const source = msg.source;

          // Parse SLSP payment info
          const payment = parseSLSPEmail(source);
          if (!payment) {
            // Not a payment email or couldn't parse — skip but mark as read
            await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
            continue;
          }

          console.log(`[AutoPay] Found VS: ${payment.variableSymbol}, Amount: ${payment.amount} EUR, Sender: ${payment.senderName}`);

          // ── Lookup #1: proposal payment ──────────────────
          // Proposal VS is a short numeric (e.g. "2604011") generated
          // by generateVariableSymbol().
          const { data: proposal } = await admin
            .from("proposals")
            .select("id, status, paid_at, variable_symbol, company_name")
            .eq("variable_symbol", payment.variableSymbol)
            .maybeSingle();

          if (proposal) {
            // Skip if already paid
            if (proposal.paid_at || proposal.status === "paid") {
              console.log(`[AutoPay] VS ${payment.variableSymbol}: proposal already paid, skipping`);
              await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
              continue;
            }

            // Auto-confirm payment via the same logic as manual confirm
            const confirmRes = await fetch(
              `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/api/admin/payments/confirm`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  // Use a service-level auth header for cron jobs
                  "x-cron-secret": process.env.CRON_SECRET || "",
                },
                body: JSON.stringify({
                  proposal_id: proposal.id,
                  amount: payment.amount,
                  note: `Auto-confirmed from bank email. Sender: ${payment.senderName || "Unknown"}. VS: ${payment.variableSymbol}`,
                }),
              }
            );

            if (confirmRes.ok) {
              results.confirmed++;
              console.log(`[AutoPay] ✓ Confirmed proposal payment for ${proposal.company_name} (VS: ${payment.variableSymbol}, €${payment.amount})`);
            } else {
              const errData = await confirmRes.json().catch(() => ({}));
              results.errors.push(`VS ${payment.variableSymbol}: proposal confirm failed — ${(errData as { error?: string }).error || confirmRes.status}`);
            }

            await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
            continue;
          }

          // ── Lookup #2: pending credit purchase ───────────
          // Credit-purchase VS starts with "9" (per
          // generateCreditVariableSymbol) but we don't gate on the
          // prefix — the payments table lookup is the source of truth.
          // Picks the most-recent pending row in case the customer
          // generated multiple QRs (only the latest will match the
          // bank email's expected amount; older pendings sit until
          // an admin cleans them up).
          const { data: pendingPayment } = await admin
            .from("payments")
            .select("id, site_id, amount, profile_id, status")
            .eq("variable_symbol", payment.variableSymbol)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (pendingPayment) {
            const creditResult = await confirmCreditPurchase(
              admin,
              pendingPayment,
              payment.amount,
              payment.senderName,
            );
            if (creditResult.ok) {
              results.confirmed++;
              console.log(
                `[AutoPay] ✓ Credited ${payment.amount} € to site=${pendingPayment.site_id} (VS: ${payment.variableSymbol})`,
              );
            } else {
              results.errors.push(
                `VS ${payment.variableSymbol}: credit confirm failed — ${creditResult.error}`,
              );
            }
            await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
            continue;
          }

          // ── No match in either table ─────────────────────
          // Could be an expired pending row (cleared manually), a
          // duplicate notification for an already-confirmed payment,
          // or a mistyped VS. Mark seen so we don't loop forever.
          results.errors.push(`VS ${payment.variableSymbol}: no matching proposal or pending credit purchase`);
          await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });

        } catch (msgErr) {
          const errMsg = msgErr instanceof Error ? msgErr.message : String(msgErr);
          results.errors.push(`Message processing error: ${errMsg}`);
        }
      }
    } finally {
      lock.release();
    }

    // Defensive logout — Hostinger sometimes closes the IMAP session on
    // its own between the last operation and our LOGOUT command, which
    // makes client.logout() throw "Connection not available". That's a
    // benign teardown error (we already finished all the real work);
    // swallowing it keeps the cron's `errors` array meaningful.
    try {
      await client.logout();
    } catch (logoutErr) {
      // Log for visibility but don't surface as a "real" error.
      const detail =
        logoutErr instanceof Error ? logoutErr.message : String(logoutErr);
      console.warn(`[AutoPay] logout failed (non-fatal): ${detail}`);
    }
  } catch (err) {
    const errObj = err as {
      message?: string;
      code?: string;
      response?: string;
      responseText?: string;
      command?: string;
      stack?: string;
    };
    const detail = [
      errObj?.message,
      errObj?.code ? `code=${errObj.code}` : null,
      errObj?.command ? `command=${errObj.command}` : null,
      errObj?.response ? `response=${errObj.response}` : null,
      errObj?.responseText ? `responseText=${errObj.responseText}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    results.errors.push(`IMAP error: ${detail || String(err)}`);
    console.error("[AutoPay] IMAP full error:", errObj);
  }

  return results;
}
