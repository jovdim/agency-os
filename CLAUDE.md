# Agency OS — CLAUDE.md

## What this project is

A web-agency operating system: it manages the full lifecycle from cold-call lead to
live client website — CRM, proposals, in-app website building (the **composer**),
payments, invoicing, and domains. The platform is white-label (resold to agencies),
so **do not introduce Slovakia/SK/"Slovak" framing in branding, UI, or new code** —
see the brand component in `src/components/brand.tsx`. (Invoices still render a
localized faktura layout; that's a product fact, not branding.)

> **Heads-up — this file was rewritten 2026-06-09 after a large legacy cleanup.**
> A previous architecture (GitHub-deployed static sites, a Webflow-style inline
> editor, content.json, a section/template renderer, client change-requests, and
> in-app messaging) was **removed**. If you find references to any of those, they
> are stale. A separate, in-flight effort (migration 00080+) is building a
> per-site CMS + dynamic DB-served sites — marked **IN PROGRESS** below.

## Tech Stack

- **Frontend**: Next.js (App Router), React, Tailwind CSS v4, shadcn/ui, @phosphor-icons/react, next-themes
- **Backend**: Supabase (PostgreSQL, Auth, Storage)
- **Hosting**: Vercel
- **Site deployment**: Cloudflare Pages **Direct Upload** (no GitHub step). The composer
  renders the site and uploads files straight to Cloudflare; custom domains attach via the
  Cloudflare API. Sites are reachable at a `*.{PROPOSAL_DOMAIN}` subdomain (and any attached custom domain).
- **Payments**: **Stripe** (canonical) for proposal payments + credit top-ups; a manual
  "mark paid" fallback for off-Stripe money. BySquare (PAY-by-square) QR code lib still
  present for bank-transfer QR rendering.
- **AI**: composer content/image generation via `src/lib/ai/*` (multi-provider: OpenAI / Gemini / Groq / Cloudflare Workers AI)
- **Email**: Nodemailer + Hostinger SMTP (proposal send + welcome email)
- **Rich text**: TipTap (inside the composer's text fields)

## 5 User Roles

| Role            | Route prefix | Access                                                                              |
| --------------- | ------------ | ----------------------------------------------------------------------------------- |
| `client`        | `/client`    | Own site overview, credit balance, domain + business-email setup, printable invoice |
| `sales`         | `/sales`     | CRM/calling, create proposals, build in the composer, send to client, commissions   |
| `tech_admin`    | `/tech`      | Build proposals in the composer, publish, section-templates, live clients, settings |
| `administrator` | `/admin`     | Reporting / overview                                                                |
| `super_admin`   | `/super`     | Full oversight: proposals, production, sales+IT overview, users, contacts, payments, domains, settings |

Clients **cannot** self-edit or self-publish their site in-app today (that flow was
removed). All building/publishing is staff-side via the composer. (A per-site CMS that
lets site owners edit their published site at `theirdomain.com/admin` is **IN PROGRESS** — see below.)

## The Composer (the only website builder/editor)

Websites are built and edited entirely inside the CRM with the **composer**.

- A site's **draft** content lives in `sites.composition` (JSON: `pages[].sections[]`,
  each section referencing a row in the `section_templates` library, plus theme, SEO,
  i18n, and shared nav/footer slots). The **published** copy lives in
  `sites.published_composition` (added 00080).
- The composer loads published `section_templates` HTML/CSS bodies from Supabase Storage
  (`loadTemplateBodies` / `loadBaseCss`) and renders them with `src/lib/templates/render.ts`
  (placeholder-schema field substitution — **not** arbitrary-HTML DOM editing).
- Edits autosave (250ms debounce) via `PUT /api/sites/[id]` (writes `composition`).
- A per-site edit **lock** (`src/lib/composer/site-lock.ts`, `/api/sites/[id]/lock`)
  prevents two people editing the same site at once.
- **Publish** (`POST /api/sites/[id]/publish`): render composition → upload to Cloudflare
  Pages Direct Upload → snapshot a `site_versions` row (keep last 5) → copy draft to
  `published_composition`. First publish auto-flips the proposal to `review` and
  auto-provisions the client zone (`ensureClientZone`). `?silent=true` republishes with no
  history row (used to toggle the payment banner off after payment).
- **Versions / revert**: `site_versions` table; `/api/sites/[id]/versions` +
  `/api/sites/[id]/versions/[versionId]/revert`. Shown in the composer's Publish menu.

### Composer entry points (all staff)
- `/tech/proposals/[id]/composer` — IT builds the proposal's site (creates a site row if needed)
- `/sales/proposals/[id]/composer` — sales builds the same site (shared UI)
- `/super/proposals/[id]/composer` — super-admin access (redirects into the tech route)
- `/tech/sites/[id]/composer` — composer keyed to an existing site

### Composer code
- `src/components/composer/*` — composer UI (`composer-client.tsx` orchestrator,
  `publish-menu.tsx`, `section-card.tsx`, `pages-tabs.tsx`, `fields-list.tsx`,
  `placeholder-field.tsx`, `theme-panel.tsx`, `seo-panel.tsx`, `languages-panel.tsx`,
  `variant-picker.tsx`, `brand-section.tsx`, modals, etc.)
- `src/lib/composer/*` — `site-lock`, `image-store`, `json-roundtrip`, `nav-dropdown-sync`,
  `page-anchors`, `logo-generator`, `google-fonts`, `brand`, `legacy-nav-overrides`, `scaffold-palette`
- `src/lib/templates/*` — `render.ts` (server render), `render-browser.ts` (in-browser
  preview), `publish.ts` (`publishSite`), `load-bodies.ts`, `theme.ts`, `seo.ts`,
  `parser.ts`, `sanitize.ts`, `crawl-files.ts`, etc.
- `src/lib/deployment/*` — `cloudflare-direct.ts` (Direct Upload), `custom-domain.ts`, `pages-url.ts`
- `src/lib/ai/*` — provider abstraction + prompt/image builders for composer AI
- Section-template **library** is authored at `/tech/section-templates`
  (API `/api/section-templates`, `[id]`, `[id]/preview`); composer extras at `/api/composer/*`
  (`ai-generate`, `ai-image`, `ai-inputs`, `upload`, `upload-url`, `fonts`, `copywriting-guide`).

## Proposal → Client Lifecycle

**Statuses** (`ProposalStatus` in `src/types/database.ts`):
`draft, submitted, building, review, revision, sent, viewed, accepted, paid`
(the DB also has `archived` from migration 00014). Typical path:
`submitted → building → review → revision → sent → viewed → paid`.

1. **Sales creates a proposal** (contact + company details + requirements) → `submitted`.
2. **IT (or sales) builds the site** in the composer. The **first successful publish**
   auto-flips the proposal to `review` and auto-provisions the client zone
   (client auth user + site owner) via `ensureClientZone` — there's no separate manual
   "create client account" step at send time anymore.
3. **Sales sends to client** from the proposal timeline (`src/components/proposal-timeline/*`):
   sets `sent`, stamps `sent_at` + `variable_symbol`, schedules follow-up reminders.
   Send can go by **email and/or WhatsApp** (per-channel `sent_email_at` / `sent_whatsapp_at`).
4. **Client opens** the public proposal / live site → `viewed`.
5. **Client pays** (Stripe) → `confirmProposalPayment` runs (see Payments) → `paid`.

Pipeline visible to super-admin at `/super/proposals` (+ `/super/proposals/[id]`); IT works
the build queue from `/tech/proposals`.

## Payments

Two surfaces, **one shared helper** — `src/lib/payments/confirm-proposal-payment.ts`
(`confirmProposalPayment`) — so manual and automatic payments produce identical records
(payment row, invoice `FV-YYYYMMDD-NNN`, `paid` status, banner-off republish, reminders
dismissed, commission accrual, welcome email).

1. **Stripe (primary, automatic).** The payment banner on the live proposal site links/QRs to
   `GET /api/public/proposals/[slug]/pay` (public): computes the active price
   (discount-window aware), inserts a PENDING `payments` row, creates a Stripe Checkout
   session, and redirects to hosted Checkout. On success Stripe fires
   `checkout.session.completed` → `POST /api/payments/stripe/webhook` (signature-verified,
   idempotent). `metadata.kind === "proposal"` → `confirmProposalPayment`; `"credits"` →
   credit-balance top-up + `purchase` transaction. Stripe config in `src/lib/payments/stripe.ts`;
   credit top-up session at `/api/payments/stripe/create-session`.
2. **Mark-paid (manual fallback).** `POST /api/proposals/[id]/mark-paid` (tech/super, or sales
   for own proposals) for money received off-Stripe (cash, bank transfer, invoice). Same helper.

### Price logic
- Default base price €299, min discount €149, 14-day discount window.
- Active price = `now < discount_expires_at ? discount_price : base_price` (computed at read time).

### Follow-up reminders (`proposal_reminders`)
- Day 4 / Day 10 (follow-up calls), Day 14 (discount expired), Day 30 (final). Auto-dismissed on payment.

> BySquare QR code generation (`src/lib/payments/bysquare.ts`, `/api/payments/qr`) still
> exists, but Stripe is the canonical pay path. There is **no** `/api/admin/payments/confirm`
> bank-transfer-confirmation route anymore.

## Client surface (`/client`)

What remains under `/client`: the dashboard (`page.tsx` — greeting, paid/expiry banners,
live-site link, domain + business-email tile), `balance/` (credit balance + top-up),
`domain/` (domain + business-email setup pipeline), `services/`, and
`payments/[id]/invoice/` (printable faktura). **Removed:** `client/sites` (+ inline editor),
`client/requests` (change-request tracker), `client/messages` (in-app support), `client/credits`
(now `client/balance`), `client/designs`.

## Domains

- Selection happens on `/client/domain` (register new with DNS availability check, or transfer
  with EPP auth code). Requests surface on super-admin `/super/domains`.
- `sites` domain columns: `domain_status` (`none | register_new | transfer | decided_later | active`),
  `requested_domain`, `domain_auth_code`, `domain_notes`, `domain_decided_at`, plus the
  custom-domain-setup columns (`domain_setup_status`, `domain_setup_started_at`,
  `domain_setup_error`, `domain_nameservers`).

## IN PROGRESS — per-site CMS + dynamic serving (migration 00080+, owned by a parallel effort)

A newer direction is being built and is **not yet the live path**; coordinate before touching it:
- `site_admins` table — per-site CMS logins (separate from staff `profiles`) for a future
  `theirdomain.com/admin` editor.
- `sites.published_composition` — the live copy, split from the draft `composition`.
- Dynamic, DB-served sites: `src/app/site/[host]/[[...path]]/route.ts` + `src/lib/platform/*`
  (`hosts.ts`, `resolve-site.ts`) — serving sites from the DB instead of static Cloudflare
  bundles. "Phase 8 cutover" pending.

This is distinct from the old (removed) client self-edit composer mode.

## Key Conventions

- **Server Components** for data-fetching pages (`requireAuth()` / `requireRole()` from `src/lib/auth/guards.ts`).
- **Client Components** only for interactivity.
- **Never** use the service role key in the client bundle — only in `/api/` routes and server components.
- **RLS on every table**; policies use a role helper + `auth.uid()`.
- **Supabase clients**: `createClient()` (browser) `@/lib/supabase/client`; `createClient()` (server)
  `@/lib/supabase/server`; `createAdminClient()` `@/lib/supabase/admin` (bypasses RLS).
- **shadcn/ui** for UI primitives; **sonner** for toasts; **@phosphor-icons/react** for icons.
- **File uploads** go to Supabase Storage (never local FS); the composer also uploads published
  assets directly to Cloudflare at publish time.
- **Website content** lives in `sites.composition` (JSON), rendered server-side — not in GitHub,
  not in `content.json`, not as hand-written HTML.

## Project structure (key paths)

```
src/
  app/
    (auth)/login/                   — Login
    proposal/[slug]/                — Public proposal landing (greeting, live-site link, pay) + paid/ page
    site/[host]/[[...path]]/        — IN PROGRESS: dynamic per-host site serving
    (dashboard)/
      client/                       — dashboard, balance, domain, services, payments/[id]/invoice
      sales/                        — volanie (calling), proposals (+ [id]/composer), active, live-clients, commissions, settings
      tech/                         — dashboard, proposals (+ [id] timeline, [id]/composer), production,
                                       live-clients, clients (legacy), section-templates, settings, sites/[id]/composer
      admin/                        — overview/reporting
      super/                        — proposals, production, sales-overview, it-overview, users, contacts,
                                       live-clients, payments, domains, settings
    api/
      admin/…                       — users, clients (+ [id], credits), migrate-client, commission-rate
      auth/callback/                — Supabase auth callback
      composer/…                    — ai-generate, ai-image, ai-inputs, upload, upload-url, fonts, copywriting-guide
      sites/[id]/…                  — PUT (autosave composition), publish, versions(+revert), lock, subdomain,
                                       credit-balance, site-payment-info, domain(+check), render
      section-templates/…           — section-template library CRUD (+ [id], [id]/preview)
      proposals/…                   — list/create, [id] (+ clone, messages, mark-paid)
      payments/…                    — public/proposals/[slug]/pay, stripe/{create-session,webhook}, qr
      public/…                      — proposals/[slug] (view tracking + data), contact
      contacts/…, reminders/[id]/, email-templates/, notifications/, proposal-tags/, sales/, seed/, upload/, proxy/
  components/
    composer/                       — the composer (see "The Composer")
    proposal-timeline/              — shared proposal timeline UI (tech + sales)
    layouts/                        — sidebar, topbar, dashboard-shell
    payments/                       — site-activation-dialog, etc.
    ui/                             — shadcn/ui
    brand.tsx                       — white-label brand mark
  lib/
    supabase/                       — client, server, admin, middleware
    auth/                           — roles.ts, guards.ts
    composer/                       — composer logic (see above)
    templates/                      — render/publish engine (see above)
    deployment/                     — cloudflare-direct.ts, custom-domain.ts, pages-url.ts
    ai/                             — provider + prompt/image builders
    payments/                       — confirm-proposal-payment.ts, stripe.ts, bysquare.ts, proposal-utils.ts
    platform/                       — IN PROGRESS: hosts.ts, resolve-site.ts
    email.ts                        — Hostinger SMTP + email templates
  types/database.ts                 — table types + enums
  middleware.ts                     — session refresh + role-based routing
supabase/migrations/                — see below
```

## Database

Core tables (after migration 00079, which drops the legacy `change_requests`, `sections`,
and `templates` tables + the `template_id` FK columns):

`profiles, contacts, call_logs, proposals, sites, credit_balances, payments,
credit_transactions, invoices, services, commissions, commission_rates, deployments,
proposal_messages, email_templates, proposal_emails, contact_submissions, client_tasks,
invoice_requests, client_notes, section_templates, site_versions, composer_ai_settings,
ai_generations, proposal_tags, proposal_tag_assignments, staff_notifications,
proposal_reminders, publish_requests, site_admins`

All tables have RLS. Migrations run 00001 → 00080 (note: a few numbers are duplicated across
parallel work, e.g. two 00058/00068/00069/00070/00072). Notable recent ones:
- `00042_template_library.sql` — `section_templates` + `sites.composition`
- `00043–00045` — `site_versions` (+ deployment URL), `sites.subdomain`
- `00050/00051` — `sites.updated_by_role`, edit lock
- `00052/00053/00055/00062` — composer staging buckets + AI
- `00077_publish_requests.sql` — `publish_requests`
- `00079_drop_legacy_content_system.sql` — **drops `change_requests`, `sections`, `templates`** (+ `template_id` FKs). ⚠️ apply only after the code change ships.
- `00080` — per-site CMS: `published_composition`, `site_admins` (IN PROGRESS)

## Contact form for client websites

`contacts.business_email` is captured by sales; deployed sites carry a contact handler that
posts to `POST /api/public/contact`, which emails the client's business inbox (Hostinger SMTP,
reply-to the visitor) and stores a backup row in `contact_submissions`. Spam protection
(honeypot + rate-limit + time check) is built in. **Verify current completeness against the
code before relying on details** (this area pre-dates the cleanup and may be partially built).

