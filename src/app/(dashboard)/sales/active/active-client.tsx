"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Activity,
  ChevronRight,
  GitCommitVertical,
  HelpCircle,
  Mail,
  MapPin,
  Phone,
  PhoneCall,
  Search,
} from "lucide-react";
import { PhoneQrPopover } from "@/components/phone-qr-popover";
import { StateHistoryPopover } from "../state-history-popover";
import { ProposalTagPicker } from "@/components/proposal-tags/proposal-tag-picker";
import { ProposalTagChips } from "@/components/proposal-tags/proposal-tag-chips";
import type { ProposalTag } from "@/types/database";
import type {
  ActiveContact,
  ActiveOutcomeMeta,
} from "@/lib/sales/fetch-active";
import type { ProposalUpdateState } from "@/lib/sales/proposal-seen";

// FollowUpEmailDialog brings in the rich text editor + template picker —
// only mount it when needed. Reuses the same dialog as the dashboard so
// templates and behaviour stay in sync between the two surfaces.
const FollowUpEmailDialog = dynamic(
  () => import("@/components/proposal-timeline/follow-up-email-dialog").then(m => m.FollowUpEmailDialog),
  { ssr: false, loading: () => null },
);

interface Props {
  contacts: ActiveContact[];
  outcomes: Record<string, ActiveOutcomeMeta>;
  contactsWithProposals: Record<string, boolean>;
  loggedOutcomes: Record<string, string[]>;
  activeProposalIdByContact: Record<string, string>;
  proposalTagsByContact: Record<string, ProposalTag[]>;
  proposalStatusByContact: Record<string, string>;
  /** Three-state attention signal per contact:
   *    - "new"     → first publish, never opened → prominent purple "New" pill
   *    - "updated" → re-published after being seen → minimal muted "Changed" pill
   *    - null/missing → caught up or unpublished → no chip
   *  Server already sorted NEW > UPDATED > rest; this map only controls
   *  the chip rendering, not the row order. */
  updateStateByContact: Record<string, ProposalUpdateState>;
  /** Map of contact_id -> last_published_at ISO. Drives the "Published"
   *  column: shows a date when the site is live, "Pending" when a proposal
   *  exists but isn't published yet, dash when there's no proposal. */
  lastPublishedByContact: Record<string, string | null>;
}

const OUTCOME_LABELS: Record<string, string> = {
  send_email:    "Send email",
  send_invoice:  "Send invoice",
  send_proposal: "Send proposal",
  note:          "Note",
  local_market:  "Local market",
};

// Pre-filled email templates — same wording as the calling page so the
// two surfaces feel like the same email tool.
const EMAIL_TEMPLATES = {
  info: {
    label: "More information",
    subject: "More information about our services",
    body: "<p>Hello,</p><p>thank you for our conversation. I'm sending you more information about our services.</p><p>Best regards</p>",
  },
  quote: {
    label: "Price quote",
    subject: "Price quote",
    body: "<p>Hello,</p><p>based on our conversation, I'm sending you a price quote.</p><p>Best regards</p>",
  },
  blank: {
    label: "Write your own",
    subject: "",
    body: "<p></p>",
  },
} as const;

type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES;

// Map raw proposal status -> "pending" / "ready" buckets for the Proposal
// status pill. Pending = IT still working on it. Ready = sales can open
// it (built, sent, or viewed by client).
function proposalState(status: string | undefined): "none" | "pending" | "ready" {
  if (!status) return "none";
  if (status === "submitted" || status === "building" || status === "revision") return "pending";
  return "ready";
}

