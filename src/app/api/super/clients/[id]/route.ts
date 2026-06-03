import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { profile, site } = body;

  const admin = createAdminClient();

  // Update profile fields
  if (profile) {
    const { error } = await admin
      .from("profiles")
      .update({
        company_name: profile.company_name ?? undefined,
        phone: profile.phone ?? undefined,
        ico: profile.ico ?? undefined,
        dic: profile.dic ?? undefined,
        ic_dph: profile.ic_dph ?? undefined,
        billing_street: profile.billing_street ?? undefined,
        billing_city: profile.billing_city ?? undefined,
        billing_zip: profile.billing_zip ?? undefined,
      })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update site fields
  if (site && site.id) {
    const { error } = await admin
      .from("sites")
      .update({
        domain: site.domain ?? undefined,
        domain_expiry_date: site.domain_expiry_date ?? undefined,
        domain_registrar: site.domain_registrar ?? undefined,
        domain_renewal_status: site.domain_renewal_status ?? undefined,
        next_billing_date: site.next_billing_date ?? undefined,
        billing_cycle_months: site.billing_cycle_months ?? undefined,
        website_live_date: site.website_live_date ?? undefined,
      })
      .eq("id", site.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
