"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Phone,
  ChevronDown,
  XCircle,
  Send,
  MapPin,
  Mail,
  Skull,
  Check,
  Pencil,
  Clock,
  Calendar,
  Globe,
  ArrowRight,
  ArrowLeft,
  Plus,
  GitCommitVertical,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { PhoneQrPopover } from "@/components/phone-qr-popover";
import { StateHistoryPopover } from "@/app/(dashboard)/sales/state-history-popover";
import type { CallOutcome } from "@/types/database";
import dynamic from "next/dynamic";

const FollowUpEmailDialog = dynamic(
  () => import("@/components/proposal-timeline/follow-up-email-dialog").then(m => m.FollowUpEmailDialog),
  { ssr: false, loading: () => null }
);

// TagsField wraps Radix Popover whose ids are generated at render time —
// rendering it on the server while volanie also has many other Radix
// portals (Dropdown / Tooltip / Dialog) was producing aria-controls
// hydration mismatches plus a downstream NotFoundError on insertBefore.
// SSR-disabled import keeps the rest of the page server-rendered while
// the picker mounts only after hydration completes.
const TagsField = dynamic(
  () => import("@/components/proposal-tags/tags-field").then(m => m.TagsField),
  { ssr: false, loading: () => null }
);

// ── Types ──
interface Contact {
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
  source_url: string | null;
}

interface Stats {
  callsToday: number;
  proposalsToday: number;
  totalContacts: number;
}

interface ProposalData {
  services: string[];
  price: number | null;
  basePrice: number | null;
  requirements: string;
  /** Priority + custom tag ids picked in the dialog. Server seeds "basic"
   *  when this is empty so IT always sees a tier signal. */
  tagIds: string[];
}

interface PendingAction {
  contactId: string;
  outcome: CallOutcome;
  notes?: string;
  callbackAt?: string;
  proposalData?: ProposalData;
}

const POSTPONE_OPTIONS = [
  { label: "In 2 days", days: 2 },
  { label: "In 3 days", days: 3 },
  { label: "In 5 days", days: 5 },
  { label: "In 7 days", days: 7 },
] as const;

function getFutureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d.toISOString().split("T")[0];
}


function VolanieDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 250 || text.split("\n").length > 4;
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Description</p>
      <p
        className={`text-xs text-foreground/80 whitespace-pre-wrap ${
          !expanded && isLong ? "line-clamp-4" : ""
        }`}
      >
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-primary hover:underline"
        >
          {expanded ? "Collapse" : "Show all"}
        </button>
      )}
    </div>
  );
}

