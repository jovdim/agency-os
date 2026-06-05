"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, XCircle } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (contact: Record<string, unknown>) => void;
  /** Retained for the sales side label variant. Both variants now render English. */
  slovak?: boolean;
  /** If provided, auto-assigns the contact to this user */
  assignTo?: string;
}

export function AddContactDialog({ open, onOpenChange, onCreated, slovak, assignTo }: AddContactDialogProps) {
  const [saving, setSaving] = useState(false);
  const [links, setLinks] = useState<string[]>([]);
  const [phones, setPhones] = useState<string[]>([""]);

  const labels = slovak
    ? { title: "New contact", company: "Company", name: "Name", phone: "Phone", city: "City", state: "State", industry: "Industry", email: "Email", website: "Website", links: "Links (FB, Instagram, Google Maps...)", addLink: "Add", notes: "Notes", cancel: "Cancel", create: "Create", creating: "Creating..." }
    : { title: "Add Contact", company: "Company", name: "Name", phone: "Phone", city: "City", state: "State", industry: "Industry", email: "Email", website: "Website", links: "Links (FB, Instagram, Google Maps...)", addLink: "Add", notes: "Notes", cancel: "Cancel", create: "Add Contact", creating: "Adding..." };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);

    const formData = new FormData(e.currentTarget);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      toast.error("Not authenticated");
      setSaving(false);
      return;
    }

    const filteredPhones = phones.map(p => p.trim()).filter(Boolean);
    const primaryPhone = filteredPhones[0] || null;

    if (primaryPhone) {
      const { count } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("phone", primaryPhone);
      if ((count ?? 0) > 0) {
        toast.error(slovak ? "A contact with this phone number already exists." : "Contact with this phone already exists.");
        setSaving(false);
        return;
      }
    }

    const contact = {
      company_name: (formData.get("company_name") as string)?.trim() || primaryPhone || (slovak ? "Unknown company" : "Unknown company"),
      contact_person: (formData.get("contact_person") as string)?.trim() || null,
      phone: primaryPhone,
      phones: filteredPhones.length > 0 ? filteredPhones : null,
      email: (formData.get("email") as string)?.trim().toLowerCase() || null,
      website_url: (formData.get("website_url") as string)?.trim() || null,
      industry: (formData.get("industry") as string)?.trim().toLowerCase() || null,
      town: (formData.get("town") as string)?.trim().toLowerCase() || null,
      state: (formData.get("state") as string)?.trim() || null,
      notes: (formData.get("notes") as string)?.trim() || null,
      social_links: links.filter(l => l.trim()).join("\n") || null,
      source: "manual",
      assigned_to: assignTo || user.id,
      assigned_at: new Date().toISOString(),
      status: "new",
    };

    const { data: inserted, error } = await supabase
      .from("contacts")
      .insert(contact)
      .select("*")
      .single();

    if (error) {
      toast.error(error.message);
      setSaving(false);
      return;
    }

    toast.success(slovak ? "Contact created" : "Contact added");
    setSaving(false);
    setLinks([]);
    setPhones([""]);
    onOpenChange(false);
    onCreated?.(inserted);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{labels.title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Phone — the dominant hero element */}
          <div className="py-4">
            {phones.map((phone, i) => (
              <div key={i} className="flex items-center justify-center gap-2 mb-2">
                <Input
                  value={phone}
                  onChange={(e) => {
                    const next = [...phones];
                    next[i] = e.target.value;
                    setPhones(next);
                  }}
                  type="tel"
                  required={i === 0}
                  placeholder={i === 0 ? "555 123 456" : `${slovak ? "Phone" : "Phone"} ${i + 1}`}
                  className="h-14 text-2xl text-center font-semibold tracking-wide max-w-64 mx-auto"
                  autoFocus={i === 0}
                />
                {phones.length > 1 && (
                  <button type="button" onClick={() => setPhones(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-500 shrink-0 absolute right-8">
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setPhones(prev => [...prev, ""])} className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-1 justify-center w-full mt-1">
              <Plus className="w-3 h-3" /> {slovak ? "Add number" : "Add number"}
            </button>
          </div>

          {/* Secondary fields — small, subtle */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Input name="company_name" placeholder={labels.company} className="h-7 text-xs text-muted-foreground placeholder:text-muted-foreground/40" />
            </div>
            <div>
              <Input name="industry" placeholder={labels.industry} className="h-7 text-xs text-muted-foreground placeholder:text-muted-foreground/40" />
            </div>
          </div>

          {/* More info — collapsible */}
          <details className="group">
            <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground select-none">
              {slovak ? "More info ▾" : "More info ▾"}
            </summary>
            <div className="grid gap-2 sm:grid-cols-2 mt-2">
              <div className="space-y-1">
                <label className="text-xs font-medium">{labels.name}</label>
                <Input name="contact_person" placeholder="John Smith" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">{labels.email}</label>
                <Input name="email" type="email" placeholder="email@example.com" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">{labels.city}</label>
                <Input name="town" placeholder="Springfield" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">{labels.state}</label>
                <Input name="state" placeholder="California" className="h-8 text-sm" />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs font-medium">{labels.website}</label>
                <Input name="website_url" placeholder="https://example.com" className="h-8 text-sm" />
              </div>
            <div className="sm:col-span-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">{labels.links}</label>
                <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => setLinks([...links, ""])}>
                  <Plus className="h-3 w-3" /> {labels.addLink}
                </Button>
              </div>
              {links.map((link, i) => (
                <div key={i} className="flex gap-1.5">
                  <Input
                    value={link}
                    onChange={(e) => {
                      const updated = [...links];
                      updated[i] = e.target.value;
                      setLinks(updated);
                    }}
                    placeholder="facebook.com/company, instagram.com/company..."
                    className="h-8 text-sm"
                  />
                  <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => setLinks(links.filter((_, idx) => idx !== i))}>
                    <XCircle className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {links.length === 0 && (
                <p className="text-[10px] text-muted-foreground">Facebook, Instagram, Google Maps, listings…</p>
              )}
            </div>
            <div className="sm:col-span-2 space-y-1">
              <label className="text-xs font-medium">{labels.notes}</label>
              <Input name="notes" placeholder={slovak ? "E.g. saw a banner on the street..." : "Notes..."} className="h-8 text-sm" />
            </div>
          </div>
          </details>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{labels.cancel}</Button>
            <Button type="submit" disabled={saving}>{saving ? labels.creating : labels.create}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
