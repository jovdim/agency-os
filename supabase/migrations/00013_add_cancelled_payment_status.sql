-- Add 'cancelled' to payment_status enum
-- Used when: resending proposal (old payment cancelled), client declines, etc.
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'cancelled';
