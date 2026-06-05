"use client";

/**
 * Publish menu — Framer-style.
 *
 * One button that opens a popover combining everything publish-related:
 *   - Live URL (with Open) at the top
 *   - "Publish update" primary action
 *   - History of last 5 versions with Open + Revert per row
 *
 * Replaces the previously-separate Publish button + History dropdown.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Rocket, CaretDown as ChevronDown, CaretRight as ChevronRight, ArrowSquareOut as ExternalLink, ArrowCounterClockwise as RotateCcw, CircleNotch as Loader2, Globe, Check, Clock, WarningCircle as AlertCircle } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { SiteActivationDialog } from "@/components/payments/site-activation-dialog";

interface VersionRow {
  id: string;
  created_at: string;
  reason: string;
  /** Permanent CF deployment URL for read-only preview. Null on legacy rows. */
  deployment_url: string | null;
  created_by_name: string | null;
  /** Role of the user who published — drives the team label in the UI. */
  created_by_role: string | null;
}

const REASON_LABELS: Record<string, string> = {
  tech_publish: "Published",
  rollback: "Reverted",
  change_request_apply: "Client edit applied",
  initial: "Initial version",
};

/**
 * Map an app role to the team label shown in the version history.
 *
 * We display "who" at the team level rather than by personal name so:
 *   1. The UI doesn't change when staff turnover happens.
 *   2. Future tracking (sales pushes vs client edits vs tech-admin updates)
 *      falls naturally out of these three buckets — no per-person mapping.
 */
function roleToTeam(role: string | null | undefined): string {
  switch (role) {
    case "tech_admin":
    case "super_admin":
      return "IT team";
    case "sales":
      return "Salesperson";
    case "administrator":
      return "Admin";
    case "client":
      return "Client";
    default:
      return "Unknown";
  }
}

interface Props {
  siteId: string;
  /** True while a publish from the parent is in flight (button shows spinner). */
  publishing: boolean;
  /** Called when the user clicks "Publish update". Parent owns the publish flow
   *  (including pre-flush of pending saves + post-success refresh). */
  onPublish: () => void | Promise<void>;
  /** Site's `site_url` — the friendly URL after publish (custom domain when
   *  configured, else .pages.dev). When set we display this instead of
   *  deriving from the deployment URL, so the menu shows e.g.
   *  `nexedge77.pages.dev` instead of the raw deployment URL. */
  siteUrl?: string;
  /** Async flush for any pending composition autosave (250ms debounce).
   *  The subdomain editor calls this BEFORE its window.location.reload()
   *  so a recent image upload doesn't get dropped on the reload — same
   *  protection handlePublish already gets. Optional so this component
   *  still works in older callsites that haven't wired it through. */
  flushPendingComposition?: () => Promise<void>;
  /** "tech" (default) shows the full menu — subdomain editor + publish +
   *  history with revert. "client" hides structural pieces (subdomain
   *  editor + history list) but keeps the primary Publish button and the
   *  "Live at" URL display. Clients publish their content edits directly
   *  in v1; admin retains revert ability via tech mode. */
  mode?: "tech" | "client";
}

interface CreditInfo {
  balance: number;
  publishCost: number;
  canPublish: boolean;
  isPaid: boolean;
  /** Which gate is blocking publish (when canPublish=false). null when good. */
  paywallReason: "site_not_paid" | "insufficient_credits" | null;
}

/**
 * Latest actionable publish request for the site (client mode only).
 *   - pending  → client is waiting for IT review. The request button
 *                stays ENABLED but relabeled "Update request";
 *                clicking re-submits with the latest composition,
 *                overrides the prior pending row, and charges another
 *                $12.50 (the first charge is forfeit).
 *   - rejected → IT declined; show the reason + $12.50 was refunded
 *                + let the client re-request.
 * approved / cancelled / overridden requests are historical and
 * reported as null by the credit-balance endpoint.
 */
interface PublishRequestState {
  status: "pending" | "rejected";
  reviewNote: string | null;
}

