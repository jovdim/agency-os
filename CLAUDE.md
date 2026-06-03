# SK Agency OS — CLAUDE.md

## What this project is

A web agency operating system for Peter's agency in Slovakia. Manages the full lifecycle from cold-call lead to live client website, including CRM, proposals, website building, payments, and invoicing.

## Tech Stack

- **Frontend**: Next.js (App Router), React, Tailwind CSS v4, shadcn/ui, lucide-react, next-themes
- **Backend**: Supabase (PostgreSQL, Auth, Storage)
- **Hosting**: Vercel
- **Deployment Pipeline**: GitHub (Octokit) + Cloudflare Pages (custom subdomain: `*.2dni.sk`)
- **Payments**: BySquare (PAY by square) — Slovak bank QR code standard for bank transfers via IBAN
- **QR Codes**: `bysquare` (encoding) + `qrcode.react` (rendering)
- **HTML Parsing**: cheerio (server-side DOM manipulation for applying client edits)
- **Email**: Nodemailer + Hostinger SMTP (business email)

## 5 User Roles

| Role            | Route prefix | Access                                                                     |
| --------------- | ------------ | -------------------------------------------------------------------------- |
| `client`        | `/client`    | Own sites, change requests, credits, payments                              |
| `sales`         | `/sales`     | CRM contacts, create proposals, review built websites, change subdomain    |
| `tech_admin`    | `/tech`      | Build proposals, upload & deploy, change requests, client creation         |
| `administrator` | `/admin`     | Reporting, contact reassignment, sales overview, production overview       |
| `super_admin`   | `/super`     | Full oversight: proposals, production, sales overview, users, contacts, designs, payments, domains, settings, commission rates |

## Proposal & Deployment Flow

```
1. Sales creates proposal (select contact + company details + requirements)
   → Clicks "Submit to Tech Team" → status = submitted

2. Tech admin sees proposal in build queue (/tech/proposals)
   → Opens build workspace (/tech/proposals/[id]) → status = building
   → Builds website externally (VS Code, Claude Code, etc.)
   → Uploads HTML/CSS/JS/content.json to Supabase Storage
   → Enters custom subdomain (validated for format + uniqueness)
   → Clicks "Deploy" → files pushed to GitHub → Cloudflare Pages → live at subdomain.2dni.sk
   → status = review, deployment record created with deploy_status = "live"

3. Sales reviews the live website (/sales/proposals/[id])
   → Sees Live Website card with URL + subdomain editor
   → Can change subdomain (checks availability, updates Cloudflare DNS)
   → Can "Send to Client" → opens SendProposalDialog
     → Fills Slovak greeting text (pre-filled template)
     → Sets discount price (min €149) + base price (default €299)
     → Clicks "Odoslať email" → sends email via Hostinger SMTP + auto-creates client account + site
     → status = sent, creates 4 follow-up reminders (day 4, 10, 14, 30)
   → Can "Request Revision" → status = revision (goes back to tech admin)

4. Client receives email with proposal link (/proposal/[slug])
   → Sees: greeting, "Pozrieť si webstránku" button, price with 14-day discount countdown
   → Views proposal → status = viewed
   → Pays via BySquare QR (bank transfer) → boss confirms in /super/payments → status = paid
```

**Proposal statuses:** `submitted → building → review → revision → sent → viewed → paid`

(No draft status — proposals submit directly to tech team)

## Proposal Handover (Payment Flow)

### Price Logic
- Default base price: €299, min discount: €149, discount window: 14 days
- Active price = if `now < discount_expires_at` → `discount_price`, else `base_price` (computed at read time)
- Price shown with crossed-out base price during discount window

### Follow-Up Reminders
- Day 4: "Follow-up" — call client about the proposal
- Day 10: "Follow-up" — second reminder
- Day 14: "Discount Expired" — price reverted to base
- Day 30: "Final Follow-up" — cleanup
- All auto-dismissed when client pays
- Shown on sales dashboard with dismiss button

