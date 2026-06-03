"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  AtSign,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  MapPin,
  Megaphone,
  MessageCircle,
  Phone,
  RotateCcw,
  Send,
  Settings,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import {
  type DomainSetupStatus,
  isInProgress as isDomainSetupInProgress,
  statusLabel as domainStatusLabel,
} from "@/lib/deployment/custom-domain";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ProposalMessages } from "@/components/proposal-messages";
import { BusinessEmailDialog } from "./business-email-dialog";
// Types + deriveSteps live in their own non-client module so the server
// component (page.tsx) can call deriveSteps without crossing the
// "use client" boundary. Re-exported here for backwards compatibility
// with anything that was importing them from this file.
import type {
  StepId,
  StepState,
  TimelineStep,
  TimelineProposal,
  TimelineSite,
  TimelineRole,
} from "./timeline-steps";

export type {
  StepId,
  TimelineStep,
  TimelineProposal,
  TimelineSite,
  TimelineRole,
} from "./timeline-steps";
export { deriveSteps } from "./timeline-steps";

// The two sales-only dialogs are dynamic-imported to keep them out of
// the tech-side bundle (they pull in the rich-text editor + template
// pickers — not free). Both ssr:false because their inner components
// rely on browser APIs / Radix popovers that hydrate awkwardly on first
// paint.
import dynamic from "next/dynamic";
const SendProposalDialog = dynamic(
  () => import("./send-proposal-dialog").then((m) => m.SendProposalDialog),
  { ssr: false, loading: () => null },
);
const SendProposalWhatsAppDialog = dynamic(
  () =>
    import("./send-proposal-whatsapp-dialog").then(
      (m) => m.SendProposalWhatsAppDialog,
    ),
  { ssr: false, loading: () => null },
);
const FollowUpWhatsAppDialog = dynamic(
  () =>
    import("./follow-up-whatsapp-dialog").then(
      (m) => m.FollowUpWhatsAppDialog,
    ),
  { ssr: false, loading: () => null },
);
const FollowUpEmailDialog = dynamic(
  () => import("./follow-up-email-dialog").then((m) => m.FollowUpEmailDialog),
  { ssr: false, loading: () => null },
);
// Banner config + disable dialogs — launched from the
// Send-to-client step. Dynamic-imported so they don't ship in
// the tech-side bundle on first paint (sales is the primary
// caller; tech rarely flips the banner).
const BannerConfigDialog = dynamic(
  () =>
    import("./banner-config-dialog").then((m) => m.BannerConfigDialog),
  { ssr: false, loading: () => null },
);
const BannerDisableDialog = dynamic(
  () =>
    import("./banner-disable-dialog").then((m) => m.BannerDisableDialog),
  { ssr: false, loading: () => null },
);

interface TimelineProps {
  proposal: TimelineProposal;
  site: TimelineSite | null;
  steps: TimelineStep[];
  currentUserId: string;
  /** @default "tech_admin" */
  role?: TimelineRole;
  /**
   * Optional slot rendered in the header's right-hand cluster.
   * Server pages pass action buttons here (e.g. MarkAsPaidLauncher)
   * so they sit next to the company name + back arrow without us
   * having to teach the timeline about every page-level action.
   */
  headerActions?: React.ReactNode;
  /**
   * Optional full-width slot rendered between the header and the main
   * grid. Used for the client publish-request approval card, which
   * only appears when a client is waiting for IT to approve a publish.
   */
  banner?: React.ReactNode;
}

/* ─────────────────────────────────────────────────────────────
   Visual helpers
   ───────────────────────────────────────────────────────────── */

