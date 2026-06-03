import { NextRequest, NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSLSPEmail } from "@/lib/payments/auto-confirm";
import { getActivePrice } from "@/lib/payments/proposal-utils";

/**
 * GET /api/super/match-bank-emails
 *
 * The "would auto-confirm have worked?" diagnostic. Reads every SLSP
 * "Príchodzia úhrada" (incoming payment) email in the inbox, parses
 * each one for VS + amount, looks the VS up in the proposals table,
 * and returns a
 * side-by-side comparison report:
 *
 *   - email's VS → matching proposal? (slug, status, expected amount)
 *   - email amount vs the proposal's active price (would the side-
 *     effect chain accept it as valid?)
 *   - what auto-confirm WOULD have done if the cron had been running
 *     when the email landed (already_paid / would_confirm / no_match)
 *
 * The point: prove the parser + lookup chain works against real
 * production email data, without sending any test emails or waiting
 * for a real customer. If even ONE row in the report comes back
 * "would_confirm: true, amount_matches: true", the chain is proven
 * end-to-end — we just haven't had a real customer scan-and-pay yet.
 *
 * Read-only — does not mark any emails as \Seen, does not write to
 * the DB, does not call the confirm route. Pure diagnostic.
 */
export const maxDuration = 60;

interface MatchedEmail {
  uid: number;
  subject: string;
  date: string | null;
  flags: string[];
  parsedFromEmail: {
    variableSymbol: string | null;
    amount: number | null;
    senderName: string | null;
  };
  proposalLookup: {
    found: boolean;
    proposalId: string | null;
    slug: string | null;
    companyName: string | null;
    status: string | null;
    expectedActivePrice: number | null;
  };
  verdict:
    | "would_confirm"           // VS matches, status OK, amount matches → would auto-confirm
    | "would_confirm_amount_mismatch"  // VS matches, status OK, but amount differs
    | "would_skip_already_paid" // VS matches but proposal is already in paid state
    | "would_skip_status"       // VS matches but status isn't sent/viewed
    | "no_match"                // VS doesn't match any proposal in the DB
    | "unparseable";            // parser couldn't extract VS or amount
}

interface ReportSummary {
  totalEmails: number;
  parseable: number;
  unparseable: number;
  wouldConfirm: number;
  wouldConfirmAmountMismatch: number;
  wouldSkipAlreadyPaid: number;
  wouldSkipStatus: number;
  noMatch: number;
}

export async function GET(req: NextRequest) {
  // Super-admin gate.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = user.app_metadata?.role as string | undefined;
  if (role !== "super_admin") {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const host = process.env.IMAP_HOST || "imap.hostinger.com";
  const imapUser = process.env.SMTP_PAID_USER;
  const imapPass = process.env.SMTP_PAID_PASS?.replace(/\\(.)/g, "$1");
  if (!imapUser || !imapPass) {
    return NextResponse.json(
      { error: "SMTP_PAID_USER or SMTP_PAID_PASS not configured" },
      { status: 500 },
    );
  }

  // Allow ?days=N for wider/narrower windows.
  const days = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("days") ?? 30), 1),
    90,
  );

  const matched: MatchedEmail[] = [];
  const summary: ReportSummary = {
    totalEmails: 0,
    parseable: 0,
    unparseable: 0,
    wouldConfirm: 0,
    wouldConfirmAmountMismatch: 0,
    wouldSkipAlreadyPaid: 0,
    wouldSkipStatus: 0,
    noMatch: 0,
  };

  const client = new ImapFlow({
    host,
    port: 993,
    secure: true,
    auth: { user: imapUser, pass: imapPass },
    logger: false,
    socketTimeout: 8000,
  });

  try {
    await client.connect();
    const mailboxes = await client.list();
    const inboxName =
      mailboxes.find((m) => m.path.toLowerCase() === "inbox")?.path || "INBOX";

    const lock = await client.getMailboxLock(inboxName);
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const uids = await client.search({ since }, { uid: true });
      // Iterate newest first, capped at 50 so we don't hit the function
      // budget on noisy inboxes.
      const targetUids = (uids || []).slice(-50).reverse();

      if (targetUids.length === 0) {
        lock.release();
        await client.logout();
        return NextResponse.json({
          inbox: inboxName,
          windowDays: days,
          summary,
          messages: matched,
          notes: ["No emails in the search window."],
        });
      }

      const messages = client.fetch(
        targetUids,
        { source: true, envelope: true, flags: true, uid: true },
        { uid: true },
      );

      const admin = createAdminClient();

      for await (const msg of messages) {
        summary.totalEmails++;
        const source = msg.source?.toString("utf-8") || "";
        const parsed = parseSLSPEmail(source);

        const flagsArr = Array.isArray(msg.flags)
          ? msg.flags
          : Array.from(msg.flags as Set<string>);

        const baseEntry = {
          uid: msg.uid,
          subject: msg.envelope?.subject || "(no subject)",
          date: msg.envelope?.date
            ? new Date(msg.envelope.date).toISOString()
            : null,
          flags: flagsArr,
        };

        if (!parsed) {
          summary.unparseable++;
          matched.push({
            ...baseEntry,
            parsedFromEmail: {
              variableSymbol: null,
              amount: null,
              senderName: null,
            },
            proposalLookup: {
              found: false,
              proposalId: null,
              slug: null,
              companyName: null,
              status: null,
              expectedActivePrice: null,
            },
            verdict: "unparseable",
          });
          continue;
        }

        summary.parseable++;

        // Look up proposal by VS — same query auto-confirm uses.
        const { data: proposal } = await admin
          .from("proposals")
          .select(
            "id, slug, status, paid_at, variable_symbol, company_name, discount_price, base_price, discount_expires_at",
          )
          .eq("variable_symbol", parsed.variableSymbol)
          .maybeSingle();

        if (!proposal) {
          summary.noMatch++;
          matched.push({
            ...baseEntry,
            parsedFromEmail: {
              variableSymbol: parsed.variableSymbol,
              amount: parsed.amount,
              senderName: parsed.senderName,
            },
            proposalLookup: {
              found: false,
              proposalId: null,
              slug: null,
              companyName: null,
              status: null,
              expectedActivePrice: null,
            },
            verdict: "no_match",
          });
          continue;
        }

        const expectedActivePrice = getActivePrice({
          discount_price: proposal.discount_price,
          base_price: proposal.base_price,
          discount_expires_at: proposal.discount_expires_at,
        });

        let verdict: MatchedEmail["verdict"];
        if (proposal.status === "paid" || proposal.paid_at) {
          verdict = "would_skip_already_paid";
          summary.wouldSkipAlreadyPaid++;
        } else if (!["sent", "viewed"].includes(proposal.status)) {
          verdict = "would_skip_status";
          summary.wouldSkipStatus++;
        } else if (parsed.amount === expectedActivePrice) {
          verdict = "would_confirm";
          summary.wouldConfirm++;
        } else {
          verdict = "would_confirm_amount_mismatch";
          summary.wouldConfirmAmountMismatch++;
        }

        matched.push({
          ...baseEntry,
          parsedFromEmail: {
            variableSymbol: parsed.variableSymbol,
            amount: parsed.amount,
            senderName: parsed.senderName,
          },
          proposalLookup: {
            found: true,
            proposalId: proposal.id,
            slug: proposal.slug,
            companyName: proposal.company_name,
            status: proposal.status,
            expectedActivePrice,
          },
          verdict,
        });
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    return NextResponse.json(
      {
        error: "IMAP error",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    inbox: "INBOX",
    windowDays: days,
    summary,
    messages: matched,
  });
}
