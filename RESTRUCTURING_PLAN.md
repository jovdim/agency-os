# SK Agency OS — Restructuring Plan

> Created: 2026-03-08
> Status: IN PROGRESS

## Overview

Removing the AI website builder (too expensive to run) and restructuring the entire proposal/build workflow. The system moves from "AI generates websites" to "Tech admin builds websites externally and uploads them."

---

## New Architecture

### Proposal & Website Build Flow

```
Sales Person                    Tech Admin                     Client
    |                               |                            |
    |  1. Creates proposal           |                            |
    |     (client info, requirements)|                            |
    |                               |                            |
    |  2. Submits to tech admin ---->|                            |
    |     (status: submitted)        |                            |
    |                               |  3. Receives build request  |
    |                               |     Can clone existing      |
    |                               |     design or start fresh   |
    |                               |                            |
    |                               |  4. Builds website          |
    |                               |     externally (Claude Code,|
    |                               |     VS Code, etc.)          |
    |                               |                            |
    |                               |  5. Uploads HTML/CSS/JS +   |
    |                               |     content.json            |
    |                               |     -> Pushed to GitHub     |
    |                               |     -> Auto-deploy to       |
    |                               |        Cloudflare Pages     |
    |                               |     -> Custom subdomain     |
    |                               |        (name.2ind.sk)       |
    |                               |                            |
    |  6. Reviews live website <-----|                            |
    |     (status: review)           |                            |
    |                               |                            |
    |  7a. Approves -> sends to      |                            |
    |      client (status: sent)     |                            |
    |  7b. Sends feedback ---------->|                            |
    |      (status: revision)        |  8. Fixes & redeploys      |
    |      (back to step 6)          |                            |
    |                               |                            |
    |                               |                            | 9. Client views proposal
    |                               |                            |    (public link)
    |                               |                            |
    |                               |                            | 10. Accepts -> site created
    |                               |                            |     in client dashboard
    |                               |                            |
    |                               |                            | 11. Submits change requests
    |                               |  12. Processes changes <----|    (1 credit each)
    |                               |      approves/rejects       |
```

### Proposal Status Flow

```
draft -> submitted -> building -> review -> sent -> viewed -> accepted
                          |          |                          |
                          |          +-> revision (back to      +-> declined
                          |              building)
                          +-> (tech admin picks it up)
```

### Design Library

- Every completed proposal/build becomes a reusable **design** in the tech admin's library
- Tech admin can **clone** any previous design as a starting point for new proposals
- Clients can request a **design change** — browse available designs and request a swap

---

## Role Responsibilities (After Restructuring)

| Role | Route | Responsibilities |
|------|-------|-----------------|
| **Super Admin** | `/super` | User management (all roles), system-wide reporting, payment overview, audit log, system settings — **NO tech/build stuff** |
| **Tech Admin** | `/tech` | Build queue (proposals to build), website uploads & deployment, change request processing, client account creation, design library, site editor |
| **Administrator** | `/admin` | Contact reassignment, sales performance metrics, reporting overview |
| **Sales** | `/sales` | CRM contacts, create proposals (info only), review built websites, submit feedback, commissions |
| **Client** | `/client` | View sites, submit change requests (section edits), request design change, credits, payments |

### What Moves Between Roles

| Feature | From | To | Notes |
|---------|------|----|-------|
| Template/design management | Super Admin | Tech Admin | Tech admin manages the design library |
| Client creation | Super Admin | Tech Admin | Tech admin creates client accounts when sites go live |
| Build monitoring | Super Admin | Tech Admin | Super admin only sees high-level stats |
| Template seeding | Super Admin | Tech Admin | Tech admin seeds starter templates |

### Super Admin — Clean Scope

- `/super` — Dashboard with system-wide stats (total users, revenue, sites, etc.)
- `/super/users` — User management (create/list/activate/deactivate ALL roles)
- `/super/payments` — Revenue overview, payment history
- `/super/contacts` — Batch contact assignment to sales people
- `/super/audit` — (Future) Audit log viewer
- **REMOVED**: `/super/templates` — moves to tech admin

### Tech Admin — Expanded Scope

- `/tech` — Dashboard with build queue stats, pending requests, recent deployments
- `/tech/queue` — Change request queue (pending/approved/rejected)
- `/tech/queue/[id]` — Review & process individual change request
- `/tech/builds` — Build queue: proposals waiting to be built + in-progress + completed
- `/tech/builds/[id]` — Build workspace: upload files, deploy, manage
- `/tech/sites/[id]` — 3-panel site editor (sections, fields, preview)
- `/tech/designs` — Design library: all completed builds, reusable as templates
- `/tech/clients` — Create client accounts (when proposal accepted)
- **REMOVED**: `/tech/flagged` — no more AI flagging