function fmtDate(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

function statusBadgeVariant(status: string): "default" | "secondary" | "outline" {
  switch (status) {
    case "paid":
      return "default";
    case "sent":
    case "viewed":
    case "review":
      return "secondary";
    default:
      return "outline";
  }
}

/**
 * Per-role URL prefix so the composer link + back arrow point to
 * the correct dashboard. Each role keeps its own /<role>/proposals
 * subtree so middleware role-gates (proxy.ts → canAccessRoute) keep
 * working without a mid-tree exception.
 */
function routesForRole(role: TimelineRole) {
  const prefix = role === "sales" ? "/sales" : "/tech";
  return {
    list: `${prefix}/proposals`,
    composer: (proposalId: string) => `${prefix}/proposals/${proposalId}/composer`,
  };
}

/* ─────────────────────────────────────────────────────────────
   Main component
   ───────────────────────────────────────────────────────────── */

export function ProposalTimeline({
  proposal,
  site,
  steps,
  currentUserId,
  role = "tech_admin",
  headerActions,
  banner,
}: TimelineProps) {
  const routes = routesForRole(role);
  return (
    <div className="max-w-7xl mx-auto p-4 lg:p-6 space-y-4">
      <Header
        proposal={proposal}
        role={role}
        listHref={routes.list}
        actions={headerActions}
      />

      {/* Attention slot — e.g. the client publish-request approval card.
          Sits full-width between the header and the workflow grid so a
          pending request is the first thing IT sees on the page. */}
      {banner}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <TimelineList
            proposal={proposal}
            site={site}
            steps={steps}
            role={role}
            composerHref={routes.composer(proposal.id)}
          />
        </div>

        <div className="lg:col-span-2 space-y-4">
          <SalesContextSidebar proposal={proposal} />
          <MessagesCard
            proposalId={proposal.id}
            currentUserId={currentUserId}
            role={role}
          />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Header
   ───────────────────────────────────────────────────────────── */

function Header({
  proposal,
  role,
  listHref,
  actions,
}: {
  proposal: TimelineProposal;
  role: TimelineRole;
  listHref: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <Link
          href={listHref}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold truncate">
            {proposal.company_name}
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant={statusBadgeVariant(proposal.status)} className="capitalize">
              {proposal.status}
            </Badge>
            {/* Hide the "Salesperson: ..." attribution when the viewer
                IS the salesperson — they don't need to be told their
                own name. Tech still sees it so they know who to ping. */}
            {role !== "sales" && proposal.sales?.full_name && (
              <span className="text-xs text-muted-foreground">
                Salesperson: {proposal.sales.full_name}
              </span>
            )}
          </div>
        </div>
      </div>
      {/* Page-level actions slot — server pages pass things like
          MarkAsPaidLauncher here so the buttons sit in the natural
          top-right cluster without coupling the timeline to specific
          actions. Empty `actions` collapses to nothing (no slot
          stays on the page). */}
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Vertical SVG timeline list
   ───────────────────────────────────────────────────────────── */

function TimelineList({
  proposal,
  site,
  steps,
  role,
  composerHref,
}: {
  proposal: TimelineProposal;
  site: TimelineSite | null;
  steps: TimelineStep[];
  role: TimelineRole;
  composerHref: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-6">
      <h2 className="text-sm font-semibold mb-1">Workflow</h2>
      <p className="text-xs text-muted-foreground mb-6">
        From proposal handover to live site. Each step unlocks when the previous one is done.
      </p>

      <ol className="relative space-y-0">
        {steps.map((step, idx) => {
          const next = steps[idx + 1];
          const lineDone = step.state === "done" && next?.state === "done";
          return (
            <TimelineRow
              key={step.id}
              step={step}
              proposal={proposal}
              site={site}
              role={role}
              composerHref={composerHref}
              showLine={idx < steps.length - 1}
              lineDone={lineDone}
            />
          );
        })}
      </ol>
    </div>
  );
}

function TimelineRow({
  step,
  proposal,
  site,
  role,
  composerHref,
  showLine,
  lineDone,
}: {
  step: TimelineStep;
  proposal: TimelineProposal;
  site: TimelineSite | null;
  role: TimelineRole;
  composerHref: string;
  showLine: boolean;
  lineDone: boolean;
}) {
  return (
    <li className="relative grid grid-cols-[44px_1fr] gap-x-3 pb-6 last:pb-0">
      {/* Connecting line — absolute-positioned within the li so it spans
          from just below this row's circle, through the pb-6 gap, to the
          top of the NEXT row's circle. The circle has z-10 + opaque bg
          so it visually "swallows" the line at both ends. The previous
          per-row <svg> with flex-1 sizing only filled this row's content
          area, leaving a 24px gap (pb-6) where the line skipped — which
          is what made the timeline look broken between nodes. */}
      {showLine && (
        <div
          aria-hidden="true"
          className={`absolute left-[21px] top-8 bottom-0 w-0.5 ${
            lineDone ? "bg-primary" : "bg-border"
          }`}
        />
      )}
      <div className="flex justify-center">
        <TimelineCircle state={step.state} />
      </div>

      {/* Content cell */}
      <div className="pt-1 pb-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3
            className={
              "text-sm font-semibold " +
              (step.state === "pending" ? "text-muted-foreground" : "")
            }
          >
            {step.label}
          </h3>
          {step.doneAt && (
            <span className="text-xs text-muted-foreground">
              {fmtDate(step.doneAt)}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {step.description}
        </p>
        {step.hint && step.state !== "done" && (
          <p className="text-xs text-muted-foreground/70 italic mt-1">
            {step.hint}
          </p>
        )}

        <div className="mt-3">
          <StepAction
            step={step}
            proposal={proposal}
            site={site}
            role={role}
            composerHref={composerHref}
          />
        </div>
      </div>
    </li>
  );
}

function TimelineCircle({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <div className="size-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 z-10">
        <Check className="size-4" />
      </div>
    );
  }
  if (state === "active") {
    return (
      <div className="size-8 rounded-full border-2 border-primary ring-4 ring-primary/20 bg-background flex items-center justify-center shrink-0 z-10">
        <div className="size-2 rounded-full bg-primary" />
      </div>
    );
  }
  return (
    <div className="size-8 rounded-full bg-muted border border-border shrink-0 z-10" />
  );
}

/* ─────────────────────────────────────────────────────────────
   Per-step action surfaces
   ───────────────────────────────────────────────────────────── */

function StepAction({
  step,
  proposal,
  site,
  role,
  composerHref,
}: {
  step: TimelineStep;
  proposal: TimelineProposal;
  site: TimelineSite | null;
  role: TimelineRole;
  composerHref: string;
}) {
  switch (step.id) {
    // (The "received" case used to live here — always returned null
    //  since the step had no action surface. The whole step row was
    //  removed from the timeline 2026-05-10. See timeline-steps.ts.)
    case "built":
      return (
        <BuiltAction
          proposal={proposal}
          site={site}
          step={step}
          composerHref={composerHref}
        />
      );
    case "client_zone":
      // Restored 2026-05-27. The component still handles the
      // "zone not provisioned yet" empty state (recovery path
      // for the rare case auto-create-on-publish fails), the
      // credentials panel (email + password + edit + Save), and
      // the regenerate-password flow.
      return <ClientZoneAction proposal={proposal} site={site} step={step} />;
    case "send_to_client":
      // 2026-05-10 v2 (per Peter): the previous role==="sales" guards
      // here and in deriveSteps were both removed — tech_admin now
      // sees the same Send-to-client pipeline (and the BannerLauncher
      // it embeds) so a single user wearing both hats doesn't have to
      // bounce between /tech and /sales to send the proposal email or
      // toggle the banner. Backend permits status→sent for tech_admin
      // and super_admin already, so no auth changes were needed.
      return <SendToClientAction proposal={proposal} site={site} step={step} />;
    case "custom_domain":
      return <CustomDomainAction proposal={proposal} site={site} step={step} />;
    case "business_email":
      return <BusinessEmailAction proposal={proposal} step={step} />;
    case "live_client":
      return <LiveClientAction proposal={proposal} step={step} role={role} />;
    default:
      return null;
  }
}

/* ── Step 7: Live (paying) client ───────────────────────────────
   Read-only terminal status row. No launcher / no dialog. When the
   step is DONE we show a small "Open Live Clients →" link that
   takes the operator to the customer's detail page — the natural
   next-action surface after a payment lands (edit subdomain, send
   credentials, etc.). When active / pending we render nothing
   extra; the step's own hint text says what to do.
*/

function LiveClientAction({
  proposal,
  step,
  role,
}: {
  proposal: TimelineProposal;
  step: TimelineStep;
  role: TimelineRole;
}) {
  if (step.state !== "done") return null;
  // Live-clients detail lives under the same role prefix as the
  // timeline ('/sales' or '/tech') — keep parity so middleware
  // doesn't 403 the click. id in the URL is the PROPOSAL id, same
  // routing convention used by /super/live-clients/[id].
  const prefix = role === "sales" ? "/sales" : "/tech";
  const href = `${prefix}/live-clients/${proposal.id}`;
  return (
    <div className="pt-1">
      <Link
        href={href}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        Open Live Clients
        <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}

/* ── Step 1: Built ──────────────────────────────────────────── */

function BuiltAction({
  proposal: _proposal,
  site,
  step,
  composerHref,
}: {
  proposal: TimelineProposal;
  site: TimelineSite | null;
  step: TimelineStep;
  composerHref: string;
}) {
  const liveUrl =
    site?.site_url ||
    (site?.subdomain ? `https://${site.subdomain}.pages.dev` : null);

  // Banner toggle used to live here (and before that, on the
  // now-removed "Send to sales" step). Per Peter 2026-05-10 it now
  // belongs on the Send-to-client step instead — the banner surfaces
  // the pricing/discount on the live site, which is the same thing
  // sales is configuring when they hit "Send to client". So this
  // step is back to being just composer + live-url link.

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={composerHref}>
        <Button size="sm" variant={step.state === "active" ? "default" : "outline"}>
          <Sparkles className="size-4" />
          {step.state === "done" ? "Open composer" : "Open composer"}
        </Button>
      </Link>
      {liveUrl && step.state === "done" && (
        <a
          href={liveUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3" />
          {liveUrl.replace(/^https?:\/\//, "")}
        </a>
      )}
    </div>
  );
}

/* ── Step 3: Create client zone ─────────────────────────────── */

function ClientZoneAction({
  proposal,
  site,
  step,
}: {
  proposal: TimelineProposal;
  site: TimelineSite | null;
  step: TimelineStep;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Local `creds` is seeded from the saved proposal row so the panel
  // survives reloads, and we update it in place after every API call
  // (create / regenerate / save custom) so the new password lands in
  // the input immediately.
  const [creds, setCreds] = useState<{ email: string; password: string | null } | null>(
    step.state === "done"
      ? {
          // Prefer the CONTACT email (the actual client) over
          // site.owner_email (which can still resolve to the
          // salesperson's address if the site was never reassigned
          // — e.g. legacy proposal predating auto-create-zone, or
          // a proposal where ensureClientZone didn't run). Only fall
          // back to owner_email when the owner is actually a client
          // role; that's the case where owner_email IS the client.
          // Without this guard, Peter sees `erik@sales.sk` in the
          // panel until the next Save triggers a reassignment as a
          // side effect (Peter 2026-05-27).
          email:
            site?.owner_role === "client"
              ? site.owner_email || proposal.contact?.email || ""
              : proposal.contact?.email || site?.owner_email || "",
          password: proposal.client_temp_password,
        }
      : null,
  );
  // Show/hide toggle. Per Peter 2026-05-08: defaults to **hidden** on
  // reload — credentials are sensitive and the tech doesn't always want
  // them on screen. The card auto-reveals after a successful write
  // (handleCreate / handleResetPassword / handleSaveCustom) so a freshly
  // generated password is always visible the moment it's produced.
  const [revealed, setRevealed] = useState(false);

  // Starter credit amount tech grants on first-time activation. Default
  // 37.50 € (3 free publishes) — tech can step it up/down in 12.50 €
  // increments before clicking "Create client zone". Subsequent
  // grants/deductions happen inline in the Client zone details card
  // (handleAdjustCredit below).
  const PUBLISH_COST_EUR = 12.5;
  const [starterCreditEur, setStarterCreditEur] = useState(37.5);
  // Separate busy flag for the credit adjuster so a slow API call there
  // doesn't visually disable the password Save/Generate buttons.
  const [creditBusy, setCreditBusy] = useState(false);

  /**
   * Apply a signed credit delta against the site (positive grant /
   * negative deduct). Hits the same /api/admin/clients/[id]/credits
   * endpoint the tech client-management page uses, so all the same
   * server-side validation (multiple of 12.50, balance can't go below
   * zero, sales role restrictions) applies for free.
   */
  async function handleAdjustCredit(deltaEur: number) {
    if (!site || !site.id || !site.owner_id) {
      toast.error("Site or client not yet linked — refresh and try again.");
      return;
    }
    if (creditBusy) return;
    setCreditBusy(true);
    try {
      const res = await fetch(
        `/api/admin/clients/${site.owner_id}/credits`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: deltaEur, site_id: site.id }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error((data && data.error) || "Failed to update credits");
        return;
      }
      toast.success(
        deltaEur > 0
          ? `Added ${deltaEur.toFixed(2)} €. New balance: ${Number(data?.new_balance ?? 0).toFixed(2)} €.`
          : `Deducted ${Math.abs(deltaEur).toFixed(2)} €. New balance: ${Number(data?.new_balance ?? 0).toFixed(2)} €.`,
      );
      router.refresh();
    } catch (err) {
      toast.error("Network error: " + (err as Error).message);
    } finally {
      setCreditBusy(false);
    }
  }

  async function handleCreate() {
    // The starter-credit suffix on success is appended inside callEndpoint
    // — kept there so the "was_created vs already-existed" branching
    // stays in one place.
    await callEndpoint({ starter_credit_eur: starterCreditEur }, "");
  }

  /**
   * Save a custom password the tech typed in the credentials field. The
   * endpoint validates length (≥6) and updates Supabase Auth + the
   * proposal row. Old password stops working immediately on success.
   *
   * This is the ONLY commit path for password changes from the details
   * card (Peter 2026-05-20). The Generate button used to call a separate
   * regenerate endpoint and commit immediately; it now just fills the
   * input as a local draft, and any commit — manual or generated —
   * funnels through this handler.
   */
  async function handleSaveCustom(custom: string) {
    await callEndpoint(
      { custom_password: custom },
      "Password updated. Old one stops working now.",
    );
  }

  /**
   * Change the client's LOGIN email. Hits the existing /api/admin/live-
   * clients/[id]/login-email endpoint (the same one EditLoginEmailDialog
   * uses on the Live Clients detail page) — it updates BOTH
   * auth.users.email and contacts.email atomically and falls back
   * cleanly if either side rejects. On success we mirror the new value
   * into local creds so the input reflects it immediately, then refresh
   * to pull any other dependent fields (welcome-email defaults etc.).
   */
  async function handleSaveEmail(newEmail: string) {
    if (busy) return;
    const trimmed = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/live-clients/${proposal.id}/login-email`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error((data && data.error) || "Failed to update email");
        return;
      }
      setCreds((prev) => ({
        email: data?.email ?? trimmed,
        password: prev?.password ?? null,
      }));
      toast.success(`Login email updated to ${data?.email ?? trimmed}.`, {
        description:
          "Existing sessions stay logged in until token expiry. Re-send the welcome email if the client needs the new login info.",
        duration: 8000,
      });
      router.refresh();
    } catch (err) {
      toast.error("Network error: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function callEndpoint(
    body: {
      regenerate_password?: boolean;
      custom_password?: string;
      starter_credit_eur?: number;
    },
    successMsg: string,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/proposals/${proposal.id}/create-client-zone`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Action failed");
        return;
      }
      // Defensive: never overwrite a known-good password with null. The
      // API should always return one, but if some edge path ever drops
      // it we keep the previous so the panel doesn't go blank.
      setCreds((prev) => ({
        email: data.email ?? prev?.email ?? "",
        password: data.password ?? prev?.password ?? null,
      }));
      // Auto-reveal after a write so the tech can see the new password
      // even if they had hidden the card before clicking.
      setRevealed(true);
      const wasMutating =
        body.regenerate_password === true ||
        typeof body.custom_password === "string";
      // For password-mutating calls, use the caller-supplied message.
      // Otherwise (the "create or attach" path) compose one that also
      // reflects whether a starter credit landed.
      let toastMsg: string;
      if (wasMutating) {
        toastMsg = successMsg;
      } else {
        const baseMsg = data.was_created
          ? "Client account created."
          : "Client account already existed — site reassigned.";
        const starterAmount = Number(data.starter_credit_amount_eur ?? 0);
        toastMsg =
          starterAmount > 0
            ? `${baseMsg} Starter ${starterAmount.toFixed(2)} € granted.`
            : baseMsg;
      }
      toast.success(toastMsg);
      router.refresh();
    } catch (err) {
      toast.error("Network error: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (step.state === "pending") {
    return (
      <Button size="sm" variant="outline" disabled>
        <UserPlus className="size-4" />
        Create client zone
      </Button>
    );
  }

  if (step.state === "active") {
    const publishesIncluded = Math.round(starterCreditEur / PUBLISH_COST_EUR);
    return (
      <div className="space-y-2">
        {/* Starter credit chooser. Pre-filled at 37.50 € (3 publishes).
            Only used on the first-time create — adjustments after that
            happen on the tech client management page. */}
        <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1.5 max-w-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">
                Starter credit
              </p>
              <p className="text-[11px] text-muted-foreground/80 leading-tight">
                Granted automatically on activation
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0"
                onClick={() =>
                  setStarterCreditEur((a) =>
                    Number(Math.max(0, a - PUBLISH_COST_EUR).toFixed(2)),
                  )
                }
                disabled={busy || starterCreditEur <= 0}
                aria-label="Decrease starter by 12.50 €"
              >
                −
              </Button>
              <div className="text-center min-w-17">
                <p className="text-sm font-semibold leading-tight">
                  {starterCreditEur.toFixed(2)} €
                </p>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  {publishesIncluded === 0
                    ? "no publishes"
                    : `${publishesIncluded} publish${publishesIncluded === 1 ? "" : "es"}`}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0"
                onClick={() =>
                  setStarterCreditEur((a) =>
                    Number(Math.min(500, a + PUBLISH_COST_EUR).toFixed(2)),
                  )
                }
                disabled={busy || starterCreditEur >= 500}
                aria-label="Increase starter by 12.50 €"
              >
                +
              </Button>
            </div>
          </div>
        </div>
        <Button size="sm" onClick={handleCreate} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          Create client zone
        </Button>
        {creds && revealed && (
          <ClientZoneDetailsCard
            creds={creds}
            onSaveCustom={handleSaveCustom}
            onSaveEmail={handleSaveEmail}
            busy={busy}
            creditBalance={site?.credit_balance ?? 0}
            onAdjustCredit={handleAdjustCredit}
            busyAdjusting={creditBusy}
          />
        )}
        {creds && (
          <RevealToggle revealed={revealed} setRevealed={setRevealed} />
        )}
      </div>
    );
  }

  // done — credentials are visible by default but tech can hide the
  // card (e.g. while screen-sharing). The persisted password remains
  // in `creds` either way, so toggling back on shows the saved value
  // immediately without a re-fetch.
  return (
    <div className="space-y-2">
      {creds && revealed && (
        <ClientZoneDetailsCard
          creds={creds}
          onSaveCustom={handleSaveCustom}
          onSaveEmail={handleSaveEmail}
          busy={busy}
          creditBalance={site?.credit_balance ?? 0}
          onAdjustCredit={handleAdjustCredit}
          busyAdjusting={creditBusy}
        />
      )}
      {creds && <RevealToggle revealed={revealed} setRevealed={setRevealed} />}
    </div>
  );
}

/**
 * Pill-style toggle to hide / show the Client credentials card. Used
 * twice from ClientZoneAction — both the "active" first-create state
 * and the "done" reload state. Stays subtle so it doesn't scream as
 * loud as the Save / Generate buttons inside the card.
 */
function RevealToggle({
  revealed,
  setRevealed,
}: {
  revealed: boolean;
  setRevealed: (next: boolean) => void;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => setRevealed(!revealed)}
      className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2"
    >
      {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      {revealed ? "Hide details" : "Show details"}
    </Button>
  );
}

function ClientZoneDetailsCard({
  creds,
  onSaveCustom,
  onSaveEmail,
  busy,
  creditBalance,
  onAdjustCredit,
  busyAdjusting,
}: {
  creds: { email: string; password: string | null };
  /** Saves a custom password the tech typed. Endpoint validates ≥6 chars. */
  onSaveCustom: (password: string) => void | Promise<void>;
  /** Saves a changed login email — updates auth + contacts atomically. */
  onSaveEmail: (email: string) => void | Promise<void>;
  /** Single busy flag covers both reset + save — never run two at once. */
  busy: boolean;
  /** Current credit balance in € (server-fetched, refreshed via router). */
  creditBalance: number;
  /** Apply a signed delta in €. Positive grants, negative deducts. */
  onAdjustCredit: (deltaEur: number) => void | Promise<void>;
  /** True while a credit POST is in flight. */
  busyAdjusting: boolean;
}) {
  // Lifted-up drafts so ONE Save button covers email + password
  // (Peter 2026-05-20: stacked per-field Save buttons read as noise).
  // We re-seed both drafts whenever the saved values change — the
  // standard pattern for "controlled input that mirrors server
  // truth but can be edited". Re-key safety not needed since we
  // only sync on the dependency that actually moved.
  const savedPassword = creds.password ?? "";
  const [emailDraft, setEmailDraft] = useState(creds.email);
  const [passwordDraft, setPasswordDraft] = useState(savedPassword);
  useEffect(() => {
    setEmailDraft(creds.email);
  }, [creds.email]);
  useEffect(() => {
    setPasswordDraft(savedPassword);
  }, [savedPassword]);

  const emailTrimmed = emailDraft.trim().toLowerCase();
  const emailDirty = emailTrimmed !== creds.email.trim().toLowerCase();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed);
  const emailInvalid = emailDirty && emailDraft.length > 0 && !emailValid;

  const passwordDirty = passwordDraft !== savedPassword;
  const passwordTooShort =
    passwordDirty && passwordDraft.length > 0 && passwordDraft.length < 6;
  const passwordValid = passwordDraft.length >= 6;

  const anyDirty = emailDirty || passwordDirty;
  const canSave =
    !busy &&
    anyDirty &&
    (!emailDirty || emailValid) &&
    (!passwordDirty || passwordValid);

  async function handleSaveAll() {
    // Save email first so a password call against a stale auth email
    // doesn't race the email change. Both endpoints are idempotent so
    // a partial failure still leaves the system consistent (the half
    // that committed stays committed; tech retries the rest).
    if (emailDirty && emailValid) {
      await onSaveEmail(emailDraft);
    }
    if (passwordDirty && passwordValid) {
      await onSaveCustom(passwordDraft);
    }
  }

  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-2.5 max-w-md">
      <p className="font-semibold text-foreground">Client zone details</p>

      {/* Email row — input + copy. No per-row Save; the shared Save
          button below commits any dirty values. */}
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-16 shrink-0">Email</span>
        <Input
          type="email"
          value={emailDraft}
          onChange={(e) => setEmailDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSave) {
              e.preventDefault();
              void handleSaveAll();
            }
          }}
          placeholder="client@example.com"
          className="h-7 px-2 py-0 text-xs font-mono flex-1"
          disabled={busy}
          aria-invalid={emailInvalid}
        />
        {!emailDirty && creds.email && (
          <CopyButton value={creds.email} label="Email" />
        )}
      </div>
      {emailInvalid && (
        <p className="text-[11px] text-destructive pl-18">
          Enter a valid email address.
        </p>
      )}

      {/* Password row — Generate sits LEFT of the input (Peter
          2026-05-20: reads left→right as "regenerate this value")
          and is icon+label compact so the input still has room.
          Generate fills the draft locally with a fresh 6-digit PIN —
          it does NOT commit (Peter 2026-05-20: the operator should
          review the value first, hit shared Save to commit). The
          only auto-save in this flow is the publish→auto-create-zone
          path on the composer side, not anything in this card. */}
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-16 shrink-0">Password</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPasswordDraft(generateLocalPin())}
          disabled={busy}
          title="Fill the input with a fresh 6-digit PIN (click Save to commit)"
          className="h-7 px-2 gap-1 shrink-0"
        >
          <RotateCcw className="size-3" />
          <span className="text-[11px]">Generate</span>
        </Button>
        <Input
          type="text"
          value={passwordDraft}
          onChange={(e) => setPasswordDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSave) {
              e.preventDefault();
              void handleSaveAll();
            }
          }}
          placeholder="Type a password or click Generate"
          className="h-7 px-2 py-0 text-xs font-mono flex-1"
          disabled={busy}
          aria-invalid={passwordTooShort}
        />
        {!passwordDirty && savedPassword && (
          <CopyButton value={savedPassword} label="Password" />
        )}
      </div>
      {passwordTooShort && (
        <p className="text-[11px] text-destructive pl-18">
          At least 6 characters.
        </p>
      )}

      {/* Shared Save — commits whichever fields are dirty. Hidden when
          nothing's dirty so the card stays quiet at rest. */}
      {anyDirty && (
        <div className="pt-0.5">
          <Button
            size="sm"
            variant="default"
            onClick={() => void handleSaveAll()}
            disabled={!canSave}
            className="gap-1.5"
            title={
              emailDirty && passwordDirty
                ? "Save new email and password"
                : emailDirty
                  ? "Save new email"
                  : "Save new password"
            }
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            Save
          </Button>
        </div>
      )}

      <p className="text-muted-foreground pt-1">
        Share these once with the client — they can change the password
        after first login.
      </p>

      {/* ── Credit balance + inline add/deduct ───────────────── */}
      <div className="border-t pt-2.5 -mx-3 px-3">
        <CreditAdjuster
          balance={creditBalance}
          onAdjust={onAdjustCredit}
          busy={busyAdjusting}
        />
      </div>
    </div>
  );
}

/**
 * Inline credit-balance editor inside the Client zone details card.
 * The stepper represents the DESIRED new balance (not a delta) — tech
 * scrubs it up or down in 12.50 € steps and clicks Save. The diff
 * against the current balance is computed and sent as a signed delta
 * to the existing /api/admin/clients/[id]/credits endpoint.
 *
 * "Set" semantics rather than "add" semantics matches Peter's mental
 * model: "what should the current money of the client be?"
 */
function CreditAdjuster({
  balance,
  onAdjust,
  busy,
}: {
  balance: number;
  /** Called with the SIGNED delta needed to reach `amount` from `balance`. */
  onAdjust: (deltaEur: number) => void | Promise<void>;
  busy: boolean;
}) {
  const PUBLISH_COST_EUR = 12.5;
  const [amount, setAmount] = useState(balance);

  // Keep the stepper in sync with server-side balance changes — after
  // a Save, router.refresh updates the prop and the editor reflects
  // the new value (rather than holding the previous edit forever).
  useEffect(() => {
    setAmount(balance);
  }, [balance]);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold text-foreground">Credit balance</span>
        <span className="text-base font-bold text-foreground tabular-nums">
          {balance.toFixed(2).replace(".", ",")} €
        </span>
      </div>

      {/* ± stepper. Sets the desired new balance directly, in 12.50 €
          steps. Min 0, max 1000. Save is disabled when nothing changed. */}
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          onClick={() =>
            setAmount((a) =>
              Number(Math.max(0, a - PUBLISH_COST_EUR).toFixed(2)),
            )
          }
          disabled={busy || amount <= 0}
          aria-label="Decrease by 12.50 €"
        >
          −
        </Button>
        <div className="flex-1 rounded-md border bg-background px-2 py-1 text-center">
          <p className="text-sm font-semibold leading-tight tabular-nums">
            {amount.toFixed(2)} €
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          onClick={() =>
            setAmount((a) =>
              Number(Math.min(1000, a + PUBLISH_COST_EUR).toFixed(2)),
            )
          }
          disabled={busy || amount >= 1000}
          aria-label="Increase by 12.50 €"
        >
          +
        </Button>
      </div>

      <Button
        size="sm"
        onClick={() => {
          const delta = Number((amount - balance).toFixed(2));
          if (delta === 0) {
            // No-op save — gives tech clear "nothing to do" feedback
            // instead of greying the button out, so the workflow is
            // always "set the value, click Save" with no special case
            // for "but it's already that value."
            toast.info(`Balance is already ${amount.toFixed(2)} €`);
            return;
          }
          void onAdjust(delta);
        }}
        disabled={busy}
        className="w-full gap-1.5"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" />
        )}
        Save credit
      </Button>
    </div>
  );
}

