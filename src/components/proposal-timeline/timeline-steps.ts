/**
 * Timeline step types + state derivation.
 *
 * Lives in its own non-client module so BOTH the server component
 * (page.tsx) and the client component (proposal-timeline.tsx) can
 * import from it. Putting `deriveSteps` inside a "use client" file
 * makes it a client function, which Next.js will not let a server
 * component call — that's the runtime error this module fixes.
 *
 * No React imports here — pure types + a pure derivation function.
 *
 * NOTE 2026-05-10: this file was relocated from
 * src/app/(dashboard)/tech/proposals/[id]/timeline-steps.ts to
 * src/components/proposal-timeline/timeline-steps.ts so the sales
 * proposal-detail page can render the same timeline as IT.
 *
 * NOTE 2026-05-10 (later): added `send_to_client` step ID, plus
 * a `welcome_client` step that was retired on 2026-05-21 once
 * credentials started shipping inline with the proposal email.
 * Both tech_admin and sales render the same step list.
 */

/**
 * Unwrap a `credit_balances(balance)` join result into a flat number.
 * Supabase returns embedded relations as either an array OR a single
 * object depending on the inferred cardinality, and either could be
 * absent — defaults to 0 when no row exists yet (fresh site).
 */
export function extractCreditBalance(siteRow: unknown): number {
  if (!siteRow || typeof siteRow !== "object") return 0;
  const cb = (siteRow as { credit_balances?: unknown }).credit_balances;
  if (!cb) return 0;
  if (Array.isArray(cb)) {
    return Number((cb[0] as { balance?: number } | undefined)?.balance ?? 0);
  }
  return Number((cb as { balance?: number }).balance ?? 0);
}

export type StepId =
  | "built"
  // Client zone management — auto-provisioned at publish, but the
  // step row stays visible so the operator can see + edit the
  // credentials (email, password) and regenerate them. Was removed
  // 2026-05-23 when we made the create path automatic; restored
  // 2026-05-27 because Peter still needs to view/manage. The
  // ClientZoneAction component handles both empty-state ("zone
  // not provisioned yet") and full credentials panel.
  | "client_zone"
  // Done when the salesperson has emailed the proposal landing page
  // to the customer (proposal.sent_at is set). Login credentials
  // ride inside this email's auto-appended block. The `welcome_client`
  // re-send step was retired — credentials ship with this email.
  | "send_to_client"
  | "custom_domain"
  | "business_email"
  // Terminal status indicator (Peter 2026-05-15). Read-only — flips
  // to `done` the moment proposal.status becomes "paid", whether
  // payment came from the QR banner (super confirms in
  // /super/payments) or the Mark-as-paid manual button. Without
  // this row sales has no signal that a banner-payment landed
  // unless they manually navigate to /live-clients.
  | "live_client";

// Note 2026-05-10: the "received" step (always-done, just stamped
// proposal.created_at) was removed — Peter found it noise. The
// proposal landing on this page already implies it was received,
// so the row was cermonial. If we ever want a creation-time row
// back, the data is still on `proposal.created_at`.

// Note 2026-05-10: the "sent_to_erik" / "Send to sales" step was
// removed. Per Peter, there's no longer a manual handoff button —
// once IT publishes the site, the proposal automatically becomes
// available to the salesperson (the publish endpoint now bumps the
// proposal status to `review` server-side, which is what the sales
// active list filters on). Keeping this comment so future readers
// don't get confused about the gap in the StepId union vs git
// history.

export type StepState = "done" | "active" | "pending";

export interface TimelineStep {
  id: StepId;
  label: string;
  description: string;
  state: StepState;
  doneAt?: string | null;
  hint?: string | null;
}

