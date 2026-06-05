/**
 * Fetches a salesperson's "active" contacts — those whose most recent
 * call log has a non-terminal outcome (`send_email`, `send_invoice`,
 * `send_proposal`, `note`, `local_market`). Excludes contacts whose
 * proposals have already been paid.
 *
 * Used by `/sales/active` (its dedicated subpage). Previously this lived
 * inline in `/sales/page.tsx` while Active was a tab on the dashboard;
 * extracted here so the dashboard no longer fetches it.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProposalTag } from "@/types/database";
import {
  getProposalUpdateState,
  type ProposalUpdateState,
} from "@/lib/sales/proposal-seen";

export interface ActiveContact {
  id: string;
  company_name: string;
  contact_person: string | null;
  phone: string | null;
  phones: string[] | null;
  phone_notes: Record<string, string> | null;
  email: string | null;
  website_url: string | null;
  industry: string | null;
  town: string | null;
  status: string;
  notes: string | null;
  source: string | null;
  description: string | null;
  services_offered: string | null;
  total_listings: number | null;
  cities_count: number | null;
  postal_code: string | null;
  source_url: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ActiveOutcomeMeta {
  outcome: string;
  notes: string | null;
  at: string;
}

export const ACTIVE_OUTCOMES = [
  "send_invoice",
  "send_email",
  "send_proposal",
  "note",
  "local_market",
] as const;

export type ActiveOutcome = (typeof ACTIVE_OUTCOMES)[number];

export interface FetchActiveResult {
  contacts: ActiveContact[];
  /** Map of contact_id -> the latest in-progress outcome metadata. */
  outcomes: Record<string, ActiveOutcomeMeta>;
  /** Map of contact_id -> true if the contact has any non-terminal proposal.
   *  Used to surface a "Proposal" jump button on rows even when the latest
   *  call_log activity is something else (e.g. `local_market`). */
  contactsWithProposals: Record<string, boolean>;
  /** Map of contact_id -> distinct list of in-progress outcomes ever
   *  logged. Drives the per-action button availability in the Actions
   *  column: Email / Invoice / Proposal / Local market light up only after
   *  the salesperson has actually performed that action via the calling page. */
  loggedOutcomes: Record<string, string[]>;
  /** Map of contact_id -> the most-recently-updated open proposal id.
   *  Used by the Proposal button on each row to deep-link straight to the
   *  proposal detail page instead of bouncing through the contact page. */
  activeProposalIdByContact: Record<string, string>;
  /** Map of contact_id -> list of tags attached to that contact's latest
   *  open proposal. Drives the inline tag chip display + the "edit tags"
   *  popover on the Active row. */
  proposalTagsByContact: Record<string, ProposalTag[]>;
  /** Map of contact_id -> raw proposal status (`submitted` / `building`
   *  / `revision` / `review` / `sent` / `viewed`). Drives the 3-state
   *  Proposal status pill: `submitted|building|revision` → pending,
   *  `review|sent|viewed` → ready (clickable). */
  proposalStatusByContact: Record<string, string>;
  /** Map of contact_id -> three-state attention signal:
   *    - "new"     → first publish, salesperson has never opened it
   *    - "updated" → was already seen, but IT re-published since
   *    - null/missing → caught up or not published yet
   *
   *  Drives the row chip styling ("New" prominent vs "Changed" minimal)
   *  AND the row sort order (NEW > UPDATED > rest). See
   *  `getProposalUpdateState()` for the precise math. */
  updateStateByContact: Record<string, ProposalUpdateState>;
  /** Map of contact_id -> last_published_at of the chosen active proposal's
   *  site. ISO string when the site has been published, null when there's
   *  a proposal but IT hasn't published yet, absent when there's no
   *  proposal at all. Drives the "Published" column in the Active table
   *  so sales can see at a glance which leads have a live website vs which
   *  are still in build. */
  lastPublishedByContact: Record<string, string | null>;
  /** How many contacts in this result set need attention (NEW + UPDATED
   *  combined). Surfaced to the sidebar so the "Active" entry shows total
   *  unread work, not just brand-new leads. */
  newCount: number;
}

