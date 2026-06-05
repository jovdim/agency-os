"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Pencil,
  Save,
  X,
  Plus,
  Globe,
  Phone,
  Mail,
  MapPin,
  Building2,
  Link2,
  MoreHorizontal,
  Archive,
  Trash2,
  Copy,
  Clock,
  CheckCircle,
  Loader2,
  Send,
  HelpCircle,
} from "lucide-react";
import dynamic from "next/dynamic";
import { ProposalProgress } from "@/components/proposal-progress";
import { ProposalMessages } from "@/components/proposal-messages";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const SendProposalDialog = dynamic(
  () => import("@/components/proposal-timeline/send-proposal-dialog").then((m) => m.SendProposalDialog),
  { ssr: false, loading: () => null },
);
const FollowUpEmailDialog = dynamic(
  () => import("@/components/proposal-timeline/follow-up-email-dialog").then((m) => m.FollowUpEmailDialog),
  { ssr: false, loading: () => null },
);
import { toast } from "sonner";
import type { Contact } from "@/types/database";
import { format, formatDistanceToNow } from "date-fns";

// "revision" is an internal tech state — sales just sees it as "Building"
const PROPOSAL_STATUS_STYLE: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  building:  "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  revision:  "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  review:    "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300",
  sent:      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  viewed:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  accepted:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  paid:      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
};

const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted",
  building:  "Building",
  revision:  "Building",    // internal — sales doesn't need to see "Revision"
  review:    "Website Ready",
  sent:      "Sent to Client",
  viewed:    "Sent to Client",
  accepted:  "Accepted",
  paid:      "Paid",
};

interface Proposal {
  id: string;
  status: string;
  sent_at: string | null;
  created_at: string;
  company_name: string | null;
  services: string[] | null;
  price: number | null;
  discount_price: number | null;
  base_price: number | null;
  requirements: string | null;
  industry: string | null;
  town: string | null;
  client_temp_password: string | null;
}

interface DeploymentInfo {
  id: string;
  subdomain: string;
  url: string;
}

interface ContactDetailClientProps {
  contact: Contact;
  proposals: Proposal[];
  deployments: Record<string, DeploymentInfo>;
  currentUserId: string;
}

