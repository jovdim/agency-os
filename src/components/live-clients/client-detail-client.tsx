"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ExternalLink,
  PenLine,
  Mail,
  Phone,
  MapPin,
  Building2,
  Globe,
  Calendar,
  Receipt,
  Tag,
  Wallet,
  Send,
  CheckCircle2,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { format } from "date-fns";
import dynamic from "next/dynamic";
import {
  EditSubdomainDialog,
  EditDomainDialog,
  EditLoginEmailDialog,
} from "./edit-field-dialogs";
import {
  RequestDomainDialog,
  RequestBusinessEmailDialog,
} from "./request-domain-email-dialog";
import { AddServiceDialog } from "./add-service-dialog";
import { EditServiceDialog } from "./edit-service-dialog";

// Reuse the SAME welcome-email dialog the proposal pipeline uses
// (`/tech/proposals/[id]` "Send welcome email" step) so the Live
// Clients detail page can't drift from the proposal flow's email
// UX. Preview + editable recipient/login/password + custom message
// + iframe preview pane all come from the existing component.
const SendWelcomeEmailDialog = dynamic(
  () =>
    import("@/components/send-welcome-email-dialog").then(
      (m) => m.SendWelcomeEmailDialog,
    ),
  { ssr: false },
);

/**
 * Live-client detail page — body component.
 *
 * Three roles render the same layout (super / tech / sales); the
 * server-side wrapper page handles the auth + role-scoped query and
 * passes a flat, render-ready object here. Sales hits the same route
 * structure but its server wrapper enforces own-organic-OR-migrated
 * access at fetch time.
 *
 * Actions surfaced:
 *   - Open in composer (role-prefixed link, middleware-safe)
 *   - View live (only when subdomain/domain is set)
 *   - Send welcome email (opens the SAME SendWelcomeEmailDialog the
 *     proposal pipeline uses — preview + editable recipient / login /
 *     password + custom message + iframe HTML preview, sends via
 *     /api/admin/clients/send-welcome which syncs the new password
 *     to Supabase auth + proposal.client_temp_password)
 */
export interface ClientDetailData {
  proposal_id: string;
  site_id: string | null;
  company_name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  town: string | null;
  industry: string | null;
  business_email: string | null;
  subdomain: string | null;
  custom_domain: string | null;
  /** "none" | "register_new" | "transfer" | "decided_later" | "active" */
  domain_status: string | null;
  // ── Pending-request context (new fields for the staff request UI) ──
  /** Domain string typed into a pending request — register_new or
   *  transfer carries the chosen domain here until super flips to
   *  active, at which point it also lands in custom_domain. */
  requested_domain: string | null;
  /** EPP transfer code captured during a 'transfer' request. */
  domain_auth_code: string | null;
  /** Local part the requester picked for the eventual business email
   *  (e.g. "info" → info@theirdomain.com). Tech reads it when
   *  provisioning the Hostinger mailbox. */
  requested_email_prefix: string | null;
  /** Hostinger mailbox actually provisioned (lives on profiles.
   *  business_email). Distinct from the contact-level business_email
   *  above, which was what the client typed in the proposal form. */
  provisioned_business_email: string | null;
  amount_paid: number;
  paid_at: string | null;
  invoice_number: string | null;
  payment_method: string | null;
  is_migrated: boolean;
  last_published_at: string | null;
  /** Currently stored temp password (null if never set). Surfaced in
   *  the send-credentials dialog so the admin can preview before
   *  emailing. */
  current_password: string | null;
  /** Display string — null on migrated rows since no real attribution */
  salesperson: string | null;
  /** Credit balance in EUR */
  credit_balance: number;
  // ── Organic-proposal context (auto-hidden on migrated rows) ──
  /** Public proposal landing slug (`/proposal/<slug>`) — only set for
   *  organic rows that went through the sales pipeline. */
  proposal_slug: string | null;
  /** Currently active ongoing services this client is paying for —
   *  hosting, custom domain, business email, SEO, etc. Pulled from
   *  the `services` table (is_active = true). Empty array means
   *  none configured yet. Each row carries the monthly price + the
   *  date the service became active so admins can eyeball the
   *  client's full subscription state at a glance. */
  services_active: Array<{
    id: string;
    type: string;
    name: string;
    price: number | null;
    starts_at: string | null;
  }>;
}

