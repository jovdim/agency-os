/**
 * Proposal handover utilities — pricing, discounts, reminders.
 */

export const DEFAULT_BASE_PRICE = 299;
export const MIN_DISCOUNT_PRICE = 149;
export const DISCOUNT_WINDOW_DAYS = 14;

/** Default greeting template for sales to personalize */
export const DEFAULT_GREETING = `Hello,

We have prepared a new website for you based on your requirements. You can view it using the link below.

If you have any questions, please don't hesitate to contact us.

Best regards`;

interface ProposalPriceFields {
  discount_price: number | null;
  base_price: number | null;
  discount_expires_at: string | null;
}

/** Returns the currently active price based on discount window */
export function getActivePrice(proposal: ProposalPriceFields): number {
  const basePrice = proposal.base_price ?? DEFAULT_BASE_PRICE;
  if (!proposal.discount_price || !proposal.discount_expires_at) {
    return basePrice;
  }
  return isDiscountActive(proposal)
    ? proposal.discount_price
    : basePrice;
}

/** Whether the discount window is still active */
export function isDiscountActive(proposal: ProposalPriceFields): boolean {
  if (!proposal.discount_expires_at) return false;
  return new Date() < new Date(proposal.discount_expires_at);
}

interface ReminderSchedule {
  reminder_type: string;
  due_at: Date;
}

/** Returns the 4 follow-up reminder dates from the sent timestamp */
export function getReminderSchedule(sentAt: Date): ReminderSchedule[] {
  return [
    {
      reminder_type: "day_4",
      due_at: addDays(sentAt, 4),
    },
    {
      reminder_type: "day_10",
      due_at: addDays(sentAt, 10),
    },
    {
      reminder_type: "day_14_expired",
      due_at: addDays(sentAt, 14),
    },
    {
      reminder_type: "day_30_cleanup",
      due_at: addDays(sentAt, 30),
    },
  ];
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Stable numeric reference for a proposal, derived from its id.
 *
 * Originally the bank-transfer "variable symbol" (VS); kept after BySquare
 * was retired (2026-06-09) because it's still stored on
 * `proposals.variable_symbol` and embedded in payment descriptions /
 * invoices as a human-readable reference number. Numeric, max 10 digits.
 */
export function generateVariableSymbol(identifier: string): string {
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    const char = identifier.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  // Make positive and limit to 10 digits.
  const positive = Math.abs(hash) % 10000000000;
  return String(positive).padStart(4, "0");
}
