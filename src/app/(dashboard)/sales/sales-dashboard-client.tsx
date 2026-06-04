"use client";

import { useState, useCallback, useMemo, useRef, useEffect, memo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Phone,
  ChevronDown,
  ChevronUp,
  Search,
  XCircle,
  CalendarClock,
  StickyNote,
  ArrowRight,
  Eye,
  Send,
  Plus,
  Clock,
  Calendar,
  Receipt,
  Mail,
  MapPin,
  Skull,
  Check,
  MoreHorizontal,
  Pencil,
  ChevronRight,
  GitCommitVertical,
  FileText,
  HelpCircle,
  RotateCcw,
  Info,
  Briefcase,
  Flame,
  type LucideIcon,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import type { CallOutcome } from "@/types/database";
import { DismissReminderButton } from "./dismiss-reminder-button";
import { StateHistoryPopover } from "./state-history-popover";
import { AddContactDialog } from "@/components/add-contact-dialog";
import { PhoneQrPopover } from "@/components/phone-qr-popover";
import { TagsField } from "@/components/proposal-tags/tags-field";
import dynamic from "next/dynamic";
// CallingPanel moved to Volanie page

const FollowUpEmailDialog = dynamic(
  () => import("@/components/proposal-timeline/follow-up-email-dialog").then(m => m.FollowUpEmailDialog),
  { ssr: false, loading: () => null }
);

// ── Types ──
interface HandoverProposal {
  id: string;
  company_name: string;
  status: string;
  updated_at: string;
  industry: string | null;
  town: string | null;
  contact_id: string | null;
  sent_at: string | null;
  contacts: { phone: string | null } | null;
  deployments: { subdomain: string }[] | null;
}

interface Reminder {
  id: string;
  proposal_id: string;
  reminder_type: string;
  due_at: string;
  proposals: { company_name: string; contact_id: string | null } | null;
}

interface CallingContact {
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

interface TodayLog {
  id: string;
  contact_id: string;
  outcome: string;
  notes: string | null;
  callback_at: string | null;
  created_at: string;
  contacts: { id: string; company_name: string; phone: string | null; industry: string | null; town: string | null }[] | null;
}

interface Stats {
  contactCount: number;
  inProgress: number;
  reviewCount: number;
  clientCount: number;
  totalEarned: number;
  commissionRate: number;
  commissionCount: number;
}

interface InProgressMeta {
  outcome: string;
  notes: string | null;
  at: string;
}

interface Props {
  handoverProposals: HandoverProposal[];
  reminders: Reminder[];
  newContacts: CallingContact[];
  callbackContacts: CallingContact[];
  /** Total rows in the "new" bucket — newContacts is only the first 100. */
  totalNewCount: number;
  /** Total rows in the "callback" bucket — callbackContacts is only the first 100. */
  totalCallbackCount: number;
  archiveContacts: CallingContact[];
  archiveOutcomes: Record<string, InProgressMeta>;
  contactsWithProposals: Record<string, boolean>;
  processedTodayCount: number;
  todayLogs: TodayLog[];
  noAnswerCounts: Record<string, number>;
  stats: Stats;
  /**
   * Number of this salesperson's open proposals tagged "Urgent". Drives
   * the prominent banner above the stat cards. Defaults to 0 = banner
   * hidden, so the prop is safe to omit.
   */
  urgentCount?: number;
}

interface PendingAction {
  contactId: string;
  outcome: CallOutcome;
  notes?: string;
  callbackAt?: string;
  removedContact: CallingContact;
  toastId: string | number;
  proposalData?: ProposalData;
}

interface ProposalData {
  services: string[];
  price: number | null;
  basePrice: number | null;
  requirements: string;
  /** Tag ids attached at submission so IT can triage by priority tier
   *  (urgent / priority / basic / premium) plus any custom tags. Defaults
   *  to ["basic"] when the dialog auto-seeds it. */
  tagIds: string[];
}

const REMINDER_LABELS: Record<string, string> = {
  day_4: "Follow-up",
  day_10: "2nd Follow-up",
  day_14_expired: "Discount expired",
  day_30_cleanup: "Final follow-up",
};

const OUTCOME_LABELS: Record<string, string> = {
  no_answer: "No answer",
  not_exists: "Doesn't exist",
  not_interested: "Not interested",
  send_proposal: "Send proposal",
  send_email: "Send email",
  send_invoice: "Send invoice",
  local_market: "Local market",
  callback: "Call back later",
  note: "Note",
  never_contact: "Do not contact",
};

// ── Postpone helpers ──
function getFutureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d.toISOString().split("T")[0];
}

// Discount window on a sent proposal is 14 days from `sent_at`. We only
// surface a warning when the deal is within 7 days of expiry so fresh
// sends stay quiet and Erik's eye lands on the ones running out.
function discountExpiryLabel(sentAt: string | null | undefined): { text: string; tone: "warning" | "expired" } | null {
  if (!sentAt) return null;
  const sent = new Date(sentAt).getTime();
  const expires = sent + 14 * 86400000;
  const daysLeft = Math.ceil((expires - Date.now()) / 86400000);
  if (daysLeft <= 0) return { text: "Discount ended", tone: "expired" };
  if (daysLeft > 7) return null;
  const dayWord = daysLeft === 1 ? "day" : "days";
  return { text: `Discount ends in ${daysLeft} ${dayWord}`, tone: "warning" };
}

const POSTPONE_OPTIONS = [
  { label: "In 2 days", days: 2 },
  { label: "In 3 days", days: 3 },
  { label: "In 5 days", days: 5 },
  { label: "In 7 days", days: 7 },
] as const;


export function SalesDashboardClient({
  handoverProposals,
  reminders,
  newContacts: initialContacts,
  callbackContacts: initialCallbacks,
  totalNewCount,
  totalCallbackCount,
  archiveContacts: initialArchive,
  archiveOutcomes: initialArchiveOutcomes,
  contactsWithProposals,
  processedTodayCount: initialProcessed,
  todayLogs: initialLogs,
  noAnswerCounts: initialNoAnswerCounts,
  stats,
  urgentCount = 0,
}: Props) {
  const router = useRouter();

  // ── Mobile auto-redirect to dialer ──
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) {
      router.replace("/sales/dialer");
    }
  }, [router]);

  // ── Current contact marker ──
  const [currentContactId, setCurrentContactId] = useState<string | null>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("current_contact_id");
    return null;
  });

  // useCallback so CompactContactRow (memoized below) skips re-renders
  // when only unrelated state changes — e.g. opening a dialog or typing
  // in search. Depends on currentContactId because we toggle off-on-off.
  const markCurrent = useCallback((id: string) => {
    setCurrentContactId((prev) => {
      const next = prev === id ? null : id;
      if (next) localStorage.setItem("current_contact_id", next);
      else localStorage.removeItem("current_contact_id");
      return next;
    });
  }, []);

  // ── Shared email dialog (rich text, at dashboard level) ──
  const [sharedEmailOpen, setSharedEmailOpen] = useState(false);
  const [sharedEmailContact, setSharedEmailContact] = useState<CallingContact | null>(null);
  const [sharedEmailSubject, setSharedEmailSubject] = useState("");
  const [sharedEmailBody, setSharedEmailBody] = useState("<p></p>");

  // useCallback so the prop identity is stable for the memoized rows.
  // No deps — all setters are stable.
  const openSharedEmail = useCallback((contact: CallingContact, subject?: string, body?: string) => {
    setSharedEmailContact(contact);
    setSharedEmailSubject(subject || "");
    setSharedEmailBody(body || "<p></p>");
    setSharedEmailOpen(true);
  }, []);

  // ── Handover section state ──
  const [handoverCollapsed, setHandoverCollapsed] = useState(false);
  const reviewProposals = handoverProposals.filter(p => p.status === "review");
  const sentProposals = handoverProposals.filter(p => ["sent", "viewed"].includes(p.status));
  // Tabs inside the handover panel — defaults to whichever bucket has work
  // when the page first renders so Erik isn't dropped on an empty tab.
  const [handoverTab, setHandoverTab] = useState<"review" | "waiting" | "reminders">(() => {
    if (reviewProposals.length > 0) return "review";
    if (sentProposals.length > 0) return "waiting";
    return "reminders";
  });

  // ── Calling section state ──
  const [contacts, setContacts] = useState(initialContacts);
  const [callbacks, setCallbacks] = useState(initialCallbacks);
  // `inProgress` array kept — still used by optimistic-remove and
  // wasInProgress checks when actions cross buckets. Starts empty
  // because the dashboard never surfaces in-progress contacts (Active
  // moved to /sales/active); the array only collects contacts the
  // user moves INTO an in-progress outcome during this session, so
  // optimistic-undo can restore them.
  const [inProgress, setInProgress] = useState<CallingContact[]>([]);
  const [archive, setArchive] = useState(initialArchive);
  const [archiveMeta, setArchiveMeta] = useState<Record<string, InProgressMeta>>(initialArchiveOutcomes);
  // Archive bucket is fetched lazily on first tab click. Initial server
  // payload ships empty arrays so the dashboard renders fast even for
  // salespeople with thousands of archived contacts.
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  // Load-more state for the paginated new/callback buckets. Each ships
  // 100 rows initially; user clicks "Load more" to pull the next page.
  const [loadingMore, setLoadingMore] = useState<"new" | "callback" | null>(null);
  const loadMore = useCallback(
    async (status: "new" | "callback") => {
      if (loadingMore) return;
      setLoadingMore(status);
      try {
        const offset = status === "new" ? contacts.length : callbacks.length;
        const res = await fetch(
          `/api/sales/contacts?status=${status}&offset=${offset}&limit=100`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { contacts: CallingContact[] };
        if (status === "new") {
          setContacts(prev => [...prev, ...(data.contacts ?? [])]);
        } else {
          setCallbacks(prev => [...prev, ...(data.contacts ?? [])]);
        }
      } catch {
        // Silent fail — user can click again or refresh.
      } finally {
        setLoadingMore(null);
      }
    },
    // contacts/callbacks deliberately omitted from deps — we read their
    // length INSIDE the callback at call time. Including them would
    // recreate the function on every contact mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadingMore],
  );
  const [processed, setProcessed] = useState(initialProcessed);
  const [logs, setLogs] = useState(initialLogs);
  const [search, setSearch] = useState("");
  // "in_progress" tab retired — Active lives at /sales/active as its
  // own page. The dashboard now only surfaces buckets that have no
  // dedicated drill-down page: new (cold-call queue), callback
  // (postponed), archive (closed).
  const [activeTab, setActiveTab] = useState<"new" | "callback" | "archive">("new");
  const [noAnswerCounts, setNoAnswerCounts] = useState(initialNoAnswerCounts);

  // First-click loader for the archive tab. Idempotent — bails if already
  // fetched or in-flight. Falls back silently to keep the dashboard UX
  // intact if the API errors; user can refresh to retry.
  const handleTabChange = useCallback(
    (tab: "new" | "callback" | "archive") => {
      setActiveTab(tab);
      if (tab === "archive" && !archiveLoaded && !archiveLoading) {
        setArchiveLoading(true);
        fetch("/api/sales/archive-contacts")
          .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
          .then((data: { contacts: CallingContact[]; outcomes: Record<string, InProgressMeta> }) => {
            setArchive(data.contacts ?? []);
            setArchiveMeta(data.outcomes ?? {});
            setArchiveLoaded(true);
          })
          .catch(() => {
            // Mark as loaded anyway — empty state is friendlier than a
            // perpetual spinner. Refresh the page to retry.
            setArchiveLoaded(true);
          })
          .finally(() => setArchiveLoading(false));
      }
    },
    [archiveLoaded, archiveLoading],
  );

  // ── Undo toast system ──
  const pendingActions = useRef<Map<string, PendingAction>>(new Map());

  // ── Create Proposal dialog state ──
  const [proposalDialog, setProposalDialog] = useState<{ open: boolean; contact: CallingContact | null; price: string }>({ open: false, contact: null, price: "" });

  // ── Postponed handover items (hidden until date) ──
  const [postponedIds, setPostponedIds] = useState<Set<string>>(new Set());

  // ── New contact modal ──
  const [newContactOpen, setNewContactOpen] = useState(false);


  // Flush pending actions on unmount
  useEffect(() => {
    return () => {
      pendingActions.current.forEach((action) => {
        commitAction(action);
      });
      pendingActions.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredContacts = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return contacts;
    return contacts.filter(c =>
      c.company_name.toLowerCase().includes(q) ||
      (c.town && c.town.toLowerCase().includes(q)) ||
      (c.industry && c.industry.toLowerCase().includes(q)) ||
      (c.phone && c.phone.includes(q))
    );
  }, [contacts, search]);

  const filteredCallbacks = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return callbacks;
    return callbacks.filter(c =>
      c.company_name.toLowerCase().includes(q) ||
      (c.town && c.town.toLowerCase().includes(q))
    );
  }, [callbacks, search]);


  // ── Commit action to API (called after undo timer expires) ──
  const commitAction = useCallback(async (action: PendingAction) => {
    const { contactId, outcome, notes, callbackAt, removedContact, proposalData } = action;
    pendingActions.current.delete(contactId);

    try {
      const res = await fetch(`/api/contacts/${contactId}/call-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, notes, callback_at: callbackAt }),
      });
      if (!res.ok) {
        // Revert on failure
        setContacts(prev => [...prev, removedContact]);
        setCallbacks(prev => [...prev, removedContact]);
        setProcessed(prev => prev - 1);
        setLogs(prev => prev.filter(l => l.contact_id !== contactId || l.id !== `pending-${contactId}`));
        toast.error("Error while saving");
        return;
      }

      // If create proposal, create + redirect
      if (outcome === "send_proposal" && removedContact) {
        const propRes = await fetch("/api/proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contact_id: contactId,
            company_name: removedContact.company_name,
            industry: removedContact.industry || undefined,
            town: removedContact.town || undefined,
            services: proposalData?.services || [],
            price: proposalData?.price || undefined,
            base_price: proposalData?.basePrice || undefined,
            requirements: proposalData?.requirements || undefined,
            // Priority/tier tags + custom tags chosen in the dialog. The
            // server falls back to seeding "basic" when this is empty,
            // so IT always sees at least one priority signal.
            tag_ids: proposalData?.tagIds ?? [],
          }),
        });
        if (propRes.ok) {
          toast.success("Proposal created — the IT team has been notified");
        }
      }
    } catch {
      setContacts(prev => [...prev, removedContact]);
      setProcessed(prev => prev - 1);
      toast.error("Network error");
    }
  }, [router]);

  // Outcomes that keep the contact visible on the dashboard (work in progress,
  // salesperson might need to revisit — e.g. follow up on an invoice or email).
  const IN_PROGRESS_OUTCOMES = useMemo(
    () =>
      new Set<CallOutcome>([
        "send_invoice",
        "send_email",
        "send_proposal",
        "note",
        "local_market",
      ] as CallOutcome[]),
    [],
  );

  // ── Handle call outcome with undo toast ──
  const handleOutcome = useCallback((
    contactId: string,
    outcome: CallOutcome,
    notes?: string,
    callbackAt?: string,
    proposalData?: ProposalData,
  ) => {
    // Find and optimistically remove contact from new/callback/inProgress/archive
    const wasInArchive = archive.some(c => c.id === contactId);
    const removedContact =
      contacts.find(c => c.id === contactId) ||
      callbacks.find(c => c.id === contactId) ||
      inProgress.find(c => c.id === contactId) ||
      archive.find(c => c.id === contactId);
    if (!removedContact) return;

    setContacts(prev => prev.filter(c => c.id !== contactId));
    setCallbacks(prev => prev.filter(c => c.id !== contactId));
    setInProgress(prev => prev.filter(c => c.id !== contactId));
    setArchive(prev => prev.filter(c => c.id !== contactId));
    setArchiveMeta(prev => {
      const next = { ...prev };
      delete next[contactId];
      return next;
    });
    setProcessed(prev => prev + 1);

    // For callback outcomes, add to callbacks list and increment count
    if (outcome === "no_answer" || outcome === "callback") {
      const callbackContact = { ...removedContact, status: "callback" as const, callback_at: callbackAt || new Date(Date.now() + 86400000).toISOString() };
      setCallbacks(prev => [callbackContact, ...prev]);
      setNoAnswerCounts(prev => ({ ...prev, [contactId]: (prev[contactId] || 0) + 1 }));
    }

    // Track contacts that flipped into an in-progress outcome so the
    // optimistic-undo path below can restore them to the right bucket.
    // The Active tab is gone, so we no longer store per-contact outcome
    // metadata in the dashboard — /sales/active fetches it server-side.
    if (IN_PROGRESS_OUTCOMES.has(outcome)) {
      setInProgress(prev => [removedContact, ...prev]);
    }

    const newLog: TodayLog = {
      id: `pending-${contactId}`,
      contact_id: contactId,
      outcome,
      notes: notes || null,
      callback_at: callbackAt || null,
      created_at: new Date().toISOString(),
      contacts: [{ id: removedContact.id, company_name: removedContact.company_name, phone: removedContact.phone, industry: removedContact.industry, town: removedContact.town }],
    };
    setLogs(prev => [newLog, ...prev]);

    // Build undo toast message
    let toastMessage = OUTCOME_LABELS[outcome] || outcome;
    if (outcome === "no_answer") {
      toastMessage = "No answer — call tomorrow";
    }

    const action: PendingAction = {
      contactId, outcome, notes, callbackAt, removedContact,
      toastId: "",
      proposalData,
    };

    const wasInProgress = inProgress.some(c => c.id === contactId);

    const toastId = toast(toastMessage, {
      description: removedContact.company_name,
      duration: 12000,
      action: {
        label: "Undo",
        onClick: () => {
          // Undo: restore the contact to its previous tab + remove from in-progress
          pendingActions.current.delete(contactId);
          setInProgress(prev => prev.filter(c => c.id !== contactId));
          if (wasInArchive) {
            setArchive(prev => [removedContact, ...prev]);
          } else if (wasInProgress) {
            setInProgress(prev => [removedContact, ...prev]);
          } else if (removedContact.status === "callback" || callbacks.some(c => c.id === contactId)) {
            setCallbacks(prev => [removedContact, ...prev]);
          } else {
            setContacts(prev => [removedContact, ...prev]);
          }
          setProcessed(prev => prev - 1);
          setLogs(prev => prev.filter(l => l.id !== `pending-${contactId}`));
        },
      },
      onAutoClose: () => {
        const pending = pendingActions.current.get(contactId);
        if (pending) commitAction(pending);
      },
      onDismiss: () => {
        const pending = pendingActions.current.get(contactId);
        if (pending) commitAction(pending);
      },
    });

    action.toastId = toastId;
    pendingActions.current.set(contactId, action);
  }, [contacts, callbacks, inProgress, archive, IN_PROGRESS_OUTCOMES, commitAction]);

  // ── Open proposal dialog instead of direct action ──
  const openProposalDialog = useCallback((contact: CallingContact, price?: string) => {
    setProposalDialog({ open: true, contact, price: price || "" });
  }, []);

  const visibleReviewProposals = reviewProposals.filter(p => !postponedIds.has(p.id));
  const visibleSentProposals = sentProposals.filter(p => !postponedIds.has(p.id));
  const visibleReminders = reminders.filter(r => !postponedIds.has(r.id));
  const totalHandover = visibleReviewProposals.length + visibleSentProposals.length + visibleReminders.length;

  return (
    <TooltipProvider>
      <div className="space-y-3 w-full flex flex-col" style={{ minHeight: "calc(100vh - 80px)" }}>

        {/* ══════════ STAT CARDS ══════════
            Trimmed to the two action-driving metrics:
              • V procese    — proposals tech is currently building
              • Na odovzdanie — proposals waiting on you to send
            Kontakty (vanity roster count) and Klienti (cumulative
            trophy) were removed — neither changed the salesperson's
            next action and the Klienti list is still one click away
            from the sidebar. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard
            label="In progress"
            value={stats.inProgress}
            href="/sales/proposals"
            icon={Briefcase}
          />
          <StatCard
            label="To hand over"
            value={stats.reviewCount}
            href="/sales/proposals"
            icon={Eye}
            highlight={stats.reviewCount > 0}
          />
        </div>

        {/* ══════════ TWO-COLUMN WORKSPACE ══════════
            Handover queue (left) + Calling database (right). When the
            handover queue is empty, calling collapses to a single column
            and takes the full width. */}
        <div className={`grid grid-cols-1 gap-3 flex-1 min-h-0 ${totalHandover > 0 ? "xl:grid-cols-[380px_1fr]" : ""}`}>

        {/* ══════════ SECTION 1: Handover Proposals (collapsible) ══════════ */}
        {totalHandover > 0 && (
          <div className="rounded-lg border bg-card overflow-hidden flex flex-col min-h-0">
            <button
              onClick={() => setHandoverCollapsed(!handoverCollapsed)}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-muted/30 transition-colors shrink-0"
            >
              <div className="flex items-center gap-2">
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">Ready to hand over</span>
                <span className="text-[10px] text-muted-foreground">{totalHandover}</span>
              </div>
              {handoverCollapsed ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>

            {!handoverCollapsed && (() => {
              // Each tab is hard-capped in the row render below (5/5/3).
              // Show "shown of total" when there are more rows than the cap
              // so the count stops lying about what's actually visible —
              // bare "(46)" implied all 46 were on screen.
              const REVIEW_CAP = 5;
              const WAITING_CAP = 5;
              const REMINDERS_CAP = 3;
              const tabs = [
                { id: "review" as const,    label: "To hand over", total: visibleReviewProposals.length, cap: REVIEW_CAP },
                { id: "waiting" as const,   label: "Waiting",      total: visibleSentProposals.length,   cap: WAITING_CAP },
                { id: "reminders" as const, label: "Reminders",    total: visibleReminders.length,        cap: REMINDERS_CAP },
              ];
              return (
              <>
                {/* Tabs — same visual language as the calling section below */}
                <div className="flex items-center px-1 border-t border-b shrink-0">
                  {tabs.map(t => {
                    const isActive = handoverTab === t.id;
                    const shown = Math.min(t.total, t.cap);
                    const label =
                      t.total > t.cap
                        ? `${shown} of ${t.total}`
                        : `${t.total}`;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setHandoverTab(t.id)}
                        className={`py-2 px-2.5 text-[11px] font-medium whitespace-nowrap transition-colors ${
                          isActive
                            ? "border-b-2 border-primary text-foreground -mb-px"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t.label} <span className="text-muted-foreground/70">({label})</span>
                      </button>
                    );
                  })}
                </div>

                {/* Column header */}
                <div className="flex items-center gap-2 px-3 py-1 border-b bg-muted/30 text-[10px] font-medium uppercase tracking-wide text-muted-foreground shrink-0">
                  <span className="flex-1 min-w-0">Company</span>
                  <span className="w-24 shrink-0">Status</span>
                  <span className="w-12 shrink-0 text-right">Actions</span>
                </div>

                {/* Rows — filtered by active tab */}
                <div className="flex-1 overflow-y-auto divide-y">
                  {handoverTab === "review" && (
                    visibleReviewProposals.length === 0 ? (
                      <div className="py-10 text-center text-[11px] text-muted-foreground">No proposals to hand over</div>
                    ) : (
                      [...visibleReviewProposals]
                        .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
                        .slice(0, 5)
                        .map(p => {
                          const siteUrl = p.deployments?.[0] ? `https://${p.deployments[0].subdomain}.pages.dev` : null;
                          const phone = p.contacts?.phone;
                          return (
                            <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/20 text-[11px]">
                              <div className="flex-1 min-w-0 flex items-center gap-1.5">
                                <Link href={p.contact_id ? `/sales/contacts/${p.contact_id}` : `/sales/active`} className="font-medium truncate hover:underline">{p.company_name}</Link>
                                {phone && <PhoneQrPopover phone={phone}><Phone className="h-3.5 w-3.5 text-primary shrink-0" /></PhoneQrPopover>}
                                {siteUrl && <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline shrink-0">web</a>}
                                <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">{formatDistanceToNow(new Date(p.updated_at), { addSuffix: true })}</span>
                              </div>
                              <div className="w-24 shrink-0">
                                <StatusPill tone="cyan">To hand over</StatusPill>
                              </div>
                              <div className="w-12 shrink-0 flex items-center justify-end gap-0.5">
                                <PostponeButton itemId={p.id} onPostpone={(id) => setPostponedIds(prev => new Set(prev).add(id))} />
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button className="text-muted-foreground hover:text-foreground p-0.5"><MoreHorizontal className="h-3 w-3" /></button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    {siteUrl && <DropdownMenuItem onClick={() => window.open(siteUrl, "_blank")}>View site</DropdownMenuItem>}
                                    <DropdownMenuItem onClick={() => { if (p.contact_id) window.location.href = `/sales/contacts/${p.contact_id}`; }}>Contact details</DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          );
                        })
                    )
                  )}

                  {handoverTab === "waiting" && (
                    visibleSentProposals.length === 0 ? (
                      <div className="py-10 text-center text-[11px] text-muted-foreground">No sent proposals</div>
                    ) : (
                      [...visibleSentProposals]
                        .sort((a, b) => new Date(a.sent_at || a.updated_at).getTime() - new Date(b.sent_at || b.updated_at).getTime())
                        .slice(0, 5)
                        .map(p => {
                          const siteUrl = p.deployments?.[0] ? `https://${p.deployments[0].subdomain}.pages.dev` : null;
                          const phone = p.contacts?.phone;
                          const expiry = discountExpiryLabel(p.sent_at);
                          const isViewed = p.status === "viewed";
                          return (
                            <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/20 text-[11px]">
                              <div className="flex-1 min-w-0 flex items-center gap-1.5">
                                <Link href={p.contact_id ? `/sales/contacts/${p.contact_id}` : `/sales/active`} className="font-medium truncate hover:underline">{p.company_name}</Link>
                                {phone && <PhoneQrPopover phone={phone}><Phone className="h-3.5 w-3.5 text-primary shrink-0" /></PhoneQrPopover>}
                                {siteUrl && <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline shrink-0">web</a>}
                                {expiry ? (
                                  <span className={`text-[10px] shrink-0 font-medium ml-auto ${expiry.tone === "expired" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                                    {expiry.text}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">
                                    {p.sent_at ? formatDistanceToNow(new Date(p.sent_at), { addSuffix: true }) : ""}
                                  </span>
                                )}
                              </div>
                              <div className="w-24 shrink-0">
                                <StatusPill tone={isViewed ? "emerald" : "violet"}>
                                  {isViewed ? "Client viewed" : "Sent"}
                                </StatusPill>
                              </div>
                              <div className="w-12 shrink-0 flex items-center justify-end gap-0.5">
                                <PostponeButton itemId={p.id} onPostpone={(id) => setPostponedIds(prev => new Set(prev).add(id))} />
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button className="text-muted-foreground hover:text-foreground p-0.5"><MoreHorizontal className="h-3 w-3" /></button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    {siteUrl && <DropdownMenuItem onClick={() => window.open(siteUrl, "_blank")}>View site</DropdownMenuItem>}
                                    <DropdownMenuItem onClick={() => { if (p.contact_id) window.location.href = `/sales/contacts/${p.contact_id}`; }}>Contact details</DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          );
                        })
                    )
                  )}

                  {handoverTab === "reminders" && (
                    visibleReminders.length === 0 ? (
                      <div className="py-10 text-center text-[11px] text-muted-foreground">No reminders</div>
                    ) : (
                      [...visibleReminders]
                        .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
                        .slice(0, 3)
                        .map(r => (
                          <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/20 text-[11px]">
                            <Link
                              href={r.proposals?.contact_id ? `/sales/contacts/${r.proposals.contact_id}` : "/sales/proposals"}
                              className="flex-1 min-w-0 font-medium truncate hover:underline"
                            >
                              {r.proposals?.company_name || "—"}
                            </Link>
                            <div className="w-24 shrink-0">
                              <StatusPill tone="amber">{REMINDER_LABELS[r.reminder_type] || r.reminder_type}</StatusPill>
                            </div>
                            <div className="w-12 shrink-0 flex items-center justify-end gap-0.5">
                              <PostponeButton itemId={r.id} onPostpone={(id) => setPostponedIds(prev => new Set(prev).add(id))} />
                              <DismissReminderButton reminderId={r.id} />
                            </div>
                          </div>
                        ))
                    )
                  )}
                </div>

                {totalHandover > 5 && (
                  <Link href="/sales/proposals" className="flex items-center justify-center gap-1 px-3 py-1.5 text-[10px] text-primary hover:underline border-t shrink-0">
                    View all ({totalHandover}) <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </>
              );
            })()}
          </div>
        )}

        {/* ══════════ SECTION 2: Calling Database (main) ══════════ */}
        <div className="rounded-lg border bg-card overflow-hidden flex flex-col min-h-0">
          {/* Tabs + search */}
          <div className="flex items-center justify-between px-3 border-b">
            <div className="flex items-center gap-0">
              {(() => {
                const TAB_META: Record<typeof activeTab, { label: string; count: number; hint: string }> = {
                  new: {
                    label: "New",
                    count: totalNewCount,
                    hint: "Contacts you haven't called yet.",
                  },
                  callback: {
                    label: "Call back later",
                    count: totalCallbackCount,
                    hint: "Contacts you scheduled to call back later.",
                  },
                  archive: {
                    label: "Archive",
                    count: archive.length,
                    hint: "Closed contacts. Not interested, don't exist, or should not be contacted.",
                  },
                };
                return (["new", "callback", "archive"] as const).map(tab => {
                  const meta = TAB_META[tab];
                  const isActive = activeTab === tab;
                  return (
                    <div key={tab} className="flex items-center">
                      <button
                        onClick={() => handleTabChange(tab)}
                        className={`py-2.5 pl-3 pr-1.5 text-xs font-medium transition-colors ${isActive ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {meta.label}
                        {tab === "archive" && !archiveLoaded ? null : ` (${meta.count})`}
                      </button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className={`mr-1 p-1 rounded transition-colors ${
                              isActive
                                ? "text-muted-foreground/70 hover:text-primary hover:bg-muted"
                                : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted"
                            }`}
                            aria-label={`What is ${meta.label}?`}
                          >
                            <HelpCircle className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs text-xs">
                          {meta.hint}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  );
                });
              })()}
              <span className="ml-3 text-[11px] text-emerald-600 font-semibold whitespace-nowrap" title="Calls made today">
                Today: {processed} calls
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-44">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="pl-8 h-7 text-xs"
                />
              </div>
              <Button size="sm" variant="outline" className="h-7 text-[10px] px-2 gap-1" onClick={() => setNewContactOpen(true)}>
                <Plus className="h-3 w-3" /> New contact
              </Button>
            </div>
          </div>

          {/* Table header (always shown — same column structure for all tabs) */}
          {(
            <div className="flex items-center gap-3 px-3 py-1 border-b bg-muted/30 text-[10px] font-medium text-muted-foreground uppercase tracking-wide sticky top-0 z-10">
              {activeTab === "archive" && (
                <span className="w-32 shrink-0 pr-2">Last activity</span>
              )}
              <span className="w-40 shrink-0 pr-2">Company</span>
              {/* Mesto + Odvetvie removed from every tab — Erik sees the
                  full lead detail (city, industry, services, lead
                  description) in the calling panel after clicking the row.
                  The dashboard table is for triage + first-call decision. */}
              <span className="w-32 shrink-0 pr-2">Phone</span>
              <span className="w-32 shrink-0 pr-2">Email</span>
              <span className="flex-1 text-right pr-1">Actions</span>
            </div>
          )}

          {/* Contact list */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === "new" && (
              filteredContacts.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {search ? "No results" : "No contacts to call"}
                </div>
              ) : (
                <>
                  {filteredContacts.map(c => (
                    <CompactContactRow
                      key={c.id}
                      contact={c}
                      onOutcome={handleOutcome}
                      onCreateProposal={openProposalDialog}
                      isCurrent={currentContactId === c.id}
                      onMarkCurrent={markCurrent}
                      onSendEmail={openSharedEmail}
                      hasProposal={contactsWithProposals[c.id]}
                    />
                  ))}
                  {!search && contacts.length < totalNewCount && (
                    <div className="py-3 flex justify-center border-t">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px]"
                        disabled={loadingMore === "new"}
                        onClick={() => loadMore("new")}
                      >
                        {loadingMore === "new"
                          ? "Loading…"
                          : `Load more (${totalNewCount - contacts.length} remaining)`}
                      </Button>
                    </div>
                  )}
                </>
              )
            )}

            {activeTab === "callback" && (
              filteredCallbacks.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No callbacks</div>
              ) : (
                <>
                  {filteredCallbacks.map(c => (
                    <CompactContactRow
                      key={c.id}
                      contact={c}
                      onOutcome={handleOutcome}
                      onCreateProposal={openProposalDialog}
                      noAnswerCount={noAnswerCounts[c.id]}
                      isCurrent={currentContactId === c.id}
                      onMarkCurrent={markCurrent}
                      onSendEmail={openSharedEmail}
                      hidePostpone
                      hasProposal={contactsWithProposals[c.id]}
                    />
                  ))}
                  {!search && callbacks.length < totalCallbackCount && (
                    <div className="py-3 flex justify-center border-t">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px]"
                        disabled={loadingMore === "callback"}
                        onClick={() => loadMore("callback")}
                      >
                        {loadingMore === "callback"
                          ? "Loading…"
                          : `Load more (${totalCallbackCount - callbacks.length} remaining)`}
                      </Button>
                    </div>
                  )}
                </>
              )
            )}

            {activeTab === "archive" && (
              archiveLoading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Loading archive…
                </div>
              ) : archive.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {search ? "No results" : "No archived contacts"}
                </div>
              ) : (
                archive
                  .filter(c => {
                    const q = search.toLowerCase();
                    if (!q) return true;
                    return c.company_name.toLowerCase().includes(q) ||
                      (c.town && c.town.toLowerCase().includes(q)) ||
                      (c.phone && c.phone.includes(q));
                  })
                  .map(c => {
                    const meta = archiveMeta[c.id];
                    const label = meta ? (OUTCOME_LABELS[meta.outcome] || meta.outcome) : undefined;
                    return (
                      <CompactContactRow
                        key={c.id}
                        contact={c}
                        onOutcome={handleOutcome}
                        onCreateProposal={openProposalDialog}
                        isCurrent={currentContactId === c.id}
                        onMarkCurrent={markCurrent}
                        onSendEmail={openSharedEmail}
                        hidePostpone
                        stateBadge={label}
                        latestOutcome={meta?.outcome}
                        hasProposal={contactsWithProposals[c.id]}
                        showRestore
                      />
                    );
                  })
              )
            )}
          </div>
        </div>

        </div>{/* end two-column workspace */}

        {/* ══════════ CREATE PROPOSAL DIALOG ══════════ */}
        <CreateProposalDialog
          open={proposalDialog.open}
          contact={proposalDialog.contact}
          price={proposalDialog.price}
          onOpenChange={(open) => setProposalDialog(prev => ({ ...prev, open }))}
          onSubmit={(data) => {
            if (!proposalDialog.contact) return;
            const c = proposalDialog.contact;
            setProposalDialog({ open: false, contact: null, price: "" });
            handleOutcome(c.id, "send_proposal" as CallOutcome, undefined, undefined, data);
          }}
        />

        {/* ══════════ NEW CONTACT MODAL ══════════ */}
        <AddContactDialog
          open={newContactOpen}
          onOpenChange={setNewContactOpen}
          slovak
          assignTo={undefined}
          onCreated={(contact) => {
            setContacts(prev => [...prev, contact as unknown as CallingContact]);
          }}
        />

        {/* ══════════ SHARED EMAIL DIALOG (with templates) ══════════ */}
        {sharedEmailContact && (
          <FollowUpEmailDialog
            open={sharedEmailOpen}
            onOpenChange={setSharedEmailOpen}
            contactId={sharedEmailContact.id}
            companyName={sharedEmailContact.company_name}
            contactEmail={sharedEmailContact.email}
            initialSubject={sharedEmailSubject}
            initialBody={sharedEmailBody}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

// Expandable description inside lead info popover
function LeadDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 200 || text.split("\n").length > 4;
  return (
    <div>
      <p
        className={`text-xs italic whitespace-pre-wrap ${
          !expanded && isLong ? "line-clamp-6" : ""
        }`}
      >
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] text-primary hover:underline mt-0.5"
        >
          {expanded ? "Collapse" : "Show all"}
        </button>
      )}
    </div>
  );
}