### Email Delivery
- Sent via Hostinger SMTP (nodemailer) on "Send to Client"
- HTML email template with: greeting, website link, price, "Chcem objednať" CTA
- Requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` env vars

### Bank Transfer Payment Confirmation
- Client scans BySquare QR on proposal website → bank transfer with variable symbol (VS)
- SLSP bank sends notification email to boss → auto-forwarded to `paid@2dni.sk`
- Super admin opens `/super/payments` → "Awaiting Payment" tab → searches by VS → clicks "Confirm"
- On confirmation: payment record created, proposal → paid, all reminders dismissed, invoice auto-created
- Variable symbol stored on proposals table when proposal is sent (`variable_symbol` column)
- API: `POST /api/admin/payments/confirm` (super_admin only) — body: `{ proposal_id, amount, note? }`
- Double-confirm prevention: 409 if payment already confirmed for that proposal

## Client Site Management

```
Tech admin creates client account (/tech/clients):
  → Client Info → Website Details (name + slug)
  → Creates: auth user + profile + site + credit_balances
  → No content.json needed — website content lives in the HTML on GitHub

Client dashboard (/client):
  → Sites list with inline website editor
  → Credits page with balance + transaction history
  → Change requests tracker with status tabs
  → Domain management page (/client/domain) — register new, transfer, or decide later