export function ContactDetailClient({
  contact,
  proposals,
  deployments,
  currentUserId,
}: ContactDetailClientProps) {
  const router = useRouter();
  const [editing, setEditing]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [contactState, setContactState] = useState<string>(contact.status || "");
  const [deleting, setDeleting] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [createProposalOpen, setCreateProposalOpen] = useState(false);
  const [proposalServices, setProposalServices] = useState<string[]>(["", "", "", ""]);
  const [proposalDiscountPrice, setProposalDiscountPrice] = useState("");
  const [proposalBasePrice, setProposalBasePrice] = useState("299");
  const [proposalRequirements, setProposalRequirements] = useState("");
  const [editProposalOpen, setEditProposalOpen] = useState(false);
  const [editServices, setEditServices] = useState<string[]>(proposals[0]?.services || ["", "", "", ""]);
  const [editPrice, setEditPrice] = useState(proposals[0]?.discount_price?.toString() || proposals[0]?.price?.toString() || "");
  const [editRequirements, setEditRequirements] = useState(proposals[0]?.requirements || "");
  const [savingProposal, setSavingProposal] = useState(false);

  // Send / follow-up dialogs
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);

  // Subdomain editing
  const latestDeployment = proposals[0] ? deployments[proposals[0].id] : null;
  const [editSubdomain, setEditSubdomain] = useState(latestDeployment?.subdomain || "");
  const [changingSubdomain, setChangingSubdomain] = useState(false);
  const [subdomainError, setSubdomainError] = useState("");
  const [subdomainSuccess, setSubdomainSuccess] = useState(false);

  // Form state
  const [companyName, setCompanyName] = useState(contact.company_name || "");
  const [contactPerson, setContactPerson] = useState(contact.contact_person || "");
  const [phone, setPhone]             = useState(contact.phone || "");
  const [email, setEmail]             = useState(contact.email || "");
  const [town, setTown]               = useState(contact.town || "");
  const [industry, setIndustry]       = useState(contact.industry || "");
  const [websiteUrl, setWebsiteUrl]   = useState(contact.website_url || "");
  const [notes, setNotes] = useState(contact.notes || "");
  const [contactLinks, setContactLinks] = useState<string[]>(() => {
    return contact.social_links ? contact.social_links.split("\n").filter(Boolean) : [];
  });



  async function saveContact() {
    setSaving(true);
    const supabase = createClient();
    const allLinks = contactLinks.filter((l) => l.trim());
    const { error } = await supabase
      .from("contacts")
      .update({
        company_name:  companyName,
        contact_person: contactPerson || null,
        phone:         phone || null,
        email:         email || null,
        town:          town || null,
        industry:      industry || null,
        website_url:   websiteUrl || null,
        notes:         notes || null,
        social_links:  allLinks.length > 0 ? allLinks.join("\n") : null,
      })
      .eq("id", contact.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Contact saved");
      setEditing(false);
      router.refresh();
    }
    setSaving(false);
  }


  async function updateContactStatus(status: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("contacts")
      .update({ status })
      .eq("id", contact.id);
    if (error) { toast.error(error.message); return; }
    setContactState(status);
    if (status === "archived") toast.success("Contact archived");
    if (status === "client")   toast.success("Marked as client — ready for production!");
    if (status === "active")   toast.success("Contact restored");
  }

  async function deleteContact() {
    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase.from("contacts").delete().eq("id", contact.id);
    if (error) { toast.error(error.message); setDeleting(false); return; }
    toast.success("Contact deleted");
    router.push("/sales/contacts");
  }

  async function changeSubdomain() {
    if (!latestDeployment || !editSubdomain || editSubdomain.length < 3) {
      setSubdomainError("Subdomain must be at least 3 characters");
      return;
    }
    if (editSubdomain === latestDeployment.subdomain) return;
    setChangingSubdomain(true);
    setSubdomainError("");
    setSubdomainSuccess(false);
    try {
      const checkRes = await fetch(
        `/api/deploy/check-subdomain?subdomain=${encodeURIComponent(editSubdomain)}&exclude_id=${latestDeployment.id}`
      );
      const checkData = await checkRes.json();
      if (!checkData.available) {
        setSubdomainError(checkData.error || "Subdomain already taken");
        return;
      }
      const res = await fetch("/api/deploy/subdomain", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deployment_id: latestDeployment.id, new_subdomain: editSubdomain }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubdomainError(data.error || "Failed to change subdomain");
        return;
      }
      setSubdomainSuccess(true);
      toast.success("Subdomain changed! New URL may take a few minutes to activate.");
      setTimeout(() => setSubdomainSuccess(false), 5000);
      router.refresh();
    } catch {
      setSubdomainError("Network error");
    } finally {
      setChangingSubdomain(false);
    }
  }



  const latestProposal = proposals[0] ?? null;
  const isArchived     = contactState === "archived";

  return (
    <div className="dash-root space-y-6 max-w-5xl">
      {/* ── Header ── back link sits above a clean title block: a violet icon
          chip, the company name, and the contact person as a one-line subtitle.
          No gradient hero — this is a working detail page, so a calm header
          reads best (matches the rest of the redesigned surfaces). */}
      <div className="space-y-3">
        <Link href="/sales/contacts">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
            Contacts
          </Button>
        </Link>
        <div className="flex items-start gap-3">
          <span className="dash-chip mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight truncate">{contact.company_name}</h1>
              {isArchived && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                  <Archive className="h-3 w-3" /> Archived
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {contact.contact_person || "Sales contact"}
            </p>
          </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {!isArchived ? (
              <DropdownMenuItem onClick={() => updateContactStatus("archived")} className="gap-2">
                <Archive className="h-4 w-4 text-muted-foreground" />
                Archive Contact
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => updateContactStatus("active")} className="gap-2">
                <Archive className="h-4 w-4" />
                Restore Contact
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                if (confirm(`Permanently delete "${contact.company_name}"? This cannot be undone.`)) {
                  deleteContact();
                }
              }}
              disabled={deleting}
              className="gap-2 text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "Deleting…" : "Delete Contact"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* ── LEFT: Contact details ── */}
        <div className="lg:col-span-2 space-y-4">
          <div className="dash-card overflow-hidden p-0">
            <div className="dash-subhead dash-hairline flex items-center justify-between gap-2 border-b px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact Details</span>
              {!editing ? (
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setEditing(true)}>
                  <Pencil className="h-3 w-3" /> Edit
                </Button>
              ) : (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditing(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={saveContact} disabled={saving}>
                    <Save className="h-3 w-3" />
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              )}
            </div>

            {!editing ? (
              <div className="divide-y text-sm">
                <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Company"  value={companyName} />
                {contactPerson && <InfoRow icon={null} label="Name" value={contactPerson} />}
                <InfoRow icon={<Phone className="h-3.5 w-3.5" />}     label="Phone"    value={phone} mono />
                <InfoRow icon={<Mail className="h-3.5 w-3.5" />}      label="Email"    value={email} />
                <InfoRow icon={<MapPin className="h-3.5 w-3.5" />}    label="Town"     value={town} />
                <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Industry" value={industry} />
                <InfoRow icon={<Globe className="h-3.5 w-3.5" />}     label="Website"  value={websiteUrl} link />
                {contact.total_listings !== null && contact.total_listings !== undefined && (
                  <InfoRow icon={null} label="Listings" value={String(contact.total_listings)} />
                )}
                {contact.cities_count !== null && contact.cities_count !== undefined && (
                  <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Cities" value={`${contact.cities_count} cities`} />
                )}
                {contact.postal_code && (
                  <InfoRow icon={null} label="Postal" value={contact.postal_code} />
                )}
                {contact.source_url && (
                  <div className="px-4 py-2.5 flex gap-3 text-muted-foreground">
                    <Link2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <a
                      href={contact.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline truncate max-w-48"
                      title={contact.source_url}
                    >
                      Source: {contact.source_url.replace(/^https?:\/\//, "")}
                    </a>
                  </div>
                )}
                {contact.services_offered && (
                  <div className="px-4 py-2.5 space-y-1">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Services</p>
                    <p className="text-xs text-foreground/80 line-clamp-3">
                      {contact.services_offered.split("|").map(s => s.trim()).filter(Boolean).join(" • ")}
                    </p>
                  </div>
                )}
                {contact.description && (
                  <ExpandableDescription text={contact.description} />
                )}
                {contactLinks.length > 0 && (
                  <div className="px-4 py-2.5 flex gap-3 text-muted-foreground">
                    <Link2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <div className="space-y-1 text-xs">
                      {contactLinks.map((l, i) => (
                        <a key={i} href={l} target="_blank" rel="noopener noreferrer" className="block text-primary hover:underline truncate max-w-48">
                          {l.replace(/^https?:\/\//, "")}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {notes && (
                  <div className="px-4 py-2.5">
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{notes}</p>
                  </div>
                )}
                <div className="px-4 py-2.5 text-xs text-muted-foreground">
                  Added {format(new Date(contact.created_at), "d MMM yyyy 'at' HH:mm")}
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Company *</Label>
                  <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="John Smith" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Phone</Label>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" className="h-8 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Town</Label>
                    <Input value={town} onChange={(e) => setTown(e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Industry</Label>
                    <Input value={industry} onChange={(e) => setIndustry(e.target.value)} className="h-8 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Email</Label>
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Website</Label>
                    <Input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://…" className="h-8 text-sm" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Links</Label>
                    <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={() => setContactLinks([...contactLinks, ""])}>
                      <Plus className="h-3 w-3" /> Add
                    </Button>
                  </div>
                  {contactLinks.map((link, i) => (
                    <div key={i} className="flex gap-1">
                      <Input
                        value={link}
                        onChange={(e) => {
                          const updated = [...contactLinks];
                          updated[i] = e.target.value;
                          setContactLinks(updated);
                        }}
                        placeholder="Facebook, Instagram, Google Maps…"
                        className="h-7 text-xs"
                      />
                      <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => setContactLinks(contactLinks.filter((_, idx) => idx !== i))}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Notes</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="text-sm" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Pipeline + Notes ── */}
        <div className="lg:col-span-3 space-y-4">

          {/* Pipeline */}
          <div className="dash-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="dash-chip inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                <Send className="h-3.5 w-3.5" />
              </span>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Proposal Pipeline</p>
            </div>
            <ProposalProgress
              status={latestProposal?.status ?? null}
              hasProposal={!!latestProposal}
            />

            {latestProposal && (
              <div className="mt-4 pt-4 border-t flex items-center justify-between text-xs text-muted-foreground">
                <span className={`rounded px-2 py-0.5 font-medium ${PROPOSAL_STATUS_STYLE[latestProposal.status] ?? "bg-muted"}`}>
                  {PROPOSAL_STATUS_LABEL[latestProposal.status] ?? latestProposal.status}
                </span>
                <span>{formatDistanceToNow(new Date(latestProposal.created_at), { addSuffix: true })}</span>
              </div>
            )}

            {/* Proposal details — services, price, requirements */}
            {latestProposal && (
              <div className="mt-4 dash-hairline rounded-lg border bg-muted/30 px-3 py-2.5 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Proposal</span>
                  <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 gap-1" onClick={() => setEditProposalOpen(true)}>
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                </div>
                {latestProposal.services && latestProposal.services.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">Services: </span>
                    <span>{latestProposal.services.join(", ")}</span>
                  </div>
                )}
                {(latestProposal.discount_price || latestProposal.price) && Number(latestProposal.discount_price || latestProposal.price) > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Price: </span>
                    <span className="font-semibold tabular-nums text-(--dash-accent-2)">${latestProposal.discount_price || latestProposal.price}</span>
                  </div>
                )}
                {latestProposal.requirements && (
                  <div>
                    <span className="text-muted-foreground">Notes: </span>
                    <span>{latestProposal.requirements}</span>
                  </div>
                )}
                {!latestProposal.services?.length && !latestProposal.discount_price && !latestProposal.price && !latestProposal.requirements && (
                  <p className="text-muted-foreground">No details — click Edit</p>
                )}
                {latestProposal.client_temp_password && contact.email && (
                  <div className="flex items-center gap-2 pt-1.5 mt-1.5 border-t border-border/60">
                    <span className="text-muted-foreground">Client:</span>
                    <code className="font-mono text-[11px] bg-background border rounded px-1.5 py-0.5 select-all">
                      {contact.email}
                    </code>
                    <span className="text-muted-foreground">/</span>
                    <code className="font-mono text-[11px] bg-background border rounded px-1.5 py-0.5 select-all">
                      {latestProposal.client_temp_password}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 ml-auto"
                      title="Copy password"
                      onClick={async () => {
                        await navigator.clipboard.writeText(latestProposal.client_temp_password!);
                        toast.success("Password copied");
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            )}

            {latestProposal && (
              <TooltipProvider delayDuration={150}>
              <div className="mt-4 space-y-2">
                {/* ── Handover: Send Proposal ── */}
                <div className="dash-hairline rounded-lg border bg-(--dash-chip-bg) p-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-(--dash-accent)">
                        Send Proposal to Client
                      </p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="text-(--dash-accent) opacity-60 hover:opacity-100 transition-opacity">
                            <HelpCircle className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          Sends the client an email with a link to the proposed website and the price.
                          The welcome email with login details is sent automatically after payment.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {latestProposal.status === "review" && !latestProposal.sent_at ? (
                      <Button
                        size="sm"
                        className="gap-1.5 h-8 flex-1"
                        onClick={() => setSendDialogOpen(true)}
                      >
                        <Send className="h-3.5 w-3.5" />
                        Send Proposal
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 h-8 flex-1 cursor-default border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                        disabled
                      >
                        <span className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] font-bold">
                          ✓
                        </span>
                        Proposal Sent
                      </Button>
                    )}
                  </div>
                </div>

                {/* ── Standalone: Follow-up (for nudging after handover) ── */}
                <div className="dash-hairline rounded-lg border bg-muted/20 p-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Follow-up
                      </p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="text-muted-foreground/60 hover:text-muted-foreground">
                            <HelpCircle className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          A free-form email for when the client doesn't respond — you can write your own message
                          and remind them. This is not a required part of the handover.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Optional nudge after handover
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-8 flex-1"
                      onClick={() => setFollowUpOpen(true)}
                    >
                      <Send className="h-3.5 w-3.5" />
                      Send Follow-up Email
                    </Button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="flex items-center justify-center w-5 h-5 rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors shrink-0"
                          aria-label="Info"
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs text-xs">
                        Opens an editor where you can write your own message to the client
                        (e.g. a payment reminder or questions).
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {deployments[latestProposal.id] && (
                  <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2.5 space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Globe className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <a
                        href={deployments[latestProposal.id].url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-emerald-600 dark:text-emerald-400 hover:underline truncate text-xs"
                      >
                        {deployments[latestProposal.id].url.replace(/^https?:\/\//, "")}
                      </a>
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto shrink-0 h-7 w-7 p-0"
                        onClick={async () => {
                          await navigator.clipboard.writeText(deployments[latestProposal.id].url);
                          toast.success("URL copied");
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    {/* Change subdomain */}
                    <div className="border-t pt-2.5 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Change Subdomain</p>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-0 flex-1">
                          <Input
                            value={editSubdomain}
                            onChange={(e) => {
                              setEditSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                              setSubdomainError("");
                              setSubdomainSuccess(false);
                            }}
                            placeholder="subdomain"
                            className="rounded-r-none font-mono text-xs h-8"
                          />
                          <span className="inline-flex items-center h-8 px-2 border border-l-0 rounded-r-md bg-muted text-xs text-muted-foreground whitespace-nowrap">
                            .pages.dev
                          </span>
                        </div>
                        <Button
                          size="sm"
                          className="shrink-0 gap-1.5 h-8"
                          onClick={changeSubdomain}
                          disabled={changingSubdomain || !editSubdomain || editSubdomain === latestDeployment?.subdomain}
                        >
                          {changingSubdomain ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : subdomainSuccess ? (
                            <CheckCircle className="h-3 w-3" />
                          ) : (
                            <Pencil className="h-3 w-3" />
                          )}
                          {changingSubdomain ? "..." : subdomainSuccess ? "Done" : "Change"}
                        </Button>
                      </div>
                      {subdomainError && (
                        <p className="text-xs text-destructive">{subdomainError}</p>
                      )}
                      {subdomainSuccess && (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400">
                          Subdomain changed. New URL may take a few minutes to activate.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              </TooltipProvider>
            )}

            {!latestProposal && (
              <div className="mt-4 flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed dash-hairline py-8 text-center">
                <span className="dash-chip inline-flex h-10 w-10 items-center justify-center rounded-xl">
                  <Plus className="h-5 w-5" />
                </span>
                <p className="text-xs text-muted-foreground">No proposal yet for this contact.</p>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setCreateProposalOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Prepare proposal
                </Button>
              </div>
            )}
          </div>

          {/* Messages with Tech */}
          {latestProposal && (
            <ProposalMessages
              proposalId={latestProposal.id}
              currentUserId={currentUserId}
              currentUserRole="sales"
            />
          )}


        </div>
      </div>

      {latestProposal && (
        <SendProposalDialog
          open={sendDialogOpen}
          onOpenChange={setSendDialogOpen}
          proposalId={latestProposal.id}
          companyName={contact.company_name}
          contactEmail={contact.email}
        />
      )}

      {latestProposal && (
        <FollowUpEmailDialog
          open={followUpOpen}
          onOpenChange={setFollowUpOpen}
          proposalId={latestProposal.id}
          companyName={contact.company_name}
          contactEmail={contact.email}
        />
      )}

      {/* Edit Proposal Dialog */}
      <Dialog open={editProposalOpen} onOpenChange={setEditProposalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Edit proposal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-medium mb-1 block">Main services</label>
              <div className="space-y-1.5">
                {editServices.map((service, i) => (
                  <Input key={i} value={service} onChange={(e) => {
                    const next = [...editServices];
                    next[i] = e.target.value;
                    setEditServices(next);
                  }} placeholder={`Service ${i + 1}`} className="h-8 text-sm" />
                ))}
              </div>
              <Button size="sm" variant="ghost" className="h-7 text-[11px] mt-1.5 text-muted-foreground" onClick={() => setEditServices(prev => [...prev, ""])}>
                <Plus className="h-3 w-3 mr-1" /> Add another
              </Button>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Price ($)</label>
              <Input type="number" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} placeholder="299" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Notes for the tech team</label>
              <Textarea value={editRequirements} onChange={(e) => setEditRequirements(e.target.value)} placeholder="What the client needs..." className="text-sm min-h-15" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditProposalOpen(false)}>Cancel</Button>
            <Button disabled={savingProposal} onClick={async () => {
              if (!latestProposal) return;
              setSavingProposal(true);
              const filledServices = editServices.map(s => s.trim()).filter(Boolean);
              const supabase = createClient();
              const { error } = await supabase.from("proposals").update({
                services: filledServices,
                price: editPrice ? Number(editPrice) : null,
                discount_price: editPrice ? Number(editPrice) : null,
                requirements: editRequirements || null,
              }).eq("id", latestProposal.id);
              setSavingProposal(false);
              if (error) {
                toast.error(error.message);
              } else {
                toast.success("Proposal updated");
                setEditProposalOpen(false);
                router.refresh();
              }
            }}>
              {savingProposal ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Proposal Dialog */}
      <Dialog open={createProposalOpen} onOpenChange={setCreateProposalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Create website proposal</DialogTitle>
            <p className="text-sm text-muted-foreground">
              {contact.company_name}
              {contact.town && ` · ${contact.town}`}
              {contact.industry && ` · ${contact.industry}`}
            </p>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-medium mb-1 block">Main services</label>
              <p className="text-[11px] text-muted-foreground mb-2">Enter the services the company provides</p>
              <div className="space-y-1.5">
                {proposalServices.map((service, i) => (
                  <Input
                    key={i}
                    value={service}
                    onChange={(e) => {
                      const next = [...proposalServices];
                      next[i] = e.target.value;
                      setProposalServices(next);
                    }}
                    placeholder={`Service ${i + 1}`}
                    className="h-8 text-sm"
                  />
                ))}
              </div>
              <Button size="sm" variant="ghost" className="h-7 text-[11px] mt-1.5 text-muted-foreground" onClick={() => setProposalServices(prev => [...prev, ""])}>
                <Plus className="h-3 w-3 mr-1" /> Add another
              </Button>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Price</label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Discounted price ($)</label>
                  <Input type="number" value={proposalDiscountPrice} onChange={(e) => setProposalDiscountPrice(e.target.value)} placeholder="149" min={0} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Original price ($)</label>
                  <Input type="number" value={proposalBasePrice} onChange={(e) => setProposalBasePrice(e.target.value)} placeholder="299" min={0} className="h-8 text-sm" />
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Notes for the tech team</label>
              <Textarea value={proposalRequirements} onChange={(e) => setProposalRequirements(e.target.value)} placeholder="What the client needs, special requirements..." className="text-sm min-h-15" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateProposalOpen(false)}>Cancel</Button>
            <Button disabled={creatingProposal} onClick={async () => {
              setCreatingProposal(true);
              try {
                const filledServices = proposalServices.map(s => s.trim()).filter(Boolean);
                const res = await fetch("/api/proposals", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    contact_id: contact.id,
                    company_name: contact.company_name,
                    industry: contact.industry || undefined,
                    town: contact.town || undefined,
                    services: filledServices,
                    price: proposalDiscountPrice ? Number(proposalDiscountPrice) : undefined,
                    base_price: proposalBasePrice ? Number(proposalBasePrice) : 299,
                    requirements: proposalRequirements || undefined,
                  }),
                });
                if (!res.ok) {
                  const d = await res.json();
                  toast.error(d.error || "Failed to create proposal");
                } else {
                  toast.success("Proposal created — tech team notified");
                  setCreateProposalOpen(false);
                  setProposalServices(["", "", "", ""]);
                  setProposalDiscountPrice("");
                  setProposalBasePrice("299");
                  setProposalRequirements("");
                  router.refresh();
                }
              } catch {
                toast.error("Error creating proposal");
              } finally {
                setCreatingProposal(false);
              }
            }}>
              {creatingProposal ? "Creating..." : "Prepare proposal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Info row ─────────────────────────────────────────────────────────────────
function ExpandableDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 250 || text.split("\n").length > 4;
  return (
    <div className="px-4 py-2.5 space-y-1">
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

function InfoRow({
  icon, label, value, mono = false, link = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  link?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 text-sm">
      <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
      <span className="text-muted-foreground text-xs w-16 shrink-0 pt-0.5">{label}</span>
      {link ? (
        <a href={value} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate text-xs">
          {value.replace(/^https?:\/\//, "")}
        </a>
      ) : (
        <span className={`text-xs ${mono ? "font-mono" : ""} text-foreground`}>{value}</span>
      )}
    </div>
  );
}