## Environment variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Cloudflare Pages (Direct Upload + custom domains)
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=

# Stripe (canonical payments) — exact names in src/lib/payments/stripe.ts
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# AI providers (composer) — exact names in src/lib/ai/provider.ts (OpenAI / Gemini / Groq / Cloudflare)

# BySquare (QR rendering only)
BYSQUARE_IBAN=
BYSQUARE_SWIFT=
BYSQUARE_BENEFICIARY=

# Email (Hostinger SMTP)
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

GitHub deployment env vars (`GITHUB_TOKEN`, `GITHUB_OWNER`) are **no longer used** — deploy is
Cloudflare Direct Upload.

## Important notes

- **One service** — websites for small businesses, built/edited via the composer.
- **No GitHub deploy, no static HTML hand-authoring** — sites render from `sites.composition`
  and upload to Cloudflare Pages Direct Upload.
- **No `content.json`, no inline DOM editor, no cheerio-based client-edit apply, no
  section/template renderer** — all removed.
- **AI generation is active** (composer) — the old "removed due to cost" note is obsolete.
- **Payments are Stripe-first** with a manual mark-paid fallback (not bank-transfer-confirm).
- **Clients can't self-edit today** — staff build/publish via the composer (per-site CMS IN PROGRESS).
- **White-label** — keep Slovakia/SK out of branding, UI, and new code (`src/components/brand.tsx`).
- **Language**: app UI is English; invoices render a localized faktura layout.
- **Currency**: super-admin surfaces relabel to `$` (display-only); real money + client-facing stays EUR.
- **Role separation**: super-admin = oversight; tech-admin = operations.
- **Coordinate** before editing `src/app/site/**`, `src/lib/platform/**`, payment/Stripe code, or
  migration 00080 — a parallel effort is actively building there.
```

When this file disagrees with the code, the code wins — and update this file.
