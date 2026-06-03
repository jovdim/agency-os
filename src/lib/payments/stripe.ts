/**
 * Stripe SDK singleton + the API version pin.
 *
 * Lives in its own module so both the create-session route and the
 * webhook route hit the same configured client without re-instantiating
 * (the SDK caches a connection pool internally).
 *
 * Returns `null` when STRIPE_SECRET_KEY isn't set so callers can
 * surface a clean "Stripe not configured" message rather than crashing
 * on import. Useful when the dashboard is deployed before Peter has
 * created his Stripe account.
 */
import Stripe from "stripe";

// Pinned to match the API the SDK was tested against (2026-04-22.dahlia
// is what stripe@22.1.1 ships with). Changing this here is a deliberate
// upgrade — don't auto-bump.
const API_VERSION = "2026-04-22.dahlia" as const;

let cached: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    cached = null;
    return null;
  }
  cached = new Stripe(key, { apiVersion: API_VERSION });
  return cached;
}

/** True when both the secret key + webhook secret are configured. */
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;
}