/**
 * 6-digit PIN matching the server's generateTempPassword format
 * (`src/app/api/proposals/[id]/create-client-zone/route.ts`). Used by
 * the Client zone details card's Generate button to fill the password
 * input LOCALLY — the value isn't committed until the operator clicks
 * the shared Save. Same digit-only format means support guidance is
 * identical regardless of whether the PIN came from the auto-create
 * path or a manual Generate.
 */
function generateLocalPin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() =>
        void navigator.clipboard.writeText(value).then(
          () => toast.success(`${label} copied`),
          () => toast.error("Copy failed"),
        )
      }
      title={`Copy ${label.toLowerCase()}`}
    >
      <Copy className="size-3.5" />
    </Button>
  );
}

/* ── Banner launcher (was BannerToggle prior to 2026-05-10 v2) ───
 *
 * What changed: the on-row toggle was replaced by a launcher that
 * opens BannerConfigDialog. Per Peter, turning the banner ON now
 * requires confirming the price + expiry that visitors will see —
 * not just flipping a flag tied to whatever was last set during
 * Send-to-client. Turning it OFF goes through BannerDisableDialog
 * so a fat-finger click doesn't yank the banner off a live
 * customer-facing site.
 *
 * Both dialogs own the actual save + silent-republish logic
 * (DB write → Cloudflare push). This component is just the
 * launcher surface: an outline "Configure payment banner" button
 * when the banner is OFF, or a status row with Edit / Disable
 * actions when it's ON.
 *
 * Mounting strategy: the dialog components are dynamic-imported
 * up at the top of this file. We only render them when their
 * `open` state is true so the import stays lazy on first paint —
 * a salesperson who doesn't touch the banner never pays for the
 * dialog code. */