---

## What Gets REMOVED

### AI Code (Delete Entirely)

| Path | Description |
|------|-------------|
| `src/lib/ai/generator.ts` | AI website generator (Claude API) |
| `src/lib/ai/types.ts` | AI generation types |
| `src/lib/ai/content-generator.ts` | Content.json generator |
| `src/lib/ai/section-prompts.ts` | 14 section design prompts |
| `src/lib/ai/industry-presets.ts` | 10 industry presets |
| `src/lib/ai/assembler.ts` | HTML/CSS/JS assembler |
| `src/lib/ai/script-template.ts` | Animation script template |
| `src/app/api/ai/generate/route.ts` | AI generation API endpoint |
| `src/app/api/proposals/[id]/replace-template/route.ts` | Template replacement for AI |
| `src/app/(dashboard)/sales/proposals/new/ai-proposal-wizard.tsx` | AI proposal wizard |
| `src/app/(dashboard)/sales/proposals/new/proposal-mode-toggle.tsx` | AI/Template toggle |
| `src/app/(dashboard)/tech/flagged/page.tsx` | Flagged AI queue |
| `src/app/(dashboard)/tech/flagged/[id]/page.tsx` | Flagged AI review |
| `src/app/(dashboard)/tech/flagged/[id]/flagged-review-client.tsx` | Flagged AI review client |

### Database Columns to Remove (New Migration)

**From `proposals` table:**
- `generation_method` (TEXT)
- `ai_generated_html` (TEXT)
- `ai_generation_status` (TEXT)
- `ai_generation_error` (TEXT)
- `flagged_for_review` (BOOLEAN)
- `flagged_at` (TIMESTAMPTZ)

**From `sites` table:**
- `deployment_id` (UUID FK) — deployments will reference sites, not vice versa

**Indexes to drop:**
- `idx_proposals_flagged`

### NPM Dependencies to Remove

- `@anthropic-ai/sdk` — Claude API client
- `jsonrepair` — Used in AI content extraction

### Environment Variables to Remove

- `ANTHROPIC_API_KEY`

---

## What Gets KEPT

### Deployment Pipeline (Modified Trigger)

| Path | Status | Notes |
|------|--------|-------|
| `src/lib/deployment/github.ts` | KEEP | GitHub repo creation + file push |
| `src/lib/deployment/cloudflare.ts` | KEEP | Cloudflare Pages + custom domain |
| `src/lib/deployment/pipeline.ts` | MODIFY | Trigger from tech admin upload instead of AI |
| `src/app/api/deploy/route.ts` | MODIFY | Called by tech admin after file upload |
| `src/app/api/deploy/status/[id]/route.ts` | KEEP | Deployment status polling |
| `deployments` table | KEEP | Tracks GitHub repo, Cloudflare project, subdomain, status |

### Environment Variables to Keep

- `GITHUB_TOKEN` — Still needed for deployment
- `GITHUB_OWNER` — Still needed for deployment
- `CLOUDFLARE_API_TOKEN` — Still needed for deployment
- `CLOUDFLARE_ACCOUNT_ID` — Still needed for deployment

---

## What Gets ADDED/MODIFIED

### New Features

1. **Tech Admin Build Workspace** (`/tech/builds/[id]`)
   - View proposal details (client info, requirements from sales)
   - Upload website files (HTML, CSS, JS, content.json)
   - Files pushed to GitHub automatically
   - Deploy to Cloudflare Pages
   - Clone from existing design option
   - Preview deployed site

2. **Design Library** (`/tech/designs`)
   - All completed builds listed as reusable designs
   - Clone button → creates copy for new proposal
   - Preview any design
   - Tag/categorize designs by industry

3. **Sales Feedback System**
   - Sales reviews built website (live preview)
   - "Request Revision" button with feedback notes
   - Proposal goes back to tech admin with feedback
   - Feedback history visible to both roles

4. **Client Design Change**
   - "Change Design" option in client site detail
   - Browse available designs from the library
   - Submit design change request (costs credits or separate flow)
   - Tech admin processes the design swap

5. **Tech Admin Client Creation** (`/tech/clients`)
   - Create client user accounts
   - Triggered when proposal is accepted and site needs setup

### Modified Proposal API

