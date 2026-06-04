"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  MapPin,
  Globe,
  Link2,
  ExternalLink,
} from "lucide-react";

interface ContactData {
  id: string;
  company_name: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  industry: string | null;
  town: string | null;
  website_url: string | null;
  location: string | null;
  social_links: string | null;
  notes: string | null;
  quoted_price: number | null;
  client_status: string | null;
}

interface Props {
  contact: ContactData;
  proposal: { id: string; status: string; company_name: string } | null;
  deployment: { subdomain: string; github_url: string | null } | null;
}

export function TechContactDetail({ contact, proposal, deployment }: Props) {
  const router = useRouter();
  const socialLinks = contact.social_links?.split("\n").filter(Boolean) ?? [];
  const liveUrl = deployment ? `https://${deployment.subdomain}.2dni.sk` : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/tech")}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div>
          <h1 className="text-xl font-bold">
            {contact.company_name || contact.contact_person || "Unnamed Contact"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {contact.industry || "General"} · {contact.town || "—"}
          </p>
        </div>
      </div>

      {/* Link to proposal if exists */}
      {proposal && (
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className="text-muted-foreground">Proposal:</span>{" "}
              <span className="font-medium">{proposal.company_name}</span>
              <span className="text-xs text-muted-foreground ml-2">({proposal.status})</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push(`/tech/proposals/${proposal.id}`)}
              className="gap-1.5"
            >
              View Proposal
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Live site */}
      {liveUrl && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 px-4 py-3 space-y-2">
          <div className="flex items-center gap-3 text-sm">
            <Globe className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="text-muted-foreground shrink-0">Live at:</span>
            <a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-emerald-600 dark:text-emerald-400 hover:underline truncate"
            >
              {liveUrl}
            </a>
          </div>
          {deployment?.github_url && (
            <div className="flex items-center gap-3 text-sm">
              <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground shrink-0">Repo:</span>
              <a
                href={deployment.github_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground hover:underline truncate flex items-center gap-1"
              >
                {deployment.github_url.replace("https://github.com/", "")}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          )}
        </div>
      )}

      {/* Contact Details */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b">
          <p className="text-sm font-medium">Contact Details</p>
        </div>
        <div className="divide-y text-sm">
          <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Company" value={contact.company_name} />
          <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Person" value={contact.contact_person} />
          <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={contact.phone} href={contact.phone ? `tel:${contact.phone}` : undefined} mono />
          <InfoRow icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={contact.email} href={contact.email ? `mailto:${contact.email}` : undefined} />
          <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Industry" value={contact.industry} />
          <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Town" value={contact.town} />
          <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Address" value={contact.location} />
          {contact.website_url && (
            <div className="flex items-start gap-3 px-4 py-2.5">
              <span className="mt-0.5 text-muted-foreground shrink-0"><Globe className="h-3.5 w-3.5" /></span>
              <span className="text-muted-foreground text-xs w-16 shrink-0 pt-0.5">Website</span>
              <a href={contact.website_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate flex items-center gap-1">
                {contact.website_url.replace(/^https?:\/\//, "")}
                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
              </a>
            </div>
          )}
          {contact.quoted_price != null && contact.quoted_price > 0 && (
            <InfoRow icon={null} label="Quoted" value={`$${Number(contact.quoted_price).toLocaleString()}`} />
          )}
          {socialLinks.length > 0 && (
            <div className="flex items-start gap-3 px-4 py-2.5">
              <span className="mt-0.5 text-muted-foreground shrink-0"><Link2 className="h-3.5 w-3.5" /></span>
              <span className="text-muted-foreground text-xs w-16 shrink-0 pt-0.5">Links</span>
              <div className="space-y-1 text-xs min-w-0">
                {socialLinks.map((l, i) => (
                  <a key={i} href={l} target="_blank" rel="noopener noreferrer" className="block text-primary hover:underline truncate">
                    {l.replace(/^https?:\/\//, "")}
                  </a>
                ))}
              </div>
            </div>
          )}
          {contact.notes && (
            <div className="px-4 py-2.5">
              <p className="text-xs font-medium text-muted-foreground mb-1">Sales Notes</p>
              <p className="text-xs text-foreground whitespace-pre-wrap">{contact.notes}</p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

function InfoRow({
  icon, label, value, href, mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  href?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 text-sm">
      <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
      <span className="text-muted-foreground text-xs w-16 shrink-0 pt-0.5">{label}</span>
      {href ? (
        <a href={href} className="text-xs text-primary hover:underline truncate">{value}</a>
      ) : (
        <span className={`text-xs ${mono ? "font-mono" : ""} text-foreground`}>{value}</span>
      )}
    </div>
  );
}