function BannerLauncher({
  proposal,
  site,
}: {
  proposal: TimelineProposal;
  /**
   * The site row linked to this proposal — required to call the
   * publish API from inside the dialogs. Pass null when no site
   * exists yet; the dialogs gracefully skip the republish step.
   */
  site?: TimelineSite | null;
}) {
  const [configOpen, setConfigOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  const isOn = proposal.show_banner;

  // Resolve the live URL the same way SendToClientAction does so
  // both surfaces agree on what "the live site" means: prefer the
  // custom domain when set, otherwise the *.pages.dev subdomain.
  // Null when nothing's published yet — in that case we hide the
  // "view live site" affordance entirely.
  const liveUrl =
    site?.site_url ||
    (site?.subdomain ? `https://${site.subdomain}.pages.dev` : null);

  return (
    <>
      {isOn ? (
        // Banner currently ON — show status pill + Edit / Disable +
        // a quick "view on live site" jump so sales can verify the
        // banner with their own eyes. The view-live link only
        // renders when we actually have a deployed URL.
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Payment banner active
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => setConfigOpen(true)}
          >
            <Settings className="size-3.5" />
            Edit
          </Button>
          {liveUrl && (
            <a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Open the live site in a new tab to see the banner"
            >
              <ExternalLink className="size-3.5" />
              View on live site
            </a>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => setDisableOpen(true)}
          >
            <EyeOff className="size-3.5" />
            Disable
          </Button>
        </div>
      ) : (
        // Banner OFF — single CTA. Outline so it doesn't compete
        // visually with the primary "Send to client" button it
        // sits next to.
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfigOpen(true)}
          className="gap-1.5"
        >
          <Megaphone className="size-4" />
          Configure payment banner
        </Button>
      )}

      {/* Dialogs are mounted only while open so the dynamic import
          stays cold on first paint. Closing unmounts them again.
          liveUrl is threaded into BannerConfigDialog so the success
          toast can offer the same one-click verification. */}
      {configOpen && (
        <BannerConfigDialog
          open={configOpen}
          onOpenChange={setConfigOpen}
          proposal={proposal}
          site={site ?? null}
          liveUrl={liveUrl}
        />
      )}
      {disableOpen && (
        <BannerDisableDialog
          open={disableOpen}
          onOpenChange={setDisableOpen}
          proposal={proposal}
          site={site ?? null}
        />
      )}
    </>
  );
}

