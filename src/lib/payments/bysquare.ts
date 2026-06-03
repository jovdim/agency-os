/**
 * BySquare (PAY by square) — Slovak bank QR code standard.
 * Uses the official bsqr.co API to generate QR images
 * that can be scanned by Slovak banking apps to pre-fill bank transfers.
 */

import { getActivePrice } from "@/lib/payments/proposal-utils";
import type { createAdminClient } from "@/lib/supabase/admin";

interface BySquarePaymentInput {
  amount: number;
  variableSymbol: string;
  note?: string;
}

// Bank details from env vars
function getBankConfig() {
  return {
    iban: process.env.BYSQUARE_IBAN || "SK1309000000005221380177",
    swift: process.env.BYSQUARE_SWIFT || "GIBASKBX",
    beneficiary:
      process.env.BYSQUARE_BENEFICIARY ||
      "Shark Media Consulting s. r. o.",
    apiKey: process.env.BYSQUARE_API_KEY || "",
  };
}

/**
 * Generate a PAY by square QR image via the official bsqr.co API.
 * Returns a base64 data URL (image/png) that can be used in <img src="...">.
 */
export async function generateBySquareQrImage(
  input: BySquarePaymentInput,
): Promise<string> {
  const config = getBankConfig();

  if (!config.apiKey) {
    throw new Error("BYSQUARE_API_KEY is not set");
  }

  // Use today as due date to avoid "missing maturity date" warning in banking apps
  const today = new Date();
  const dueDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const body = {
    payments: [
      {
        amount: input.amount,
        currencyCode: "EUR",
        paymentDueDate: dueDate,
        bankAccounts: [{ iban: config.iban, bic: config.swift }],
        beneficiaryName: config.beneficiary,
        paymentNote: input.note || "Webstranka - Shark Media",
        variableSymbol: input.variableSymbol,
        constantSymbol: "0308",
      },
    ],
  };

  const response = await fetch(
    "https://api.bysquare.com/generate/pay?formats=pay",
    {
      method: "POST",
      headers: {
        Authorization: config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`BySquare API error: ${response.status} - ${text}`);
  }

  const data = await response.json();
  if (!data.image) {
    throw new Error("BySquare API: no image in response");
  }

  return `data:image/png;base64,${data.image}`;
}

/**
 * Generate a variable symbol from a proposal slug or ID.
 * Must be numeric, max 10 digits.
 * Uses a simple hash of the string to produce a stable number.
 */
export function generateVariableSymbol(identifier: string): string {
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    const char = identifier.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  // Make positive and limit to 10 digits
  const positive = Math.abs(hash) % 10000000000;
  return String(positive).padStart(4, "0");
}

/**
 * Generate variable symbol for credit purchases.
 * Format: 9 + last 9 digits of timestamp (ensures uniqueness).
 */
export function generateCreditVariableSymbol(siteId: string): string {
  const ts = Date.now().toString().slice(-8);
  let hash = 0;
  for (let i = 0; i < siteId.length; i++) {
    hash = ((hash << 3) - hash + siteId.charCodeAt(i)) | 0;
  }
  const siteHash = (Math.abs(hash) % 10).toString();
  return "9" + siteHash + ts;
}

/** Shape of the proposal row this helper needs. Both callers already
 *  fetch these columns from `proposals`, so passing the row in keeps the
 *  helper free of its own SELECT round-trip. */
export interface ProposalQrSourceRow {
  id: string;
  company_name: string;
  base_price: number | null;
  discount_price: number | null;
  discount_expires_at: string | null;
  qr_image_cache: string | null;
  qr_cached_amount: number | null;
}

/**
 * Cache-or-refresh: returns the BySquare QR for a proposal.
 *
 * Fast path  — if `qr_cached_amount` matches the current active price,
 *              the cached `qr_image_cache` blob is returned as-is.
 * Slow path  — the QR is regenerated via the bsqr.co API, the fresh blob
 *              is written back to `qr_image_cache` + `qr_cached_amount`,
 *              and returned. The cache update is best-effort: a write
 *              failure logs but doesn't abort (the freshly generated QR
 *              is still returned to the caller).
 *
 * Failure semantics — on a regeneration error (network blip, BySquare
 * outage), falls back to the previously-cached QR (potentially stale by
 * one price change) so the UI never goes blank. Better a slightly-wrong
 * amount on the QR than no QR at all; the bank-transfer fields below
 * the QR still carry the correct active price + variable symbol.
 *
 * Used by:
 *   - GET /api/public/proposals/[slug]/data  (deployed-site banner widget)
 *   - GET /api/sites/[id]/site-payment-info  (composer publish dialog)
 *
 * Both endpoints share `proposals.qr_image_cache` / `qr_cached_amount`,
 * so a price change made via the sales banner-config dialog propagates
 * to every surface on next read.
 */
export async function getOrRefreshProposalQr(
  admin: ReturnType<typeof createAdminClient>,
  proposal: ProposalQrSourceRow,
): Promise<{
  qrImageDataUrl: string | null;
  variableSymbol: string;
  activePrice: number;
}> {
  const activePrice = getActivePrice({
    base_price: proposal.base_price,
    discount_price: proposal.discount_price,
    discount_expires_at: proposal.discount_expires_at,
  });
  const variableSymbol = generateVariableSymbol(proposal.id);

  // Fast path — cached amount still matches.
  if (
    proposal.qr_image_cache &&
    Number(proposal.qr_cached_amount) === activePrice
  ) {
    return {
      qrImageDataUrl: proposal.qr_image_cache,
      variableSymbol,
      activePrice,
    };
  }

  // Slow path — regenerate and try to update the cache.
  try {
    const fresh = await generateBySquareQrImage({
      amount: activePrice,
      variableSymbol,
      note: `Web ${proposal.company_name}`,
    });
    if (fresh) {
      const { error: updateErr } = await admin
        .from("proposals")
        .update({ qr_image_cache: fresh, qr_cached_amount: activePrice })
        .eq("id", proposal.id);
      if (updateErr) {
        // Cache write failed — log and keep going. The caller still
        // gets the freshly generated QR; the next call will retry the
        // cache update on its own.
        console.error("[QR] cache update failed:", updateErr.message);
      }
    }
    return { qrImageDataUrl: fresh, variableSymbol, activePrice };
  } catch (err) {
    console.error("[QR] regeneration failed:", err);
    // Fall back to the stale cache (if any) so the UI isn't blank.
    return {
      qrImageDataUrl: proposal.qr_image_cache,
      variableSymbol,
      activePrice,
    };
  }
}
