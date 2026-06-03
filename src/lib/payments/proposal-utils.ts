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
