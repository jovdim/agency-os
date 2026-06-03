"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, Save, Plus, X } from "lucide-react";
import Link from "next/link";

export function NewContactForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [links, setLinks] = useState<string[]>([]);

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

    const firstName = (formData.get("first_name") as string) || "";
    const lastName  = (formData.get("last_name") as string) || "";
    const contactPerson = [firstName, lastName].filter(Boolean).join(" ") || null;
    const allLinks = links.filter((l) => l.trim());
    const quotedPriceRaw = formData.get("quoted_price") as string;

    const phone = (formData.get("phone") as string)?.trim() || null;
    const email = (formData.get("email") as string)?.trim().toLowerCase() || null;
    const businessEmail = (formData.get("business_email") as string)?.trim().toLowerCase() || null;
    const industry = (formData.get("industry") as string)?.trim().toLowerCase() || null;
    const town = (formData.get("town") as string)?.trim().toLowerCase() || null;

    // Check uniqueness of phone and email
    if (phone) {
      const { count } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("phone", phone);
      if ((count ?? 0) > 0) {
        toast.error("A contact with this phone number already exists.");
        setSaving(false);
        return;
      }
    }
    if (email) {
      const { count } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("email", email);
      if ((count ?? 0) > 0) {
        toast.error("A contact with this email already exists.");
        setSaving(false);
        return;
      }
    }

    const contact = {
      company_name:  formData.get("company_name") as string,
      contact_person: contactPerson,
      phone,
      email,
      business_email: businessEmail,
      website_url:   (formData.get("website_url") as string)?.trim() || null,
      industry,
      town,
      location:      null,
      social_links:  allLinks.length > 0 ? allLinks.join("\n") : null,
      notes:         (formData.get("notes") as string) || null,
      quoted_price:  quotedPriceRaw ? parseFloat(quotedPriceRaw) : null,
      source:        "manual",
      assigned_to:   user.id,
      assigned_at:   new Date().toISOString(),
      status:        "new",
    };

    const { data: inserted, error } = await supabase
      .from("contacts")
      .insert(contact)
      .select("id")
      .single();

    if (error) {
      toast.error(error.message);
      setSaving(false);
      return;
    }

    toast.success("Contact created.");
    router.push(`/sales/contacts/${inserted.id}`);
    router.refresh();
  }

  return (
    <div className="max-w-2xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/sales/active">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2">
            <ArrowLeft className="h-4 w-4" />
            Active
          </Button>
        </Link>
        <div className="h-4 w-px bg-border" />
        <h1 className="text-lg font-semibold">New Contact</h1>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="rounded-lg border bg-card divide-y">

          {/* Section: Company */}
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Company</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2 space-y-1">
                <Label htmlFor="company_name" className="text-xs">Company Name *</Label>
                <Input id="company_name" name="company_name" required placeholder="HM Elektro" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="quoted_price" className="text-xs">Web Price (€)</Label>
                <Input id="quoted_price" name="quoted_price" type="number" min="0" step="1" placeholder="149" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="industry" className="text-xs">Industry</Label>
                <Input id="industry" name="industry" placeholder="electrical installations" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="town" className="text-xs">Location</Label>
                <Input id="town" name="town" placeholder="Bratislava" className="h-8 text-sm" />
              </div>
            </div>
          </div>

          {/* Section: Contact Person */}
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Contact Person</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="first_name" className="text-xs">First Name</Label>
                <Input id="first_name" name="first_name" placeholder="Peter" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="last_name" className="text-xs">Last Name</Label>
                <Input id="last_name" name="last_name" placeholder="Smith" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="phone" className="text-xs">Phone</Label>
                <Input id="phone" name="phone" type="tel" placeholder="0905 692 611" className="h-8 text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email" className="text-xs">Email</Label>
                <Input id="email" name="email" type="email" placeholder="email@example.com" className="h-8 text-sm" />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label htmlFor="business_email" className="text-xs">Business Email (for contact form)</Label>
                <Input id="business_email" name="business_email" type="email" placeholder="info@company.com" className="h-8 text-sm" />
              </div>
            </div>
          </div>

          {/* Section: Online */}
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Online Presence</p>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="website_url" className="text-xs">Current Website</Label>
                <Input id="website_url" name="website_url" placeholder="https://www.example.com" className="h-8 text-sm" />
              </div>
              {/* Links */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Social / Directory Links</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 text-xs"
                    onClick={() => setLinks([...links, ""])}
                  >
                    <Plus className="h-3 w-3" /> Add
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
                      placeholder="Instagram, Facebook, Google Maps, directory listing…"
                      className="h-8 text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 shrink-0"
                      onClick={() => setLinks(links.filter((_, idx) => idx !== i))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                {links.length === 0 && (
                  <p className="text-xs text-muted-foreground">Facebook, Instagram, Google Maps, directory listing…</p>
                )}
              </div>
            </div>
          </div>

          {/* Section: Notes */}
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Notes for Tech Team</p>
            <Textarea
              name="notes"
              placeholder="What they need, special requirements, anything the tech team should know…"
              rows={3}
              className="text-sm resize-none"
            />
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end mt-4">
          <Button type="submit" disabled={saving} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? "Creating…" : "Create Contact"}
          </Button>
        </div>
      </form>
    </div>
  );
}
