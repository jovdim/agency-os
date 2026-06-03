import { NextRequest, NextResponse } from "next/server";
import { checkAndConfirmPayments } from "@/lib/payments/auto-confirm";

/**
 * GET /api/cron/check-payments
 * Cron job that checks paid@youragency.com inbox for SLSP bank notifications
 * and auto-confirms matching payments.
 *
 * Runs every 10 minutes via cron-job.org (external).
 * Protected by CRON_SECRET — sent as `Authorization: Bearer <secret>`.
 */
// Vercel Hobby plan caps functions at 10s regardless; setting this anyway
// for when/if we upgrade.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await checkAndConfirmPayments();

    console.log(
      `[Cron] Payment check: ${results.processed} emails processed, ${results.confirmed} confirmed` +
      (results.errors.length > 0 ? `, ${results.errors.length} errors` : "")
    );

    return NextResponse.json({
      success: true,
      ...results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Cron] Payment check failed:", message);
    return NextResponse.json(
      { error: "Payment check failed", details: message },
      { status: 500 }
    );
  }
}