export interface TimelineProposal {
  id: string;
  status: string;
  company_name: string;
  industry: string | null;
  town: string | null;
  services: string[] | null;
  requirements: string | null;
  show_banner: boolean;
  client_temp_password: string | null;
  /**
   * Foreign-key into the contacts table. Used by the sales-only
   * "Called client" sub-action to log a handover outcome on the
   * contact's activity history (POST /api/contacts/[id]/call-log).
   * Null when the proposal was created without linking to a CRM
   * contact — the sub-action button still renders but skips the log.
   */
  contact_id: string | null;
  /** When the business-email setup notification was emailed to the client. */
  business_email_sent_at: string | null;
  /**
   * When the salesperson emailed the proposal landing page to the
   * customer (Send-to-client step). Required for the sales-only
   * timeline branches; tech doesn't read this.
   */
  sent_at: string | null;
  /**
   * Timestamps of the most recent send for each delivery channel.
   * Drive the "✓ Sent by email" / "✓ Sent via WhatsApp"
   * cues on SendToClientAction (Peter 2026-05-15: keep both
   * buttons clickable post-send so sales can re-send via the
   * other channel; just show which one was already used).
   * Resolved server-side from proposal_emails (latest row per
   * email_type). Authoritative "sent" gate stays `sent_at`.
   */
  sent_email_at: string | null;
  sent_whatsapp_at: string | null;
  /**
   * Pricing fields used by SendProposalDialog when launching the
   * Send-to-client action. `price` is the active (computed) price;
   * the dialog also needs the underlying `discount_price` and
   * `base_price` to prefill its form.
   *
   * `discount_expires_at` is also surfaced on the BannerConfigDialog
   * (per Peter 2026-05-10) so sales can extend the 14-day window
   * from the banner-config surface — handy when a client is
   * dragging their feet and the discount is about to lapse.
   */
  price: number | null;
  discount_price: number | null;
  base_price: number | null;
  discount_expires_at: string | null;
  created_at: string;
  /**
   * Timestamp when proposal.status flipped to "paid". Powers the
   * terminal "Live client" timeline step (Peter 2026-05-15). Set by
   * /api/admin/payments/confirm (QR-banner flow) AND /api/proposals/
   * [id]/mark-paid (manual flow). Null until the proposal converts.
   */
  paid_at: string | null;
  contact: {
    contact_person: string | null;
    phone: string | null;
    email: string | null;
    business_email: string | null;
  } | null;
  sales: {
    full_name: string | null;
  } | null;
  /** Pulled off the linked client profile (resolved server-side). */
  client_profile: {
    business_email: string | null;
    business_email_password: string | null;
  } | null;
}

export interface TimelineSite {
  id: string;
  owner_id: string | null;
  owner_email: string | null;
  /**
   * Profile.full_name of the site owner. Used by the welcome-client
   * step to prefill the SendWelcomeEmailDialog. Null when no owner
   * has been resolved yet (pre-client-zone).
   */
  owner_full_name: string | null;
  owner_role: string | null;
  /**
   * Current credit balance on the site (in euros). Surfaced inside the
   * Client zone details card so tech can grant/deduct credits inline
   * without leaving the proposal timeline. Defaults to 0 when no
   * credit_balances row exists yet.
   */
  credit_balance: number;
  last_published_at: string | null;
  domain: string | null;
  domain_status: string | null;
  site_url: string | null;
  subdomain: string | null;
  /**
   * Cloudflare custom-domain setup pipeline state. Drives the
   * Custom Domain step's live progress UI. NULL on rows that
   * haven't started a fresh-pipeline run since migration 00054
   * landed (legacy domains set via the old super-admin flow keep
   * `domain_status='active'` without a setup_status; the timeline
   * treats those as "done"). String values match the CHECK
   * constraint:
   *   not_started | creating_zone | waiting_dns | registering_pages
   *   | provisioning_ssl | active | failed
   */
  domain_setup_status: string | null;
  /** Wall-clock when the current pipeline run began. */
  domain_setup_started_at: string | null;
  /** Last error message from the pipeline (for the failure UI). */
  domain_setup_error: string | null;
  /**
   * Nameservers Cloudflare assigned to the zone — surfaced verbatim
   * in the timeline so sales can read them off if Hostcreator's
   * auto-delegation needs to be checked. Empty array when no zone
   * exists yet.
   */
  domain_nameservers: string[] | null;
  /** Requested domain (normalized to apex form during /domain/start). */
  requested_domain: string | null;
}

/**
 * Which dashboard the timeline is being rendered inside. Drives:
 *   - URL prefixes for in-page links (/tech vs /sales — handled in
 *     proposal-timeline.tsx, not here)
 *
 * Currently both roles render the same step list — the parameter
 * is kept so future role-specific gating can land without another
 * signature change. Defaults to "tech_admin" for backwards compat.
 */
export type TimelineRole = "tech_admin" | "sales";

/**
 * Derive the state of every timeline step from the loaded proposal +
 * site rows. Pure — no side effects, no React, no async. Same input
 * always produces the same output, so it's safe to run server-side
 * during the page render OR client-side on a refresh.
 *
 * `role` is optional, defaults to "tech_admin" for backwards-compat
 * with any caller that hasn't been updated.
 */