**New proposal fields needed:**
- `requirements` (TEXT) — Sales person's notes on what client wants
- `feedback` (TEXT) — Sales person's revision feedback
- `built_by` (UUID FK) — Tech admin who built it

**New proposal statuses:**
- `submitted` — Sales sent to tech admin
- `building` — Tech admin working on it
- `review` — Built, waiting for sales review
- `revision` — Sales requested changes

### Modified Files

| File | Changes |
|------|---------|
| `src/types/database.ts` | Remove AI types, add new proposal statuses/fields |
| `src/app/api/proposals/route.ts` | Remove AI logic, add submitted/building flow |
| `src/app/api/proposals/[id]/route.ts` | Remove AI column updates, add feedback flow |
| `src/app/api/render/[id]/route.ts` | Remove AI HTML branch, keep template rendering |
| `src/app/(dashboard)/tech/page.tsx` | Remove flagged AI card, add build queue stats |
| `src/app/(dashboard)/sales/proposals/new/page.tsx` | Remove mode toggle, template wizard only |
| `src/app/(dashboard)/sales/proposals/proposal-list-client.tsx` | Update for new statuses |
| `src/app/(dashboard)/sales/proposals/[id]/page.tsx` | Add review/feedback UI |
| `package.json` | Remove AI dependencies |
| `.env.example` | Remove ANTHROPIC_API_KEY |
| `CLAUDE.md` | Update to reflect new architecture |

---

## Implementation Phases

### Phase A — AI Removal & Cleanup
- [x] Delete `src/lib/ai/` directory (7 files)
- [ ] Delete AI API route (`src/app/api/ai/generate/`)
- [ ] Delete replace-template route (`src/app/api/proposals/[id]/replace-template/`)
- [ ] Delete flagged pages (`src/app/(dashboard)/tech/flagged/`)
- [ ] Delete AI proposal wizard + mode toggle
- [ ] Remove AI types from `src/types/database.ts`
- [ ] Remove AI logic from proposal API routes
- [ ] Remove AI rendering branch from render API
- [ ] Remove `@anthropic-ai/sdk` and `jsonrepair` from package.json
- [ ] Remove `ANTHROPIC_API_KEY` from .env.example
- [ ] Clean up tech admin dashboard (remove flagged card)

### Phase B — Database Migration
- [ ] Create migration `00006_remove_ai_add_proposal_workflow.sql`
  - Drop AI columns from proposals
  - Drop `deployment_id` from sites (keep deployments table separate)
  - Drop `idx_proposals_flagged` index
  - Add `requirements` column to proposals
  - Add `feedback` column to proposals
  - Add `built_by` column to proposals
  - Update proposal status enum/check to include new statuses
  - Update RLS policies for tech admin build access

### Phase C — New Proposal Flow
- [ ] Update proposal creation API (sales submits with requirements)
- [ ] Tech admin build queue page (`/tech/builds` updated)
- [ ] Tech admin build workspace (`/tech/builds/[id]`)
- [ ] File upload → GitHub → Cloudflare deploy flow
- [ ] Sales review page (preview + approve/feedback)
- [ ] Feedback submission API
- [ ] Update proposal list/detail for new statuses

### Phase D — Role Restructuring
- [ ] Move template management from `/super/templates` to `/tech/designs`
- [ ] Add client creation to tech admin (`/tech/clients`)
- [ ] Clean up super admin pages (remove tech-related features)
- [ ] Update sidebar navigation for all roles
- [ ] Update role permissions/guards

### Phase E — Design Library & Client Design Change
- [ ] Design library page (`/tech/designs`)
- [ ] Clone design functionality
- [ ] Client "Change Design" feature
- [ ] Design change request flow

### Phase F — Final Cleanup
- [ ] Update CLAUDE.md with new architecture
- [ ] Update memory files
- [ ] Verify all role dashboards work correctly
- [ ] Test complete flow: sales → tech → deploy → sales review → client

---

## Tracking

| Phase | Status | Started | Completed |
|-------|--------|---------|-----------|
| A — AI Removal | DONE | 2026-03-08 | 2026-03-08 |
| B — DB Migration | DONE | 2026-03-08 | 2026-03-08 |
| C — Proposal Flow | DONE | 2026-03-08 | 2026-03-08 |
| D — Role Restructure | DONE | 2026-03-08 | 2026-03-08 |
| E — Design Library | DONE (basic) | 2026-03-08 | 2026-03-08 |
| F — Final Cleanup | DONE | 2026-03-08 | 2026-03-08 |