/* ── Step 6: Custom domain ──────────────────────────────────── */

/**
 * Custom Domain step — multi-state UI driven by the Cloudflare
 * setup pipeline (see src/lib/deployment/custom-domain.ts).
 *
 * Four visual modes:
 *
 *   IDLE        — no setup in progress. Shows the input + "Set
 *                  custom domain" button. (Or — for legacy rows
 *                  with domain_status='active' but no setup_status
 *                  — shows the active-domain layout below; this
 *                  path is the same as ACTIVE.)
 *
 *   IN_PROGRESS — pipeline is mid-flight. Shows status pill,
 *                  elapsed-time counter, sub-step list, and
 *                  nameservers if the zone is fresh and waiting
 *                  for DNS. Polls the tick endpoint every 30 sec.
 *
 *   ACTIVE      — pipeline succeeded. Shows the live domain link
 *                  with a "Change" button.
 *
 *   FAILED      — pipeline gave up. Shows the error message,
 *                  nameservers (so sales can verify Hostcreator
 *                  delegation), retry button, and a Cloudflare
 *                  link.
 *
 * Polling lifecycle:
 *   - Mount + IN_PROGRESS  → start a 30s interval that POSTs to
 *                            /api/sites/[id]/domain/tick and
 *                            router.refresh() after each tick.
 *   - State leaves IN_PROGRESS → interval is cleared.
 *   - Component unmounts   → interval is cleared.
 *
 * The router.refresh() approach is intentional: the page.tsx
 * server component is the authoritative source for the row's
 * current state, so we re-fetch through it rather than holding a
 * parallel client state in sync. One mental model.
 */
function CustomDomainAction({
  proposal,
  site,
  step: _step,
}: {
  proposal: TimelineProposal;
  site: TimelineSite | null;
  step: TimelineStep;
}) {
  const router = useRouter();
  const setupStatus = (site?.domain_setup_status ?? null) as
    | DomainSetupStatus
    | null;
  const inProgress = isDomainSetupInProgress(setupStatus);

  // Active branch: either the pipeline reached the "active" terminal,
  // OR a legacy row has domain set + domain_status='active' (super-
  // admin-approved before migration 00054). Both render the same UI.
  const isActiveDomain =
    setupStatus === "active" ||
    (!setupStatus && !!site?.domain && site.domain_status === "active");

  if (isActiveDomain && site?.domain) {
    return <ActiveDomainView site={site} />;
  }

  if (setupStatus === "failed") {
    return <FailedSetupView site={site} />;
  }

  if (inProgress && site) {
    return <InProgressView site={site} onTick={() => router.refresh()} />;
  }

  // Idle: input + "Set custom domain" button. step.state === "pending"
  // for this branch (the legacy "active" path was already caught above).
  // proposalId is threaded through so the "publish first" prompt can
  // deep-link to the composer when the site hasn't been published yet
  // — custom domain attach requires a live Cloudflare Pages project.
  return <IdleSetupView site={site} />;
}

/* ── Active (success) view ──────────────────────────────────── */

