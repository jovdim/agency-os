# Dynamic Platform — Go-Live Checklist

This is what it takes to put the new self-edit platform (client websites served
live from the DB + per-site `theirdomain.com/admin` editor) onto the real
internet. The **code and the editor are built and tested**; the steps below are
mostly **deployment + DNS**, which only you can do.

---

## ✅ Already done (in code)
- Dynamic serving (a site renders live from `sites.published_composition`).
- Host routing: CRM host vs client-site host (`src/proxy.ts` + `src/lib/platform/*`).
- Per-site login + the full editor mounted at `/admin` (edit text/images, publish).
- DB migration **`00080`** — **already applied to production** (the `published_composition`
  column, the `site_admins` table, indexes).

---

## What YOU need to do for the FIRST real site

The easiest first go-live uses a **subdomain** (e.g. `riverside.sites.youragency.com`).
A client's *own* domain (e.g. `riverside.com`) needs the custom-domain step
(see "Later"), which isn't built yet.

### 1. Deploy the app
The platform is the **same Next.js app** as your dashboard. Deploy this repo to
Vercel (the dashboard and all client sites are served by one deployment — host
routing decides which is which).

### 2. Set environment variables (on Vercel)
| Variable | Value | Why |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | your dashboard URL, e.g. `https://app.youragency.com` | **Required.** Tells the app which host is the CRM vs a client site. If unset, everything is treated as the CRM (fail-safe). |
| `PROPOSAL_DOMAIN` | the domain you hang client subdomains off, e.g. `sites.youragency.com` | A client site lives at `<subdomain>.<PROPOSAL_DOMAIN>`. |
| `PLATFORM_SESSION_SECRET` | a random 32+ char string — generate with `openssl rand -base64 32` | Signs the per-site login cookies. |
| (Supabase vars) | already set | — |

### 3. Point DNS at the platform
- Add a **wildcard domain** `*.<PROPOSAL_DOMAIN>` to the Vercel project
  (Vercel → Project → Domains → add `*.sites.youragency.com`).
- In your DNS, add the wildcard record Vercel asks for (a CNAME for `*` → Vercel).
- Result: `anything.<PROPOSAL_DOMAIN>` reaches the platform, which figures out
  the site from the subdomain.

### 4. Give a site a subdomain + a login
- The site needs a `subdomain` value (e.g. `riverside`). Publishing sets one
  automatically; or set it on the `sites` row.
- Create the client's login:
  ```
  npx tsx scripts/create-site-admin.ts --site <slug> --email client@theirbiz.com
  ```
  It prints a password — send it to the client.

### 5. Test on the real internet
- `https://<subdomain>.<PROPOSAL_DOMAIN>/` → the site, live from the DB.
- `https://<subdomain>.<PROPOSAL_DOMAIN>/admin` → the client logs in and edits.

---

## Later (not needed for the first subdomain go-live)
- **Client's own domain** (`riverside.com` → platform): the custom-domain step
  (Cloudflare for SaaS / custom hostnames). **Not built yet.**
- **Cutover**: moving sites that are currently live on the old static Cloudflare
  hosting onto the platform, one at a time, keeping the old version as rollback.
- **Polish**: hide staff-only buttons (AI / version history / subdomain) from the
  client editor; move uploaded images from the `composer-staging` bucket to a
  permanent home; require a dedicated `PLATFORM_SESSION_SECRET` in prod; move the
  login rate-limiter to a shared store.

---

## One-deployment model (why this is safe)
The dashboard and every client site run from the **one** Vercel deployment.
`src/proxy.ts` inspects the request host:
- the CRM host → the dashboard (unchanged),
- `*.<PROPOSAL_DOMAIN>` or a known client domain → that client's site / `/admin`.
So deploying does **not** change the dashboard; it just additionally answers
client-site hosts once DNS points them at the platform.
