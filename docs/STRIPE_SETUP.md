# Stripe Setup Guide

This dashboard ships with Stripe Checkout fully wired for credit top-ups. To activate it, you need a Stripe account, API keys, and a configured webhook. Until then, the "Platba kartou" button in the top-up dialog returns a friendly "not available yet" message and clients fall back to the BySquare QR path.

**Time to complete:** ~30 min for test mode, ~1–2 days for live mode (Stripe identity verification).

---

## 1. Create a Stripe account

Sign up at **https://dashboard.stripe.com/register**.

Country: **Slovakia**
Business type: matches your legal entity (most likely **s.r.o.**).

You'll be asked for:
- Company **IČO** + **DIČ**
- Business address
- Bank account **IBAN** (where Stripe pays out your earnings)
- A government-issued ID of a company representative (for verification)

**You can use TEST MODE immediately** — no verification required. Real card payments only work after Stripe verifies your account, which usually takes 1–2 business days. While verifying, test all the code with Stripe's test cards (see step 5).

---

## 2. Get your API keys

In the Stripe Dashboard → **Developers → API keys**, copy:

| Key | Format | Where it lives |
|---|---|---|
| **Secret key** | `sk_test_…` (test) or `sk_live_…` (live) | Vercel env var `STRIPE_SECRET_KEY` — **never** put in client code |
| Publishable key | `pk_test_…` or `pk_live_…` | Not needed for this app (we use Checkout redirect, not embedded Elements) |

Keep TEST keys for now. Don't switch to live until you've tested end-to-end.

---

## 3. Configure the webhook

The webhook is how Stripe tells our server "payment succeeded — credit the balance". Without it, customers pay but the balance never updates.

In Stripe Dashboard → **Developers → Webhooks → Add endpoint**:

- **Endpoint URL:** `https://klient.2dni.sk/api/payments/stripe/webhook`
  *(or whatever your production URL is — match what's in `NEXT_PUBLIC_SITE_URL`)*
- **Events to send:** check **`checkout.session.completed`** (the only event our code handles)
- Click **Add endpoint**

After creating, click the endpoint name, then click **Reveal** on the **Signing secret**. It looks like `whsec_…`. **Copy it.**

That signing secret goes into Vercel env var `STRIPE_WEBHOOK_SECRET`. It's used to verify that webhook calls really come from Stripe and weren't forged.

> **Warning:** the signing secret is **per-endpoint**. Each time you delete and recreate the endpoint, you get a new secret. If you have separate dev/staging/prod environments, each gets its own endpoint + secret.

---

## 4. Add env vars to Vercel

In Vercel → Project → **Settings → Environment Variables**, add for the **Production** environment:

| Variable | Value | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` initially | Switch to `sk_live_…` once verified |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from step 3 | Required — webhook rejects without it |

For **local development**, add the same two to `.env.local`. You'll also want **Stripe CLI** to forward webhooks to your machine (see step 6).

After saving in Vercel, **redeploy** so the new env vars apply (or trigger a small push). The "Platba kartou" button should now reach Stripe instead of showing the fallback message.

---

## 5. Test in prod (test mode)

1. Open `/client/balance` as a client (test client account)
2. Click **Dobiť zostatok → Zaplatiť kartou**
3. Browser redirects to Stripe-hosted Checkout
4. Enter test card details:
   - **Card:** `4242 4242 4242 4242`
   - **Expiry:** any future date (e.g. `12 / 30`)
   - **CVC:** any 3 digits (e.g. `123`)
   - **Name/email:** anything
5. Click **Pay**
6. Browser redirects to `/client/balance?topup=success`
7. Within **2–5 seconds** the balance should increment

If the balance doesn't increment:
- In Stripe Dashboard → Developers → Webhooks → click your endpoint → **Recent deliveries**
- You'll see whether the webhook fired + what response your server returned
- If 200: server received it, check Vercel logs for the actual processing
- If 401 / 503: env vars not set or signing secret mismatch

Other test cards (for failure scenarios):
- `4000 0000 0000 0002` → card declined
- `4000 0025 0000 3155` → 3D Secure required (Stripe handles the auth flow automatically)

Full list: https://docs.stripe.com/testing#cards

---

## 6. Local dev with Stripe CLI (optional)

To test the webhook on `localhost:3000`:

```bash
# Install Stripe CLI (one-time, requires brew on macOS, chocolatey on Windows)
brew install stripe/stripe-cli/stripe         # macOS
choco install stripe-cli                       # Windows
# or download: https://github.com/stripe/stripe-cli/releases

stripe login                                   # browser opens, authorize once

# Forward webhook events to your local server
stripe listen --forward-to localhost:3000/api/payments/stripe/webhook
```

The CLI prints a **webhook signing secret** for the local session (starts with `whsec_`). Put that in `.env.local` as `STRIPE_WEBHOOK_SECRET` for the local server only.

When you complete a test Checkout, the CLI forwards the event to your local machine and you can debug the webhook handler with breakpoints.

---

## 7. Going live

Once Stripe verifies your account:

1. Swap `STRIPE_SECRET_KEY` from `sk_test_…` to `sk_live_…` in Vercel
2. In Stripe Dashboard, **toggle to Live mode** (top-right of dashboard)
3. **Re-create the webhook** in Live mode (test-mode and live-mode webhooks are separate). Copy the new `whsec_…` and update `STRIPE_WEBHOOK_SECRET` in Vercel.
4. Test once with a real card on a small amount (€12.50 is fine), confirm the flow end-to-end, then we're live.

Test cards stop working in live mode — only real cards.

---

## What the code does

**On "Zaplatiť kartou" click:**
1. `POST /api/payments/stripe/create-session` → server inserts a pending `payments` row + creates a Stripe Checkout session → returns the Checkout URL
2. Browser redirects to Stripe-hosted Checkout
3. Customer pays
4. Stripe redirects browser back to `/client/balance?topup=success`

**Meanwhile (server-to-server):**
5. Stripe fires `checkout.session.completed` to `/api/payments/stripe/webhook`
6. Server verifies signature, looks up the pending payment by `metadata.payment_id`
7. Credits the balance, inserts a `credit_transactions` row, flips payment to `confirmed`, audits

**Idempotent**: if Stripe retries the webhook (network glitch, etc.), the second call sees `status='confirmed'` and skips. No double-crediting.

---

## Costs

Stripe charges **1.4% + 0.25 €** per EU card payment (lower than typical EU rates). For a 25 € top-up: ~0.60 € fee. For a 200 € top-up: ~3.05 € fee. Fees come out of the amount paid — Stripe deposits the net into your IBAN on a rolling basis (default: weekly).

Adjustable in Stripe Dashboard → Settings → Payouts.
