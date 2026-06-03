/**
 * Custom-domain Cloudflare setup pipeline.
 *
 * Driven by polling: the dashboard's CustomDomainAction calls a tick
 * endpoint every 30 sec; each tick advances the state machine by AT
 * MOST one step. No long-running connection, no background worker,
 * no cron — just idempotent transitions persisted to the `sites`
 * row and resumed whenever the next tick arrives.
 *
 * Pipeline states (matches the CHECK constraint in migration 00054):
 *
 *   not_started    → user just clicked Save; no work done yet
 *   creating_zone  → just persisted the zone; about to wire DNS
 *   waiting_dns    → zone exists in CF but hasn't activated yet
 *                    (customer's nameservers haven't propagated)
 *   registering_pages → zone is active; trying to attach apex + www
 *                       to the Pages project (may need a few retries
 *                       during the "DNS setup" window). On success this
 *                       step flips straight to `active` — Cloudflare
 *                       provisions SSL automatically in the background
 *                       within seconds-to-minutes, and waiting for the
 *                       cert + content-verifying every domain added
 *                       5-30 min of perceived setup time for negligible
 *                       safety benefit. See `runRegisterPages`.
 *   provisioning_ssl  → LEGACY. New rows never enter this state. Kept
 *                       in the enum + state machine so any in-flight
 *                       row from before the pipeline simplification
 *                       (2026-05-19) finishes cleanly on its next tick.
 *   active         → terminal: domain is fully live
 *   failed         → terminal: gave up (timeout or hard error)
 *
 * The pure `nextStep()` decides what action to run; the orchestrator
 * `tickSetup()` runs that action against Cloudflare + persists the
 * new row state. Splitting the two means the decision logic is
 * trivially testable without mocking fetch.
 */
import {
  findOrCreateZone,
  getZoneStatus,
  enableAlwaysUseHttps,
  addOrUpdateCnameRecord,
  registerPagesDomain,
  removeSubdomainRouting,
} from "./cloudflare";
import { extractApex, isApex } from "./extract-apex";

export type DomainSetupStatus =
  | "not_started"
  | "creating_zone"
  | "waiting_dns"
  | "registering_pages"
  | "provisioning_ssl"
  | "active"
  | "failed";

/**
 * Subset of the `sites` row the pipeline cares about. The
 * orchestrator loads this from Supabase; tests pass it in directly.
 */
export interface DomainSetupRow {
  domain_setup_status: DomainSetupStatus | null;
  domain_setup_started_at: string | null;
  domain_setup_attempts: number;
  domain_zone_id: string | null;
  domain_nameservers: string[] | null;
  /** What sales typed (after lowercase + trim normalization). */
  requested_domain: string | null;
  /** Active domain (set only at the very end, when status flips active). */
  domain: string | null;
}

/**
 * One of seven actions the orchestrator can take this tick. Pure
 * function — picks an action from the row's current state without
 * touching Cloudflare.
 */
export type NextStep =
  | "init"            // not_started → create zone, persist nameservers
  | "wire_dns"        // creating_zone → enable HTTPS + CNAMEs + page rule
  | "wait_for_zone"   // waiting_dns → poll zone status
  | "register_pages"  // registering_pages → POST domain to Pages project
  | "wait_for_ssl"    // provisioning_ssl → poll Pages domain status
  | "done"            // already active or already failed; nothing to do
  | "abort";          // exceeded total timeout, give up

/**
 * Total wall-clock budget for the whole pipeline. ~60 min covers:
 *   - Worst-case nameserver propagation (most resolve within 5 min,
 *     stragglers can take up to ~30 min)
 *   - SSL cert provisioning (~5–30 min on Cloudflare's side)
 * If we hit this without reaching `active`, surface a failure so
 * sales can investigate (probably nameserver issue at Hostcreator).
 */