const CONTACT_COLUMNS =
  "id, company_name, contact_person, phone, phones, phone_notes, email, website_url, industry, town, status, notes, source, description, services_offered, total_listings, cities_count, postal_code, source_url, created_at";

export async function fetchActiveContacts(salesPersonId: string): Promise<FetchActiveResult> {
  const admin = createAdminClient();

  // ── Round 1: three independent queries against salesPersonId. ──
  // progressLogs        — non-terminal call_logs (drives "active" set A)
  // openProposalRows    — open proposals (drives "active" set B)
  // paidProposalRows    — paid contacts (used later to exclude)
  //
  // These used to run sequentially across the function. Running them in
  // parallel collapses ~3 round-trips of latency into 1 at the cost of
  // doing the paid-filter prep upfront. Worst case: paidProposalRows
  // returns rows for a salesperson with no active contacts and we
  // discard the result — fine, the query is cheap.
  const [
    { data: progressLogs },
    { data: openProposalRows },
    { data: paidProposalRows },
  ] = await Promise.all([
    admin
      .from("call_logs")
      .select("contact_id, outcome, notes, created_at")
      .eq("sales_person_id", salesPersonId)
      .in("outcome", [...ACTIVE_OUTCOMES])
      .order("created_at", { ascending: false })
      .limit(500),
    admin
      .from("proposals")
      .select("contact_id")
      .eq("sales_person_id", salesPersonId)
      .not("status", "in", "(paid,archived)")
      .not("contact_id", "is", null),
    admin
      .from("proposals")
      .select("contact_id")
      .eq("sales_person_id", salesPersonId)
      .eq("status", "paid")
      .not("contact_id", "is", null),
  ]);

  // Process progressLogs → latest in-progress outcome per contact + the
  // full distinct-outcome set per contact (drives action-button state).
  const latestPerContact = new Map<string, ActiveOutcomeMeta>();
  const outcomeSetPerContact = new Map<string, Set<string>>();
  for (const row of progressLogs ?? []) {
    if (!row.contact_id) continue;
    if (!latestPerContact.has(row.contact_id)) {
      latestPerContact.set(row.contact_id, {
        outcome: row.outcome,
        notes: row.notes,
        at: row.created_at,
      });
    }
    const set = outcomeSetPerContact.get(row.contact_id) ?? new Set<string>();
    set.add(row.outcome);
    outcomeSetPerContact.set(row.contact_id, set);
  }

  const candidateIds = Array.from(latestPerContact.keys());

  // Set B — contacts with at least one open proposal. These belong on
  // Active even if their latest call_log is terminal (e.g. a "no_answer"
  // follow-up on a proposal that's already at sent/viewed). Without this,
  // qualified leads silently disappear from the funnel surface the moment
  // the salesperson logs a missed call.
  const openProposalContactIds = new Set<string>(
    (openProposalRows ?? [])
      .map(r => r.contact_id as string | null)
      .filter((id): id is string => !!id),
  );

  if (candidateIds.length === 0 && openProposalContactIds.size === 0) {
    return { contacts: [], outcomes: {}, contactsWithProposals: {}, loggedOutcomes: {}, activeProposalIdByContact: {}, proposalTagsByContact: {}, proposalStatusByContact: {}, updateStateByContact: {}, lastPublishedByContact: {}, newCount: 0 };
  }

  // ── Round 2: verify Set A's latest log is still in-progress ──
  // (no terminal outcome recorded after). Has to wait for Round 1 because
  // it needs candidateIds.
  const trulyActive = new Set<string>();
  if (candidateIds.length > 0) {
    const { data: latestAnyLog } = await admin
      .from("call_logs")
      .select("contact_id, outcome, created_at")
      .eq("sales_person_id", salesPersonId)
      .in("contact_id", candidateIds)
      .order("created_at", { ascending: false })
      .limit(2000);

    const seen = new Set<string>();
    for (const row of latestAnyLog ?? []) {
      if (!row.contact_id || seen.has(row.contact_id)) continue;
      seen.add(row.contact_id);
      if ((ACTIVE_OUTCOMES as readonly string[]).includes(row.outcome)) {
        trulyActive.add(row.contact_id);
      }
    }
  }

  // Union Set A (verified non-terminal latest call_log) with Set B
  // (any open proposal). The two sets can overlap; set membership is
  // all that matters for the contact pull below.
  const allCandidateIds = new Set<string>([
    ...trulyActive,
    ...openProposalContactIds,
  ]);

  if (allCandidateIds.size === 0) {
    return { contacts: [], outcomes: {}, contactsWithProposals: {}, loggedOutcomes: {}, activeProposalIdByContact: {}, proposalTagsByContact: {}, proposalStatusByContact: {}, updateStateByContact: {}, lastPublishedByContact: {}, newCount: 0 };
  }

  // ── Round 3: pull contact records, scoped to this salesperson. ──
  const { data: contactsRaw } = await admin
    .from("contacts")
    .select(CONTACT_COLUMNS)
    .in("id", Array.from(allCandidateIds))
    .eq("assigned_to", salesPersonId);

  let contacts = (contactsRaw ?? []) as ActiveContact[];

  // Apply the paid-contact filter using the result from Round 1.
  const paidIds = new Set((paidProposalRows ?? []).map(p => p.contact_id as string));
  contacts = contacts.filter(c => !paidIds.has(c.id));

  // 6. Build the outcome map + the per-contact distinct-outcome list.
  const outcomes: Record<string, ActiveOutcomeMeta> = {};
  const loggedOutcomes: Record<string, string[]> = {};
  for (const c of contacts) {
    const meta = latestPerContact.get(c.id);
    if (meta) outcomes[c.id] = meta;
    const set = outcomeSetPerContact.get(c.id);
    loggedOutcomes[c.id] = set ? Array.from(set) : [];
  }

  // ── Round 4: proposals for these contacts ──
  const contactIds = contacts.map(c => c.id);
  const { data: allProposalsForContacts } = contactIds.length > 0
    ? await admin
        .from("proposals")
        .select("id, contact_id, status, updated_at, sales_seen_at")
        .in("contact_id", contactIds)
        .order("updated_at", { ascending: false })
    : { data: [] as { id: string; contact_id: string | null; status: string; updated_at: string; sales_seen_at: string | null }[] };

  // Process proposals → contactsWithProposals + chosen (latest open)
  // per contact. Same logic as before: pull all, filter closed-statuses
  // in JS (matches the IT side's PostgREST quirk workaround).
  const contactsWithProposals: Record<string, boolean> = {};
  const activeProposalIdByContact: Record<string, string> = {};
  const proposalStatusByContact: Record<string, string> = {};
  const proposalIdToContactId = new Map<string, string>();
  // sales_seen_at per contact's chosen (latest open) proposal — feeds the
  // NEW-badge calculation below alongside sites.last_published_at.
  const salesSeenByContact: Record<string, string | null> = {};
  const CLOSED_STATUSES = new Set(["paid", "archived"]);
  for (const p of allProposalsForContacts ?? []) {
    if (!p.contact_id) continue;
    if (CLOSED_STATUSES.has(p.status)) continue;
    contactsWithProposals[p.contact_id] = true;
    if (!activeProposalIdByContact[p.contact_id]) {
      activeProposalIdByContact[p.contact_id] = p.id;
      proposalStatusByContact[p.contact_id] = p.status;
      proposalIdToContactId.set(p.id, p.contact_id);
      // Hold sales_seen_at against the *chosen* proposal so the NEW
      // calculation downstream uses the same row the UI links to.
      salesSeenByContact[p.contact_id] = (p as { sales_seen_at: string | null }).sales_seen_at ?? null;
    }
  }


  // ── Round 5: tag assignments + site publish dates in parallel ──
  // Both scope by chosenProposalIds, independent of each other.
  //
  // Rule (Peter 2026-05-11, "publish is the pivot"): a proposal counts as
  //   NEW     → site is published AND salesperson has NEVER opened the proposal
  //   UPDATED → site is published, salesperson HAS opened it, but IT
  //             re-published since (last_published_at > sales_seen_at)
  // We use the proposal_id → contact_id map built earlier; only the
  // proposals already pinned as "the active one per contact" matter.
  const proposalTagsByContact: Record<string, ProposalTag[]> = {};
  const updateStateByContact: Record<string, ProposalUpdateState> = {};
  const lastPublishedByContact: Record<string, string | null> = {};
  const chosenProposalIds = Array.from(proposalIdToContactId.keys());

  if (chosenProposalIds.length > 0) {
    const [
      { data: assignments },
      { data: siteRows },
    ] = await Promise.all([
      admin
        .from("proposal_tag_assignments")
        .select("proposal_id, proposal_tags(id, name, slug, color, created_by, created_at)")
        .in("proposal_id", chosenProposalIds),
      admin
        .from("sites")
        .select("proposal_id, last_published_at")
        .in("proposal_id", chosenProposalIds)
        .order("last_published_at", { ascending: false, nullsFirst: false }),
    ]);

    // Tags → proposalTagsByContact via proposal_id → contact_id map.
    for (const row of assignments ?? []) {
      const contactId = proposalIdToContactId.get(row.proposal_id as string);
      if (!contactId) continue;
      const tag = Array.isArray(row.proposal_tags) ? row.proposal_tags[0] : row.proposal_tags;
      if (!tag) continue;
      const list = proposalTagsByContact[contactId] ?? [];
      list.push(tag as ProposalTag);
      proposalTagsByContact[contactId] = list;
    }

    // First site per proposal wins (rare to have >1 but defensive). The
    // ORDER BY above puts the most-recently-published row first so any
    // accidental duplicate doesn't make a published proposal look unpublished.
    const seenProposalIds = new Set<string>();
    for (const row of siteRows ?? []) {
      const pid = row.proposal_id as string | null;
      if (!pid || seenProposalIds.has(pid)) continue;
      seenProposalIds.add(pid);
      const contactId = proposalIdToContactId.get(pid);
      if (!contactId) continue;
      lastPublishedByContact[contactId] = row.last_published_at as string | null;
    }
  }

  for (const c of contacts) {
    updateStateByContact[c.id] = getProposalUpdateState(
      lastPublishedByContact[c.id] ?? null,
      salesSeenByContact[c.id] ?? null,
    );
  }

  // 10. Sort: NEW > UPDATED > everything else. Within each tier, most
  // recently published wins. We mutate the contacts array directly so
  // downstream consumers see the already-ordered list.
  function tier(state: ProposalUpdateState): number {
    if (state === "new") return 2;
    if (state === "updated") return 1;
    return 0;
  }
  contacts.sort((a, b) => {
    const at = tier(updateStateByContact[a.id]);
    const bt = tier(updateStateByContact[b.id]);
    if (at !== bt) return bt - at;
    if (at > 0) {
      // Inside NEW or UPDATED: newest publish first.
      const ap = lastPublishedByContact[a.id] ?? "";
      const bp = lastPublishedByContact[b.id] ?? "";
      return bp.localeCompare(ap);
    }
    return 0;
  });

  // newCount = total unread (NEW + UPDATED). Drives the sidebar pill,
  // which represents "items needing attention" — not just brand-new leads.
  const newCount = Object.values(updateStateByContact).filter(
    (s) => s !== null,
  ).length;

  return {
    contacts,
    outcomes,
    contactsWithProposals,
    loggedOutcomes,
    activeProposalIdByContact,
    proposalTagsByContact,
    proposalStatusByContact,
    updateStateByContact,
    lastPublishedByContact,
    newCount,
  };
}