export function VolanieClient({ contacts: initialContacts, stats }: { contacts: Contact[]; stats: Stats }) {
  const router = useRouter();
  const [contacts, setContacts] = useState(initialContacts);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [processed, setProcessed] = useState(stats.callsToday);
  const [proposals, setProposals] = useState(stats.proposalsToday);
  const pendingActions = useRef<Map<string, PendingAction>>(new Map());

  // Dialog states
  const [proposalOpen, setProposalOpen] = useState(false);
  const [neverContactOpen, setNeverContactOpen] = useState(false);
  const [neverContactNote, setNeverContactNote] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("<p></p>");
  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [customDate, setCustomDate] = useState("");

  // Proposal dialog state
  const [propServices, setPropServices] = useState<string[]>(["", "", "", ""]);
  const [propPrice, setPropPrice] = useState("");
  const [propRequirements, setPropRequirements] = useState("");
  const [propEmailInput, setPropEmailInput] = useState("");
  const [propEmailSaved, setPropEmailSaved] = useState(false);
  // Tag ids picked in the proposal dialog. TagsField auto-seeds the
  // "basic" tag on first render so IT always has a priority signal.
  const [propTagIds, setPropTagIds] = useState<string[]>([]);
  const [propEmailEditing, setPropEmailEditing] = useState(false);

  // Email edit
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailValue, setEmailValue] = useState("");

  // Edit contact modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editCompany, setEditCompany] = useState("");
  const [editTown, setEditTown] = useState("");
  const [editIndustry, setEditIndustry] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editWebsite, setEditWebsite] = useState("");
  const [editContactPerson, setEditContactPerson] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editPhones, setEditPhones] = useState<string[]>([""]);
  const [editExpanded, setEditExpanded] = useState(false);

  // Sales hints
  const [showHints, setShowHints] = useState(false);

  // Push-to-phone
  const [pushStatus, setPushStatus] = useState<"idle" | "sent" | "failed">("idle");
  const lastPushedId = useRef<string>("");

  const current = contacts[currentIndex] || null;

  // Auto push-to-phone when contact changes
  useEffect(() => {
    if (!current?.phone || lastPushedId.current === current.id) return;
    lastPushedId.current = current.id;
    setPushStatus("idle");
    (async () => {
      try {
        const supabase = (await import("@/lib/supabase/client")).createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setPushStatus("failed"); return; }
        const ch = supabase.channel(`dial-${user.id}`, { config: { broadcast: { ack: true } } });
        let acked = false;
        ch.on("broadcast", { event: "dial-ack" }, () => { acked = true; setPushStatus("sent"); });
        await ch.subscribe();
        await new Promise(r => setTimeout(r, 300));
        await ch.send({ type: "broadcast", event: "dial", payload: { phone: current.phone, companyName: current.company_name || "", timestamp: Date.now() } });
        await new Promise(r => setTimeout(r, 2000));
        if (!acked) setPushStatus("failed");
        supabase.removeChannel(ch);
      } catch { setPushStatus("failed"); }
    })();
  }, [current?.id, current?.phone, current?.company_name]);

  function openEditModal() {
    if (!current) return;
    setEditCompany(current.company_name || "");
    setEditTown(current.town || "");
    setEditIndustry(current.industry || "");
    setEditEmail(current.email || "");
    setEditWebsite(current.website_url || "");
    setEditContactPerson(current.contact_person || "");
    setEditNotes(current.notes || "");
    setEditPhones(current.phones?.length ? [...current.phones] : current.phone ? [current.phone] : [""]);
    setEditExpanded(false);
    setEditModalOpen(true);
  }

  async function saveEditModal() {
    if (!current) return;
    const filteredPhones = editPhones.filter(p => p.trim());
    try {
      await fetch(`/api/contacts/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: editCompany.trim() || null,
          town: editTown.trim() || null,
          industry: editIndustry.trim() || null,
          email: editEmail.trim() || null,
          website_url: editWebsite.trim() || null,
          contact_person: editContactPerson.trim() || null,
          notes: editNotes.trim() || null,
          phone: filteredPhones[0] || null,
          phones: filteredPhones.length > 0 ? filteredPhones : null,
        }),
      });
      setContacts(prev => prev.map(c => c.id === current.id ? {
        ...c,
        company_name: editCompany.trim() || c.company_name,
        town: editTown.trim() || null,
        industry: editIndustry.trim() || null,
        email: editEmail.trim() || null,
        website_url: editWebsite.trim() || null,
        contact_person: editContactPerson.trim() || null,
        notes: editNotes.trim() || null,
        phone: filteredPhones[0] || c.phone,
        phones: filteredPhones.length > 0 ? filteredPhones : c.phones,
      } : c));
      toast.success("Contact updated");
    } catch { toast.error("Error"); }
    setEditModalOpen(false);
  }

  // Flush pending on unmount
  useEffect(() => {
    return () => {
      pendingActions.current.forEach(action => commitAction(action));
      pendingActions.current.clear();
    };
  }, []);

  const commitAction = useCallback(async (action: PendingAction) => {
    const { contactId, outcome, notes, callbackAt, proposalData } = action;
    pendingActions.current.delete(contactId);

    try {
      await fetch(`/api/contacts/${contactId}/call-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, notes, callback_at: callbackAt }),
      });

      if (outcome === "send_proposal" && proposalData) {
        const contact = initialContacts.find(c => c.id === contactId);
        await fetch("/api/proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contact_id: contactId,
            company_name: contact?.company_name || "",
            industry: contact?.industry || undefined,
            town: contact?.town || undefined,
            services: proposalData.services || [],
            price: proposalData.price || undefined,
            base_price: proposalData.basePrice || undefined,
            requirements: proposalData.requirements || undefined,
            // Priority + custom tags picked in the dialog. The server
            // falls back to seeding "basic" when this is empty.
            tag_ids: proposalData.tagIds ?? [],
          }),
        });
      }

    } catch {
      toast.error("Network error");
    }
  }, [initialContacts]);

  function handleAction(outcome: CallOutcome, notes?: string, callbackAt?: string, proposalData?: ProposalData) {
    if (!current) return;

    const action: PendingAction = { contactId: current.id, outcome, notes, callbackAt, proposalData };

    // Remove from queue
    setContacts(prev => prev.filter(c => c.id !== current.id));
    setProcessed(p => p + 1);
    if (outcome === "send_proposal") setProposals(p => p + 1);

    // Undo toast
    const removedContact = current;
    const toastId = toast(outcome === "no_answer" ? "Call tomorrow" : outcome === "not_exists" ? "Doesn't exist" : outcome === "send_proposal" ? "Proposal created" : outcome === "send_invoice" ? "Invoice sent" : outcome === "local_market" ? "Local market" : outcome === "send_email" ? "Email" : outcome === "never_contact" ? "Do not contact" : outcome, {
      description: removedContact.company_name,
      duration: 12000,
      action: {
        label: "Undo",
        onClick: () => {
          pendingActions.current.delete(current.id);
          setContacts(prev => [removedContact, ...prev]);
          setProcessed(p => p - 1);
          if (outcome === "send_proposal") setProposals(p => p - 1);
        },
      },
      onAutoClose: () => { const p = pendingActions.current.get(current.id); if (p) commitAction(p); },
      onDismiss: () => { const p = pendingActions.current.get(current.id); if (p) commitAction(p); },
    });

    pendingActions.current.set(current.id, action);
  }

  function nextContact() {
    if (currentIndex < contacts.length - 1) {
      setCurrentIndex(i => i + 1);
    }
  }

  function previousContact() {
    if (currentIndex > 0) {
      setCurrentIndex(i => i - 1);
    }
  }

  // Keep index in bounds
  useEffect(() => {
    if (currentIndex >= contacts.length && contacts.length > 0) {
      setCurrentIndex(contacts.length - 1);
    }
  }, [contacts.length, currentIndex]);

  if (contacts.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-120px)]">
        <div className="dash-card max-w-sm px-8 py-10 text-center space-y-3">
          <span className="dash-chip mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl">
            <Phone className="h-6 w-6" />
          </span>
          <p className="text-lg font-semibold">No contacts to call</p>
          <p className="text-sm text-muted-foreground">
            All contacts have been processed. Today: <span className="font-semibold text-foreground tabular-nums">{processed}</span> calls.
          </p>
        </div>
      </div>
    );
  }

  const c = current!;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Stats bar — calling queue header */}
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b dash-hairline dash-subhead shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="dash-chip inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
            <Phone className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground leading-none">Calling queue</p>
            <p className="text-sm font-semibold leading-tight mt-0.5">Today&apos;s session</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="dash-panel flex items-center gap-2 rounded-lg px-3 py-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground hidden sm:inline">Calls</span>
            <span className="text-sm font-bold tabular-nums dash-accent">{processed}</span>
          </div>
          <div className="dash-panel flex items-center gap-2 rounded-lg px-3 py-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground hidden sm:inline">Proposals</span>
            <span className="text-sm font-bold tabular-nums text-(--dash-accent-2)">{proposals}</span>
          </div>
          <div className="dash-panel flex items-center gap-2 rounded-lg px-3 py-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground hidden sm:inline">Remaining</span>
            <span className="text-sm font-semibold tabular-nums">{contacts.length}</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto flex justify-center">
        <div className="w-full max-w-2xl px-6 py-6 space-y-4 my-auto">
          {/* Company info + edit + state history */}
          <div className="dash-card p-5 space-y-3">
            <div className="flex items-start gap-3">
              <span className="dash-chip mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <Globe className="h-5 w-5" />
              </span>
              <h1 className="text-2xl font-bold leading-tight min-w-0 flex-1">{c.company_name}</h1>
              <button onClick={openEditModal} className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors" title="Edit contact">
                <Pencil className="w-4 h-4" />
              </button>
              <StateHistoryPopover contactId={c.id} companyName={c.company_name}>
                <button
                  type="button"
                  className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border dash-hairline hover:border-(--dash-accent) hover:text-foreground hover:bg-(--dash-subtle) transition-colors"
                  title="View activity history"
                >
                  <GitCommitVertical className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Activity history</span>
                </button>
              </StateHistoryPopover>
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {c.town && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.town}</span>}
              {c.industry && <Badge variant="secondary" className="text-xs">{c.industry}</Badge>}
              {c.website_url && (
                <a href={c.website_url.startsWith("http") ? c.website_url : `https://${c.website_url}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                  <Globe className="w-3 h-3" />{c.website_url.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              )}
              {c.contact_person && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {c.contact_person}</span>}
            </div>
            {c.notes && <p className="text-sm text-muted-foreground dash-subhead rounded-lg px-3 py-2">{c.notes}</p>}

            {/* Services offered (from CSV lead data) */}
            {c.services_offered && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Services</p>
                <p className="text-xs text-foreground/80 line-clamp-2" title={c.services_offered}>
                  {c.services_offered.split("|").map(s => s.trim()).filter(Boolean).join(" • ")}
                </p>
              </div>
            )}

            {/* Description — expandable */}
            {c.description && (
              <VolanieDescription text={c.description} />
            )}

            {/* Extra metadata row — detailed labels, smart location display */}
            {(c.total_listings !== null || c.cities_count !== null || c.town || c.source_url) && (
              <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground pt-1">
                {c.total_listings !== null && (
                  <span>
                    <span className="text-muted-foreground/70">Listings:</span>{" "}
                    <span className="font-semibold text-foreground/80">
                      {c.total_listings} {c.total_listings === 1 ? "listing" : "listings"}
                    </span>
                  </span>
                )}
                {/* Location: show cities_count if multi-city; otherwise show the actual town */}
                {c.cities_count !== null && c.cities_count > 1 ? (
                  <span>
                    <span className="text-muted-foreground/70">Operates in:</span>{" "}
                    <span className="font-semibold text-foreground/80">
                      {c.cities_count} {c.cities_count === 1 ? "city" : "cities"}
                    </span>
                  </span>
                ) : c.town ? (
                  <span>
                    <span className="text-muted-foreground/70">City:</span>{" "}
                    <span className="font-semibold text-foreground/80">{c.town}</span>
                  </span>
                ) : null}
                {c.source_url && (
                  <a
                    href={c.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline truncate max-w-60"
                    title={c.source_url}
                  >
                    Listing source ↗
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Contact panel — phone + email */}
          <div className="dash-card p-5 space-y-3">

          {/* Push-to-phone status */}
          {pushStatus === "sent" && (
            <div className="text-[11px] text-(--dash-accent-2) flex items-center gap-1">
              <Check className="w-3 h-3" /> Sent to phone
            </div>
          )}
          {pushStatus === "failed" && (
            <div className="text-[11px] text-amber-500 flex items-center gap-1">
              <Phone className="w-3 h-3" /> Phone not connected — use the QR code
            </div>
          )}

          {/* Phone — same as dashboard: QR + multiple numbers popover + notes */}
          <div className="flex items-center gap-3">
            {c.phone ? (
              <>
                <PhoneQrPopover phone={c.phone} companyName={c.company_name}>
                  <span className="text-xl font-mono font-bold flex items-center gap-2 cursor-pointer hover:underline">
                    <Phone className="h-5 w-5" />
                    {c.phone}
                  </span>
                </PhoneQrPopover>
                {c.phone_notes?.[c.phone] && (
                  <span className="text-xs text-muted-foreground">{c.phone_notes[c.phone]}</span>
                )}
                <Popover>
                  <PopoverTrigger asChild>
                    <button className={`rounded px-1.5 py-0.5 ${c.phones && c.phones.length > 1 ? "text-xs font-bold bg-primary/20 text-primary" : "text-xs text-muted-foreground/70 hover:text-muted-foreground"}`}>
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
                              <Phone className="h-3 w-3" /> {p}
                            </span>
                          </PhoneQrPopover>
                          <input
                            id={`volanie-phone-note-${c.id}-${i}`}
                            defaultValue={c.phone_notes?.[p!] || ""}
                            placeholder="e.g. owner, assistant, not working..."
                            className="flex-1 text-[10px] bg-transparent border-b border-border/30 focus:border-primary/50 outline-none px-1 py-0.5 text-muted-foreground placeholder:text-muted-foreground/50"
                          />
                          <button className="shrink-0 text-muted-foreground hover:text-emerald-500 transition-colors" onClick={async () => {
                            const input = document.getElementById(`volanie-phone-note-${c.id}-${i}`) as HTMLInputElement;
                            const note = input?.value.trim() || "";
                            const currentNotes = c.phone_notes || {};
                            const updated = { ...currentNotes, [p!]: note };
                            try {
                              const supabase = (await import("@/lib/supabase/client")).createClient();
                              await supabase.from("contacts").update({ phone_notes: updated }).eq("id", c.id);
                              toast(`${p}: "${note || "—"}"`, { description: "Note saved" });
                            } catch { toast.error("Error"); }
                          }}>
                            <Check className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </>
            ) : (
              <span className="text-lg text-muted-foreground">No number</span>
            )}
          </div>

          {/* Email */}
          <div className="flex items-center gap-2 text-sm">
            <Mail className="h-4 w-4 text-muted-foreground" />
            {!editingEmail ? (
              <button className="text-primary hover:underline flex items-center gap-1" onClick={() => { setEmailValue(c.email || ""); setEditingEmail(true); }}>
                <Pencil className="h-3 w-3" />
                {c.email || <span className="text-amber-500">No email — click to add</span>}
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <Input
                  value={emailValue}
                  onChange={(e) => setEmailValue(e.target.value)}
                  placeholder="email@example.com"
                  type="email"
                  className={`h-7 text-sm w-56 ${emailValue && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(emailValue) ? "border-red-400 text-red-400" : ""}`}
                  autoFocus
                />
                <Button
                  size="sm"
                  className="h-7 px-2"
                  disabled={!emailValue.trim() || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(emailValue.trim())}
                  onClick={async () => {
                    const supabase = (await import("@/lib/supabase/client")).createClient();
                    await supabase.from("contacts").update({ email: emailValue.trim() }).eq("id", c.id);
                    c.email = emailValue.trim();
                    setEditingEmail(false);
                    toast.success("Email saved");
                  }}
                ><Check className="h-3 w-3" /></Button>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditingEmail(false)}>
                  <XCircle className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>

          </div>

          {/* Sales hints */}
          <div className="pt-1">
            <button onClick={() => setShowHints(!showHints)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <span>💡</span>
              <span className="font-medium">Calling helpers</span>
              {showHints ? <ChevronDown className="w-3 h-3 rotate-180" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showHints && (
              <div className="mt-2 space-y-2 text-[11px] text-muted-foreground">
                <div className="dash-panel rounded-lg p-3 space-y-1.5">
                  <p className="font-semibold text-foreground text-xs uppercase tracking-wider">Opening script</p>
                  <p>&quot;Hello, I'm calling from [Your Agency]. We noticed your business and would love to help you with a website. Do you have a minute?&quot;</p>
                </div>
                <div className="dash-panel rounded-lg p-3 space-y-1.5">
                  <p className="font-semibold text-foreground text-xs uppercase tracking-wider">Common objections</p>
                  <p><span className="dash-accent">→</span> &quot;I already have a website&quot; — &quot;Great! When did you last take a look at it?&quot;</p>
                  <p><span className="dash-accent">→</span> &quot;I'm not interested&quot; — &quot;I understand. Can I quickly show you what we do?&quot;</p>
                  <p><span className="dash-accent">→</span> &quot;It's expensive&quot; — &quot;Our prices start from $149.&quot;</p>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ── FIXED BOTTOM — Actions ── */}
      <div className="shrink-0 border-t dash-hairline bg-card px-6 py-4">
        <div className="max-w-2xl mx-auto space-y-4">

          {/* ── PRIMARY ACTIONS — big, dominant ── */}
          <div className="grid grid-cols-3 gap-3">
            <Button className="h-14 gap-2 text-sm font-medium flex-col" onClick={() => {
              setPropServices(c.industry ? [c.industry, "", "", ""] : ["", "", "", ""]);
              setPropPrice("");
              setPropRequirements("");
              setProposalOpen(true);
            }}>
              <Send className="h-5 w-5" /> Proposal
            </Button>
            <Button variant="outline" className="h-14 gap-2 text-sm font-medium flex-col" onClick={() => handleAction("local_market" as CallOutcome)}>
              <MapPin className="h-5 w-5" /> LM
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-14 gap-2 text-sm font-medium flex-col w-full">
                  <Mail className="h-5 w-5" /> Email
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => {
                  if (!c.email) { toast.error("Contact has no email"); return; }
                  setEmailSubject("More information about our services");
                  setEmailBody("<p>Hello,</p><p>thank you for our conversation. I'm sending you more information about our services.</p><p>Best regards</p>");
                  setEmailOpen(true);
                }}>More information</DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  if (!c.email) { toast.error("Contact has no email"); return; }
                  setEmailSubject("Price quote");
                  setEmailBody("<p>Hello,</p><p>based on our conversation, I'm sending you a price quote.</p><p>Best regards</p>");
                  setEmailOpen(true);
                }}>Price quote</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => {
                  if (!c.email) { toast.error("Contact has no email"); return; }
                  setEmailSubject("");
                  setEmailBody("<p></p>");
                  setEmailOpen(true);
                }}>Write your own</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* ── NAVIGATION — Back + Next ── */}
          <div className="flex justify-between items-center gap-2">
            <Button
              variant="outline"
              onClick={previousContact}
              disabled={currentIndex === 0}
              className="gap-2 h-9"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {currentIndex + 1} / {contacts.length}
            </span>
            <Button
              onClick={nextContact}
              disabled={currentIndex >= contacts.length - 1}
              className="gap-2 h-9"
            >
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          </div>

          {/* ── SECONDARY ACTIONS — small, separated ── */}
          <div className="flex items-center justify-between pt-2 border-t dash-hairline">
            {/* Left — Do not contact */}
            <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1 text-red-400" onClick={() => setNeverContactOpen(true)}>
              <Skull className="h-3 w-3" /> Do not contact
            </Button>

            {/* Right — Doesn't exist + Tomorrow */}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1 text-muted-foreground" onClick={() => handleAction("not_exists" as CallOutcome)}>
                <XCircle className="h-3 w-3" /> Doesn't exist
              </Button>
              <div className="flex items-center">
                <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1 text-muted-foreground rounded-r-none" onClick={() => handleAction("no_answer" as CallOutcome)}>
                  <Phone className="h-3 w-3" /> Tomorrow
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-7 px-1 rounded-l-none text-muted-foreground">
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {POSTPONE_OPTIONS.map(opt => (
                      <DropdownMenuItem key={opt.days} onClick={() => handleAction("no_answer" as CallOutcome, undefined, getFutureDate(opt.days))}>
                        <Clock className="h-3.5 w-3.5 mr-2 text-muted-foreground" /> {opt.label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setDateDialogOpen(true)}>
                      <Calendar className="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Pick a date...
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════ EDIT CONTACT MODAL ══════════ */}
      <Dialog open={editModalOpen} onOpenChange={(v) => { setEditModalOpen(v); if (!v) setEditExpanded(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Edit contact</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Company</label>
              <Input value={editCompany} onChange={(e) => setEditCompany(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">City</label>
                <Input value={editTown} onChange={(e) => setEditTown(e.target.value)} placeholder="—" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">Industry</label>
                <Input value={editIndustry} onChange={(e) => setEditIndustry(e.target.value)} placeholder="—" className="h-8 text-sm" />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Email</label>
              <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="email@company.com" className="h-8 text-sm" />
            </div>

            <button onClick={() => setEditExpanded(!editExpanded)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full">
              {editExpanded ? <ChevronDown className="w-3 h-3 rotate-180" /> : <ChevronDown className="w-3 h-3" />}
              More information
            </button>

            {editExpanded && (
              <div className="space-y-3 pt-1 border-t border-border/50">
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Phone numbers</label>
                  <div className="space-y-1.5">
                    {editPhones.map((phone, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <Input value={phone} onChange={(e) => { const next = [...editPhones]; next[i] = e.target.value; setEditPhones(next); }} placeholder={`Phone ${i + 1}`} className="h-8 text-sm" />
                        {editPhones.length > 1 && (
                          <button onClick={() => setEditPhones(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-500 shrink-0"><XCircle className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    ))}
                    <button onClick={() => setEditPhones(prev => [...prev, ""])} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                      <Plus className="w-3 h-3" /> Add number
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Contact person</label>
                  <Input value={editContactPerson} onChange={(e) => setEditContactPerson(e.target.value)} placeholder="Name, position..." className="h-8 text-sm" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Website</label>
                  <Input value={editWebsite} onChange={(e) => setEditWebsite(e.target.value)} placeholder="www.company.com" className="h-8 text-sm" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Notes</label>
                  <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Internal notes..." className="text-sm min-h-14" />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => { setEditModalOpen(false); setEditExpanded(false); }}>Cancel</Button>
            <Button size="sm" onClick={saveEditModal}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════ DIALOGS ══════════ */}

      {/* Proposal */}
      <Dialog open={proposalOpen} onOpenChange={(v) => { if (!v) { setPropEmailInput(""); setPropEmailSaved(false); setPropEmailEditing(false); setPropTagIds([]); } setProposalOpen(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Create website proposal</DialogTitle>
            <div className="text-sm text-muted-foreground space-y-0.5">
              <p>{c.company_name}{c.town && ` · ${c.town}`}</p>
              {(c.email || propEmailSaved) ? (
                <p className="text-xs">Email: <span className="text-foreground">{c.email || propEmailInput}</span></p>
              ) : propEmailEditing ? (
                <div className="flex items-center gap-1.5 text-xs">
                  <input
                    type="email"
                    value={propEmailInput}
                    autoFocus
                    onChange={(e) => setPropEmailInput(e.target.value)}
                    placeholder="email@company.com"
                    className="h-6 flex-1 bg-transparent border-b border-border/50 focus:border-primary outline-none px-0.5"
                  />
                  {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(propEmailInput.trim()) && (
                    <button
                      onClick={async () => {
                        try {
                          const supabase = (await import("@/lib/supabase/client")).createClient();
                          await supabase.from("contacts").update({ email: propEmailInput.trim() }).eq("id", c.id);
                          setPropEmailSaved(true);
                          setPropEmailEditing(false);
                          toast.success("Email saved");
                        } catch { toast.error("Error while saving"); }
                      }}
                      className="text-emerald-500 hover:text-emerald-600 shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setPropEmailEditing(true)}
                  className="inline-flex items-center gap-1 text-xs text-amber-500 hover:text-amber-600"
                >
                  <span>No email</span>
                  <Pencil className="w-3 h-3" />
                </button>
              )}
            </div>
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
                  value={propPrice}
                  onChange={(e) => setPropPrice(e.target.value)}
                  placeholder="299"
                  min={0}
                  autoFocus
                  className="w-20 h-8 text-lg font-bold text-right bg-transparent border-b border-amber-500/40 focus:border-amber-500 outline-none text-amber-800 dark:text-amber-300 placeholder:text-amber-400/30"
                />
                <span className="text-base font-bold text-amber-700 dark:text-amber-400">$</span>
              </div>
            </div>

            {/* Priority tags — IT triages the build queue by these. Erik
                can also create custom tags inline. Defaults to "Basic"
                when empty so IT always has a tier signal. */}
            <div>
              <label className="text-xs font-medium mb-1 block">Priority / tags</label>
              <p className="text-[11px] text-muted-foreground mb-2">
                Tags set the priority for the IT team. Default is <strong>Basic</strong>.
              </p>
              <TagsField value={propTagIds} onChange={setPropTagIds} defaultSlug="basic" />
            </div>

            <div>
              <label className="text-xs font-medium mb-1 block">Main services</label>
              <div className="space-y-1.5">
                {propServices.map((service, i) => (
                  <Input key={i} value={service} onChange={(e) => {
                    const next = [...propServices]; next[i] = e.target.value; setPropServices(next);
                  }} placeholder={`Service ${i + 1}`} className="h-8 text-sm" />
                ))}
              </div>
              <Button size="sm" variant="ghost" className="h-7 text-[11px] mt-1.5 text-muted-foreground" onClick={() => setPropServices(prev => [...prev, ""])}>
                <Plus className="h-3 w-3 mr-1" /> Add another
              </Button>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Notes for the tech team</label>
              <Textarea value={propRequirements} onChange={(e) => setPropRequirements(e.target.value)} placeholder="What the client needs..." className="text-sm min-h-15" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setProposalOpen(false)}>Cancel</Button>
            <Button disabled={!propPrice.trim()} onClick={() => {
              const filledServices = propServices.map(s => s.trim()).filter(Boolean);
              setProposalOpen(false);
              handleAction("send_proposal" as CallOutcome, undefined, undefined, {
                services: filledServices,
                price: propPrice ? Number(propPrice) : null,
                basePrice: 299,
                requirements: propRequirements,
                tagIds: propTagIds,
              });
            }}>Prepare proposal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Never contact */}
      <Dialog open={neverContactOpen} onOpenChange={setNeverContactOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Do not contact</DialogTitle>
            <p className="text-xs text-muted-foreground">{c.company_name}</p>
          </DialogHeader>
          <Textarea value={neverContactNote} onChange={(e) => setNeverContactNote(e.target.value)} placeholder="Reason (e.g. doesn't want to be contacted, made threats...)" className="text-sm min-h-16" />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setNeverContactOpen(false)}>Cancel</Button>
            <Button size="sm" variant="destructive" onClick={() => {
              setNeverContactOpen(false);
              handleAction("never_contact" as CallOutcome, neverContactNote);
              setNeverContactNote("");
            }}>Do not contact</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom date */}
      <Dialog open={dateDialogOpen} onOpenChange={setDateDialogOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Call back later</DialogTitle>
          </DialogHeader>
          <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} className="w-full text-sm border rounded px-3 py-2 bg-background" min={getFutureDate(1)} />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDateDialogOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={!customDate} onClick={() => {
              setDateDialogOpen(false);
              handleAction("no_answer" as CallOutcome, undefined, customDate);
            }}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email dialog */}
      {c && (
        <FollowUpEmailDialog
          open={emailOpen}
          onOpenChange={setEmailOpen}
          contactId={c.id}
          companyName={c.company_name}
          contactEmail={c.email}
          initialSubject={emailSubject}
          initialBody={emailBody}
        />
      )}
    </div>
  );
}
