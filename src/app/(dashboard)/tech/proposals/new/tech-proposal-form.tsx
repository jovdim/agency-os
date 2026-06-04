"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowLeft,
  Send,
  Phone,
  Mail,
  Globe,
  MapPin,
  Building2,
  ExternalLink,
} from "lucide-react";

interface Contact {
  id: string;
  company_name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  industry: string | null;
  town: string | null;
  location: string | null;
  quoted_price: number | null;
  social_links: string | null;
  notes: string | null;
}

export function TechProposalForm({ contact }: { contact: Contact | null }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [companyName, setCompanyName] = useState(contact?.company_name || "");
  const [industry, setIndustry] = useState(contact?.industry || "");
  const [town, setTown] = useState(contact?.town || "");
  const [price, setPrice] = useState(contact?.quoted_price?.toString() || "");
  const [requirements, setRequirements] = useState("");
  const [services, setServices] = useState("");

  async function handleSubmit() {
    if (!companyName.trim()) {
      toast.error("Company name is required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: contact?.id || null,
          company_name: companyName,
          industry: industry || undefined,
          town: town || undefined,
          price: price ? parseFloat(price) : undefined,
          requirements: requirements || undefined,
          services: services
            ? services.split(",").map((s) => s.trim()).filter(Boolean)
            : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to create proposal");
        setSaving(false);
        return;
      }

      toast.success("Proposal created! You can now start building the website.");
      router.push(`/tech/proposals/${data.proposal.id}`);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const socialLinks = contact?.social_links
    ? contact.social_links.split("\n").filter(Boolean)
    : [];

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/tech")}
        className="gap-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Button>

      <div>
        <h1 className="text-2xl font-bold">Create Proposal</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review the contact info from sales and create a website proposal.
        </p>
      </div>

      {/* Contact Info from Sales (read-only) */}
      {contact && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardHeader>
            <CardTitle className="text-base">Contact Info from Sales</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
              {contact.contact_person && (
                <div>
                  <span className="text-xs text-muted-foreground">Contact Person</span>
                  <p className="font-medium">{contact.contact_person}</p>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span>{contact.phone}</span>
                </div>
              )}
              {contact.email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span>{contact.email}</span>
                </div>
              )}
              {contact.website_url && (
                <div className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <a
                    href={contact.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1"
                  >
                    {contact.website_url}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              {(contact.town || contact.location) && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span>{[contact.town, contact.location].filter(Boolean).join(", ")}</span>
                </div>
              )}
              {contact.industry && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span>{contact.industry}</span>
                </div>
              )}
            </div>

            {socialLinks.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {socialLinks.map((link, i) => (
                  <a
                    key={i}
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {link.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                  </a>
                ))}
              </div>
            )}

            {contact.notes && (
              <div className="mt-3 rounded-md bg-muted/50 px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Sales Notes</p>
                <p className="text-sm whitespace-pre-wrap">{contact.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Company Details (editable) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proposal Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="company_name">Company Name *</Label>
              <Input
                id="company_name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Company name"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="e.g. Plumbing, Restaurant"
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
                placeholder="149"
                min="0"
                step="1"
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
            Comma-separated list of services included.
          </p>
        </CardContent>
      </Card>

      {/* Requirements / Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Build Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Textarea
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
            placeholder={`Notes for this build:\n- Pages needed (Home, About, Services, Contact...)\n- Color preferences, style\n- Reference websites\n- Anything specific about this project`}
            rows={6}
          />
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
          {saving ? "Creating..." : "Create Proposal & Start Building"}
        </Button>
      </div>
    </div>
  );
}