// Total time we'll spend on a single domain-setup attempt before
// flipping to `failed`. Lowered from 60 min to 30 min on
// 2026-05-10 v3 (per Peter): a real customer's NS delegation +
// SSL provisioning fits comfortably under 30 min for any reasonable
// registrar (Hostcreator typically ~10 min). Going past 30 means
// something is genuinely wrong (NS not delegated, wrong account,
// etc.) — let the failure surface fast and show the Retry button
// rather than make the user stare at an in-progress UI for an
// extra half hour. The Retry path resets the pipeline and starts
// over from scratch.
export const TOTAL_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Pure state-machine function: which action should the orchestrator
 * run next, given the current row state? Does NOT touch Cloudflare —
 * just inspects the row and the clock.
 *
 * `now` is parameterized for testability (deterministic time travel
 * in unit tests). Defaults to the real wall clock.
 */
export function nextStep(row: DomainSetupRow, now: Date = new Date()): NextStep {
  const status = row.domain_setup_status ?? "not_started";

  if (status === "active" || status === "failed") return "done";

  // Total-elapsed timeout check applies to every non-terminal state.
  if (row.domain_setup_started_at) {
    const elapsedMs =
      now.getTime() - new Date(row.domain_setup_started_at).getTime();
    if (elapsedMs > TOTAL_TIMEOUT_MS) return "abort";
  }

  switch (status) {
    case "not_started":
      return "init";
    case "creating_zone":
      return "wire_dns";
    case "waiting_dns":
      return "wait_for_zone";
    case "registering_pages":
      return "register_pages";
    case "provisioning_ssl":
      return "wait_for_ssl";
  }

  // Unrecognized status — be safe and abort.
  return "abort";
}

/**
 * Patch shape the orchestrator hands back to the DB layer. Only
 * fields whose value is changing should appear; null means
 * "explicitly clear this column". The DB write is a single UPDATE.
 */
export interface SetupPatch {
  domain_setup_status?: DomainSetupStatus;
  domain_setup_started_at?: string;
  domain_setup_attempts?: number;
  domain_setup_error?: string | null;
  domain_zone_id?: string;
  domain_nameservers?: string[];
  /** Set ONLY when the pipeline completes successfully. */
  domain?: string;
  /** Mirrored to the legacy approval workflow on success. */
  domain_status?: "active";
  /** Cleared (set to null) when the custom domain goes active so the
   *  `*.{PROPOSAL_DOMAIN}` fallback stops surfacing in the composer
   *  ("Live at" pill, publish toast, SEO panel). The Cloudflare side
   *  of that subdomain is already removed by `removeSubdomainRouting`
   *  inside `finishActive` — this just keeps the DB row honest. */
  subdomain?: string | null;
}

/**
 * Run one state transition for the given row. Idempotent: re-running
 * with the same input produces the same output (modulo upstream
 * Cloudflare state changes between calls). Throws on hard errors so
 * the caller's catch block can persist the failure to the DB.
 *
 * Returns a partial patch the caller should write back to Supabase.
 *
 * `projectName` is the Cloudflare Pages project slug (== github_repo
 * in the deployments table).
 */
export async function runStep(args: {
  row: DomainSetupRow;
  projectName: string;
  /**
   * The site's `*.{PROPOSAL_DOMAIN}` fallback hostname — full form
   * (e.g. "clientname.2dni.sk"). Threaded all the way down to the
   * terminal `runWaitForSsl` step so it can clean up the fallback
   * routing once the real custom domain is verified serving content.
   * Pass null when the site has no fallback subdomain (rare — only
   * legacy rows or edge cases).
   */
  fullSubdomain?: string | null;
  now?: Date;
}): Promise<SetupPatch> {
  const now = args.now ?? new Date();
  const step = nextStep(args.row, now);

  if (step === "done") {
    // Nothing to do — terminal state.
    return {};
  }

  if (step === "abort") {
    return {
      domain_setup_status: "failed",
      domain_setup_error:
        "Timed out after 30 minutes. Most likely the nameservers haven't been delegated to Cloudflare. Check the .sk registrar (Hostcreator) and click Retry.",
    };
  }

  // Required for every non-terminal step: a domain to operate on.
  const requested = args.row.requested_domain;
  if (!requested) {
    return {
      domain_setup_status: "failed",
      domain_setup_error: "No requested_domain on row — cannot run setup.",
    };
  }
  // We always anchor pipeline state on the apex (registrable) form,
  // even if sales typed `www.clientname.sk`. The www variant gets a
  // CNAME + page rule but isn't the canonical domain we register
  // against.
  const naked = isApex(requested) ? requested : extractApex(requested);
  const www = `www.${naked}`;

  switch (step) {
    case "init":
      return await runInit(naked);

    case "wire_dns":
      return await runWireDns({
        zoneId: requireZoneId(args.row),
        projectName: args.projectName,
        naked,
        www,
      });

    case "wait_for_zone":
      return await runWaitForZone(requireZoneId(args.row));

    case "register_pages":
      return await runRegisterPages({
        projectName: args.projectName,
        naked,
        www,
        fullSubdomain: args.fullSubdomain ?? null,
      });

    case "wait_for_ssl":
      // Legacy-only path: any row still in `provisioning_ssl` from
      // before the pipeline simplification gets the same fallback
      // cleanup + flip-to-active treatment as a fresh runRegisterPages,
      // no Cloudflare polling required.
      return await finishActive({
        projectName: args.projectName,
        naked,
        fullSubdomain: args.fullSubdomain ?? null,
      });
  }
}