```

## Inline Website Editor (Webflow-Style)

Client edits their website directly on a full-screen preview — click any text to edit, click any image to replace. No panels, no form fields, no content.json.

### How It Works
1. Client opens `/client/sites/[id]/edit` → full-width website preview via proxy
2. Proxy (`/api/proxy-preview?mode=inline-edit`) injects inline editor script
3. Script makes all text/image elements interactive (hover highlight, pencil button, click to edit)
4. Script discovers all pages from the site's own `<a>` links → sends `PAGES_DISCOVERED` to parent
5. Parent shows a **left sidebar** with all pages — click to switch (iframe reloads fresh)
6. All links inside iframe are blocked — navigation only via sidebar
7. Changes tracked in React state with revert capability
8. Submit → change request created → tech admin reviews with visual preview
9. Tech admin approves → HTML in GitHub updated via cheerio → Cloudflare re-deploys

### Element Identification (Dual Strategy)
- **Priority 1**: `data-section` + `data-field` + `data-item` attributes (optional, set by IT guy for robust ID)
- **Priority 2**: CSS path auto-generated by editor script (always works, no setup needed)
- **Conflict safety**: old_value verified against current HTML before applying

### Change Format
```typescript
interface InlineChange {
  file_path: string;        // "index.html", "about.html"
  css_path: string;          // auto-generated CSS selector
  section?: string;          // data-section value (if present)
  field?: string;            // data-field value (if present)
  item_id?: string;          // data-item value (if present)
  action: 'update_text' | 'replace_image';
  old_value: string;
  new_value: string;
}
```

### Tech Admin Review
- `/tech/queue/[id]` shows website preview with changed elements highlighted (orange)
- Toggle between current/proposed values
- Approve/reject per change
- Conflict detection if HTML was modified since client's edit

### Key Files
- `src/lib/inline-editor-script.ts` — vanilla JS injected into iframe (hover, pencil button, edit, page discovery, postMessage)
- `src/lib/apply-html-changes.ts` — cheerio-based HTML updater for applying approved changes
- `src/app/(dashboard)/client/sites/[id]/edit/site-editor-client.tsx` — full-width editor UI with sidebar
- `src/app/(dashboard)/client/sites/[id]/edit/page-sidebar.tsx` — collapsible page list (Framer-style)
- `src/app/(dashboard)/client/sites/[id]/edit/floating-toolbar.tsx` — toolbar near active element
- `src/app/(dashboard)/client/sites/[id]/edit/changes-panel.tsx` — slide-in change tracker with revert
- `src/app/api/proxy-preview/route.ts` — loads site HTML, injects editor/review scripts (no link rewriting)

## Domain Selection Flow

- The blocking DomainWelcomeModal has been removed. Domain selection now happens entirely on the dedicated `/client/domain` page (no first-login interrupt).
- Domain management page (`/client/domain`) for ongoing management
  → Register new domain with availability check (DNS lookup via `/api/sites/[id]/domain/check`)
  → Transfer existing domain with EPP auth code
- Domain requests appear on super admin `/super/domains` page
  → Super admin can approve (sets `domain_status: 'active'`) or add notes
- Domain statuses: `none → register_new/transfer/decided_later → active`

### Domain Database Columns (on sites table)
- `domain_status`: 'none', 'register_new', 'transfer', 'decided_later', 'active'
- `requested_domain`: the domain name requested
- `domain_auth_code`: EPP code for transfers
- `domain_notes`: admin notes
- `domain_decided_at`: timestamp

## Key Conventions

- **Server Components** for all data-fetching pages (use `requireAuth()` or `requireRole()`)
- **Client Components** only for interactivity (forms, dialogs, realtime updates)
- **Never use service role key in client bundle** — only in `/api/` routes and server components
- **RLS on every table** — policies use `get_my_role()` SQL helper + `auth.uid()`
- **Supabase clients**: `createClient()` from `@/lib/supabase/client` (browser) or `@/lib/supabase/server` (server), `createAdminClient()` from `@/lib/supabase/admin` (API routes + server components that need to bypass RLS)
- **shadcn/ui** for all UI components — do not create custom UI primitives
- **Toast notifications** via `sonner` (already in layout)
- **File uploads** go to Supabase Storage — never the local filesystem
- **Website files** (HTML/CSS/JS) stored in GitHub repos, NOT in database
- **No templates** — tech admin builds each website from scratch externally
- **No AI generation** — removed due to cost

## Project Structure (key paths)

```
src/
  app/
    (auth)/login/                — Public login page
    (public)/proposal/[slug]/    — Public sales landing page (greeting, website link, QR payment, decline)
    (dashboard)/                 — Protected shell layout
      client/                    — Client role pages
        sites/                   — Sites list + [id] detail + [id]/edit site editor (with payment gate)
        domain/                  — Domain management page (register, transfer, availability check)
        unpaid-payment-reminder.tsx — Expandable QR + bank-info card shown on /client when site.is_paid = false. Reads the same proposals.qr_image_cache columns as the deployed-site banner widget so price/QR updates cascade to both surfaces.
        requests/                — Change request tracker (all sites)
        credits/                 — Credit balances + transaction history
        payments/[id]/invoice/   — Printable invoice (Slovak faktura format)
        services/                — Services page
        designs/                 — Design library browser
      sales/                     — Sales role pages
        contacts/                — CRM contacts (list, new, [id] detail, import CSV)
        proposals/               — Proposal list + new (wizard) + [id] detail (review/send dialog/subdomain)
      tech/                      — Tech admin pages
        proposals/               — Build queue + [id] build workspace (upload + deploy + subdomain)
        builds/                  — Site build queue (queued/building/live)
        queue/                   — Change request queue + [id] review (approve/reject)
        sites/[id]/              — 3-panel site editor (sections, fields, preview)
        designs/                 — Design library
        clients/                 — Client creation (3-step) + management (re-sync content, credits)
      admin/                     — Administrator pages
        contacts/                — Contact reassignment
        sales-overview/          — Sales performance overview
        reports/                 — Reports
        production/              — Production overview
      super/                     — Super admin pages (full oversight of everything)
        proposals/               — All proposals pipeline (all salespersons, all statuses)
        production/              — All live sites with owner, domain, paid status, revenue
        sales-overview/          — Per-salesperson metrics (proposals, acceptance rate, revenue, commission)
        users/                   — User management (create/list/activate/deactivate)
        contacts/                — Batch contact assignment
        designs/                 — Design library (same as tech admin)
        payments/                — Revenue overview + payment history
        domains/                 — Domain management + pending domain requests
        settings/                — System status, commission rate config, seed templates
    api/
      admin/users/               — POST: create user (service role)
      admin/clients/             — POST: create client + site + sections + credits
      admin/clients/[id]/        — GET/PUT client info
      admin/clients/[id]/content/— GET: export content.json, PUT: re-sync sections
      admin/clients/[id]/credits/— POST: grant credits
      admin/payments/confirm/    — POST: confirm bank transfer payment (super_admin)
      auth/callback/             — Supabase auth callback
      change-requests/           — POST: submit, GET: list
      change-requests/[id]/      — GET + PUT: approve/reject change request
      sites/[id]/                — GET/PUT site + sections/[sectionId] PUT
      render/site/[id]/          — GET: render site HTML from sections
      render/[id]/               — GET: render template preview
      public/proposals/[slug]/   — Public proposal actions (view tracking)
      public/designs/            — Public design library API
      proposals/                 — GET: list, POST: create proposal (status = submitted)
      proposals/[id]/            — GET/PUT: proposal detail + status transitions
      proposals/[id]/clone/      — POST: clone a proposal
      proposals/[id]/messages/   — GET/POST: proposal messages (sales ↔ tech)
      contacts/[id]/client-account/ — POST: create client from contact
      deploy/                    — POST: deploy to GitHub + Cloudflare Pages (with subdomain)
      deploy/status/[id]/        — GET: deployment status polling
      deploy/check-subdomain/    — GET: check subdomain availability (?subdomain=x&exclude_id=y)
      deploy/subdomain/          — PUT: change subdomain on existing deployment
      upload/                    — POST: file upload to Supabase Storage
      sites/[id]/domain/         — GET/PUT: domain status + selection for a site
      sites/[id]/domain/check/   — GET: domain availability check (DNS lookup)
      admin/commission-rate/     — PUT: set commission rate per salesperson
      reminders/[id]/            — PUT: dismiss a follow-up reminder
      templates/                 — CRUD templates (legacy, not used in proposal flow)
      seed/templates/            — POST: seed starter templates
      seed/reset/                — POST: reset seed data
  components/
    layouts/                     — sidebar, topbar, dashboard-shell
    dashboard/                   — section-sidebar, section-editor, gallery-editor, site-preview
    ui/                          — shadcn/ui components
    proposal-progress.tsx        — Proposal status progress tracker
    proposal-messages.tsx        — Proposal message thread
    theme-provider.tsx           — Theme context provider
    theme-toggle.tsx             — Dark/light mode toggle
  lib/
    supabase/                    — client, server, admin, middleware
    auth/roles.ts                — role hierarchy, route mapping, getDefaultRoute()
    auth/guards.ts               — requireAuth(), requireRole()
    section-registry.ts          — 14 section type definitions (hero, about, services, etc.)
    template-renderer.ts         — HTML template rendering engine
    payments/proposal-utils.ts   — Price computation, discount window, reminder schedule
    email.ts                     — Hostinger SMTP email sending + proposal email HTML template
    deployment/github.ts         — GitHub repo creation + file push (Octokit)
    deployment/cloudflare.ts     — Cloudflare Pages project + custom domain + updateCustomDomain()
    deployment/pipeline.ts       — deployWebsite() + redeployWebsite() orchestration
    deployment/subdomain.ts      — validateSubdomainFormat() + checkSubdomainAvailability()
  types/
    database.ts                  — Supabase table types + UserRole enum
    content.ts                   — ContentSection, FieldChange types
  middleware.ts                  — Session refresh + role-based routing