export function deriveSteps(
  proposal: TimelineProposal,
  site: TimelineSite | null,
  role: TimelineRole = "tech_admin",
): TimelineStep[] {
  const steps: TimelineStep[] = [];
  // (`role` is currently unused — kept in the signature for
  //  backwards compat. Both tech_admin and sales render the same
  //  step list.)
  void role;

  // (The "Received" step that used to live first — always-done,
  //  stamped at proposal.created_at — was removed 2026-05-10. Page
  //  load already implies the proposal was received; the row was
  //  ceremonial. proposal.created_at is still available on the
  //  TimelineProposal type if any caller needs it.)

  // Status-based fallback for upstream "done" detection. When
  // proposal.status has advanced past the build phase, we know the
  // upstream steps were completed at SOME point — even if the direct
  // data signals (last_published_at, owner_role) aren't populated on
  // the row. This catches legacy rows where status was bumped
  // manually before the auto-flip-on-publish logic landed
  // (2026-05-10), and avoids the timeline showing a stuck "Build
  // still active" pill on proposals sales is already working.
  //
  // Status only ever moves forward in the workflow, so a downstream
  // status implies all upstream gates were cleared. Combining the
  // status fallback with the direct data signal gives us the right
  // answer for every cohort:
  //   - new proposals → data signals fire, status follows
  //   - legacy proposals → data signals empty, status fills the gap
  const reviewOrBeyond = ["review", "sent", "viewed", "paid"].includes(
    proposal.status,
  );

  // 1. Built — done when site has been published OR proposal moved past build
  const builtDone = !!site?.last_published_at || reviewOrBeyond;
  steps.push({
    id: "built",
    label: "Build + publish site",
    description: "Open the composer, build the site, and publish it.",
    state: builtDone ? "done" : "active",
    doneAt: site?.last_published_at ?? undefined,
    hint: !site ? "Open the composer to start building." : null,
  });

  // 2. Client zone — auto-provisioned at publish (see
  //    ensureClientZone in /api/sites/[id]/publish), but the step
  //    stays visible so operators can view + edit + regenerate
  //    credentials inline (Peter 2026-05-27 restored this row after
  //    we'd removed it 2026-05-23 — auto-create is fine, but he
  //    still needs the credential panel on the proposal page rather
  //    than navigating to /live-clients each time).
  //
  //    State logic:
  //      done   — owner_role === "client" (zone exists)
  //      active — site is built but the owner_role isn't "client" yet
  //               (auto-create hadn't run or failed; the panel exposes
  //               a manual create button as the recovery path)
  //      pending — site not built yet
  const clientZoneDone = site?.owner_role === "client" || reviewOrBeyond;
  let clientZoneState: StepState;
  if (clientZoneDone) clientZoneState = "done";
  else if (builtDone) clientZoneState = "active";
  else clientZoneState = "pending";

  steps.push({
    id: "client_zone",
    label: "Client zone",
    description: "View + manage the client's login credentials.",
    state: clientZoneState,
    hint:
      clientZoneState === "pending"
        ? "Waiting for the site to be published — client zone auto-creates then."
        : null,
  });

  // 2. Send to client — emails the live website URL to the customer
  //    along with their client-zone login credentials (auto-appended
  //    by buildProposalEmailHtml). Done when proposal.sent_at is set.
  //
  //    Active the moment publish is done; client zone auto-happens
  //    at publish so there's no separate gate. The pricing / banner
  //    used to live here too — Peter 2026-05-23 split that into a
  //    standalone "Payment banner + discount" action inside the
  //    SendToClientAction component so sending the email no longer
  //    triggers any pricing side effect.
  {
    const sentOrBeyond = ["sent", "viewed", "paid"].includes(proposal.status);
    const sentToClientDone = !!proposal.sent_at || sentOrBeyond;
    let sendToClientState: StepState;
    if (sentToClientDone) sendToClientState = "done";
    else if (builtDone) sendToClientState = "active";
    else sendToClientState = "pending";

    steps.push({
      id: "send_to_client",
      label: "Send to client",
      description:
        "Email the customer the website link + their client zone login.",
      state: sendToClientState,
      doneAt: proposal.sent_at ?? undefined,
      hint:
        sendToClientState === "pending"
          ? "Waiting for the site to be published."
          : sendToClientState === "active"
            ? "Compose + send. The payment banner + discount is a separate action below the send buttons."
            : null,
    });
  }

  // (The "Send to sales" step that lived here in the old flow was
  //  removed 2026-05-10 — see the note at the top of this file. The
  //  "Paid" step was also previously here; payment now lives in
  //  /super/payments only.)

  // 4. Custom domain — three states drive the row circle:
  //
  //   done     — pipeline reached the "active" terminal, OR a legacy
  //              row has domain + domain_status='active' (super-admin-
  //              approved before migration 00054 introduced the new
  //              setup_status column)
  //   active   — pipeline is mid-flight (creating_zone / waiting_dns /
  //              registering_pages / provisioning_ssl) or failed;
  //              CustomDomainAction renders the live progress UI in
  //              both cases so sales can see what's happening (or
  //              what went wrong) and retry
  //   pending  — nothing requested yet
  const setupStatus = site?.domain_setup_status ?? null;
  const setupActive = setupStatus === "active";
  const legacyDone =
    !!site?.domain &&
    site.domain.length > 0 &&
    site.domain_status === "active" &&
    setupStatus === null;
  const domainDone = setupActive || legacyDone;

  const setupInFlight =
    setupStatus !== null &&
    setupStatus !== "active" &&
    setupStatus !== "not_started";

  let customDomainState: StepState;
  if (domainDone) customDomainState = "done";
  else if (setupInFlight) customDomainState = "active";
  else customDomainState = "pending";

  steps.push({
    id: "custom_domain",
    label: "Custom domain",
    description: "Optional. Wire up the domain the client purchased.",
    state: customDomainState,
    hint:
      customDomainState === "pending"
        ? "Optional — set after the client buys a real domain."
        : null,
  });

  // 5. Business email — gated on custom_domain.done. Per Peter
  //    2026-05-08: a Hostinger mailbox like info@yourcompany.sk
  //    can't exist until the client actually owns yourcompany.sk,
  //    so this step has to wait for the .sk to land. Stays pending
  //    (and the launcher button stays disabled) until then.
  const businessEmailDone = !!proposal.business_email_sent_at;
  let businessEmailState: StepState;
  if (businessEmailDone) businessEmailState = "done";
  else if (domainDone) businessEmailState = "active";
  else businessEmailState = "pending";

  steps.push({
    id: "business_email",
    label: "Business email",
    description:
      "Set up the client's Hostinger mailbox and email them the login.",
    state: businessEmailState,
    doneAt: proposal.business_email_sent_at ?? undefined,
    hint:
      businessEmailState === "pending"
        ? "Waiting for the custom domain to be active — the mailbox needs the domain first."
        : businessEmailState === "active"
          ? "Create info@… in Hostinger, then paste the credentials here."
          : null,
  });

  // 6. Live (paying) client — terminal status indicator. Read-only.
  //
  //    2026-05-21: the previous "Welcome client" step was removed.
  //    Login credentials now ship inline with the proposal email
  //    (auto-appended block in buildProposalEmailHtml), so a
  //    separate welcome-email surface was redundant — operators
  //    were sending two emails saying "your site is ready" with
  //    overlapping copy. Re-send happens via Send-to-client's
  //    "Send again" path, which re-includes credentials.
  //
  //    Purpose: give sales an unmissable signal when a banner-paid
  //    customer's status flips, since otherwise that path is silent
  //    (boss confirms in /super/payments → DB updates → nothing on
  //    this page changes unless we have a row here).
  //
  //    State logic:
  //      done    — status === "paid". Done timestamp is paid_at.
  //                Hint links to /live-clients detail so sales can
  //                drill in for invoice + credentials actions.
  //      active  — proposal is out in front of the client (sent or
  //                viewed). QR banner is live, money may arrive any
  //                moment. Hint reminds operator to use Mark-as-paid
  //                if money came in off-channel (invoice / cash).
  //      pending — proposal not yet sent. No banner, no payment path
  //                open. Hint waits-on the send_to_client step.
  //
  //    This is a STATUS row, not an ACTION row — no launcher button.
  {
    const isPaid = proposal.status === "paid";
    const isSentOrViewed = ["sent", "viewed"].includes(proposal.status);
    let liveClientState: StepState;
    if (isPaid) liveClientState = "done";
    else if (isSentOrViewed) liveClientState = "active";
    else liveClientState = "pending";

    steps.push({
      id: "live_client",
      label: "Paid",
      description: "Confirms when the client pays.",
      state: liveClientState,
      doneAt: proposal.paid_at ?? undefined,
      hint:
        liveClientState === "done"
          ? "Client paid. Manage them in Live Clients."
          : liveClientState === "active"
            ? "Waiting for payment. If they paid another way, use Mark as paid above."
            : "Send the proposal first.",
    });
  }

  return steps;
}
