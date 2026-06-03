import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DomainManagementClient } from "./domain-management-client";

export const dynamic = "force-dynamic";

export default async function DomainPage() {
  const { profile } = await requireRole("client");
  const supabase = await createClient();

  // Fetch the site + the profile's email credentials in parallel.
  //   - site: domain + email_prefix columns drive steps 1 + 2 of the pipeline
  //   - profile: business_email / business_email_password drive step 3
  //     (credentials display, shown only when tech has provisioned the
  //     Hostinger mailbox). business_email_password is only readable by
  //     the owner due to RLS; we deliberately surface it on the
  //     authenticated client zone so the client doesn't have to dig
  //     through old emails to find it.
  const [sitesRes, profileEmailRes] = await Promise.all([
    supabase
      .from("sites")
      .select(
        "id, name, domain, domain_status, requested_domain, domain_auth_code, domain_notes, domain_decided_at, requested_email_prefix",
      )
      .eq("owner_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("profiles")
      .select("business_email, business_email_password")
      .eq("id", profile.id)
      .single(),
  ]);

  const site = sitesRes.data?.[0];

  if (!site) {
    redirect("/client");
  }

  return (
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
        requestedEmailPrefix:
          (site as { requested_email_prefix?: string | null })
            .requested_email_prefix ?? null,
      }}
      businessEmail={profileEmailRes.data?.business_email ?? null}
      businessEmailPassword={
        profileEmailRes.data?.business_email_password ?? null
      }
    />
  );
}