function ActiveDomainView({ site }: { site: TimelineSite }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
        <a
          href={`https://${site.domain}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono hover:underline"
        >
          {site.domain}
        </a>
        <span className="text-muted-foreground/70">·</span>
        <span className="text-muted-foreground">www → naked redirect</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs"
          onClick={() => setEditing(true)}
        >
          Change
        </Button>
      </div>
      {editing && (
        <DomainInputForm
          siteId={site.id}
          initialDomain=""
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

/* ── Idle (no setup yet) view ───────────────────────────────── */

/**
 * Two sub-states:
 *
 *   1. No site row at all
 *      → built step hasn't started; show a disabled button as a
 *        passive signpost. The Built step itself owns the active
 *        CTA, this is just here so the timeline visual reads
 *        consistently.
 *
 *   2. Site exists
 *      → standard idle flow: button → input form → POST to
 *        /domain/start.
 *
 * 2026-05-10 v2 (per Peter): the previous "site exists but not
 * published" sub-state (amber "Publish first" warning) was
 * removed. The /domain/start endpoint now calls
 * ensureDirectUploadProject() upfront, so the pipeline's
 * registering_pages step has a Pages project to attach to even
 * before the site has been published. That made the gate
 * unnecessary — sales can wire up the custom domain in parallel
 * with IT building the site, instead of having to wait for the
 * first publish.
 */
function IdleSetupView({
  site,
}: {
  site: TimelineSite | null;
}) {
  const [editing, setEditing] = useState(false);

  // Sub-state 1 — no site row yet. Disabled button as a placeholder.
  if (!site) {
    return (
      <Button size="sm" variant="outline" disabled>
        <Globe className="size-4" />
        Set custom domain
      </Button>
    );
  }

  // Sub-state 2 — site exists. Standard idle flow regardless of
  // last_published_at; pipeline self-bootstraps the Pages project.
  if (!editing) {
    return (
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        <Globe className="size-4" />
        Set custom domain
      </Button>
    );
  }

  return (
    <DomainInputForm
      siteId={site.id}
      initialDomain={site.requested_domain ?? ""}
      onCancel={() => setEditing(false)}
    />
  );
}

/* ── Domain input form (used by Idle + Active "Change") ─────── */

/**
 * Inline form that POSTs to /api/sites/[id]/domain/start. On
 * success the parent re-renders (router.refresh) and the timeline
 * flips into the in-progress branch automatically.
 */
function DomainInputForm({
  siteId,
  initialDomain,
  onCancel,
}: {
  siteId: string;
  initialDomain: string;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [domain, setDomain] = useState(initialDomain);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const trimmed = domain.trim().toLowerCase();
    if (!trimmed) {
      toast.error("Enter a domain (e.g. yourcompany.sk)");
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]?(\.[a-z]{2,})+$/.test(trimmed)) {
      toast.error("Invalid domain format");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/domain/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to start domain setup");
        return;
      }
      toast.success("Domain setup started.");
      router.refresh();
    } catch (err) {
      toast.error("Network error: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <Input
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        placeholder="yourcompany.sk"
        className="h-9 max-w-xs"
        disabled={saving}
      />
      <Button size="sm" onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="size-4 animate-spin" /> : null}
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
        Cancel
      </Button>
    </div>
  );
}

/* ── In-progress (polling) view ─────────────────────────────── */

/**
 * Polls /api/sites/[id]/domain/tick every 30 sec while the
 * pipeline is mid-flight. Calls `onTick` after each successful
 * tick so the parent can router.refresh() and the latest row
 * state lands in the next render.
 *
 * The interval is also responsible for pausing when the tab is
 * backgrounded — `document.visibilityState` is checked before
 * every poll. We don't want to keep hitting the API when no one
 * is watching (and Cloudflare's clock keeps ticking regardless,
 * so resuming when the user comes back is harmless).
 */
function InProgressView({
  site,
  onTick,
}: {
  site: TimelineSite;
  onTick: () => void;
}) {
  const setupStatus = site.domain_setup_status as DomainSetupStatus;
  const startedAt = site.domain_setup_started_at;
  const requestedDomain = site.requested_domain ?? "";

  // Live elapsed-time ticker (re-renders every second so the
  // counter shows the right wall-clock value without hammering
  // the backend).
  const [elapsedMs, setElapsedMs] = useState(() =>
    startedAt ? Date.now() - new Date(startedAt).getTime() : 0,
  );
  useEffect(() => {
    if (!startedAt) return;
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - new Date(startedAt).getTime());
    }, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  // 30-second polling interval. Skips the call when the tab is
  // hidden so we're not running up Cloudflare API calls in
  // background tabs the user has forgotten about.
  const tickingRef = useRef(false);
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled || tickingRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      tickingRef.current = true;
      try {
        const res = await fetch(`/api/sites/${site.id}/domain/tick`, {
          method: "POST",
        });
        if (!res.ok) return; // Soft fail — try again next interval.
        onTick();
      } catch {
        // Network blip; keep polling.
      } finally {
        tickingRef.current = false;
      }
    }

    // Fire one poll immediately so the user sees a refreshed
    // state within ~1 sec of opening the page (rather than
    // waiting for the first 30s tick).
    void poll();
    const id = window.setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [site.id, onTick]);

  const elapsedMin = Math.floor(elapsedMs / 60_000);
  const nameservers = site.domain_nameservers ?? [];

  // Sub-step checklist — fills in green checks as the pipeline
  // advances. Order matches the runtime sequence inside
  // custom-domain.ts. SSL has no dedicated step: Cloudflare provisions
  // the cert automatically in the background once the Pages
  // registration finishes, and the pipeline marks the domain `active`
  // straight after register_pages without waiting.
  const stepStates: Array<{ label: string; state: "done" | "current" | "pending" }> = [
    {
      label: "Domain added to Cloudflare",
      state:
        setupStatus === "creating_zone"
          ? "current"
          : "done", // any later state implies this is done
    },
    {
      label: "DNS records + redirect rules created",
      state:
        setupStatus === "creating_zone"
          ? "pending"
          : ["waiting_dns", "registering_pages", "provisioning_ssl"].includes(
                setupStatus,
              )
            ? setupStatus === "waiting_dns"
              ? "current"
              : "done"
            : "pending",
    },
    {
      label: "Connecting to Cloudflare Pages",
      state:
        setupStatus === "registering_pages" ||
        setupStatus === "provisioning_ssl"
          ? "current"
          : "pending",
    },
  ];

  return (
    <div className="space-y-3">
      {/* Status pill */}
      <div className="flex items-center gap-2">
        <Loader2 className="size-3.5 text-amber-500 animate-spin" />
        <span className="text-xs font-medium">
          {domainStatusLabel(setupStatus)}
        </span>
        {requestedDomain && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className="font-mono text-xs text-muted-foreground">
              {requestedDomain}
            </span>
          </>
        )}
        <span className="text-muted-foreground/50">·</span>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3" />
          {elapsedMin === 0 ? "<1 min" : `${elapsedMin} min`}
        </span>
      </div>

      {/* Sub-step checklist */}
      <ul className="text-xs space-y-1 border-l-2 border-border pl-3">
        {stepStates.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            {s.state === "done" ? (
              <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
            ) : s.state === "current" ? (
              <Loader2 className="size-3 text-amber-500 animate-spin shrink-0" />
            ) : (
              <Circle className="size-3 text-muted-foreground/30 shrink-0" />
            )}
            <span
              className={
                s.state === "pending"
                  ? "text-muted-foreground/60"
                  : "text-foreground"
              }
            >
              {s.label}
            </span>
          </li>
        ))}
      </ul>

      {/* Fresh-zone nameservers — only surfaced while waiting for DNS,
          since that's when sales might need to verify them with the
          customer / Hostcreator. */}
      {setupStatus === "waiting_dns" && nameservers.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1.5 text-xs">
          <p className="text-muted-foreground">
            Cloudflare nameservers (Hostcreator should have these
            already — only verify if the wait gets long):
          </p>
          <div className="space-y-1">
            {nameservers.map((ns) => (
              <div key={ns} className="flex items-center gap-2">
                <code className="font-mono">{ns}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1"
                  onClick={() => {
                    void navigator.clipboard.writeText(ns).then(
                      () => toast.success("Nameserver copied"),
                      () => toast.error("Copy failed"),
                    );
                  }}
                  title="Copy"
                >
                  <Copy className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Failed view ────────────────────────────────────────────── */

/**
 * Shown when the pipeline gave up (30-min timeout or hard
 * Cloudflare error). Surfaces the error message verbatim, the
 * nameservers if known, and a Retry button that re-POSTs to
 * /domain/start with the same `requested_domain`.
 *
 * The Retry path is a full pipeline reset — wipes
 * domain_setup_status / attempts / error / zone_id and starts
 * over from `not_started`. Same behavior as if sales had typed
 * the domain in fresh.
 */
function FailedSetupView({ site }: { site: TimelineSite | null }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Two-click confirm for cancel — first click flips to "Confirm cancel",
  // second click commits. Auto-reverts after 4s if no second click.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const cancelResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestedDomain = site?.requested_domain ?? "";
  const errorMessage = site?.domain_setup_error ?? "Unknown error.";
  const nameservers = site?.domain_nameservers ?? [];

  // Clear any pending cancel-confirm timer if the user navigates away
  // mid-confirm — avoids a setState-on-unmounted warning in dev.
  useEffect(() => {
    return () => {
      if (cancelResetTimer.current) {
        clearTimeout(cancelResetTimer.current);
        cancelResetTimer.current = null;
      }
    };
  }, []);

  async function handleRetry() {
    if (!site || !requestedDomain) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/sites/${site.id}/domain/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: requestedDomain }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Retry failed");
        return;
      }
      toast.success("Retrying domain setup.");
      router.refresh();
    } catch (err) {
      toast.error("Network error: " + (err as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  function handleCancelClick() {
    if (!site) return;
    if (!confirmingCancel) {
      // First click — arm confirm + start auto-revert timer.
      setConfirmingCancel(true);
      if (cancelResetTimer.current) clearTimeout(cancelResetTimer.current);
      cancelResetTimer.current = setTimeout(() => {
        setConfirmingCancel(false);
        cancelResetTimer.current = null;
      }, 4000);
      return;
    }
    // Second click — commit.
    if (cancelResetTimer.current) {
      clearTimeout(cancelResetTimer.current);
      cancelResetTimer.current = null;
    }
    void commitCancel();
  }

  async function commitCancel() {
    if (!site) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/sites/${site.id}/domain/cancel`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error((data && data.error) || "Cancel failed");
        return;
      }
      toast.success("Setup cancelled.");
      router.refresh();
    } catch (err) {
      toast.error("Network error: " + (err as Error).message);
    } finally {
      setCancelling(false);
      setConfirmingCancel(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-2 text-xs font-medium text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />
          Setup failed
          {requestedDomain && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="font-mono text-foreground">{requestedDomain}</span>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {errorMessage}
        </p>
        {nameservers.length > 0 && (
          <div className="text-xs space-y-1 pt-1">
            <p className="text-muted-foreground">
              Verify these nameservers are set at Hostcreator:
            </p>
            {nameservers.map((ns) => (
              <code key={ns} className="block font-mono">
                {ns}
              </code>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={handleRetry}
          disabled={retrying || cancelling || !requestedDomain}
          className="gap-1.5"
        >
          {retrying ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RotateCcw className="size-3.5" />
          )}
          Retry
        </Button>
        <Button
          size="sm"
          variant={confirmingCancel ? "destructive" : "ghost"}
          onClick={handleCancelClick}
          disabled={cancelling || retrying}
          className="gap-1.5"
        >
          {cancelling ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <X className="size-3.5" />
          )}
          {confirmingCancel ? "Confirm cancel" : "Cancel setup"}
        </Button>
        <a
          href={`https://dash.cloudflare.com/?account=${process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_ID ?? ""}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3" />
          Open in Cloudflare
        </a>
      </div>
      {confirmingCancel && (
        <p className="text-[11px] text-muted-foreground leading-snug">
          Resets domain fields on this site. The Cloudflare zone is left
          intact — delete it manually if it was a test.
        </p>
      )}
    </div>
  );
}

/* ── Step 7: Business email setup ───────────────────────────── */

/**
 * Lightweight launcher for the Gmail-style compose dialog. The actual
 * compose surface (subject, rich-text body, live preview iframe, send)
 * lives in `business-email-dialog.tsx` so it stays out of the way until
 * the tech actually wants it open.
 *
 * Saved credentials prefill the dialog if the tech is re-sending.
 */
function BusinessEmailAction({
  proposal,
  step,
}: {
  proposal: TimelineProposal;
  step: TimelineStep;
}) {
  const router = useRouter();
  const saved = proposal.client_profile;
  // Sensible default mailbox: prefer the contact's existing business
  // email domain → fallback to their personal email's domain → finally
  // `yourcompany.sk` placeholder. Tech can edit before sending.
  const contactDomain =
    proposal.contact?.business_email?.split("@")[1] ??
    proposal.contact?.email?.split("@")[1] ??
    "yourcompany.sk";

  const [open, setOpen] = useState(false);

  if (step.state === "pending") {
    return (
      <Button size="sm" variant="outline" disabled>
        <AtSign className="size-4" />
        Set up business email
      </Button>
    );
  }

  const recipient = proposal.contact?.email ?? "";
  const ctaLabel = step.state === "done" ? "Re-send setup email" : "Compose setup email";

  return (
    <div className="space-y-2">
      <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <AtSign className="size-4" />
        {ctaLabel}
      </Button>
      {step.state === "done" && step.doneAt && (
        <p className="text-[11px] text-muted-foreground">
          Last sent {fmtDate(step.doneAt)} to{" "}
          <span className="font-mono text-foreground">{recipient}</span>.
        </p>
      )}

      <BusinessEmailDialog
        open={open}
        onOpenChange={setOpen}
        proposalId={proposal.id}
        companyName={proposal.company_name}
        recipientEmail={recipient}
        initialBusinessEmail={saved?.business_email ?? `info@${contactDomain}`}
        initialBusinessEmailPassword={saved?.business_email_password ?? ""}
        alreadySent={step.state === "done"}
        onSent={() => router.refresh()}
      />
    </div>
  );
}

/* ── Step (sales): Send to client ───────────────────────────── */

/**
 * Sales-only step. Primary action launches SendProposalDialog
 * (greeting + price + actual email to the customer). After the email
 * lands (proposal.sent_at set, step state = "done"), the same surface
 * exposes three secondary actions:
 *
 *   - Send follow-up         (FollowUpEmailDialog launcher)
 *   - Called client          (logs a `handed_over` outcome on the contact)
 *   - WhatsApp               (copies a Slovak handover message + logs
 *                              `whatsapp_sent`)
 *
 * Pre-send (state="active") only the primary CTA is shown. Pre-active
 * (state="pending") the button is disabled and we surface the hint
 * the deriveSteps function already attached.
 */
function SendToClientAction({
  proposal,
  site,
  step,
}: {
  proposal: TimelineProposal;
  site: TimelineSite | null;
  step: TimelineStep;
}) {
  const [sendOpen, setSendOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpWaOpen, setFollowUpWaOpen] = useState(false);
  // Resend-confirmation modal (Peter 2026-05-15 v2): once any
  // channel has been used, both send buttons turn gray and clicking
  // either opens a "you already sent this — resend?" confirmation
  // instead of jumping straight into the compose dialog. Tracks
  // which channel the user wants to resend through.
  const [resendChannel, setResendChannel] = useState<
    "email" | "whatsapp" | null
  >(null);

  // Live URL is needed by the WhatsApp dialog to substitute
  // `{website_link}` in the outbound message. Same resolution
  // pattern used elsewhere in this file (see line 521 + 1182 +
  // 2195 — site_url overrides subdomain).
  const liveUrl =
    site?.site_url ||
    (site?.subdomain ? `https://${site.subdomain}.pages.dev` : null);

  if (step.state === "pending") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled>
          <Mail className="size-4" />
          Send via email
        </Button>
        <Button size="sm" variant="outline" disabled>
          <MessageCircle className="size-4" />
          Send via WhatsApp
        </Button>
      </div>
    );
  }

  // ─── Active + Done: unified send surface (Peter 2026-05-15) ────
  //
  // Both states share the same two send buttons — they're never
  // disabled post-send. After the first send (state="done") the
  // button that was used carries a "✓ Sent" badge so sales
  // sees at a glance which channel was used, but BOTH stay
  // clickable in case sales wants to try the other channel ("the
  // client never replied to my email, let me try WhatsApp"). The
  // only disable case is the banner-not-yet-configured gate while
  // state="active".
  //
  // Banner gate: the banner must be configured BEFORE the first
  // send — otherwise the client clicks the link and lands on a
  // site with no discount widget. proposal.show_banner === true
  // (set atomically by BannerConfigDialog along with discount /
  // base price / auto-republish) is the reliable proxy for
  // "banner is live with real prices". Once we're past state=
  // "active", the gate no longer applies.
  //
  // Two-channel send: same dialog shape, same pricing block, same
  // banner gate — they just differ in delivery. Email goes via
  // Hostinger SMTP server-side. WhatsApp opens wa.me in a new tab
  // with the message pre-filled; the salesperson hits Send inside
  // WhatsApp themselves. Both routes call the same PUT
  // /api/proposals/[id] with status="sent", so reminders /
  // sent_at / variable_symbol are wired identically.
  const isDone = step.state === "done";
  // Send + banner are fully decoupled now (Peter 2026-05-23). The
  // email goes out as "your site is ready, here are your login
  // details" — no pricing baked in. The payment banner is configured
  // and triggered separately, whenever sales is ready to push for
  // payment. Both buttons stay enabled regardless of banner state.
  const sendsBlocked = false;
  const blockedTitle: string | undefined = undefined;
  const emailSentAt = proposal.sent_email_at;
  const waSentAt = proposal.sent_whatsapp_at;

  // Click handlers route through the resend-confirmation modal
  // when the proposal has already been sent (any channel). Pre-
  // send we open the compose dialog directly.
  function openEmail() {
    if (sendsBlocked) return;
    if (isDone) setResendChannel("email");
    else setSendOpen(true);
  }
  function openWhatsApp() {
    if (sendsBlocked) return;
    if (isDone) setResendChannel("whatsapp");
    else setWaOpen(true);
  }
  function confirmResend() {
    if (resendChannel === "email") setSendOpen(true);
    else if (resendChannel === "whatsapp") setWaOpen(true);
    setResendChannel(null);
  }

  return (
    <div className="space-y-3">
      {/* Per-channel send info (replaces the old single "Sent on…"
          line). Each channel surfaces its own timestamp + the exact
          recipient (email address or phone) so sales sees not just
          *when* but *how* and *to whom* the proposal went out.
          Only renders when at least one channel has been used —
          pre-send we don't reserve space for empty info. */}
      {isDone && (emailSentAt || waSentAt || proposal.sent_at) && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1">
          {emailSentAt && (
            <div className="flex items-center gap-1.5 text-xs flex-wrap">
              <Check className="size-3.5 text-emerald-500 shrink-0" />
              <span className="text-foreground">
                Sent by email — {fmtDate(emailSentAt)}
              </span>
              {proposal.contact?.email && (
                <>
                  <span className="text-muted-foreground/50">·</span>
                  <span className="font-mono text-muted-foreground">
                    {proposal.contact.email}
                  </span>
                </>
              )}
            </div>
          )}
          {waSentAt && (
            <div className="flex items-center gap-1.5 text-xs flex-wrap">
              <Check className="size-3.5 text-emerald-500 shrink-0" />
              <span className="text-foreground">
                Sent via WhatsApp — {fmtDate(waSentAt)}
              </span>
              {proposal.contact?.phone && (
                <>
                  <span className="text-muted-foreground/50">·</span>
                  <span className="font-mono text-muted-foreground">
                    {proposal.contact.phone}
                  </span>
                </>
              )}
            </div>
          )}
          {/* Legacy fallback for proposals sent before per-channel
              proposal_emails logging shipped. */}
          {!emailSentAt && !waSentAt && proposal.sent_at && (
            <div className="flex items-center gap-1.5 text-xs flex-wrap">
              <Check className="size-3.5 text-emerald-500 shrink-0" />
              <span className="text-foreground">
                Sent — {fmtDate(proposal.sent_at)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Top row: Send via email + Send via WhatsApp, grouped. Both
          buttons share the same gray "secondary" treatment once any
          channel has been used so they read as "this step is done,
          but here if you need to resend" affordances. Clicks route
          through the resend-confirmation modal in that state. */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={isDone ? "secondary" : "default"}
            onClick={openEmail}
            disabled={sendsBlocked}
            className={
              "gap-1.5" + (isDone ? " opacity-70 hover:opacity-100" : "")
            }
            title={blockedTitle}
          >
            <Mail className="size-4" />
            Send via email
          </Button>
          <Button
            size="sm"
            variant={isDone ? "secondary" : "outline"}
            onClick={openWhatsApp}
            disabled={sendsBlocked}
            className={
              "gap-1.5" + (isDone ? " opacity-70 hover:opacity-100" : "")
            }
            title={blockedTitle}
          >
            <MessageCircle className="size-4" />
            Send via WhatsApp
          </Button>
        </div>
      </div>

      {/* Bottom row: follow-up. Only after the first send — a
          follow-up before the customer's seen the original makes no
          sense. Sits BELOW the two primary send buttons (Peter
          2026-05-15 v2: "send follow up below of it") rather than
          inline alongside them. Separated from the send row by a
          full-width divider (Peter 2026-05-15 v3) so the two
          actions read as distinct phases — first-send vs nudge. */}
      {isDone && (
        <>
          <div className="border-t" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFollowUpOpen(true)}
              className="gap-1.5"
            >
              <Mail className="size-4" />
              Send follow-up email
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFollowUpWaOpen(true)}
              className="gap-1.5"
            >
              <MessageCircle className="size-4" />
              Send follow-up WhatsApp
            </Button>
          </div>
        </>
      )}

      {/* Banner launcher — separated from the send buttons by a
          full-width divider so it reads as a distinct phase rather
          than a sibling action. Sales sends the "site is ready"
          email first; later (after a call / follow-up) they fire
          the banner to push payment. The launcher is always
          available so the order is up to the operator. */}
      <div className="border-t" aria-hidden="true" />
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-foreground">
          Payment banner + discount
        </p>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Separate from the email above. Configure when you&apos;re
          ready to push payment — the live site will start showing
          the QR + discounted price.
        </p>
        <BannerLauncher proposal={proposal} site={site} />
      </div>

      <SendProposalDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        proposalId={proposal.id}
        companyName={proposal.company_name}
        contactEmail={proposal.contact?.email ?? null}
      />
      <SendProposalWhatsAppDialog
        open={waOpen}
        onOpenChange={setWaOpen}
        proposalId={proposal.id}
        companyName={proposal.company_name}
        contactPhone={proposal.contact?.phone ?? null}
        liveUrl={liveUrl}
        salesPersonName={proposal.sales?.full_name ?? null}
        clientEmail={site?.owner_email ?? proposal.contact?.email ?? null}
        clientPassword={proposal.client_temp_password}
        contactId={proposal.contact_id}
      />
      <FollowUpEmailDialog
        open={followUpOpen}
        onOpenChange={setFollowUpOpen}
        proposalId={proposal.id}
        companyName={proposal.company_name}
        contactEmail={proposal.contact?.email ?? null}
      />
      <FollowUpWhatsAppDialog
        open={followUpWaOpen}
        onOpenChange={setFollowUpWaOpen}
        proposalId={proposal.id}
        companyName={proposal.company_name}
        contactPhone={proposal.contact?.phone ?? null}
        liveUrl={liveUrl}
        salesPersonName={proposal.sales?.full_name ?? null}
        contactId={proposal.contact_id}
      />

      {/* Resend-confirmation modal. Surfaces the most recent send
          dates for both channels so sales sees the full picture
          before deciding to resend (e.g. "I already sent both two
          days ago — don't bother resending"). The CTA is channel-
          specific based on which button was clicked. */}
      <Dialog
        open={resendChannel !== null}
        onOpenChange={(o) => {
          if (!o) setResendChannel(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>You already sent this proposal to the client</DialogTitle>
            <DialogDescription className="space-y-2 pt-1">
              <span className="block">
                Before resending, check whether the client really needs
                it — it can come across as spam.
              </span>
              <span className="block text-foreground">
                Nothing is sent now. In the next step you can still edit
                the message and send it yourself.
              </span>
            </DialogDescription>
          </DialogHeader>
          {(emailSentAt || waSentAt || proposal.sent_at) && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1 text-xs">
              {emailSentAt && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Check className="size-3.5 text-emerald-500 shrink-0" />
                  <span className="text-foreground">
                    By email — {fmtDate(emailSentAt)}
                  </span>
                  {proposal.contact?.email && (
                    <>
                      <span className="text-muted-foreground/50">·</span>
                      <span className="font-mono text-muted-foreground">
                        {proposal.contact.email}
                      </span>
                    </>
                  )}
                </div>
              )}
              {waSentAt && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Check className="size-3.5 text-emerald-500 shrink-0" />
                  <span className="text-foreground">
                    WhatsApp — {fmtDate(waSentAt)}
                  </span>
                  {proposal.contact?.phone && (
                    <>
                      <span className="text-muted-foreground/50">·</span>
                      <span className="font-mono text-muted-foreground">
                        {proposal.contact.phone}
                      </span>
                    </>
                  )}
                </div>
              )}
              {/* Legacy fallback: proposals sent before the per-
                  channel proposal_emails logging shipped have no
                  channel timestamp. Surface the proposal-level
                  sent_at so the resend modal isn't empty. */}
              {!emailSentAt && !waSentAt && proposal.sent_at && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Check className="size-3.5 text-emerald-500 shrink-0" />
                  <span className="text-foreground">
                    Sent — {fmtDate(proposal.sent_at)}
                  </span>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="ghost"
              onClick={() => setResendChannel(null)}
            >
              Cancel
            </Button>
            <Button onClick={confirmResend} className="gap-1.5">
              {resendChannel === "whatsapp" ? (
                <MessageCircle className="size-4" />
              ) : (
                <Mail className="size-4" />
              )}
              {/* This does NOT send — it opens the compose step where the
                  user reviews + actually sends. The old "Yes, send again"
                  label made the team think it auto-sent, so they were
                  scared to click. "Continue" makes the next-step nature
                  explicit. */}
              {resendChannel === "whatsapp"
                ? "Continue to WhatsApp"
                : "Continue to email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sales context sidebar
   ───────────────────────────────────────────────────────────── */

function SalesContextSidebar({ proposal }: { proposal: TimelineProposal }) {
  const c = proposal.contact;
  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Company</h3>
        <div className="space-y-1 text-xs">
          <div className="font-medium text-sm">{proposal.company_name}</div>
          {(proposal.industry || proposal.town) && (
            <div className="flex items-center gap-2 text-muted-foreground">
              {proposal.town && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" />
                  {proposal.town}
                </span>
              )}
              {proposal.industry && <span>· {proposal.industry}</span>}
            </div>
          )}
        </div>
      </div>

      {c && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Contact</h3>
          <div className="space-y-1 text-xs">
            {c.contact_person && (
              <div className="text-foreground">{c.contact_person}</div>
            )}
            {c.phone && (
              <a
                href={`tel:${c.phone}`}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
              >
                <Phone className="size-3" />
                {c.phone}
              </a>
            )}
            {c.email && (
              <a
                href={`mailto:${c.email}`}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground break-all"
              >
                <Mail className="size-3 shrink-0" />
                {c.email}
              </a>
            )}
            {c.business_email && c.business_email !== c.email && (
              <a
                href={`mailto:${c.business_email}`}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground break-all"
              >
                <Mail className="size-3 shrink-0" />
                {c.business_email}{" "}
                <span className="text-muted-foreground/70">(business)</span>
              </a>
            )}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold mb-2">From sales</h3>
        {proposal.services && proposal.services.length > 0 && (
          <div className="mb-2">
            <div className="text-xs text-muted-foreground mb-1">Services</div>
            <div className="flex flex-wrap gap-1">
              {proposal.services.map((s) => (
                <Badge key={s} variant="secondary" className="text-[10px]">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {proposal.requirements && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Requirements</div>
            <p className="text-xs whitespace-pre-wrap leading-relaxed">
              {proposal.requirements}
            </p>
          </div>
        )}
        {(!proposal.services || proposal.services.length === 0) &&
          !proposal.requirements && (
            <p className="text-xs text-muted-foreground italic">
              No additional notes from sales.
            </p>
          )}
      </div>
    </div>
  );
}

function MessagesCard({
  proposalId,
  currentUserId,
  role,
}: {
  proposalId: string;
  currentUserId: string;
  role: TimelineRole;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <MessageCircle className="size-4 text-muted-foreground" />
        {role === "sales" ? "Messages with tech" : "Messages with sales"}
      </h3>
      <ProposalMessages
        proposalId={proposalId}
        currentUserId={currentUserId}
        currentUserRole={role}
      />
    </div>
  );
}
