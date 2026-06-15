import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { DomainManagementClient } from "@/app/(dashboard)/client/domain/domain-management-client";
import { resolveSiteAdminContext } from "../auth";
import { LoginForm } from "../login-form";
import { SiteAdminHeader } from "../header";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

interface DomainSite {
  id: string;
  name: string;
  owner_id: string | null;
  is_paid: boolean | null;
  is_legacy: boolean | null;
  domain: string | null;
  domain_status: string | null;
  requested_domain: string | null;
  domain_auth_code: string | null;
  domain_notes: string | null;
  domain_decided_at: string | null;
  requested_email_prefix: string | null;
}

/**
 * Per-site /admin DOMAIN — reuses the CRM DomainManagementClient (3-step
 * domain + business-email pipeline). The domain endpoints it calls
 * (/api/sites/[id]/domain[/check]) now accept the site-admin cookie. Gated on
 * is_paid (domain setup only after activation) and is_legacy.
 */
export default async function SiteAdminDomainPage({
  params,
}: {
  params: Promise<{ host: string }>;
}) {
  const { host: rawHost } = await params;
  const ctx = await resolveSiteAdminContext(rawHost);
  if (!ctx) notFound();
  if (!ctx.authed) return <LoginForm />;

  const admin = createAdminClient();
  const { data } = await admin
    .from("sites")
    .select(
      "id, name, owner_id, is_paid, is_legacy, domain, domain_status, requested_domain, domain_auth_code, domain_notes, domain_decided_at, requested_email_prefix",
    )
    .eq("id", ctx.siteId)
    .single();
  if (!data) notFound();
  const site = data as unknown as DomainSite;

  const shell = (children: ReactNode) => (
    <div className="min-h-screen bg-background">
      <SiteAdminHeader active="domain" />
      <div className="px-4 py-8 sm:px-6">{children}</div>
    </div>
  );

  if (site.is_legacy) {
    return shell(
      <p className="py-12 text-center text-sm text-muted-foreground">
        This website isn&apos;t available in the new editor.
      </p>,
    );
  }

  if (site.is_paid !== true) {
    return shell(
      <div className="mx-auto max-w-md py-12 text-center">
        <p className="text-sm text-foreground">
          Activate your website first to set up your domain and business email.
        </p>
        <Link
          href="/admin"
          className="dash-accent mt-3 inline-block text-sm font-medium hover:underline"
        >
          Back to dashboard
        </Link>
      </div>,
    );
  }

  // Business-email credentials live on the owner profile (step 3 of the pipeline).
  let businessEmail: string | null = null;
  let businessEmailPassword: string | null = null;
  if (site.owner_id) {
    const { data: profile } = await admin
      .from("profiles")
      .select("business_email, business_email_password")
      .eq("id", site.owner_id)
      .maybeSingle();
    businessEmail =
      (profile as { business_email?: string | null } | null)?.business_email ??
      null;
    businessEmailPassword =
      (profile as { business_email_password?: string | null } | null)
        ?.business_email_password ?? null;
  }

  return shell(
    <div className="mx-auto max-w-3xl">
      <DomainManagementClient
        site={{
          id: site.id,
          name: site.name,
          domain: site.domain,
          domainStatus: site.domain_status || "none",
          requestedDomain: site.requested_domain,
          domainAuthCode: site.domain_auth_code,
          domainNotes: site.domain_notes,
          domainDecidedAt: site.domain_decided_at,
          requestedEmailPrefix: site.requested_email_prefix ?? null,
        }}
        businessEmail={businessEmail}
        businessEmailPassword={businessEmailPassword}
      />
    </div>,
  );
}
