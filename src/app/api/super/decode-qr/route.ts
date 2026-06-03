import { NextRequest, NextResponse } from "next/server";
import { decode } from "bysquare/pay";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePrice } from "@/lib/payments/proposal-utils";

/**
 * GET /api/super/decode-qr?text=<bysquare_qr_string>
 *
 * Debug-only endpoint. Decodes a PAY by square QR string into its
 * structured payment data, then cross-references the variable symbol
 * against the proposals table — so super_admin can paste a scanned
 * QR (or one copied from the dashboard preview) and see:
 *
 *   - Which proposal it points to (slug, status, expected price)
 *   - Whether the VS would match auto-confirm's lookup
 *   - The full decoded payload (IBAN, amount, beneficiary, note, etc.)
 *
 * Reason this exists: previously the only way to verify a generated
 * QR was correct was to run `node -e "..."` from a terminal and
 * eyeball JSON. With this endpoint Peter can do the whole flow from
 * the dashboard URL bar.
 *
 * Auth: super_admin only. The decoded payload includes IBAN, so we
 * keep this behind a real session and don't expose a CRON_SECRET path.
 */
export const maxDuration = 30;

interface VsLookup {
  proposal_id: string;
  slug: string | null;
  status: string;
  company_name: string | null;
  expected_active_price: number;
  amount_matches: boolean;
  already_paid: boolean;
}

export async function GET(req: NextRequest) {
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

  const text = req.nextUrl.searchParams.get("text");
  if (!text || !text.trim()) {
    return NextResponse.json(
      {
        error: "Missing required query param 'text'",
        usage: "/api/super/decode-qr?text=<bysquare_qr_string>",
      },
      { status: 400 },
    );
  }

  // Decode the BySquare string. The library throws on malformed input
  // (bad LZMA stream, bad checksum, wrong field count, etc.).
  let decoded;
  try {
    decoded = decode(text.trim());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown decode error";
    return NextResponse.json(
      {
        error: `Decode failed: ${message}`,
        hint: "The string must be a complete PAY by square payload (typically starts with 0x00 byte sequence base32-encoded).",
      },
      { status: 400 },
    );
  }

  // Pull the first payment block — single-payment is the only shape
  // the dashboard ever generates, and the only one auto-confirm matches.
  const payment = decoded.payments?.[0];
  const variableSymbol = payment?.variableSymbol ?? null;
  const amount = payment?.amount ?? null;

  // Look up the VS in proposals (mirrors match-bank-emails logic).
  let vsLookup: VsLookup | null = null;
  if (variableSymbol) {
    const admin = createAdminClient();
    const { data: proposal } = await admin
      .from("proposals")
      .select(
        "id, slug, status, paid_at, company_name, discount_price, base_price, discount_expires_at",
      )
      .eq("variable_symbol", variableSymbol)
      .maybeSingle();

    if (proposal) {
      const expected = getActivePrice({
        discount_price: proposal.discount_price,
        base_price: proposal.base_price,
        discount_expires_at: proposal.discount_expires_at,
      });

      vsLookup = {
        proposal_id: proposal.id,
        slug: proposal.slug ?? null,
        status: proposal.status,
        company_name: proposal.company_name ?? null,
        expected_active_price: expected,
        // Tolerate cents-rounding (BySquare amounts are decimals).
        amount_matches:
          typeof amount === "number" && Math.abs(amount - expected) < 0.01,
        already_paid: Boolean(proposal.paid_at),
      };
    }
  }

  return NextResponse.json({
    input_length: text.trim().length,
    decoded,
    summary: {
      variable_symbol: variableSymbol,
      amount,
      currency: payment?.currencyCode ?? null,
      iban: payment?.bankAccounts?.[0]?.iban ?? null,
      note: payment?.paymentNote ?? null,
    },
    vs_lookup: vsLookup,
  });
}