export function PublishMenu({
  siteId,
  publishing,
  onPublish,
  siteUrl,
  flushPendingComposition,
  mode = "tech",
}: Props) {
  const isClientMode = mode === "client";
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [confirmTarget, setConfirmTarget] = useState<VersionRow | null>(null);
  const [reverting, setReverting] = useState(false);
  // History is collapsed by default — only fetches + renders the list when
  // expanded so opening the popover stays instant.
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  // Credit balance shown above the Publish button in client mode. Fetched
  // once on mount and after every publish (since the post-charge balance
  // changes). Tech / sales / admin modes leave this null and skip the
  // gating UI entirely — they don't pay per publish.
  const [credit, setCredit] = useState<CreditInfo | null>(null);
  // Latest pending/rejected publish request (client mode). Drives the
  // request button's "waiting for review" / "rejected" states. Loaded
  // alongside the balance from the same credit-balance response.
  const [publishRequest, setPublishRequest] =
    useState<PublishRequestState | null>(null);

  // Activation dialog visibility — the dialog's internal state (stage 1
  // intro vs stage 2 QR reveal, fetch, etc.) lives inside the shared
  // <SiteActivationDialog> component. Same dialog opens from the dashboard
  // "set up domain + email" card so the paywall message is identical
  // across surfaces.
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  /** Open the activation dialog and close the publish popover behind it
   *  so the modal sits on top cleanly. */
  function openPaymentDialog() {
    setPaymentDialogOpen(true);
    setOpen(false);
  }

  /**
   * Refetch the site's credit balance + per-publish cost. No-op outside
   * client mode (only clients are charged, so only the client UI needs
   * the gating display). Errors swallow silently — we'd rather render
   * the publish button "unsure" than break the menu over a balance fetch.
   */
  const reloadCredit = useCallback(async () => {
    if (!isClientMode) return;
    try {
      const res = await fetch(`/api/sites/${siteId}/credit-balance`);
      if (!res.ok) return;
      const data = await res.json();
      setCredit({
        balance: Number(data.balance ?? 0),
        publishCost: Number(data.publish_cost ?? 12.5),
        canPublish: Boolean(data.can_publish),
        isPaid: Boolean(data.is_paid),
        paywallReason:
          data.paywall_reason === "site_not_paid" ||
          data.paywall_reason === "insufficient_credits"
            ? data.paywall_reason
            : null,
      });
      const pr = data.publish_request;
      setPublishRequest(
        pr && (pr.status === "pending" || pr.status === "rejected")
          ? { status: pr.status, reviewNote: pr.review_note ?? null }
          : null,
      );
    } catch {
      // Network blip — leave previous value (or null) in place.
    }
  }, [isClientMode, siteId]);

  useEffect(() => {
    void reloadCredit();
  }, [reloadCredit]);
  // Refresh after a publish settles — captures the post-charge balance.
  useEffect(() => {
    if (!publishing) void reloadCredit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishing]);

  // Top version is the currently-live one (most recent).
  const liveVersion = versions[0] ?? null;
  // Stable production URL — prefer the custom domain (e.g. nexedge77.pages.dev)
  // when site_url has been populated by publish. Fall back to stripping the
  // deployment hash from the version URL (works for sites that haven't yet
  // been republished after the custom-domain feature shipped).
  const stableUrl = siteUrl
    ? siteUrl
    : liveVersion?.deployment_url
      ? liveVersion.deployment_url.replace(/\/\/[^.]+\./, "//")
      : null;

  // Fetch versions — used both for the Live URL section (one fetch on open)
  // and to refresh after publish/revert. Cheap (small JSON), runs once per
  // popover-open by default; the History section reuses the same data.
  function reload() {
    setLoading(true);
    fetch(`/api/sites/${siteId}/versions`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          toast.error(data.error);
          return;
        }
        setVersions(data.versions ?? []);
        setHasFetched(true);
      })
      .catch(() => toast.error("Failed to load versions"))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    if (open && !hasFetched) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, siteId]);
  // After a parent-driven publish completes (publishing flips false), refresh.
  useEffect(() => {
    if (!publishing && hasFetched) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishing]);

  async function doRevert(version: VersionRow) {
    setReverting(true);
    try {
      const res = await fetch(
        `/api/sites/${siteId}/versions/${version.id}/revert`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Revert failed");
        return;
      }
      toast.success(`Reverted! Live at ${data.url}`, { duration: 8000 });
      setConfirmTarget(null);
      reload();
      // Refresh the page so the composer reflects the reverted composition
      window.location.reload();
    } catch {
      toast.error("Network error");
    } finally {
      setReverting(false);
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            disabled={publishing}
            className="gap-1.5"
            title="Publish & history"
          >
            {publishing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            {publishing ? "Publishing..." : "Publish"}
            <ChevronDown className="h-3 w-3 opacity-70" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 p-0">
          {/* ── Live URL section ──
              The URL itself is the clickable link — no separate Open button.
              The ↗ icon next to the URL signals "opens in new tab".
              Three states:
                1. Initial fetch in flight  → skeleton (avoids the jarring
                   "Not published yet" flash that misleads the user during
                   the ~500ms first-fetch window)
                2. Fetched, has version     → real URL + meta
                3. Fetched, no version      → "Not published yet" (truthful) */}
          {!hasFetched ? (
            <div className="dash-subhead dash-hairline px-3 py-2.5 border-b animate-pulse">
              <div className="flex items-start gap-2">
                <Globe className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-2 w-12 rounded bg-muted-foreground/15" />
                  <div className="h-3 w-40 rounded bg-muted-foreground/20" />
                  <div className="h-2 w-28 rounded bg-muted-foreground/10 mt-2" />
                </div>
              </div>
            </div>
          ) : stableUrl ? (
            <div className="dash-subhead dash-hairline px-3 py-2.5 border-b">
              <div className="flex items-start gap-2">
                <span className="dash-chip inline-flex h-5 w-5 items-center justify-center rounded-md shrink-0 mt-0.5">
                  <Globe className="h-3 w-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground/80">
                    Live at
                  </p>
                  <a
                    href={stableUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="dash-accent inline-flex items-center gap-1 text-[12px] font-medium hover:underline max-w-full"
                    title="Open live site in new tab"
                  >
                    <span className="truncate">
                      {stableUrl.replace(/^https?:\/\//, "")}
                    </span>
                    <ExternalLink className="h-3 w-3 opacity-70 shrink-0" />
                  </a>
                </div>
              </div>
              {liveVersion && (
                <p className="text-[10px] text-muted-foreground mt-1.5 ml-7">
                  Last update: {formatRelative(liveVersion.created_at)} ·{" "}
                  {roleToTeam(liveVersion.created_by_role)}
                </p>
              )}
            </div>
          ) : (
            <div className="dash-subhead dash-hairline px-3 py-3 border-b text-center">
              <p className="text-[11px] text-muted-foreground">
                Not published yet
              </p>
            </div>
          )}

          {/* ── Subdomain editor ──
              Sales/tech can pick the *.{PROPOSAL_DOMAIN} subdomain. Loads
              the current value lazily on popover open (cheap GET). On save,
              the API swaps the Cloudflare custom domain mapping atomically
              and updates site_url. Format + uniqueness are checked live as
              the user types so the Save button is only enabled when valid.
              Hidden in client mode — clients can't change their subdomain. */}
          {!isClientMode && (
            <SubdomainEditor
              siteId={siteId}
              onSaved={reload}
              onBeforeReload={flushPendingComposition}
            />
          )}

          {/* ── Primary action ──
              Two completely different flows:

              CLIENT mode → "Request publish". The client can't push live
              directly anymore (Peter 2026-05-29): clicking submits a
              request that an IT/tech admin approves on the proposal
              pipeline page, and the $12.50 is charged there at go-live.
              The button has three states (request / waiting / rejected),
              all handled inside ClientRequestAction.

              TECH / sales / super mode → the original direct-publish
              button (onPublish), unchanged + free. */}
          {isClientMode ? (
            <ClientRequestAction
              siteId={siteId}
              credit={credit}
              publishRequest={publishRequest}
              flushPendingComposition={flushPendingComposition}
              onChanged={reloadCredit}
              openPaymentDialog={openPaymentDialog}
            />
          ) : (
            <div className="px-3 py-3 border-b">
              <Button
                className="w-full gap-1.5"
                onClick={async () => {
                  await onPublish();
                  // The parent toggles `publishing`; the effect above
                  // reloads versions when it flips back to false.
                }}
                disabled={publishing}
              >
                {publishing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Publishing...
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" />
                    <span>{stableUrl ? "Publish update" : "Publish"}</span>
                  </>
                )}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center mt-1.5">
                {stableUrl
                  ? "Updates the live site with current composition"
                  : "Pushes the site live for the first time"}
              </p>
            </div>
          )}

          {/* ── History (collapsed by default — click header to expand) ──
              Visible in BOTH tech and client modes (Peter 2026-05-08): the
              client zone should mirror what the IT side sees, including
              Revert — the only thing held back from clients is the
              SubdomainEditor above. The history list is read-mostly anyway
              (look at past publishes, click to preview), and Revert simply
              re-publishes an older snapshot which clients are already
              allowed to do via the Publish button. */}
          <button
            type="button"
            onClick={() => setHistoryExpanded((e) => !e)}
            className="dash-subhead dash-hairline dash-row w-full flex items-center gap-1.5 px-3 py-2 border-b text-left"
            aria-expanded={historyExpanded}
          >
            {historyExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                History
              </p>
              <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                {historyExpanded
                  ? "Click a URL to preview · Revert to roll back"
                  : `Last ${versions.length || 5} publishes`}
              </p>
            </div>
          </button>

          {historyExpanded &&
            (loading ? (
              <div className="px-3 py-6 flex items-center justify-center text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Loading…
              </div>
            ) : versions.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No publish history yet.
              </div>
            ) : (
              <ul className="max-h-72 overflow-y-auto">
                {versions.map((v, idx) => (
                  <li
                    key={v.id}
                    className="dash-row dash-hairline px-3 py-2.5 border-b last:border-b-0 flex items-start gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      {/* Header row: timestamp · author · Live badge */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-medium">
                          {formatRelative(v.created_at)}
                        </span>
                        {idx === 0 && (
                          <span className="dash-chip-pink text-[9px] uppercase rounded px-1.5 py-0.5 font-semibold">
                            Live
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          · {REASON_LABELS[v.reason] ?? v.reason} ·{" "}
                          {roleToTeam(v.created_by_role)}
                        </span>
                      </div>
                      {/* URL row — clickable link with ↗ icon. THIS is the
                          preview action; no separate Preview button. */}
                      {v.deployment_url ? (
                        <a
                          href={v.deployment_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="dash-accent mt-1 inline-flex items-center gap-1 text-[11px] hover:underline max-w-full"
                          title="Open this version in a new tab"
                        >
                          <span className="truncate">
                            {v.deployment_url.replace(/^https?:\/\//, "")}
                          </span>
                          <ExternalLink className="h-2.5 w-2.5 opacity-70 shrink-0" />
                        </a>
                      ) : (
                        <p className="mt-1 text-[10px] text-muted-foreground/70 italic">
                          Preview not available for this version
                        </p>
                      )}
                    </div>
                    {/* Revert with explicit text label so it's obvious. */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 gap-1 text-[11px] shrink-0"
                      onClick={() => setConfirmTarget(v)}
                      disabled={idx === 0}
                      title={
                        idx === 0
                          ? "This is already the live version"
                          : "Revert to this version"
                      }
                    >
                      <RotateCcw className="h-3 w-3" />
                      Revert
                    </Button>
                  </li>
                ))}
              </ul>
            ))}
        </PopoverContent>
      </Popover>

      {/* Shared site-activation dialog (used in both publish flow and
          dashboard's "set up domain + email" card). Stage 1 intro,
          stage 2 reveals the QR + bank info on demand. */}
      <SiteActivationDialog
        siteId={siteId}
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
      />

      {/* Revert confirmation dialog */}
      <Dialog
        open={!!confirmTarget}
        onOpenChange={(o) => !o && !reverting && setConfirmTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Revert to this version?</DialogTitle>
            <DialogDescription asChild>
              {confirmTarget ? (
                <div className="space-y-3 text-sm">
                  <p>
                    This will roll back the live site to{" "}
                    <strong>{formatRelative(confirmTarget.created_at)}</strong>{" "}
                    (
                    {REASON_LABELS[confirmTarget.reason] ??
                      confirmTarget.reason}
                    {confirmTarget.created_by_name &&
                      ` · ${confirmTarget.created_by_name}`}
                    ).
                  </p>
                  <p className="text-destructive font-medium">
                    All changes you made after that version will be lost.
                  </p>
                  <p className="text-muted-foreground">
                    A new version snapshot will be created so this revert
                    itself can be undone later.
                  </p>
                </div>
              ) : (
                <span />
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={reverting}
              onClick={() => setConfirmTarget(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (confirmTarget) doRevert(confirmTarget);
              }}
              disabled={reverting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {reverting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Reverting…
                </>
              ) : (
                "Revert and Publish"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Client-mode primary action — "Request publish".
 *
 * Clients can't push live directly anymore. This submits a publish
 * request that an IT/tech admin approves on the proposal pipeline
 * page. The $12.50 is charged AT SUBMIT time (Peter 2026-05-30) —
 * approve does not re-charge, reject refunds.
 *
 * Three states:
 *   - pending  → button STAYS ENABLED, relabeled "Update request
 *                · $12.50". Clicking overrides the prior pending row
 *                (first charge forfeit) and submits the latest
 *                composition as a fresh request with its own $12.50.
 *                A warning above the button spells this out so the
 *                client knows what re-clicking costs.
 *   - rejected → reason banner + refund confirmation + a fresh
 *                "Request publish" button.
 *   - normal   → "Request publish · $12.50".
 *
 * Paywalls mirror the old direct-publish UI: site_not_paid opens the
 * activation dialog; insufficient_credits disables with a top-up link.
 */
function ClientRequestAction({
  siteId,
  credit,
  publishRequest,
  flushPendingComposition,
  onChanged,
  openPaymentDialog,
}: {
  siteId: string;
  credit: CreditInfo | null;
  publishRequest: PublishRequestState | null;
  flushPendingComposition?: () => Promise<void>;
  /** Refetch balance + request state after a successful request. */
  onChanged: () => void | Promise<void>;
  openPaymentDialog: () => void;
}) {
  const [requesting, setRequesting] = useState(false);

  const isPending = publishRequest?.status === "pending";
  const wasRejected = publishRequest?.status === "rejected";
  const insufficient = credit?.paywallReason === "insufficient_credits";
  const notPaid = credit?.paywallReason === "site_not_paid";

  async function doRequest() {
    if (requesting) return;
    // Unpaid gate — explain via the activation modal instead of firing
    // a request the server would 402 anyway.
    if (notPaid) {
      openPaymentDialog();
      return;
    }
    setRequesting(true);
    try {
      // Flush any pending autosave so IT reviews/publishes the latest
      // composition. Best-effort — a failure shouldn't block the request
      // (the 250ms autosave fires on its own regardless).
      if (flushPendingComposition) {
        try {
          await flushPendingComposition();
        } catch {
          /* non-fatal */
        }
      }
      const res = await fetch(`/api/sites/${siteId}/publish-request`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "SITE_NOT_PAID") {
          openPaymentDialog();
        } else {
          toast.error(data.error || "The request could not be sent.");
        }
        return;
      }
      // Different success toast depending on whether this submit
      // replaced an earlier pending request (overrode_id non-null)
      // or was a fresh first request. The override toast reminds the
      // client they were just charged again — they should see that
      // immediately, not just notice it next time they open balance.
      if (data.overrode_id) {
        toast.success(
          "Your previous request was replaced. $12.50 was deducted from your balance.",
          { duration: 7000 },
        );
      } else {
        toast.success("Request sent. We'll publish your changes within 24 hours.", {
          duration: 6000,
        });
      }
      await onChanged();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setRequesting(false);
    }
  }

  // Single render path covers all three states — pending, rejected,
  // and normal. The only differences are the banner above the button
  // (rejected only), the button label (Update vs Request), and
  // the helper line under the button (override warning vs 24h note).
  // Keeping them in one branch means the credit row + insufficient
  // gate stay identical across states.
  const buttonLabel = isPending
    ? "Update request"
    : "Request publish";

  return (
    <div className="px-3 py-3 border-b">
      {wasRejected && (
        <div className="mb-2.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[11px] leading-snug">
          <p className="font-medium text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Changes were not approved
          </p>
          {publishRequest?.reviewNote && (
            <p className="text-muted-foreground mt-0.5">
              {publishRequest.reviewNote}
            </p>
          )}
          <p className="text-muted-foreground mt-0.5">
            $12.50 has been refunded to your balance. Edit as needed and
            send again.
          </p>
        </div>
      )}

      {isPending && (
        <div className="mb-2.5 rounded-md border border-amber-300/60 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-950/30 px-2.5 py-2 text-[11px] leading-snug">
          <p className="font-medium text-amber-900 dark:text-amber-200 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            You have a request awaiting approval
          </p>
          <p className="text-amber-800/80 dark:text-amber-200/80 mt-0.5">
            Clicking replaces it with your latest changes ($12.50 fee).
            The previous fee is not refunded.
          </p>
        </div>
      )}

      {credit && (
        <div className="flex items-center justify-between text-[11px] mb-2 px-0.5">
          <span className="text-muted-foreground">Balance</span>
          <span
            className={`font-semibold tabular-nums ${
              insufficient ? "text-destructive" : ""
            }`}
          >
            ${credit.balance.toFixed(2)}
          </span>
        </div>
      )}

      <Button
        className="w-full gap-1.5"
        onClick={doRequest}
        disabled={requesting || insufficient}
        variant={isPending ? "secondary" : "default"}
      >
        {requesting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Sending…
          </>
        ) : (
          <>
            <Rocket className="h-4 w-4" />
            <span>{buttonLabel}</span>
            {credit && (
              <span className="opacity-80 tabular-nums">
                · ${credit.publishCost.toFixed(2)}
              </span>
            )}
          </>
        )}
      </Button>

      {insufficient ? (
        <p className="text-[11px] text-destructive text-center mt-1.5 leading-snug">
          Not enough credits —{" "}
          <a
            href="/client/balance"
            className="underline underline-offset-2 hover:text-destructive/80 font-medium"
          >
            top up credits
          </a>
          .
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground text-center mt-1.5">
          We'll publish your changes within 24 hours.
        </p>
      )}
    </div>
  );
}

/**
 * Inline subdomain picker. Loads the site's current subdomain on first
 * render, then debounces availability checks as the user types. Save is
 * only enabled when the value is valid AND available AND different from
 * the current persisted value.
 */
function SubdomainEditor({
  siteId,
  onSaved,
  onBeforeReload,
}: {
  siteId: string;
  /** Called after a successful save so the parent can refetch versions /
   *  refresh the displayed live URL. */
  onSaved: () => void;
  /** Optional async flush of any pending composition autosave (the 250ms
   *  debounce window). Awaited BEFORE window.location.reload() so a recent
   *  image upload — in the SEO panel or in any section — doesn't get
   *  dropped when the page reloads to pick up the new subdomain. */
  onBeforeReload?: () => Promise<void>;
}) {
  // null = not yet loaded; "" = loaded but empty; string = current value
  const [persisted, setPersisted] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [value, setValue] = useState<string>("");
  // Custom domain takes over the editor UI when active. Per Peter
  // 2026-05-10 v2: once the Cloudflare pipeline reaches "active" and
  // the site has a real .sk attached, the *.{PROPOSAL_DOMAIN}
  // subdomain becomes a fallback the user shouldn't be tweaking
  // anymore — the live URL is the custom domain. We surface it
  // read-only here and disable the input. The subdomain itself is
  // not deleted (it stays valid as a fallback URL), just hidden.
  const [customDomain, setCustomDomain] = useState<string | null>(null);
  const [customDomainActive, setCustomDomainActive] = useState(false);
  const [check, setCheck] = useState<{
    state: "idle" | "checking" | "ok" | "bad";
    msg?: string;
  }>({ state: "idle" });
  const [saving, setSaving] = useState(false);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load on mount.
  useEffect(() => {
    fetch(`/api/sites/${siteId}/subdomain`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) return;
        setPersisted(data.subdomain ?? "");
        setDomain(data.domain ?? null);
        setValue(data.subdomain ?? "");
        setCustomDomain(data.customDomain ?? null);
        setCustomDomainActive(!!data.customDomainActive);
      })
      .catch(() => {});
  }, [siteId]);

  // Debounced availability check as user types.
  const runCheck = useCallback(
    (candidate: string) => {
      if (checkTimer.current) clearTimeout(checkTimer.current);
      // Same as persisted → no check needed (it's already "available").
      if (candidate === persisted) {
        setCheck({ state: "idle" });
        return;
      }
      // Empty / very short → don't bother the server, just show neutral.
      if (candidate.length < 3) {
        setCheck({ state: "bad", msg: "Min 3 characters" });
        return;
      }
      setCheck({ state: "checking" });
      checkTimer.current = setTimeout(() => {
        fetch(
          `/api/sites/${siteId}/subdomain?check=${encodeURIComponent(candidate)}`,
        )
          .then((r) => r.json())
          .then((data) => {
            if (data.available) {
              setCheck({ state: "ok" });
            } else {
              setCheck({ state: "bad", msg: data.error ?? "Not available" });
            }
          })
          .catch(() => setCheck({ state: "bad", msg: "Check failed" }));
      }, 350);
    },
    [persisted, siteId],
  );

  function onChangeValue(v: string) {
    setValue(v);
    runCheck(v);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/subdomain`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Save failed");
        return;
      }
      toast.success(`Subdomain set to ${value}.${domain}`);
      setPersisted(value);
      setCheck({ state: "idle" });
      onSaved();
      // CRITICAL: flush any pending composition autosave BEFORE reload.
      // Without this, anything in the 250ms autosave debounce window —
      // typically a fresh image upload in the SEO panel or a section —
      // gets dropped when the page reloads, and the user sees images
      // mysteriously "removed" after the subdomain change.
      if (onBeforeReload) {
        try {
          await onBeforeReload();
        } catch (err) {
          // Don't block the reload on flush failure — better to land
          // on a slightly stale composition than to leave the user
          // stuck on a "saved subdomain but didn't reload" state.
          console.error("[subdomain] flush before reload failed:", err);
        }
      }
      // Reload the page so siteUrl context, base href, and "LIVE AT"
      // section all reflect the new subdomain. Same pattern as revert.
      window.location.reload();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  // Don't render anything if PROPOSAL_DOMAIN isn't configured server-side
  // (the API returns domain=null in that case).
  if (persisted === null) {
    // Still loading — render a skinny skeleton so the popover height is stable.
    return (
      <div className="dash-subhead dash-hairline px-3 py-2.5 border-b animate-pulse">
        <div className="h-2 w-16 rounded bg-muted-foreground/15" />
        <div className="h-7 w-full rounded bg-muted-foreground/10 mt-1.5" />
      </div>
    );
  }
  if (!domain) return null;

  const changed = value !== persisted;
  const canSave =
    !saving && changed && (check.state === "ok" || value === persisted);

  // ── Custom-domain takeover ──────────────────────────────────
  // Once a real .sk is attached and active, the SubdomainEditor
  // becomes a read-only display showing the live custom domain
  // instead of the .{PROPOSAL_DOMAIN} fallback. The fallback is
  // still functional (Cloudflare keeps both routes alive), but the
  // primary URL is now the custom domain and the user shouldn't be
  // tweaking the subdomain anymore. Per Peter 2026-05-10 v2.
  if (customDomainActive && customDomain) {
    return (
      <div className="dash-subhead dash-hairline px-3 py-2.5 border-b">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/80 font-semibold">
          Primary domain
        </p>
        <div className="flex items-center gap-1 mt-1.5">
          <input
            type="text"
            value={customDomain}
            disabled
            readOnly
            className="flex-1 min-w-0 px-2 py-1 text-xs rounded-md border border-input bg-muted/30 text-foreground/80 cursor-not-allowed"
            title="The custom domain is active. Manage it from the proposal timeline."
          />
          <span
            className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap"
            title="Custom domain is live"
          >
            <span className="size-1 rounded-full bg-emerald-500" />
            Live
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Subdomain editing is disabled while a custom domain is active.
          Manage the domain from the proposal timeline.
        </p>
      </div>
    );
  }

  return (
    <div className="dash-subhead dash-hairline px-3 py-2.5 border-b">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/80 font-semibold">
        Subdomain
      </p>
      <div className="flex items-center gap-1 mt-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => onChangeValue(e.target.value.toLowerCase())}
          placeholder="my-site"
          maxLength={50}
          className="flex-1 min-w-0 px-2 py-1 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-(--dash-accent)/40"
        />
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
          .{domain}
        </span>
        <Button
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={save}
          disabled={!canSave}
          title={
            !changed
              ? "No change"
              : check.state === "bad"
                ? check.msg
                : "Save subdomain"
          }
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </Button>
      </div>
      {/* Inline validation feedback — only shown when meaningful (not for
          unchanged or untouched fields). */}
      {changed && check.state !== "idle" && (
        <p
          className={`text-[10px] mt-1 flex items-center gap-1 ${
            check.state === "ok"
              ? "text-emerald-600"
              : check.state === "bad"
                ? "text-destructive"
                : "text-muted-foreground"
          }`}
        >
          {check.state === "checking" && (
            <>
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> Checking…
            </>
          )}
          {check.state === "ok" && (
            <>
              <Check className="h-2.5 w-2.5" /> Available
            </>
          )}
          {check.state === "bad" && (
            <>
              <AlertCircle className="h-2.5 w-2.5" /> {check.msg}
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** "Just now", "5 min ago", "Today 14:23", "Yesterday 18:45", or full date */
function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 6) return `${diffHr} h ago`;
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
