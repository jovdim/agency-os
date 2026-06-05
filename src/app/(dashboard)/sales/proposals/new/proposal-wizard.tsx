"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, PaperPlaneTilt as Send, MagnifyingGlass as Search } from "@phosphor-icons/react/ssr";

interface Contact {
  id: string;
  company_name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  industry: string | null;
  town: string | null;
  quoted_price: number | null;
}

export function ProposalWizard({
  contacts,
  preSelectedContactId,
}: {
  contacts: Contact[];
  preSelectedContactId?: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  // Pre-select contact if provided via URL param
  const preContact = preSelectedContactId
    ? contacts.find((c) => c.id === preSelectedContactId)
    : null;

  // Form fields
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    preSelectedContactId || null,
  );
  const [contactSearch, setContactSearch] = useState("");
  const [companyName, setCompanyName] = useState(preContact?.company_name || "");
  const [industry, setIndustry] = useState(preContact?.industry || "");
  const [town, setTown] = useState(preContact?.town || "");
  const [price, setPrice] = useState(preContact?.quoted_price?.toString() || "");
  const [requirements, setRequirements] = useState("");
  const [services, setServices] = useState("");

  const selectedContact = contacts.find((c) => c.id === selectedContactId);

  const filteredContacts = useMemo(() => {
    if (!contactSearch) return contacts.slice(0, 50);
    const q = contactSearch.toLowerCase();
    return contacts
      .filter(
        (c) =>
          c.company_name.toLowerCase().includes(q) ||
          (c.contact_person || "").toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [contacts, contactSearch]);

  function selectContact(contact: Contact) {
    setSelectedContactId(contact.id);
    setContactSearch("");
    if (!companyName) setCompanyName(contact.company_name);
    if (!industry && contact.industry) setIndustry(contact.industry);
    if (!town && contact.town) setTown(contact.town);
    if (!price && contact.quoted_price) setPrice(contact.quoted_price.toString());
  }

  async function handleSubmit() {
    if (!selectedContactId) {
      toast.error("Please select a contact");
      return;
    }
    if (!companyName.trim()) {
      toast.error("Company name is required");
      return;
    }
    if (!requirements?.trim()) {
      toast.error("Please describe the requirements for the tech team");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: selectedContactId,
          company_name: companyName,
          industry: industry || undefined,
          town: town || undefined,
          price: price ? parseFloat(price) : undefined,
          requirements: requirements || undefined,
          services: services
            ? services
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to create proposal");
        setSaving(false);
        return;
      }

      toast.success("Proposal submitted to tech team!");
      router.push("/sales/proposals");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/sales/proposals")}
        className="gap-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Proposals
      </Button>

      <div>
        <h1 className="text-2xl font-bold">New Proposal</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fill in the client details and requirements. The tech team will build
          the website based on this information.
        </p>
      </div>

      {/* Contact Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact *</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search contacts..."
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {selectedContact && (
            <Badge variant="secondary" className="gap-1">
              {selectedContact.company_name}
              {selectedContact.contact_person &&
                ` — ${selectedContact.contact_person}`}
              <button
                onClick={() => setSelectedContactId(null)}
                className="ml-1 hover:text-destructive"
              >
                ×
              </button>
            </Badge>
          )}
          {contactSearch && !selectedContactId && (
            <div className="border rounded-lg max-h-48 overflow-y-auto">
              {filteredContacts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectContact(c)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex justify-between"
                >
                  <span className="font-medium">{c.company_name}</span>
                  <span className="text-muted-foreground text-xs">
                    {c.contact_person}
                  </span>
                </button>
              ))}
              {filteredContacts.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  No contacts found
                </p>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Select the contact this proposal is for.
          </p>
        </CardContent>
      </Card>

      {/* Company Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="company_name">Company Name *</Label>
              <Input
                id="company_name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="ABC Plumbing"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Plumbing"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="town">Town</Label>
              <Input
                id="town"
                value={town}
                onChange={(e) => setTown(e.target.value)}
                placeholder="Bratislava"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="price">Price ($)</Label>
              <Input
                id="price"
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="499"
                min="0"
                step="0.01"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Services */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Services</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Input
            value={services}
            onChange={(e) => setServices(e.target.value)}
            placeholder="Website, Hosting, Maintenance"
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated list of services included in this proposal.
          </p>
        </CardContent>
      </Card>

      {/* Requirements */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Requirements for Tech Team</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Textarea
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
            placeholder={`Describe what the client wants:\n- Pages needed (Home, About, Services, Contact...)\n- Specific features (gallery, booking form, map...)\n- Color preferences, style references\n- Reference websites\n- Any other notes for the tech team`}
            rows={8}
          />
          <p className="text-xs text-muted-foreground">
            Be as detailed as possible. The tech team will use this to build the
            website.
          </p>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t">
        <Button
          onClick={handleSubmit}
          disabled={saving}
          className="gap-2"
        >
          <Send className="h-4 w-4" />
          {saving ? "Submitting..." : "Submit to Tech Team"}
        </Button>
      </div>
    </div>
  );
}