supabase/
  migrations/
    00001_initial_schema.sql     — Full DB schema (15 tables, enums, RLS, triggers)
    00002_fix_role_in_app_metadata.sql
    00003_template_content_schema.sql
    00004_credit_deduction_trigger.sql — Credit triggers + template_id on sites
    00005_ai_generation_and_deployment.sql — Deployments table
    00006_remove_ai_add_proposal_workflow.sql — Remove AI columns, add requirements/feedback/built_by
    00007–00010 — Contacts columns, proposal messages, client account columns
    00011_proposal_handover.sql — Payment handover: proposal pricing, payment links, reminders table, paid status
    00012_sales_commissions.sql — commission_rates table + rate/type columns on commissions
    00019_unpaid_accounts_and_domains.sql — is_paid on sites, domain columns, client_temp_password on proposals
```

## Database (17 tables)

profiles, contacts, call_logs, templates, proposals, sites, sections,
change_requests, credit_balances, credit_transactions, payments, invoices,
services, commissions, commission_rates, deployments, **proposal_reminders**

All tables have RLS. See `supabase/migrations/00001_initial_schema.sql` for full schema.

## What is DONE

- Next.js project with Tailwind v4, shadcn/ui, TypeScript
- Supabase client helpers (browser, server, admin, middleware)
- Full database schema — 16 tables, all enums, RLS policies, triggers, JWT hook
- Root middleware — session refresh + role-based route protection
- Dashboard shell layout — role-aware sidebar + topbar
- Auth: login page, logout, session handling, callback route
- All 5 role home pages with live Supabase data queries
- Theme toggle (dark/light)
- CRM contacts: list, create, detail, CSV import, reassignment (admin + super)
- Sales proposal wizard: select contact → company details → services → requirements → submit to tech team
- Sales proposal list with status filters
- Sales proposal detail: review live website, approve/send to client, request revision, change subdomain
- Public proposal page with view tracking
- Proposal messaging (sales ↔ tech)
- Tech admin: proposal build queue + build workspace (upload files + enter subdomain + deploy)
- Tech admin: client creation (3-step: info → website details → paste content.json)
- Tech admin: client management (re-sync content.json, grant credits, manage sites)
- Tech admin: change request queue + review (approve/reject)
- Tech admin: site editor (3-panel: sections, fields, preview)
- Tech admin: design library
- Tech admin: site build queue
- Client: sites list + detail with change request form
- Client: site editor (sections + fields)
- Client: change requests tracker with status tabs
- Client: credits page with per-site balances + transaction history
- Client: domain welcome modal (first login — register new, transfer, or decide later)
- Client: domain management page (/client/domain) with availability checking (DNS lookup)
- Printable invoice page (Slovak faktura format)
- Super admin: full oversight dashboard with proposal pipeline, action items, system status
- Super admin: proposals page (all proposals across all salespersons, grouped by status)
- Super admin: production page (all live sites with owner, domain, paid status, revenue, search/filter)
- Super admin: sales overview (per-salesperson metrics: proposals, acceptance rate, revenue, commission)
- Super admin: design library (same as tech admin)
- Super admin: user management (create/list/activate/deactivate)
- Super admin: payments overview + payment history
- Super admin: domains page (pending domain requests + all deployments)
- Super admin: settings (system status, commission rate config per salesperson, seed templates)
- Super admin: commission rate settings (default 10%, stored in commission_rates table)
- Deployment pipeline: GitHub (Octokit) → Cloudflare Pages → custom subdomain (*.2dni.sk)
- Custom subdomain input on deploy (format validation + uniqueness check)
- Subdomain change API (sales can change after deployment, updates Cloudflare DNS)
- Admin: contact reassignment, sales overview, reports, production overview
- Proposal Handover: SendProposalDialog (greeting + price), email delivery via Hostinger SMTP
- Proposal Handover: public sales landing page with pricing + 14-day discount countdown
- Proposal Handover: auto-creates client account + site on send
- Proposal Handover: follow-up reminders on sales dashboard (day 4/10/14/30) with dismiss
- Proposal Handover: proposal_reminders table + reminders API
- Bank transfer payment confirmation: super admin confirms payments via VS matching → auto-creates payment record, invoice, dismisses reminders
- BySquare QR code integration: proposal widget injection + client credits buy dialog

## Contact Form for Client Websites (NOT BUILT YET)

Each deployed client website has a contact form. When a visitor fills it, the message goes to the client's business email.

### Architecture
- **Shared script**: `public/contact-handler.js` on Vercel (same pattern as `proposal-widget.js`)
- **API endpoint**: `POST /api/public/contact` on Vercel
- **Email sender**: Hostinger SMTP (nodemailer, already configured) — `info@sharkmedia.sk` sends on behalf of all sites
- **Backup storage**: `contact_submissions` table in Supabase
- **New DB field**: `business_email` column on `contacts` table — sales fills this when creating the contact

### Full Flow
1. **Sales creates proposal** → fills contact info including new **"Business email"** field (e.g. `info@balkar.sk`)
2. **Tech admin builds & deploys** the website — contact form in HTML must have `id="contact-form"`
3. **Sales clicks "Send to Client"** → deploy pipeline auto-injects both scripts:
   - `proposal-widget.js` (payment banner — already working)
   - `contact-handler.js` with `data-email="info@balkar.sk"` (pulled from `business_email` in DB)
4. **Site goes live** at `balkar.2dni.sk` — contact form works automatically, no extra setup
5. **Visitor fills contact form** → `contact-handler.js` sends `fetch()` to `/api/public/contact`
6. **API sends email**:
   - **From:** `info@sharkmedia.sk` (your Hostinger SMTP)
   - **To:** `info@balkar.sk` (client's business email from `data-email`)
   - **Reply-To:** `visitor@gmail.com` (the person who filled the form)
   - **Subject:** "Nová správa z vašej webstránky"
   - **Body:** visitor's name, email, phone, message
7. **Submission stored** in `contact_submissions` table as backup
8. **Client receives email** in business inbox → hits reply → goes straight to visitor

### Email Change
- Update `business_email` in dashboard → redeploy → new email injected automatically
- OR edit HTML directly in GitHub repo (change `data-email` attribute)

### Scalability
- Hostinger SMTP: ~500-1000 emails/day (fine for early stage)
- At scale: swap to Resend/SendGrid/Amazon SES — same code, just change SMTP config
- Supabase stores all submissions as backup (no data loss if email fails)
- Vercel free: 100k invocations/month. Pro ($20/mo): 1M invocations

### Spam Protection (built into contact-handler.js + API)
1. **Honeypot field** — hidden input added by the script. Bots fill it, humans don't. If filled → API rejects silently.
2. **Rate limiting** — API blocks more than 3 submissions per IP per hour.
3. **Time check** — script records timestamp when form loads. If submitted in under 2 seconds → bot. API rejects.
4. **Future (if needed):** Cloudflare Turnstile (free, one click max, already on Cloudflare)

All three methods are invisible to users — no captcha, no puzzles, no friction.

### What Needs to Be Built
1. Add `business_email` column to `contacts` table (Supabase migration)
2. Add "Business email" field to sales contact/proposal forms
3. `public/contact-handler.js` — shared script (finds `#contact-form`, handles submit, success/error UI)
4. `POST /api/public/contact` — API endpoint (validate, send email via Hostinger SMTP, store in Supabase)
5. `contact_submissions` table — Supabase migration (to, name, email, phone, message, site_id, created_at)
6. Update `proposal-injection.ts` → also inject contact handler script with `data-email` from `business_email`

