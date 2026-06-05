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
  User,
  Tag,
  FileText,
  StickyNote,
  CircleDollarSign,
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
    <div className="dash-root space-y-8">
      {/* Clean page header — no gradient on a sub-page. Back control + eyebrow,
          title and one-line subtitle on the left; primary action on the right. */}
      <header className="space-y-5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/tech")}
          className="-ml-2 h-8 gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Button>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3.5">
            <span className="dash-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
              <Building2 className="dash-accent h-5 w-5" />
            </span>
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Contact
              </p>
              <h1 className="text-2xl font-bold tracking-tight">
                {contact.company_name ||
                  contact.contact_person ||
                  "Unnamed Contact"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {contact.industry || "General"} · {contact.town || "—"}
              </p>
            </div>
          </div>

          {proposal && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push(`/tech/proposals/${proposal.id}`)}
              className="gap-1.5 self-start sm:self-auto"
            >
              View Proposal
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </header>

      {/* Status cards — proposal + live site sit side by side on wide screens so
          the operator scans deployment state at a glance. */}
      {(proposal || liveUrl) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {proposal && (
            <div className="dash-card p-4">
              <div className="flex items-center gap-3">
                <span className="dash-chip inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                  <FileText className="dash-accent h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Proposal
                  </p>
                  <p className="truncate text-sm font-medium">
                    {proposal.company_name}
                  </p>
                </div>
                <span className="ml-auto shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium capitalize text-muted-foreground">
                  {proposal.status}
                </span>
              </div>
            </div>
          )}

          {liveUrl && (
            <div className="dash-card p-4">
              <div className="flex items-center gap-3">
                {/* Pink accent = "good news": this contact has a live site. */}
                <span className="dash-chip-pink inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                  <Globe className="h-4 w-4 text-(--dash-accent-2)" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Live site
                  </p>
                  <a
                    href={liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-sm font-medium text-(--dash-accent-2) hover:underline"
                  >
                    {liveUrl.replace(/^https?:\/\//, "")}
                  </a>
                </div>
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              {deployment?.github_url && (
                <div className="mt-3 flex items-center gap-2 border-t pt-3 text-xs">
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="shrink-0 text-muted-foreground">Repo</span>
                  <a
                    href={deployment.github_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 items-center gap-1 truncate text-muted-foreground hover:text-foreground hover:underline"
                  >
                    <span className="truncate">
                      {deployment.github_url.replace(
                        "https://github.com/",
                        ""
                      )}
                    </span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Contact Details */}
      <div className="dash-card overflow-hidden p-0">
        <div className="dash-subhead flex items-center gap-2.5 border-b px-4 py-3">
          <User className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium">Contact Details</p>
        </div>
        <div className="divide-y">
          <InfoRow
            icon={<Building2 className="h-4 w-4" />}
            label="Company"
            value={contact.company_name}
          />
          <InfoRow
            icon={<User className="h-4 w-4" />}
            label="Person"
            value={contact.contact_person}
          />
          <InfoRow
            icon={<Phone className="h-4 w-4" />}
            label="Phone"
            value={contact.phone}
            href={contact.phone ? `tel:${contact.phone}` : undefined}
            mono
          />
          <InfoRow
            icon={<Mail className="h-4 w-4" />}
            label="Email"
            value={contact.email}
            href={contact.email ? `mailto:${contact.email}` : undefined}
          />
          <InfoRow
            icon={<Tag className="h-4 w-4" />}
            label="Industry"
            value={contact.industry}
          />
          <InfoRow
            icon={<MapPin className="h-4 w-4" />}
            label="Town"
            value={contact.town}
          />
          <InfoRow
            icon={<MapPin className="h-4 w-4" />}
            label="Address"
            value={contact.location}
          />
          {contact.website_url && (
            <div className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 shrink-0 text-muted-foreground">
                <Globe className="h-4 w-4" />
              </span>
              <span className="w-20 shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">
                Website
              </span>
              <a
                href={contact.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="dash-accent flex min-w-0 items-center gap-1 truncate text-sm hover:underline"
              >
                <span className="truncate">
                  {contact.website_url.replace(/^https?:\/\//, "")}
                </span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          )}
          {contact.quoted_price != null && contact.quoted_price > 0 && (
            <InfoRow
              icon={<CircleDollarSign className="h-4 w-4" />}
              label="Quoted"
              value={`$${Number(contact.quoted_price).toLocaleString()}`}
            />
          )}
          {socialLinks.length > 0 && (
            <div className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 shrink-0 text-muted-foreground">
                <Link2 className="h-4 w-4" />
              </span>
              <span className="w-20 shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">
                Links
              </span>
              <div className="min-w-0 space-y-1 text-sm">
                {socialLinks.map((l, i) => (
                  <a
                    key={i}
                    href={l}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="dash-accent block truncate hover:underline"
                  >
                    {l.replace(/^https?:\/\//, "")}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sales notes — broken out into its own soft card for readability. */}
      {contact.notes && (
        <div className="dash-card overflow-hidden p-0">
          <div className="dash-subhead flex items-center gap-2.5 border-b px-4 py-3">
            <StickyNote className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">Sales Notes</p>
          </div>
          <p className="whitespace-pre-wrap px-4 py-3.5 text-sm leading-relaxed text-foreground">
            {contact.notes}
          </p>
        </div>
      )}
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  href,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  href?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="dash-row flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <span className="w-20 shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {href ? (
        <a
          href={href}
          className={`dash-accent truncate text-sm hover:underline ${
            mono ? "font-mono tabular-nums" : ""
          }`}
        >
          {value}
        </a>
      ) : (
        <span
          className={`text-sm text-foreground ${
            mono ? "font-mono tabular-nums" : ""
          }`}
        >
          {value}
        </span>
      )}
    </div>
  );
}