interface ClientDetailClientProps {
  data: ClientDetailData;
  /** Route prefix that this user is authorized for — keeps the
   *  composer link from 403'ing under middleware. */
  composerPathPrefix: "/tech" | "/sales" | "/super";
  /** Back-link to the listing page (same role prefix). */
  listPathPrefix: "/tech" | "/sales" | "/super";
  /** When true, drop the outer page chrome (back button, company-name
   *  H1, action toolbar) so the cards can render INSIDE another page
   *  (e.g. /tech/proposals/[id] when the proposal is paid). The host
   *  page provides its own header + Mark-as-paid / Open composer
   *  actions in that case, so re-rendering them would duplicate. The
   *  card grid + proposal-journey strip + edit dialogs still render. */
  embedded?: boolean;
  /** Language for the new staff-side request dialogs (domain +
   *  business email). Sales passes "sk" per the role rule; tech /
   *  super default to "en". The rest of this component is still
   *  English-only — a broader i18n pass is a follow-up. */
  lang?: "en" | "sk";
}

export function ClientDetailClient({
  data,
  composerPathPrefix,
  listPathPrefix,
  embedded = false,
  lang = "en",
}: ClientDetailClientProps) {
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  // One open-state per editable field. Kept as separate booleans
  // rather than a single "which dialog is open" enum so independent
  // dialogs never accidentally co-mount (each one fetches state on
  // open).
  const [editSubdomainOpen, setEditSubdomainOpen] = useState(false);
  const [editDomainOpen, setEditDomainOpen] = useState(false);
  const [editEmailOpen, setEditEmailOpen] = useState(false);
  // Staff request dialogs — submit a fresh request to super_admin
  // (separate flow from the inline pencil edits above, which directly
  // overwrite the field without going through the request pipeline).
  const [requestDomainOpen, setRequestDomainOpen] = useState(false);
  const [requestBusinessEmailOpen, setRequestBusinessEmailOpen] = useState(false);
  const [addServiceOpen, setAddServiceOpen] = useState(false);
  const [editingService, setEditingService] = useState<
    ClientDetailData["services_active"][number] | null
  >(null);
  // Track which service rows are currently being removed so we can
  // disable their buttons + show a spinner without optimistic UI.
  const [removingServiceIds, setRemovingServiceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const router = useRouter();

  async function handleRemoveService(serviceId: string, name: string) {
    if (removingServiceIds.has(serviceId)) return;
    setRemovingServiceIds((prev) => {
      const next = new Set(prev);
      next.add(serviceId);
      return next;
    });
    try {
      const res = await fetch(
        `/api/admin/live-clients/${data.proposal_id}/services/${serviceId}`,
        { method: "DELETE" },
      );
      const result = await res.json();
      if (!res.ok) {
        toast.error(result.error || "Failed to remove service");
        return;
      }
      toast.success(`Removed: ${name}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setRemovingServiceIds((prev) => {
        const next = new Set(prev);
        next.delete(serviceId);
        return next;
      });
    }
  }

  // Setup-state helpers used by the Site card's Setup section.
  const domainActive = data.domain_status === "active" && !!data.custom_domain;
  const domainPending =
    data.domain_status === "register_new" ||
    data.domain_status === "transfer" ||
    data.domain_status === "register_in_progress" ||
    data.domain_status === "transfer_in_progress";
  const emailReady = !!data.provisioned_business_email;
  const emailPending = !!data.requested_email_prefix && !emailReady;

  // ── Per-site notification awareness ──
  // The global StaffNotificationBanner shows "domain X is now active"
  // at the top of every page when super completes a request. That's
  // good for first-discovery, but on the per-client page itself we
  // want the Setup row to ALSO call out "this just landed" so the
  // requester knows what specifically to do next (configure the
  // domain on the website, etc.). Fetches /api/notifications once on
  // mount + on tab focus; filters by site_id and kind.
  type SiteNotification = { id: string; kind: string; site_id: string | null };
  const [hasDomainPing, setHasDomainPing] = useState(false);
  const [hasEmailPing, setHasEmailPing] = useState(false);
  const [domainPingId, setDomainPingId] = useState<string | null>(null);
  const [emailPingId, setEmailPingId] = useState<string | null>(null);

  useEffect(() => {
    if (!data.site_id) return;
    let cancelled = false;

    async function fetchPings() {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const all: SiteNotification[] = json.notifications ?? [];
        if (cancelled) return;
        const forThisSite = all.filter((n) => n.site_id === data.site_id);
        const domainPing = forThisSite.find((n) => n.kind === "domain_active");
        const emailPing = forThisSite.find((n) => n.kind === "email_ready");
        setHasDomainPing(!!domainPing);
        setDomainPingId(domainPing?.id ?? null);
        setHasEmailPing(!!emailPing);
        setEmailPingId(emailPing?.id ?? null);
      } catch {
        // Silent — notifications are decorative, not load-bearing.
      }
    }

    void fetchPings();
    const handler = () => {
      if (document.visibilityState === "visible") void fetchPings();
    };
    document.addEventListener("visibilitychange", handler);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handler);
    };
  }, [data.site_id]);

  // Dismiss a per-site ping when the user actively engages with the
  // row (e.g. clicks the Change button) — the cue has served its
  // purpose at that point. Fire-and-forget POST, optimistic UI.
  async function dismissPing(id: string | null) {
    if (!id) return;
    try {
      await fetch(`/api/notifications/${id}/dismiss`, { method: "POST" });
    } catch {
      // Best-effort — next fetch will catch a missed dismissal.
    }
  }

  // Inline strings for the new Setup section. Keeps the i18n inline
  // (small surface area, not worth a shared dict yet — when more of
  // ClientDetailClient gets translated we'll lift this).
  const setup = lang === "sk"
    ? {
        title: "Setup",
        domainNotRequested: "Domain not requested yet",
        domainPending: "Awaiting super_admin",
        domainActive: "Active",
        requestDomain: "Request domain",
        editDomainRequest: "Edit request",
        // Surfaced when domain is already active — lets staff re-request
        // a change (e.g. typo, client switched their mind). Opens the
        // same dialog so super treats it as a new request.
        changeDomain: "Change domain",
        businessEmailNotRequested: "Business email not requested yet",
        businessEmailPending: "Awaiting provisioning",
        businessEmailReady: "Ready",
        requestBusinessEmail: "Request business email",
        editEmailRequest: "Edit request",
        changeBusinessEmail: "Change email",
        needsDomainFirst: "Needs an active domain first",
      }
    : {
        title: "Setup",
        domainNotRequested: "Domain not requested yet",
        domainPending: "Awaiting super_admin",
        domainActive: "Active",
        requestDomain: "Request domain",
        editDomainRequest: "Edit request",
        changeDomain: "Change domain",
        businessEmailNotRequested: "Business email not requested yet",
        businessEmailPending: "Awaiting provisioning",
        businessEmailReady: "Ready",
        requestBusinessEmail: "Request business email",
        editEmailRequest: "Edit request",
        changeBusinessEmail: "Change email",
        needsDomainFirst: "Needs an active domain first",
      };

  const liveUrl = data.custom_domain
    ? `https://${data.custom_domain}`
    : data.subdomain
      ? `https://${data.subdomain}.pages.dev`
      : null;
  const liveHostname = data.custom_domain
    ? data.custom_domain
    : data.subdomain
      ? `${data.subdomain}.pages.dev`
      : null;

  // Embedded mode skips:
  //   - outer page padding + max-width wrapper (host page provides it)
  //   - back button / company-name H1 (host has its own header)
  //   - action toolbar (host has Mark-as-paid / Open composer in its
  //     header, no point duplicating "Open composer" etc. here)
  // Send-welcome + edit dialogs stay mounted so the action buttons we
  // surface INSIDE the cards (Send credentials on the Contact card,
  // pencil buttons next to editable rows) still work end-to-end.
  return (
    <div
      className={
        embedded ? "space-y-5" : "p-6 max-w-[1100px] mx-auto space-y-5"
      }
    >
      {/* Header — hidden in embedded mode */}
      {!embedded && (
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <Link
              href={`${listPathPrefix}/live-clients`}
              className="inline-flex h-9 w-9 items-center justify-center rounded border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Back to live clients"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-2xl font-semibold flex items-center gap-2">
                {data.company_name}
                {data.is_migrated && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                    <Tag className="h-3 w-3" />
                    Migrated
                  </span>
                )}
              </h1>
              {data.contact_person && (
                <p className="text-sm text-muted-foreground mt-1">
                  {data.contact_person}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={() => setCredentialsOpen(true)}
              disabled={!data.email}
              title={data.email ? "" : "No email on contact"}
            >
              <Send className="h-4 w-4 mr-1.5" />
              Send welcome email
            </Button>
            {liveUrl && (
              <Button asChild variant="outline">
                <a href={liveUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1.5" />
                  View live
                </a>
              </Button>
            )}
            <Button asChild>
              <Link
                href={`${composerPathPrefix}/proposals/${data.proposal_id}/composer`}
              >
                <PenLine className="h-4 w-4 mr-1.5" />
                Open composer
              </Link>
            </Button>
          </div>
        </div>
      )}

      {/* In embedded mode, the host page's header doesn't have a
          "Send welcome email" button (it has Mark-as-paid). Surface a
          compact actions row above the cards so admins can still
          re-send credentials without leaving the page. */}
      {embedded && (
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2 mr-auto">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Live client
            {data.is_migrated && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 normal-case tracking-normal">
                <Tag className="h-3 w-3" />
                Migrated
              </span>
            )}
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCredentialsOpen(true)}
            disabled={!data.email}
            title={data.email ? "" : "No email on contact"}
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            Send credentials
          </Button>
          {liveUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={liveUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                View live
              </a>
            </Button>
          )}
          <Button asChild size="sm">
            <Link
              href={`${composerPathPrefix}/proposals/${data.proposal_id}/composer`}
            >
              <PenLine className="h-3.5 w-3.5 mr-1.5" />
              Composer
            </Link>
          </Button>
        </div>
      )}

      {/* Info grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Contact card */}
        <Card title="Contact">
          <Row
            icon={<Mail className="h-4 w-4" />}
            label="Email (login)"
            onEdit={() => setEditEmailOpen(true)}
          >
            {data.email ? (
              <a
                href={`mailto:${data.email}`}
                className="text-primary hover:underline break-all"
              >
                {data.email}
              </a>
            ) : (
              <Muted>not set</Muted>
            )}
          </Row>
          <Row icon={<Phone className="h-4 w-4" />} label="Phone">
            {data.phone ? (
              <a
                href={`tel:${data.phone}`}
                className="text-primary hover:underline"
              >
                {data.phone}
              </a>
            ) : (
              <Muted>—</Muted>
            )}
          </Row>
          <Row icon={<MapPin className="h-4 w-4" />} label="Town">
            {data.town || <Muted>—</Muted>}
          </Row>
          <Row icon={<Building2 className="h-4 w-4" />} label="Industry">
            {data.industry || <Muted>—</Muted>}
          </Row>
          <Row icon={<Mail className="h-4 w-4" />} label="Business email">
            <span className="break-all">
              {data.business_email || <Muted>—</Muted>}
            </span>
          </Row>
        </Card>

        {/* Site / domain card */}
        <Card title="Site">
          <Row icon={<Globe className="h-4 w-4" />} label="Live URL">
            {liveUrl ? (
              <a
                href={liveUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1 break-all"
              >
                {liveHostname}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ) : (
              <Muted>—</Muted>
            )}
          </Row>
          <Row
            icon={<Globe className="h-4 w-4" />}
            label="Subdomain"
            onEdit={() => setEditSubdomainOpen(true)}
          >
            {data.subdomain ? (
              <span className="font-mono text-sm">
                {data.subdomain}.pages.dev
              </span>
            ) : (
              <Muted>not set</Muted>
            )}
          </Row>
          <Row
            icon={<Globe className="h-4 w-4" />}
            label="Custom domain"
            onEdit={() => setEditDomainOpen(true)}
          >
            {data.custom_domain ? (
              <span className="font-mono text-sm">{data.custom_domain}</span>
            ) : (
              <Muted>not set</Muted>
            )}
          </Row>
          <Row icon={<Tag className="h-4 w-4" />} label="Domain status">
            <span className="capitalize">
              {data.domain_status || "none"}
            </span>
          </Row>
          <Row icon={<Calendar className="h-4 w-4" />} label="Last published">
            {data.last_published_at ? (
              format(new Date(data.last_published_at), "yyyy-MM-dd HH:mm")
            ) : (
              <Muted>not yet</Muted>
            )}
          </Row>

          {/* ── Setup section: domain + business email request flow ──
              Staff (tech / sales / super) submit a request → super
              fulfills via /super/domains → the requester gets a
              banner on their dashboard. Mirrors the client zone
              flow but lives on the per-client view so the agency
              can drive setup without waiting on the client. The
              inline pencil-edit dialogs above this stay (super can
              still skip the request pipeline + set the values
              directly). */}
          {data.site_id && (
            <div className="pt-3 mt-3 border-t border-dashed space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {setup.title}
              </p>

              {/* Domain row */}
              <div className="flex items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">
                    {domainActive ? (
                      <>
                        <span className="font-mono">{data.custom_domain}</span>
                        <span className={
                          "ml-2 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 " +
                          (hasDomainPing ? "ring-2 ring-emerald-500/40 animate-pulse" : "")
                        }>
                          {/* Tiny dot prefix when there's an unread
                              completion ping for this site — calls
                              out "this just landed, take next step". */}
                          {hasDomainPing && (
                            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          )}
                          {setup.domainActive}
                        </span>
                      </>
                    ) : domainPending ? (
                      <>
                        <span className="font-mono">
                          {data.requested_domain || "—"}
                        </span>
                        <span className="ml-2 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                          {setup.domainPending}
                        </span>
                      </>
                    ) : (
                      <Muted>{setup.domainNotRequested}</Muted>
                    )}
                  </span>
                </div>
                {/* Button always visible — even when active. Staff need
                    to be able to change a wrong domain (typo / client
                    swapped preference) without us needing to edit the DB
                    by hand. Clicking on an active row opens the same
                    request dialog; super then treats it as a fresh
                    request. */}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs shrink-0"
                  onClick={() => {
                    // Engaging with the row = the pulse has done its
                    // job; dismiss the per-site ping. Banner-level
                    // dismiss happens independently via the global
                    // banner ✕.
                    if (hasDomainPing) {
                      setHasDomainPing(false);
                      void dismissPing(domainPingId);
                    }
                    setRequestDomainOpen(true);
                  }}
                >
                  {domainActive
                    ? setup.changeDomain
                    : domainPending
                      ? setup.editDomainRequest
                      : setup.requestDomain}
                </Button>
              </div>

              {/* Business email row */}
              <div className="flex items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">
                    {emailReady ? (
                      <>
                        <span className="font-mono break-all">
                          {data.provisioned_business_email}
                        </span>
                        <span className={
                          "ml-2 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 " +
                          (hasEmailPing ? "ring-2 ring-emerald-500/40 animate-pulse" : "")
                        }>
                          {hasEmailPing && (
                            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          )}
                          {setup.businessEmailReady}
                        </span>
                      </>
                    ) : emailPending ? (
                      <>
                        <span className="font-mono">
                          {data.requested_email_prefix}
                          @
                          {data.custom_domain || data.requested_domain || "…"}
                        </span>
                        <span className="ml-2 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                          {setup.businessEmailPending}
                        </span>
                      </>
                    ) : (
                      <Muted>{setup.businessEmailNotRequested}</Muted>
                    )}
                  </span>
                </div>
                {/* Button always visible — even when email is already
                    "Ready" (profiles.business_email is set). Real case:
                    older accounts have a personal email saved in that
                    column (auto-default from earlier sign-up flows)
                    that's NOT a Hostinger mailbox. Staff need to be
                    able to issue a fresh request to overwrite. */}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs shrink-0"
                  onClick={() => {
                    if (hasEmailPing) {
                      setHasEmailPing(false);
                      void dismissPing(emailPingId);
                    }
                    setRequestBusinessEmailOpen(true);
                  }}
                >
                  {emailReady
                    ? setup.changeBusinessEmail
                    : emailPending
                      ? setup.editEmailRequest
                      : setup.requestBusinessEmail}
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Payment card */}
        <Card title="Payment">
          <Row icon={<Wallet className="h-4 w-4" />} label="Amount paid">
            <span className="font-medium tabular-nums">
              €{data.amount_paid.toLocaleString("en-US", {
                maximumFractionDigits: 0,
              })}
            </span>
          </Row>
          <Row icon={<Calendar className="h-4 w-4" />} label="Paid on">
            {data.paid_at ? (
              format(new Date(data.paid_at), "yyyy-MM-dd")
            ) : (
              <Muted>—</Muted>
            )}
          </Row>
          {/* Invoice row — only shown for ORGANIC clients (who paid
              through the dashboard's QR banner and got a real auto-
              generated FV invoice). Migrated clients already have a
              real invoice in your external accounting system; we
              don't show a placeholder FV here for them since it
              would look like a duplicate / fake entry. */}
          {!data.is_migrated && (
            <Row icon={<Receipt className="h-4 w-4" />} label="Invoice">
              <span className="font-mono text-xs">
                {data.invoice_number || <Muted>—</Muted>}
              </span>
            </Row>
          )}
          <Row icon={<Tag className="h-4 w-4" />} label="Method">
            <span className="capitalize">
              {data.payment_method?.replace(/_/g, " ") || (
                <Muted>—</Muted>
              )}
            </span>
          </Row>
          <Row icon={<Tag className="h-4 w-4" />} label="Source">
            {data.is_migrated ? "Migrated" : "Organic"}
          </Row>
          <Row icon={<Tag className="h-4 w-4" />} label="Salesperson">
            {data.salesperson || <Muted>—</Muted>}
          </Row>
        </Card>

        {/* Balance card */}
        <Card title="Credits">
          <Row icon={<Wallet className="h-4 w-4" />} label="Balance">
            <span className="font-medium tabular-nums">
              €{data.credit_balance.toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })}
            </span>
          </Row>
          <p className="text-xs text-muted-foreground mt-2 leading-snug">
            Credits are deducted when the client requests a paid
            change. Top-ups happen through the credits flow — not
            from here.
          </p>
        </Card>
      </div>

      {/* Services card — ongoing subscriptions this client pays for.
          Full-width below the 2-col grid so the row list has room to
          breathe. Empty state still shows the Add button so the
          operator can populate it from a fresh client. */}
      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Services
          </h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAddServiceOpen(true)}
            className="h-7 gap-1 text-xs"
          >
            <Plus className="h-3 w-3" />
            Add service
          </Button>
        </div>

        {data.services_active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active services. Add one to track what this client is
            paying for.
          </p>
        ) : (
          <ul className="divide-y -mx-4">
            {data.services_active.map((svc) => {
              const removing = removingServiceIds.has(svc.id);
              return (
                <li
                  key={svc.id}
                  className="flex items-center gap-3 px-4 py-2.5 group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {svc.name}
                    </div>
                    {(svc.price != null || svc.starts_at) && (
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {svc.price != null && (
                          <>
                            €{svc.price.toLocaleString("en-US", {
                              maximumFractionDigits: 2,
                            })}
                          </>
                        )}
                        {svc.price != null && svc.starts_at && " · "}
                        {svc.starts_at && <>since {svc.starts_at}</>}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => setEditingService(svc)}
                      disabled={removing}
                      className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors disabled:cursor-not-allowed"
                      title={`Edit ${svc.name}`}
                      aria-label={`Edit ${svc.name}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveService(svc.id, svc.name)}
                      disabled={removing}
                      className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:cursor-not-allowed"
                      title={`Remove ${svc.name}`}
                      aria-label={`Remove ${svc.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <SendWelcomeEmailDialog
        open={credentialsOpen}
        onOpenChange={setCredentialsOpen}
        defaultTo={data.email ?? ""}
        defaultLoginEmail={data.email ?? ""}
        defaultPassword={data.current_password ?? ""}
        fullName={
          data.contact_person ||
          data.company_name ||
          data.email ||
          ""
        }
        companyName={data.company_name}
        siteUrl={liveUrl}
      />

      <EditSubdomainDialog
        open={editSubdomainOpen}
        onOpenChange={setEditSubdomainOpen}
        proposalId={data.proposal_id}
        current={data.subdomain}
      />
      <EditDomainDialog
        open={editDomainOpen}
        onOpenChange={setEditDomainOpen}
        proposalId={data.proposal_id}
        current={data.custom_domain}
      />
      <EditLoginEmailDialog
        open={editEmailOpen}
        onOpenChange={setEditEmailOpen}
        proposalId={data.proposal_id}
        current={data.email}
      />

      {/* Staff request dialogs — separate flow from the pencil-edit
          dialogs above. These post a formal request to super_admin
          via PUT /api/sites/[id]/domain (status=register_new /
          transfer / prefix-only update). Notification banner fires on
          completion via the staff_notifications table. Mounted unconditionally so
          state survives re-render; gated by site_id presence at the
          button. */}
      {data.site_id && (
        <>
          <RequestDomainDialog
            open={requestDomainOpen}
            onOpenChange={setRequestDomainOpen}
            siteId={data.site_id}
            currentDomain={data.requested_domain ?? data.custom_domain ?? null}
            currentStatus={data.domain_status}
            currentAuthCode={data.domain_auth_code}
            lang={lang}
          />
          <RequestBusinessEmailDialog
            open={requestBusinessEmailOpen}
            onOpenChange={setRequestBusinessEmailOpen}
            siteId={data.site_id}
            currentPrefix={data.requested_email_prefix}
            activeDomain={data.domain_status === "active" ? data.custom_domain : null}
            lang={lang}
          />
        </>
      )}

      <AddServiceDialog
        open={addServiceOpen}
        onOpenChange={setAddServiceOpen}
        proposalId={data.proposal_id}
      />

      <EditServiceDialog
        open={editingService !== null}
        onOpenChange={(o) => {
          if (!o) setEditingService(null);
        }}
        proposalId={data.proposal_id}
        service={editingService}
      />
    </div>
  );
}

// ── Small layout primitives ────────────────────────────────────────────────

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({
  icon,
  label,
  children,
  onEdit,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  /** When provided, a small pencil button appears in the row's right
   *  gutter. Clicking it fires this handler — callers wire it to
   *  open the field-specific edit dialog. Optional so non-editable
   *  rows (phone, paid date, etc.) stay visually clean. */
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-start gap-2.5 text-sm group">
      <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm">{children}</div>
      </div>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
          title={`Edit ${label.toLowerCase()}`}
          aria-label={`Edit ${label}`}
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}