## What is NOT DONE

- Contact form for client websites (see section above)
- Commission auto-calculation on payment confirmation (rates are configured, but not auto-applied to payments yet)
- Supabase Realtime notifications
- Additional email notifications (beyond proposal sending — e.g., payment confirmations, reminders)
- Mobile responsiveness audit
- File uploads in change requests (image fields)
- Client service expiry dates
- Client "Change Design" feature
- WhatsApp/SMS proposal sending
- "Potrebujem úpravy" (client edits before payment)
- WHMCS integration for domain registration/transfer (currently manual via super admin)

## Environment Variables Required

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# GitHub Deployment
GITHUB_TOKEN=                    # GitHub PAT with repo scope
GITHUB_OWNER=                    # GitHub username or org name

# Cloudflare Pages
CLOUDFLARE_API_TOKEN=            # Cloudflare API token (Pages + DNS permissions)
CLOUDFLARE_ACCOUNT_ID=

# BySquare (PAY by square) — Slovak bank QR payments
BYSQUARE_IBAN=                   # Company IBAN (no spaces)
BYSQUARE_SWIFT=                  # Bank SWIFT/BIC code
BYSQUARE_BENEFICIARY=            # Company name on transfer

# Email (Hostinger SMTP)
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=                       # Hostinger business email (e.g. info@yourdomain.sk)
SMTP_PASS=                       # Email password
SMTP_FROM=                       # Display name + email (e.g. "Shark Media <info@yourdomain.sk>")
```

## Important Notes

- **No templates in proposal flow** — tech admin builds each website from scratch externally
- **No AI generation** — removed due to cost
- **No draft status** — proposals submit directly to tech team
- **Websites**: Plain HTML/CSS/JS (NOT React)
- **No content.json** — website content lives directly in the HTML. GitHub is the single source of truth.
- **`data-field` required** — every editable element has `data-field` attribute (like Webflow/WordPress)
- **Inline editing** — client edits directly on the website preview (Webflow-style), no form fields
- **cheerio** — used server-side to parse and modify HTML when applying approved changes
- **CSS custom properties** — theming via `:root` variables in style.css (no config.json)
- **No GSAP** — CSS animations + IntersectionObserver only
- **Subpages in root** — not in `/pages/` directory (better SEO)
- **See `website-structure-rules.md`** for complete AI website building guide
- **Payments**: BySquare QR codes for bank transfers (IBAN). Payment tracking is manual (check bank statement, match variable symbol).
- **Email**: Sent via Hostinger SMTP (nodemailer). Proposal emails sent on "Send to Client" action.
- **Invoices**: Slovak proforma + legal invoice format
- **Deployment**: GitHub repo + Cloudflare Pages with custom subdomain (subdomain.2dni.sk)
- **Subdomain**: Tech admin sets on first deploy, sales can change after deployment
- **No data migration** from v1 — fresh start
- **Language**: App UI is English, invoice content is Slovak
- **Role separation**: Super admin = oversight. Tech admin = operations. They don't mix.
