"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  X,
  Phone,
  XCircle,
  ChevronDown,
  ChevronUp,
  Calendar,
  Clock,
  Skull,
  Send,
  Globe,
  MapPin,
  Building2,
  User,
  StickyNote,
  Lightbulb,
  Save,
  Check,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import type { CallOutcome } from "@/types/database";

export interface CallingPanelContact {
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
}

interface CallingPanelProps {
  contact: CallingPanelContact;
  noAnswerCount?: number;
  onOutcome: (id: string, outcome: CallOutcome, notes?: string, callbackAt?: string) => void;
  onCreateProposal: (contact: CallingPanelContact, price?: string) => void;
  onClose: () => void;
}

const POSTPONE_OPTIONS = [
  { days: 1, label: "Tomorrow" },
  { days: 2, label: "In 2 days" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "In a week" },
  { days: 14, label: "In 2 weeks" },
];

function getFutureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

export function CallingPanel({
  contact: c,
  noAnswerCount,
  onOutcome,
  onCreateProposal,
  onClose,
}: CallingPanelProps) {
  // Editable fields
  const [company, setCompany] = useState(c.company_name || "");
  const [town, setTown] = useState(c.town || "");
  const [website, setWebsite] = useState(c.website_url || "");
  const [contactPerson, setContactPerson] = useState(c.contact_person || "");
  const [notes, setNotes] = useState(c.notes || "");
  const [email, setEmail] = useState(c.email || "");
  const [saving, setSaving] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [dirty, setDirty] = useState(false);

  // Auto push-to-phone when panel opens
  const didPush = useRef(false);
  const [pushStatus, setPushStatus] = useState<"sending" | "sent" | "failed" | null>("sending");
  useEffect(() => {
    if (didPush.current || !c.phone) return;
    didPush.current = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setPushStatus("failed"); return; }

        const channel = supabase.channel(`dial-${user.id}`, {
          config: { broadcast: { ack: true } },
        });

        // Listen for acknowledgement from phone
        let phoneAcked = false;
        channel.on("broadcast", { event: "dial-ack" }, () => {
          phoneAcked = true;
          setPushStatus("sent");
        });

        await channel.subscribe();
        await new Promise(r => setTimeout(r, 300));

        const result = await channel.send({
          type: "broadcast",
          event: "dial",
          payload: { phone: c.phone, companyName: c.company_name || "", timestamp: Date.now() },
        });

        // Wait 2s for phone to acknowledge
        if (result === "ok") {
          await new Promise(r => setTimeout(r, 2000));
          if (!phoneAcked) {
            setPushStatus("failed");
          }
        } else {
          setPushStatus("failed");
        }

        supabase.removeChannel(channel);
      } catch {
        setPushStatus("failed");
      }
    })();
  }, [c.phone, c.company_name]);

  // Track if any field changed
  useEffect(() => {
    const changed =
      company !== (c.company_name || "") ||
      town !== (c.town || "") ||
      website !== (c.website_url || "") ||
      contactPerson !== (c.contact_person || "") ||
      notes !== (c.notes || "") ||
      email !== (c.email || "");
    setDirty(changed);
  }, [company, town, website, contactPerson, notes, email, c]);

  // Save contact changes
  const saveChanges = async () => {
    setSaving(true);
    try {
      await fetch(`/api/contacts/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: company.trim() || null,
          town: town.trim() || null,
          website_url: website.trim() || null,
          contact_person: contactPerson.trim() || null,
          notes: notes.trim() || null,
          email: email.trim() || null,
        }),
      });
      setDirty(false);
      toast.success("Saved");
    } catch {
      toast.error("Error while saving");
    }
    setSaving(false);
  };

  // Auto-save before outcome action
  const handleOutcome = async (outcome: CallOutcome, callbackNotes?: string, callbackAt?: string) => {
    if (dirty) await saveChanges();
    onOutcome(c.id, outcome, callbackNotes, callbackAt);
    onClose();
  };

  const allPhones = c.phones && c.phones.length > 0 ? c.phones : c.phone ? [c.phone] : [];

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-card border-l border-border shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold truncate">{company || "New contact"}</h3>
          {c.industry && (
            <span className="text-[11px] text-muted-foreground">{c.industry}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {noAnswerCount && noAnswerCount > 0 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800">
              {noAnswerCount}× postponed
            </Badge>
          )}
          <button onClick={onClose} className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Phone numbers + push status */}
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <div className="space-y-1.5">
          {allPhones.map((phone, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-sm font-mono font-medium">{phone}</span>
              <button
                onClick={async () => {
                  try {
                    const supabase = createClient();
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return;
                    const ch = supabase.channel(`dial-${user.id}`, { config: { broadcast: { ack: true } } });
                    await ch.subscribe();
                    await new Promise(r => setTimeout(r, 300));
                    await ch.send({ type: "broadcast", event: "dial", payload: { phone, companyName: company || "", timestamp: Date.now() } });
                    supabase.removeChannel(ch);
                    setPushStatus("sent");
                    toast.success("Sent to phone");
                  } catch {
                    setPushStatus("failed");
                  }
                }}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <Phone className="w-3 h-3" /> Call
              </button>
            </div>
          ))}
          {allPhones.length === 0 && (
            <span className="text-sm text-muted-foreground">No number</span>
          )}
        </div>
        {/* Push-to-phone status */}
        {pushStatus === "sending" && (
          <div className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" /> Sending to phone...
          </div>
        )}
        {pushStatus === "sent" && (
          <div className="mt-2 text-[10px] text-emerald-500 flex items-center gap-1">
            <Check className="w-3 h-3" /> Sent to phone
          </div>
        )}
        {pushStatus === "failed" && (
          <div className="mt-2 text-[10px] text-amber-500 flex items-center gap-1">
            <Phone className="w-3 h-3" /> Phone not connected — use the &quot;Call&quot; button
          </div>
        )}
      </div>

      {/* Editable fields */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Row: Company + City */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground flex items-center gap-1 mb-1">
              <Building2 className="w-3 h-3" /> Company
            </label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name" className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground flex items-center gap-1 mb-1">
              <MapPin className="w-3 h-3" /> City
            </label>
            <Input value={town} onChange={(e) => setTown(e.target.value)} placeholder="City" className="h-8 text-sm" />
          </div>
        </div>

        {/* Row: Website + Email */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground flex items-center gap-1 mb-1">
              <Globe className="w-3 h-3" /> Web
            </label>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="www.company.com" className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground flex items-center gap-1 mb-1">
              <Send className="w-3 h-3" /> Email
            </label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@company.com" className="h-8 text-sm" />
          </div>
        </div>

        {/* Contact person */}
        <div>
          <label className="text-[10px] text-muted-foreground flex items-center gap-1 mb-1">
            <User className="w-3 h-3" /> Contact person
          </label>
          <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="Name, position..." className="h-8 text-sm" />
        </div>

        {/* Notes — full width textarea */}
        <div>
          <label className="text-[10px] text-muted-foreground flex items-center gap-1 mb-1">
            <StickyNote className="w-3 h-3" /> Notes
          </label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything important from the call..."
            className="text-sm min-h-20 resize-none"
          />
        </div>

        {/* Save button — only when dirty */}
        {dirty && (
          <Button size="sm" variant="outline" className="w-full gap-1.5 h-8" onClick={saveChanges} disabled={saving}>
            <Save className="w-3 h-3" /> {saving ? "Saving..." : "Save changes"}
          </Button>
        )}

        {/* ── Sales Hints (collapsible) ── */}
        <div className="border-t border-border pt-3">
          <button
            onClick={() => setShowHints(!showHints)}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            <Lightbulb className="w-3 h-3" />
            <span className="font-medium">Calling helpers</span>
            {showHints ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
          </button>

          {showHints && (
            <div className="mt-2 space-y-2 text-[11px] text-muted-foreground">
              <div className="rounded-md bg-muted/50 p-2.5 space-y-1.5">
                <p className="font-medium text-foreground text-xs">Opening script</p>
                <p>&quot;Hello, I'm calling from [Your Agency]. We noticed your business and would love to help you with a website. Do you have a minute?&quot;</p>
              </div>
              <div className="rounded-md bg-muted/50 p-2.5 space-y-1.5">
                <p className="font-medium text-foreground text-xs">Common objections</p>
                <div className="space-y-1">
                  <p><span className="text-amber-500">→</span> &quot;I already have a website&quot; — &quot;Great! When did you last take a look at it? Most sites need a refresh after 2-3 years.&quot;</p>
                  <p><span className="text-amber-500">→</span> &quot;I'm not interested&quot; — &quot;I understand. Can I quickly show you what we do? It won't take more than 2 minutes.&quot;</p>
                  <p><span className="text-amber-500">→</span> &quot;It's expensive&quot; — &quot;Our prices start from $149. And the website pays for itself through new customers.&quot;</p>
                </div>
              </div>
              <div className="rounded-md bg-muted/50 p-2.5 space-y-1.5">
                <p className="font-medium text-foreground text-xs">Tips</p>
                <ul className="space-y-0.5 list-disc list-inside">
                  <li>Ask about their business, don't just sell</li>
                  <li>Write down the contact person's name right away</li>
                  <li>If they're not the decision-maker, ask for the owner's number</li>
                  <li>Always agree on the next step</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Action Buttons (sticky bottom) ── */}
      <div className="border-t border-border px-4 py-3 space-y-2 shrink-0 bg-card">
        <div className="text-[10px] text-muted-foreground mb-1">Call outcome</div>
        <div className="flex flex-wrap gap-1.5">
          {/* Doesn't exist */}
          <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 gap-1" onClick={() => handleOutcome("not_exists" as CallOutcome)}>
            <XCircle className="w-3 h-3" /> Doesn't exist
          </Button>

          {/* Tomorrow (no answer) */}
          <div className="flex items-center">
            <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 gap-1 rounded-r-none border-r-0" onClick={() => handleOutcome("no_answer" as CallOutcome)}>
              <Phone className="w-3 h-3" /> Tomorrow
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 w-6 p-0 rounded-l-none">
                  <ChevronDown className="w-2.5 h-2.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {POSTPONE_OPTIONS.map((opt) => (
                  <DropdownMenuItem key={opt.days} onClick={() => handleOutcome("no_answer" as CallOutcome, undefined, getFutureDate(opt.days))}>
                    <Clock className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                    {opt.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setDateDialogOpen(true)}>
                  <Calendar className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                  Pick a date...
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Proposal */}
          <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 gap-1" onClick={() => {
            if (dirty) saveChanges();
            onCreateProposal({ ...c, company_name: company, town, website_url: website, contact_person: contactPerson, email, notes });
            onClose();
          }}>
            <Send className="w-3 h-3" /> Proposal
          </Button>

          {/* Do not contact */}
          <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 gap-1 text-red-400 hover:text-red-500" onClick={() => handleOutcome("never_contact" as CallOutcome, notes || undefined)}>
            <Skull className="w-3 h-3" /> Do not contact
          </Button>
        </div>
      </div>

      {/* Custom date dialog */}
      {dateDialogOpen && (
        <div className="absolute inset-0 bg-black/50 z-10 flex items-center justify-center cursor-pointer" onClick={() => setDateDialogOpen(false)}>
          <div className="bg-card rounded-lg border p-4 space-y-3 w-64" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium">Call back later</p>
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="w-full text-sm border rounded px-3 py-2 bg-background"
              min={getFutureDate(1)}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDateDialogOpen(false)}>Cancel</Button>
              <Button size="sm" disabled={!customDate} onClick={() => {
                setDateDialogOpen(false);
                handleOutcome("no_answer" as CallOutcome, undefined, customDate);
              }}>Confirm</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