/* ──────────────────────────────────────────────────────────────
   Per-step runners. Each one is "do one thing, return patch"
   and is independently testable by mocking the Cloudflare
   functions it imports.
   ────────────────────────────────────────────────────────────── */

async function runInit(naked: string): Promise<SetupPatch> {
  const zone = await findOrCreateZone(naked);
  return {
    domain_setup_status: "creating_zone",
    domain_setup_started_at: new Date().toISOString(),
    domain_zone_id: zone.id,
    domain_nameservers: zone.nameServers,
    domain_setup_attempts: 0,
    domain_setup_error: null,
  };
}

async function runWireDns(args: {
  zoneId: string;
  projectName: string;
  naked: string;
  www: string;
}): Promise<SetupPatch> {
  const pagesTarget = `${args.projectName}.pages.dev`;

  // 1. Always-use-HTTPS — turn on first so any direct hit is upgraded
  //    to TLS even before the cert finishes provisioning.
  await enableAlwaysUseHttps(args.zoneId);

  // 2. CNAMEs for apex + www. Both proxied so Cloudflare's pipeline
  //    can validate the ownership when we register them on Pages.
  //    Both hostnames are also registered on the Pages project below
  //    (see runRegisterPages), so both URLs serve the site directly
  //    with no www→naked redirect. Per Peter 2026-05-23: prefer two
  //    equal entry points over a Page Rule redirect — keeps the setup
  //    simpler and lets Cloudflare handle canonicalization on its end.
  await addOrUpdateCnameRecord({
    zoneId: args.zoneId,
    name: args.naked,
    target: pagesTarget,
    proxied: true,
  });
  await addOrUpdateCnameRecord({
    zoneId: args.zoneId,
    name: args.www,
    target: pagesTarget,
    proxied: true,
  });

  // Advance to waiting_dns. The next tick will poll zone status.
  return {
    domain_setup_status: "waiting_dns",
    domain_setup_attempts: 0,
    domain_setup_error: null,
  };
}

async function runWaitForZone(zoneId: string): Promise<SetupPatch> {
  const status = await getZoneStatus(zoneId);
  if (status === "active") {
    return {
      domain_setup_status: "registering_pages",
    };
  }
  // Still pending. Returning an empty patch signals "no state change
  // this tick"; the orchestrator's resolveAttempts() bumps the
  // attempts counter for us. The total-timeout in nextStep() is the
  // real safety net.
  return {};
}

async function runRegisterPages(args: {
  projectName: string;
  naked: string;
  www: string;
  fullSubdomain: string | null;
}): Promise<SetupPatch> {
  const apexResult = await registerPagesDomain(args.projectName, args.naked);
  if (apexResult === "dns_setup") {
    // Soft retry signal — try again next tick. Don't advance state.
    return {};
  }

  const wwwResult = await registerPagesDomain(args.projectName, args.www);
  if (wwwResult === "dns_setup") {
    return {};
  }

  // Both registered. Skip the explicit SSL provisioning state —
  // Cloudflare issues the cert automatically in seconds-to-minutes,
  // so polling for "active" + HEAD-verifying content just adds
  // perceived latency without buying real safety. Hand off to the
  // shared finish path so legacy-row recovery and fresh runs do the
  // same fallback cleanup + DB write.
  return await finishActive({
    projectName: args.projectName,
    naked: args.naked,
    fullSubdomain: args.fullSubdomain,
  });
}