export function ActiveClient({
  contacts,
  outcomes,
  contactsWithProposals,
  loggedOutcomes,
  activeProposalIdByContact,
  proposalTagsByContact,
  proposalStatusByContact,
  updateStateByContact,
  lastPublishedByContact,
}: Props) {
  const [search, setSearch] = useState("");

  // Email compose dialog lives at the table level so a single instance
  // serves every row. State holds the contact whose row triggered it +
  // the prefilled subject/body from the chosen template.
  const [emailContact, setEmailContact] = useState<ActiveContact | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("<p></p>");

  function openEmail(contact: ActiveContact, template: EmailTemplateKey) {
    const t = EMAIL_TEMPLATES[template];
    setEmailSubject(t.subject);
    setEmailBody(t.body);
    setEmailContact(contact);
  }

  // Tag edits update the row optimistically without re-fetching the whole
  // page. Stored as a per-contact override; falls back to the server data
  // when no edit has happened in this session.
  const [tagOverrides, setTagOverrides] = useState<Record<string, ProposalTag[]>>({});
  const tagsForContact = (id: string): ProposalTag[] =>
    tagOverrides[id] ?? proposalTagsByContact[id] ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(c =>
      c.company_name.toLowerCase().includes(q) ||
      (c.town?.toLowerCase().includes(q) ?? false) ||
      (c.industry?.toLowerCase().includes(q) ?? false) ||
      (c.phone?.includes(q) ?? false) ||
      (c.email?.toLowerCase().includes(q) ?? false)
    );
  }, [contacts, search]);

  // Client-side pagination — cap React render to PAGE_SIZE rows at a time.
  // The full set is already in memory (search needs it), but rendering all
  // 500+ rows with their tag chips / popovers / status pills slows initial
  // paint and tab interactions. Reset to first page whenever the search
  // query changes so the visible window always starts at the top of the
  // current result set.
  const PAGE_SIZE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search]);
  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="dash-root max-w-6xl space-y-6">
        {/* Clean page header — quiet violet icon chip carries the identity
            (no hero gradient on this operational list), eyebrow + title +
            one-line contact count. Search sits on the right on wider screens. */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="dash-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
              <Activity className="h-5 w-5" />
            </span>
            <div className="space-y-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Sales pipeline
              </p>
              <div className="flex items-center gap-1.5">
                <h1 className="text-2xl font-bold tracking-tight">Active</h1>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground/60 transition-colors hover:text-(--dash-accent)"
                      aria-label="Information"
                    >
                      <HelpCircle className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-sm text-xs">
                    Contacts you've started working with — you sent an email,
                    an invoice, a proposal, or left a note.
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="tabular-nums">{contacts.length}</span>{" "}
                {contacts.length === 1 ? "contact" : "contacts"}
              </p>
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, town, phone, email..."
              className="pl-9"
            />
          </div>
        </header>

        {/* List — soft panel with hairline border + quiet subhead row. The
            original fixed column widths are preserved so every row stays in
            alignment with the header. */}
        {filtered.length === 0 ? (
          <div className="dash-panel dash-hairline flex flex-col items-center justify-center px-6 py-16 text-center">
            <span className="dash-chip mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full">
              <Activity className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium">
              {search ? "No matches" : "No active contacts"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {search
                ? "Nothing matches your current search."
                : "Contacts you start working with will show up here."}
            </p>
          </div>
        ) : (
          <div className="dash-panel dash-hairline overflow-hidden">
            <div className="overflow-x-auto">
              <div className="min-w-[760px]">
                <div className="dash-subhead dash-hairline flex items-center gap-3 border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span className="w-32 shrink-0 pr-2">Last activity</span>
                  <span className="w-48 shrink-0 pr-2">Company</span>
                  <span className="w-32 shrink-0 pr-2">Phone</span>
                  <span className="w-32 shrink-0 pr-2">Email</span>
                  <span className="w-24 shrink-0 pr-2">Published</span>
                  <span className="flex-1 pr-1 text-right">Actions</span>
                </div>

                <ul className="dash-hairline divide-y">
                  {visible.map(c => (
                    <ActiveRow
                      key={c.id}
                      contact={c}
                      meta={outcomes[c.id]}
                      hasProposal={contactsWithProposals[c.id]}
                      proposalId={activeProposalIdByContact[c.id]}
                      proposalStatus={proposalStatusByContact[c.id]}
                      logged={loggedOutcomes[c.id] ?? []}
                      tags={tagsForContact(c.id)}
                      updateState={updateStateByContact[c.id] ?? null}
                      lastPublishedAt={lastPublishedByContact[c.id] ?? null}
                      onTagsChange={(next) => setTagOverrides(prev => ({ ...prev, [c.id]: next }))}
                      onEmail={(template) => openEmail(c, template)}
                    />
                  ))}
                  {hasMore && (
                    <li className="flex justify-center py-3">
                      <button
                        type="button"
                        onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                        className="rounded-md px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-(--dash-subtle) hover:text-foreground"
                      >
                        Load more ({filtered.length - visibleCount} remaining)
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Single shared email dialog for all rows */}
      {emailContact && (
        <FollowUpEmailDialog
          open={!!emailContact}
          onOpenChange={(open: boolean) => { if (!open) setEmailContact(null); }}
          contactId={emailContact.id}
          companyName={emailContact.company_name}
          contactEmail={emailContact.email}
          initialSubject={emailSubject}
          initialBody={emailBody}
        />
      )}
    </TooltipProvider>
  );
}

// ── Row ────────────────────────────────────────────────────────────────
function ActiveRow({
  contact: c,
  meta,
  hasProposal,
  proposalId,
  proposalStatus,
  logged,
  tags,
  updateState,
  lastPublishedAt,
  onTagsChange,
  onEmail,
}: {
  contact: ActiveContact;
  meta: ActiveOutcomeMeta | undefined;
  hasProposal: boolean | undefined;
  proposalId: string | undefined;
  proposalStatus: string | undefined;
  logged: string[];
  tags: ProposalTag[];
  updateState: ProposalUpdateState;
  lastPublishedAt: string | null;
  onTagsChange: (next: ProposalTag[]) => void;
  onEmail: (template: EmailTemplateKey) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const outcomeLabel = meta ? OUTCOME_LABELS[meta.outcome] ?? meta.outcome : undefined;
  const localMarketLogged = useMemo(() => logged.includes("local_market"), [logged]);

  // 3-state derivation for the right-side proposal status pill
  const proposalPillState = proposalState(proposalStatus ?? (hasProposal ? "submitted" : undefined));

  return (
    <li
      className={`dash-row flex items-center gap-3 px-4 py-2 text-[11px] transition-colors ${
        historyOpen ? "bg-amber-500/10" : ""
      }`}
    >
      {/* Last activity */}
      <div className="w-32 shrink-0 pr-2">
        {outcomeLabel ? (
          <StateHistoryPopover
            contactId={c.id}
            companyName={c.company_name}
            onOpenChange={setHistoryOpen}
          >
            <button
              type="button"
              className="group inline-flex max-w-full items-center gap-1 text-left text-[10px] font-semibold text-amber-700 transition-colors hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300"
              title="View activity history"
            >
              <GitCommitVertical className="h-3 w-3 shrink-0 text-amber-600/70 transition-colors group-hover:text-amber-500 dark:text-amber-400/70" />
              <span className="truncate border-b border-dotted border-amber-600/50 group-hover:border-amber-500">
                {outcomeLabel}
              </span>
            </button>
          </StateHistoryPopover>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </div>

      {/* Company — company name with attention chip + tag chips inline below.
          Two attention states:
            "new"     → prominent purple "New" pill (first publish, never opened)
            "updated" → minimal outlined "Changed" chip (re-published after seen)
          Both clear when salesperson opens the proposal detail. Server already
          sorted: NEW > UPDATED > rest. The chip styling deliberately makes
          the two distinguishable at a glance so "new lead" doesn't blur with
          "tech tweak". */}
      <div className="w-48 shrink-0 pr-2 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          {updateState === "new" && (
            <span
              className="inline-flex shrink-0 items-center rounded-sm bg-(--dash-accent) px-1 py-0 text-[8.5px] font-semibold uppercase tracking-wider text-white"
              title="New proposal — IT just published the website. Clicking the proposal clears the marker."
            >
              New
            </span>
          )}
          {updateState === "updated" && (
            <span
              className="inline-flex shrink-0 items-center rounded-sm border border-muted-foreground/30 px-1 py-0 text-[8.5px] font-medium text-muted-foreground"
              title="IT made a change to the published website. Clicking clears the marker."
            >
              Changed
            </span>
          )}
          <Link
            href={`/sales/volanie?contact=${c.id}`}
            className="min-w-0 truncate font-medium transition-colors hover:text-(--dash-accent) hover:underline"
            title={c.company_name}
          >
            {c.company_name}
          </Link>
        </div>
        {(proposalId || localMarketLogged) && (
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            {proposalId && (
              <ProposalTagPicker
                proposalId={proposalId}
                attachedTags={tags}
                onChange={onTagsChange}
                chipSize="minimal"
                trigger={
                  <button
                    type="button"
                    className="text-[9px] text-muted-foreground/70 hover:text-foreground transition-colors"
                    title="Add tag"
                  >
                    {tags.length === 0 ? "+ tag" : "+"}
                  </button>
                }
              />
            )}
            {/* Pipe separator only when both sides have content */}
            {proposalId && tags.length > 0 && localMarketLogged && (
              <span className="text-muted-foreground/40 text-[10px] mx-0.5">|</span>
            )}
            {localMarketLogged && (
              <span className="inline-flex items-center gap-1 text-[9px] text-amber-600 dark:text-amber-400 bg-muted/60 px-1 leading-[14px]">
                <MapPin className="h-2.5 w-2.5" />
                Local Market
              </span>
            )}
          </div>
        )}
      </div>

      {/* Phone */}
      <div className="w-32 shrink-0 pr-2 truncate font-mono text-[10px] text-muted-foreground">
        {c.phone ? (
          <PhoneQrPopover phone={c.phone} companyName={c.company_name}>
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {c.phone}
            </span>
          </PhoneQrPopover>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </div>

      {/* Email */}
      <span className="w-32 shrink-0 pr-2 truncate text-[10px] text-muted-foreground" title={c.email || "Email missing"}>
        {c.email || <span className="text-amber-500/70">—</span>}
      </span>

      {/* Published — when the website went live. Three states:
            no proposal       → dash
            proposal pending  → "Pending" amber pill (matches Invoice/Proposal wording)
            published         → DD. M. YYYY date in muted text */}
      <span className="w-24 shrink-0 pr-2 text-[10px]">
        {!proposalId ? (
          <span className="text-muted-foreground/40">—</span>
        ) : lastPublishedAt ? (
          <span
            className="text-muted-foreground tabular-nums"
            title={`Published ${new Date(lastPublishedAt).toLocaleString("en-US")}`}
          >
            {new Date(lastPublishedAt).toLocaleDateString("en-US")}
          </span>
        ) : (
          <span
            className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
            title="The website isn't published yet — IT is working on it"
          >
            Pending
          </span>
        )}
      </span>

      {/* Actions:
          - Email: dropdown with 3 templates (matches calling page).
          - Invoice status: passive 3-state pill (none / pending / done).
          - Proposal status: 3-state pill, clickable when "ready" (opens proposal).
          - Call: always opens calling page. */}
      <div className="flex items-center justify-end flex-1 gap-1.5">
        {/* Email dropdown — disabled when no email on file */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={!c.email}
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                c.email
                  ? "border-foreground/15 bg-background text-foreground hover:border-foreground/35 hover:bg-muted/50"
                  : "border-border/40 text-muted-foreground/40 cursor-not-allowed"
              }`}
              title={c.email ? "Send email" : "Email missing"}
            >
              <Mail className="h-3 w-3" /> Email
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEmail("info")}>{EMAIL_TEMPLATES.info.label}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEmail("quote")}>{EMAIL_TEMPLATES.quote.label}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onEmail("blank")}>{EMAIL_TEMPLATES.blank.label}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ProposalStatusPill state={proposalPillState} proposalId={proposalId} />

        <Link
          href={`/sales/volanie?contact=${c.id}`}
          className="inline-flex items-center gap-1 rounded border border-(--dash-accent)/40 px-1.5 py-0.5 text-[10px] font-medium text-(--dash-accent) transition-colors hover:border-(--dash-accent) hover:bg-(--dash-accent)/10"
        >
          <PhoneCall className="h-3 w-3" />
          Call
          <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
    </li>
  );
}

// ── Status pill ────────────────────────────────────────────────────────
// 3-state visual language: gray for "none", amber for "pending", green for
// "ready". The Proposal pill becomes a clickable Link in the "ready" state so
// sales can jump straight to the proposal detail.

function ProposalStatusPill({ state, proposalId }: { state: "none" | "pending" | "ready"; proposalId: string | undefined }) {
  if (state === "none") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded border border-border/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/60"
        title="Proposal: none"
      >
        Proposal: none
      </span>
    );
  }
  if (state === "pending") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
        title="Proposal: pending — IT is working on it"
      >
        Proposal: pending
      </span>
    );
  }
  // ready — clickable
  return (
    <Link
      href={proposalId ? `/sales/proposals/${proposalId}` : "#"}
      className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 hover:border-emerald-500 hover:bg-emerald-500/10 transition-colors"
      title="Proposal: done — click to open the details"
    >
      Proposal: done
    </Link>
  );
}
