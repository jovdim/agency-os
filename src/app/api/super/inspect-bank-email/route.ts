import { NextRequest, NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { createClient } from "@/lib/supabase/server";
import { parseSLSPEmail } from "@/lib/payments/auto-confirm";

/**
 * GET /api/super/inspect-bank-email
 *
 * Debug-only endpoint that connects to paid@youragency.com over IMAP and
 * returns the last N emails (subject + first ~2KB of body), plus
 * the result of running the SLSP parser regex against each one.
 *
 * The point: the auto-confirm cron has never confirmed a payment in
 * production, but the inbox demonstrably receives SLSP "Príchodzia
 * úhrada" (incoming payment) emails (per [Your Name] 2026-05-10). The
 * most likely cause is a
 * parser/format mismatch — SLSP's real email format differs from
 * what `parseSLSPEmail` was written against. To fix the regex we
 * need to see the actual email body.
 *
 * Important — this endpoint:
 *
 *   - Does NOT mark messages as \Seen (the cron's normal flow does;
 *     here we want to peek without disturbing). If the cron has
 *     already auto-marked them read on previous polls, that's fine
 *     — we still see them, just have to set seen:false=false in
 *     the IMAP search to include read mail too.
 *   - Limits to the last 7 days, max 10 messages, to stay fast.
 *   - Only super_admin can call it. The CRON_SECRET path is NOT
 *     exposed here because this returns email content — we keep
 *     that behind a real session.
 *   - Trims body to 2KB per message to keep the JSON sane.
 */
export const maxDuration = 60;

interface InspectedEmail {
  uid: number;
  subject: string;
  from: string;
  date: string | null;
  flags: string[];
  bodyPreview: string;
  parserResult: ReturnType<typeof parseSLSPEmail>;
  /** What the parser regex matched (or didn't) — surfaced separately
   *  from parserResult so we can see WHY it failed when it does. */
  regexHits: {
    vsMatch: boolean;
    vsValue: string | null;
    amountMatch: boolean;
    amountValue: string | null;
  };
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

  // Allow ?limit=N (1..25) and ?days=N (1..30) overrides for power-user debugging.
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 10), 1),
    25,
  );
  const days = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("days") ?? 7), 1),
    30,
  );

  const client = new ImapFlow({
    host,
    port: 993,
    secure: true,
    auth: { user: imapUser, pass: imapPass },
    logger: false,
    socketTimeout: 8000,
  });

  const results: InspectedEmail[] = [];
  const errors: string[] = [];

  try {
    await client.connect();

    const mailboxes = await client.list();
    const inboxName =
      mailboxes.find((m) => m.path.toLowerCase() === "inbox")?.path || "INBOX";

    const lock = await client.getMailboxLock(inboxName);
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);

      // Pull both unread AND read so we see emails the cron may have
      // already processed (and marked seen) without confirming. That's
      // exactly the cohort we care about for parser debugging.
      const uids = await client.search({ since }, { uid: true });
      const targetUids = (uids || []).slice(-limit).reverse();

      if (targetUids.length === 0) {
        lock.release();
        await client.logout();
        return NextResponse.json({
          inbox: inboxName,
          searchWindow: `last ${days} days`,
          totalFound: 0,
          messages: [],
          notes: [
            "No emails found in the search window. Either nothing arrived in this period, or the inbox is empty.",
          ],
        });
      }

      const messages = client.fetch(
        targetUids,
        { source: true, envelope: true, flags: true, uid: true },
        { uid: true },
      );

      for await (const msg of messages) {
        try {
          const source = msg.source?.toString("utf-8") || "";
          // Strip HTML for the preview; full source is too noisy.
          const cleanText = source
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          const bodyPreview = cleanText.slice(0, 2000);

          const parserResult = parseSLSPEmail(source);

          // Run the same two regexes the parser uses — surface both
          // results separately so we know exactly which step failed.
          const vsMatch = cleanText.match(/\/VS(\d+)\//);
          const amountMatch = cleanText.match(/(\d{1,6}[.,]\d{2})\s*EUR/);

          const fromAddr = msg.envelope?.from?.[0];
          const fromStr = fromAddr
            ? `${fromAddr.name || ""} <${fromAddr.address || ""}>`.trim()
            : "(unknown)";

          results.push({
            uid: msg.uid,
            subject: msg.envelope?.subject || "(no subject)",
            from: fromStr,
            date: msg.envelope?.date
              ? new Date(msg.envelope.date).toISOString()
              : null,
            flags: Array.isArray(msg.flags)
              ? msg.flags
              : Array.from(msg.flags as Set<string>),
            bodyPreview,
            parserResult,
            regexHits: {
              vsMatch: vsMatch !== null,
              vsValue: vsMatch ? vsMatch[1] : null,
              amountMatch: amountMatch !== null,
              amountValue: amountMatch ? amountMatch[1] : null,
            },
          });
        } catch (msgErr) {
          errors.push(
            `Message ${msg.uid}: ${msgErr instanceof Error ? msgErr.message : String(msgErr)}`,
          );
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    const errObj = err as {
      message?: string;
      code?: string;
      response?: string;
    };
    return NextResponse.json(
      {
        error: "IMAP error",
        detail:
          errObj?.message ||
          errObj?.code ||
          errObj?.response ||
          String(err),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    inbox: "INBOX",
    searchWindow: `last ${days} days`,
    totalFound: results.length,
    messages: results,
    errors,
  });
}