/**
 * Shared terminal: remove the *.{PROPOSAL_DOMAIN} fallback routing
 * (best-effort) and flip the row to `active`. Called by both the
 * fresh-pipeline path (right after register_pages succeeds) and the
 * legacy compatibility path (provisioning_ssl → wait_for_ssl tick).
 *
 * Fallback cleanup is best-effort: a Cloudflare hiccup or race
 * shouldn't block the domain from going live — the custom domain
 * working is the success criterion. The leftover subdomain can be
 * mopped up manually.
 */
async function finishActive(args: {
  projectName: string;
  naked: string;
  fullSubdomain: string | null;
}): Promise<SetupPatch> {
  if (args.fullSubdomain) {
    try {
      const result = await removeSubdomainRouting(
        args.projectName,
        args.fullSubdomain,
      );
      if (result.errors.length > 0) {
        console.warn(
          `[custom-domain] Subdomain cleanup completed with errors for ${args.fullSubdomain}: ${result.errors.join("; ")}`,
        );
      } else {
        console.log(
          `[custom-domain] Removed fallback ${args.fullSubdomain} after custom domain ${args.naked} went active.`,
        );
      }
    } catch (err) {
      console.error(
        `[custom-domain] Subdomain cleanup threw for ${args.fullSubdomain} (non-fatal):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    domain_setup_status: "active",
    domain: args.naked,
    domain_status: "active",
    domain_setup_error: null,
    // Null the subdomain column once the custom domain is live. The
    // CF mapping was just removed by removeSubdomainRouting above;
    // nulling the DB keeps composer UI in sync (Live at pill, publish
    // toast, etc.) and prevents the next publish from re-creating the
    // subdomain on Cloudflare. Per Peter 2026-05-23.
    subdomain: null,
  };
}

/* ──────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────── */

function requireZoneId(row: DomainSetupRow): string {
  if (!row.domain_zone_id) {
    throw new Error(
      "domain_zone_id is null but pipeline expected it — corrupt state.",
    );
  }
  return row.domain_zone_id;
}

/**
 * Reconcile the raw step patch with the row's current attempts
 * counter. Pure helper:
 *
 *   - If the patch advances the status (or sets attempts explicitly),
 *     use that.
 *   - Otherwise (we stayed in the same state this tick), bump the
 *     row's attempts counter by 1 so the UI can show "still trying".
 *   - On any status advance, reset attempts to 0.
 *
 * Caller calls this between `runStep()` and the actual DB write.
 */
export function resolveAttempts(args: {
  patch: SetupPatch;
  currentStatus: DomainSetupStatus | null;
  currentAttempts: number;
}): SetupPatch {
  if (typeof args.patch.domain_setup_attempts === "number") {
    return args.patch;
  }
  const advancedStatus =
    args.patch.domain_setup_status &&
    args.patch.domain_setup_status !== args.currentStatus;
  if (advancedStatus) {
    return { ...args.patch, domain_setup_attempts: 0 };
  }
  return { ...args.patch, domain_setup_attempts: args.currentAttempts + 1 };
}

/**
 * Human-readable label per state — used by the timeline UI's
 * status pill. Keeps the wording in one place so it can't drift
 * between server-rendered + client-rendered surfaces.
 */
export function statusLabel(status: DomainSetupStatus | null): string {
  switch (status) {
    case "not_started":
    case null:
      return "Not started";
    case "creating_zone":
      return "Adding domain to Cloudflare";
    case "waiting_dns":
      return "Waiting for nameservers";
    case "registering_pages":
      return "Registering with Cloudflare Pages";
    case "provisioning_ssl":
      return "SSL certificate provisioning";
    case "active":
      return "Domain live";
    case "failed":
      return "Setup failed";
  }
}

/**
 * True for the in-progress (non-terminal) states the UI should keep
 * polling. Let the timeline component inspect a single function
 * instead of duplicating the enum check at every callsite.
 */
export function isInProgress(status: DomainSetupStatus | null): boolean {
  return (
    status !== null &&
    status !== "not_started" &&
    status !== "active" &&
    status !== "failed"
  );
}