// ── Compact Contact Row (Excel-like) ──
//
// Wrapped in React.memo so the calling-page list doesn't re-render every
// row whenever an unrelated state changes (search input, dialog open/close,
// outcome toast, etc.). For memo to actually skip work the props identity
// must be stable, which is why the parent now uses useCallback for
// markCurrent / openSharedEmail and passes `markCurrent` directly instead
// of `() => markCurrent(c.id)`.
function CompactContactRowImpl({ contact: c, onOutcome, onCreateProposal, noAnswerCount, isCurrent, onMarkCurrent, onSendEmail, hidePostpone, stateBadge, latestOutcome, hasProposal, showRestore }: {
  contact: CallingContact;
  onOutcome: (id: string, outcome: CallOutcome, notes?: string, callbackAt?: string) => void;
  onCreateProposal: (contact: CallingContact, price?: string) => void;
  noAnswerCount?: number;
  isCurrent?: boolean;
  onMarkCurrent?: (id: string) => void;
  onSendEmail?: (contact: CallingContact, subject?: string, body?: string) => void;
  hidePostpone?: boolean;
  stateBadge?: string;
  latestOutcome?: string;
  hasProposal?: boolean;
  showRestore?: boolean;
}) {
  const [fading, setFading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [phonePopoverOpen, setPhonePopoverOpen] = useState(false);
  const [emailPopoverOpen, setEmailPopoverOpen] = useState(false);
  const [invoiceMessage, setInvoiceMessage] = useState("");
  const [neverContactOpen, setNeverContactOpen] = useState(false);
  const [neverContactNote, setNeverContactNote] = useState("");
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editExpanded, setEditExpanded] = useState(false);
  const [localCompany, setLocalCompany] = useState(c.company_name);
  const [localTown, setLocalTown] = useState(c.town || "");
  const [localIndustry, setLocalIndustry] = useState(c.industry || "");
  const [localEmail, setLocalEmail] = useState(c.email || "");
  const [localPhones, setLocalPhones] = useState<string[]>(
    c.phones && c.phones.length > 0 ? [...c.phones] : c.phone ? [c.phone] : [""]
  );
  const [localContact, setLocalContact] = useState(c.contact_person || "");
  const [localWebsite, setLocalWebsite] = useState(c.website_url || "");
  const [localNotes, setLocalNotes] = useState(c.notes || "");

  const handleAction = (outcome: CallOutcome, notes?: string) => {
    setFading(true);
    setTimeout(() => onOutcome(c.id, outcome, notes), 300);
  };

  return (
    <div className={`flex items-center gap-3 px-3 py-0.5 border-b last:border-b-0 text-[11px] transition-[opacity,transform,background-color,border-color] duration-300 ${fading ? "opacity-0 -translate-x-4" : "opacity-100"} ${
      historyOpen
        ? "bg-amber-500/10 border-l-2 border-l-amber-500"
        : isCurrent
          ? "border-l-2! border-l-primary! bg-primary/5"
          : "border-l-2 border-l-transparent hover:border-l-primary/60 hover:bg-muted/20"
    }`}>
      {/* Last activity — state label only opens history popover */}
      {stateBadge && (
        <div className="w-32 shrink-0 pr-2">
          <StateHistoryPopover
            contactId={c.id}
            companyName={c.company_name}
            onOpenChange={setHistoryOpen}
          >
            <button
              type="button"
              className="group inline-flex items-center gap-1 max-w-full text-left text-[10px] font-semibold text-amber-700 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 transition-colors"
              title="View activity history"
            >
              <GitCommitVertical className="h-3 w-3 text-amber-600/70 dark:text-amber-400/70 group-hover:text-amber-500 transition-colors shrink-0" />
              <span className="truncate border-b border-dotted border-amber-600/50 group-hover:border-amber-500">
                {stateBadge}
              </span>
            </button>
          </StateHistoryPopover>
        </div>
      )}
      {/* Firma */}
      <div className="w-40 shrink-0 flex items-center gap-1.5 min-w-0 pr-2">
        <Link
          href={`/sales/volanie?contact=${c.id}`}
          className={`font-medium truncate hover:underline hover:text-primary transition-colors ${c.source === "manual" ? "text-emerald-300/70" : ""}`}
          title={`${localCompany} — click to open in calling`}
        >
          {localCompany}
        </Link>
        {(c.description || c.services_offered || c.total_listings !== null || c.cities_count !== null || c.postal_code || c.source_url) && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="shrink-0 text-muted-foreground/60 hover:text-primary transition-colors"
                title="Lead info"
              >
                <Info className="h-3 w-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-80 p-3 space-y-2 text-xs">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Lead info
              </p>

              {/* Stats grid — always show all fields so gaps are visible */}
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="space-y-0.5">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Listings</p>
                  <p className="font-semibold">{c.total_listings ?? "—"}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Cities</p>
                  <p className="font-semibold">{c.cities_count ?? "—"}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Postal code</p>
                  <p className="font-semibold">{c.postal_code || "—"}</p>
                </div>
              </div>

              <div className="space-y-0.5">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Services</p>
                {c.services_offered ? (
                  <p className="text-xs line-clamp-2" title={c.services_offered}>
                    {c.services_offered.split("|").map(s => s.trim()).filter(Boolean).join(" • ")}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground italic">—</p>
                )}
              </div>

              <div className="space-y-0.5 border-l-2 border-border pl-2">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Description</p>
                {c.description ? (
                  <LeadDescription text={c.description} />
                ) : (
                  <p className="text-xs text-muted-foreground italic">—</p>
                )}
              </div>

              <div className="space-y-0.5">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Source</p>
                {c.source_url ? (
                  <a
                    href={c.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-[11px] text-primary hover:underline truncate"
                    title={c.source_url}
                  >
                    {c.source_url.replace(/^https?:\/\//, "")} ↗
                  </a>
                ) : (
                  <p className="text-xs text-muted-foreground italic">—</p>
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {noAnswerCount && noAnswerCount > 0 && (
          <Badge
            variant="outline"
            className="text-[9px] px-1 py-0 h-4 bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800 shrink-0 cursor-help"
            title={`Call was postponed ${noAnswerCount}×`}
          >
            {noAnswerCount}x
          </Badge>
        )}
        {c.notes && (
          <Tooltip>
            <TooltipTrigger asChild>
              <StickyNote className="h-3 w-3 text-muted-foreground shrink-0 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-50">
              <p className="text-xs">{c.notes}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Mesto + Odvetvie cells were here — both removed from the dashboard
          table. They live in the calling panel and the contact detail page
          where they're needed for context. */}

      {/* Phone */}
      <div className="w-32 shrink-0 min-w-0 pr-2 flex items-center gap-1">
        {c.phone ? (
          <>
            <PhoneQrPopover phone={c.phone} companyName={c.company_name}>
              <Phone className="h-3 w-3 shrink-0" />
              {c.phone}
            </PhoneQrPopover>
            {c.phone_notes?.[c.phone] && (
              <span className="text-[9px] text-muted-foreground truncate max-w-12">{c.phone_notes[c.phone]}</span>
            )}
            <Popover open={phonePopoverOpen} onOpenChange={setPhonePopoverOpen}>
              <PopoverTrigger asChild>
                <button className={`shrink-0 rounded px-1 py-0.5 ${c.phones && c.phones.length > 1 ? "text-[10px] font-bold bg-primary/20 text-primary" : "text-[10px] text-muted-foreground/70 hover:text-muted-foreground"}`}>
                  {c.phones && c.phones.length > 1 ? `+${c.phones.length - 1}` : "✎"}
                </button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="start" className="w-72 p-2">
                <p className="text-[10px] text-muted-foreground mb-2 font-medium">
                  {c.phones && c.phones.length > 1 ? `All numbers (${c.phones.length})` : "Phone"}
                </p>
                <div className="space-y-1.5">
                  {(c.phones && c.phones.length > 0 ? c.phones : [c.phone]).map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <PhoneQrPopover phone={p!} companyName={c.company_name}>
                        <span className="flex items-center gap-1.5 text-xs shrink-0 min-w-28">
                          <Phone className="h-3 w-3" />
                          {p}
                        </span>
                      </PhoneQrPopover>
                      <input
                        id={`phone-note-${c.id}-${i}`}
                        defaultValue={c.phone_notes?.[p!] || ""}
                        placeholder="e.g. owner, assistant, not working..."
                        className="flex-1 text-[10px] bg-transparent border-b border-border/30 focus:border-primary/50 outline-none px-1 py-0.5 text-muted-foreground placeholder:text-muted-foreground/50"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        className="shrink-0 text-muted-foreground hover:text-emerald-500 transition-colors"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const input = document.getElementById(`phone-note-${c.id}-${i}`) as HTMLInputElement;
                          const note = input?.value.trim() || "";
                          const currentNotes = c.phone_notes || {};
                          const updated = { ...currentNotes, [p!]: note };
                          try {
                            const supabase = (await import("@/lib/supabase/client")).createClient();
                            const oldNotes = { ...currentNotes };
                            await supabase.from("contacts").update({ phone_notes: updated }).eq("id", c.id);
                            setPhonePopoverOpen(false);
                            toast(`${p}: "${note || "—"}"`, {
                              description: "Note saved",
                              action: {
                                label: "Undo",
                                onClick: async () => {
                                  await supabase.from("contacts").update({ phone_notes: oldNotes }).eq("id", c.id);
                                  if (input) input.value = oldNotes[p!] || "";
                                  toast.success("Reverted");
                                },
                              },
                            });
                          } catch {
                            toast.error("Error");
                          }
                        }}
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </>
        ) : (
          <span className="text-muted-foreground/50 text-[10px]">—</span>
        )}
      </div>


      {/* Email shown read-only — amber dash signals "missing, you'll need this" without shouting */}
      <span className="w-32 shrink-0 truncate text-[10px] text-muted-foreground" title={c.email || "Email missing"}>
        {c.email || <span className="text-amber-500/70" title="Email missing — add it on the contact">—</span>}
      </span>

      {/* Akcie */}
      <div className="flex items-center justify-end flex-1 gap-1.5">
        {showRestore ? (
          /* Restore button — only on archived rows */
          <button
            type="button"
            onClick={() => handleAction("note" as CallOutcome, "Restored from archive")}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 hover:border-emerald-500 hover:bg-emerald-500/10 rounded px-1.5 py-0.5 transition-colors"
            title="Restore contact back to active"
          >
            <RotateCcw className="h-3 w-3" />
            Restore
          </button>
        ) : (
          <>
            {/* Proposal button — shown whenever an active proposal exists */}
            {(hasProposal || latestOutcome === "send_proposal") && (
              <Link
                href={`/sales/contacts/${c.id}`}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-600 dark:text-sky-400 border border-sky-500/40 hover:border-sky-500 hover:bg-sky-500/10 rounded px-1.5 py-0.5 transition-colors"
                title="Open proposal"
              >
                <FileText className="h-3 w-3" />
                Proposal
              </Link>
            )}

            {/* Calling button — always shown */}
            <Link
              href={`/sales/volanie?contact=${c.id}`}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-primary border border-primary/40 hover:border-primary hover:bg-primary/10 rounded px-1.5 py-0.5 transition-colors"
            >
              Open
              <ChevronRight className="h-3 w-3" />
            </Link>
          </>
        )}
      </div>

      {/* Invoice dialog — message to admin */}
      <Dialog open={invoiceDialogOpen} onOpenChange={setInvoiceDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Send invoice</DialogTitle>
            <div className="text-xs text-muted-foreground">
              <p>{c.company_name}</p>
              <p className="mt-0.5">Email: <span className={c.email ? "text-foreground" : "text-amber-500"}>{c.email || "no email"}</span></p>
            </div>
          </DialogHeader>
          <Textarea
            value={invoiceMessage}
            onChange={(e) => setInvoiceMessage(e.target.value)}
            placeholder="What should be on the invoice? E.g.: Website $149, GBP $75, Backlinks $35..."
            className="text-sm min-h-20"
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setInvoiceDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={async () => {
              if (!invoiceMessage.trim()) return;
              // Route through the API so super admin gets both the
              // dashboard row + email notification (same inbox as
              // domain requests).
              try {
                await fetch(`/api/contacts/${c.id}/invoice-request`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    company_name: c.company_name,
                    message: invoiceMessage,
                  }),
                });
              } catch { /* still proceed with the action */ }
              setInvoiceDialogOpen(false);
              handleAction("send_invoice" as CallOutcome, invoiceMessage || undefined);
              setInvoiceMessage("");
            }}>
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Never contact dialog */}
      <Dialog open={neverContactOpen} onOpenChange={setNeverContactOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Do not contact</DialogTitle>
            <p className="text-xs text-muted-foreground">{c.company_name}</p>
          </DialogHeader>
          <Textarea
            value={neverContactNote}
            onChange={(e) => setNeverContactNote(e.target.value)}
            placeholder="Reason (e.g. doesn't want to be contacted, made threats...)"
            className="text-sm min-h-16"
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setNeverContactOpen(false)}>Cancel</Button>
            <Button size="sm" variant="destructive" onClick={() => {
              setNeverContactOpen(false);
              handleAction("never_contact" as CallOutcome, neverContactNote || undefined);
              setNeverContactNote("");
            }}>
              Do not contact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom date dialog for No answer */}
      <Dialog open={dateDialogOpen} onOpenChange={setDateDialogOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Call back later</DialogTitle>
          </DialogHeader>
          <input
            type="date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            className="w-full text-sm border rounded px-3 py-2 bg-background"
            min={getFutureDate(1)}
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDateDialogOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={!customDate} onClick={() => {
              setDateDialogOpen(false);
              setFading(true);
              setTimeout(() => onOutcome(c.id, "no_answer" as CallOutcome, undefined, customDate), 300);
            }}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit contact modal */}
      <Dialog open={editModalOpen} onOpenChange={(v) => { setEditModalOpen(v); if (!v) setEditExpanded(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Edit contact</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {/* Primary fields */}
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Company</label>
              <Input value={localCompany} onChange={(e) => setLocalCompany(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">City</label>
                <Input value={localTown} onChange={(e) => setLocalTown(e.target.value)} placeholder="—" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">Industry</label>
                <Input value={localIndustry} onChange={(e) => setLocalIndustry(e.target.value)} placeholder="—" className="h-8 text-sm" />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Email</label>
              <Input type="email" value={localEmail} onChange={(e) => setLocalEmail(e.target.value)} placeholder="email@company.com" className="h-8 text-sm" />
            </div>

            {/* Expandable extra fields */}
            <button
              onClick={() => setEditExpanded(!editExpanded)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              {editExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              More information
            </button>

            {editExpanded && (
              <div className="space-y-3 pt-1 border-t border-border/50">
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Phone numbers</label>
                  <div className="space-y-1.5">
                    {localPhones.map((phone, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <Input
                          value={phone}
                          onChange={(e) => {
                            const next = [...localPhones];
                            next[i] = e.target.value;
                            setLocalPhones(next);
                          }}
                          placeholder={`Phone ${i + 1}`}
                          className="h-8 text-sm"
                        />
                        {localPhones.length > 1 && (
                          <button
                            onClick={() => setLocalPhones(prev => prev.filter((_, j) => j !== i))}
                            className="text-red-400 hover:text-red-500 shrink-0"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => setLocalPhones(prev => [...prev, ""])}
                      className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Add number
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Contact person</label>
                  <Input value={localContact} onChange={(e) => setLocalContact(e.target.value)} placeholder="First and last name" className="h-8 text-sm" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Website</label>
                  <Input value={localWebsite} onChange={(e) => setLocalWebsite(e.target.value)} placeholder="www.company.com" className="h-8 text-sm" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Notes</label>
                  <Textarea value={localNotes} onChange={(e) => setLocalNotes(e.target.value)} placeholder="Internal notes..." className="text-sm min-h-14" />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => { setEditModalOpen(false); setEditExpanded(false); }}>Cancel</Button>
            <Button size="sm" onClick={async () => {
              try {
                await fetch(`/api/contacts/${c.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    company_name: localCompany.trim(),
                    town: localTown.trim() || null,
                    industry: localIndustry.trim() || null,
                    email: localEmail.trim() || null,
                    phone: localPhones.filter(p => p.trim())[0] || null,
                    phones: localPhones.filter(p => p.trim()),
                    contact_person: localContact.trim() || null,
                    website_url: localWebsite.trim() || null,
                    notes: localNotes.trim() || null,
                  }),
                });
                toast.success("Contact updated");
              } catch { toast.error("Error"); }
              setEditModalOpen(false);
              setEditExpanded(false);
            }}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const CompactContactRow = memo(CompactContactRowImpl);

// ── Create Proposal Dialog ──
function CreateProposalDialog({ open, contact, price: initialPrice, onOpenChange, onSubmit }: {
  open: boolean;
  contact: CallingContact | null;
  price: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ProposalData) => void;
}) {
  const [services, setServices] = useState<string[]>(["", "", "", ""]);
  const [discountPrice, setDiscountPrice] = useState(initialPrice || "");
  const [basePrice, setBasePrice] = useState("299");
  const [requirements, setRequirements] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailEditing, setEmailEditing] = useState(false);
  // Priority + custom tags. TagsField auto-seeds "basic" when empty so
  // IT always sees a tier signal even if Erik doesn't pick anything.
  const [tagIds, setTagIds] = useState<string[]>([]);

  // Check if email looks valid (has TLD)
  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email);
  const emailValid = isValidEmail(emailInput);
  const hasEmail = !!contact?.email || emailSaved;

  // Pre-fill first service with industry when dialog opens
  useEffect(() => {
    if (open && contact?.industry) {
      setServices([contact.industry, "", "", ""]);
    }
  }, [open, contact]);

  const resetForm = () => {
    setServices(["", "", "", ""]);
    setDiscountPrice("");
    setBasePrice("299");
    setRequirements("");
    setEmailInput("");
    setEmailSaved(false);
    setEmailEditing(false);
    setTagIds([]);
  };

  const updateService = (index: number, value: string) => {
    setServices(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const addServiceField = () => {
    setServices(prev => [...prev, ""]);
  };

  const handleSubmit = () => {
    const filledServices = services.map(s => s.trim()).filter(Boolean);
    onSubmit({
      services: filledServices,
      price: discountPrice ? Number(discountPrice) : null,
      basePrice: basePrice ? Number(basePrice) : null,
      requirements,
      tagIds,
    });
    resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Create website proposal</DialogTitle>
          {contact && (
            <div className="text-sm text-muted-foreground space-y-0.5">
              <p>{contact.company_name}{contact.town && ` · ${contact.town}`}</p>

              {/* Email — compact inline edit if missing */}
              {(contact.email || emailSaved) ? (
                <p className="text-xs">Email: <span className="text-foreground">{contact.email || emailInput}</span></p>
              ) : emailEditing ? (
                <div className="flex items-center gap-1.5 text-xs">
                  <input
                    type="email"
                    value={emailInput}
                    autoFocus
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="email@company.com"
                    className="h-6 flex-1 bg-transparent border-b border-border/50 focus:border-primary outline-none px-0.5"
                  />
                  {emailValid && (
                    <button
                      onClick={async () => {
                        try {
                          await fetch(`/api/contacts/${contact.id}/call-log`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ outcome: "update_email", notes: emailInput }),
                          }).catch(() => {});
                          await fetch(`/api/contacts/${contact.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ email: emailInput }),
                          }).catch(() => {});
                        } catch {}
                        setEmailSaved(true);
                        setEmailEditing(false);
                        toast.success("Email saved");
                      }}
                      className="text-emerald-500 hover:text-emerald-600 shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setEmailEditing(true)}
                  className="inline-flex items-center gap-1 text-xs text-amber-500 hover:text-amber-600"
                >
                  <span>No email</span>
                  <Pencil className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* ── PRICE — prominent but not overkill ── */}
          <div className="flex items-center justify-between rounded-md border border-amber-400/40 dark:border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/15 px-3 py-2">
            <label className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              Website price *
            </label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={discountPrice}
                onChange={(e) => setDiscountPrice(e.target.value)}
                placeholder="299"
                min={0}
                autoFocus
                className="w-20 h-8 text-lg font-bold text-right bg-transparent border-b border-amber-500/40 focus:border-amber-500 outline-none text-amber-800 dark:text-amber-300 placeholder:text-amber-400/30"
              />
              <span className="text-base font-bold text-amber-700 dark:text-amber-400">$</span>
            </div>
          </div>

          {/* Priority tags — IT triages the build queue by these. Erik
              can also create custom tags inline. Defaults to "Basic" when
              empty so IT always has a tier signal. */}
          <div>
            <label className="text-xs font-medium mb-1 block">Priority / tags</label>
            <p className="text-[11px] text-muted-foreground mb-2">
              Tags set the priority for the IT team. Default is <strong>Basic</strong>.
            </p>
            <TagsField value={tagIds} onChange={setTagIds} defaultSlug="basic" />
          </div>

          {/* Services — what the client's business does */}
          <div>
            <label className="text-xs font-medium mb-1 block">Main services</label>
            <p className="text-[11px] text-muted-foreground mb-2">Enter the services the company provides</p>
            <div className="space-y-1.5">
              {services.map((service, i) => (
                <Input
                  key={i}
                  value={service}
                  onChange={(e) => updateService(i, e.target.value)}
                  placeholder={`Service ${i + 1}`}
                  className="h-8 text-sm"
                />
              ))}
            </div>
            <Button size="sm" variant="ghost" className="h-7 text-[11px] mt-1.5 text-muted-foreground" onClick={addServiceField}>
              <Plus className="h-3 w-3 mr-1" /> Add another
            </Button>
          </div>

          {/* Requirements */}
          <div>
            <label className="text-xs font-medium mb-1 block">Notes for the tech team</label>
            <Textarea
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="What the client needs, special requirements..."
              className="text-sm min-h-15"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { resetForm(); onOpenChange(false); }}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!discountPrice.trim() || !hasEmail}>
            Prepare proposal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Postpone Button (shared by handover items) ──
function PostponeButton({ itemId, onPostpone }: {
  itemId: string;
  onPostpone: (id: string) => void;
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [customDate, setCustomDate] = useState("");

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                <CalendarClock className="h-3.5 w-3.5 text-amber-500" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Postpone</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {POSTPONE_OPTIONS.map(opt => (
            <DropdownMenuItem key={opt.days} onClick={() => {
              onPostpone(itemId);
              toast(`Postponed — ${opt.label.toLowerCase()}`, { duration: 3000 });
            }}>
              <Clock className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
              {opt.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCalendarOpen(true)}>
            <Calendar className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            Pick a date...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Custom date dialog */}
      <Dialog open={calendarOpen} onOpenChange={setCalendarOpen}>
        <DialogContent className="sm:max-w-xs" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="text-sm">Postpone until</DialogTitle>
          </DialogHeader>
          <input
            type="date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            className="w-full text-sm border rounded px-3 py-2 bg-background"
            min={getFutureDate(1)}
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCalendarOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={!customDate} onClick={() => {
              onPostpone(itemId);
              setCalendarOpen(false);
              toast(`Postponed until ${customDate}`, { duration: 3000 });
            }}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Stat Card ──
// ── Handover section helpers ───────────────────────────────────────────
// Pill-style status badge with a leading dot. Single visual language for
// every status across the handover section so colour communicates state
// instead of being decorative.
const STATUS_PILL_TONES = {
  cyan:    { bg: "bg-cyan-500/10",    text: "text-cyan-700 dark:text-cyan-300",       ring: "ring-cyan-500/20",    dot: "bg-cyan-500" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-300", ring: "ring-emerald-500/20", dot: "bg-emerald-500" },
  violet:  { bg: "bg-violet-500/10",  text: "text-violet-700 dark:text-violet-300",   ring: "ring-violet-500/20",  dot: "bg-violet-500" },
  amber:   { bg: "bg-amber-500/10",   text: "text-amber-700 dark:text-amber-300",     ring: "ring-amber-500/20",   dot: "bg-amber-500" },
} as const;

function StatusPill({ tone, children }: { tone: keyof typeof STATUS_PILL_TONES; children: React.ReactNode }) {
  const t = STATUS_PILL_TONES[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${t.bg} ${t.text} ${t.ring}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {children}
    </span>
  );
}

function StatCard({ label, value, sub, highlight, href, icon: Icon }: {
  label: string;
  value: number | string;
  sub?: string;
  highlight?: boolean;
  href?: string;
  icon: LucideIcon;
}) {
  const content = (
    <div
      className={`group relative h-full rounded-xl bg-card px-4 py-3.5
        border transition-colors duration-150
        ${highlight
          ? "border-foreground/30"
          : "border-border hover:border-foreground/20"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="text-[28px] leading-none font-semibold tabular-nums text-foreground">{value}</p>
          {sub && <p className="pt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
        </div>
        <span className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-colors group-hover:bg-muted group-hover:text-foreground">
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
      </div>
    </div>
  );

  if (href) return <Link href={href} className="block">{content}</Link>;
  return content;
}

