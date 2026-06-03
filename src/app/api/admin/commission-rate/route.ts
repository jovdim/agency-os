import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * PUT /api/admin/commission-rate
 * Set commission rate for a salesperson.
 * Body: { profile_id: string, rate: number (percentage, e.g. 10 for 10%) }
 */
export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = user.app_metadata?.role as string;
  if (!["super_admin", "administrator"].includes(role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const body = await req.json();
  const { profile_id, rate } = body as { profile_id?: string; rate?: number };

  if (!profile_id || rate === undefined || rate === null) {
    return NextResponse.json({ error: "Missing profile_id or rate" }, { status: 400 });
  }

  if (rate < 0 || rate > 100) {
    return NextResponse.json({ error: "Rate must be between 0 and 100" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify the profile is a salesperson
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", profile_id)
    .single();

  if (!profile || profile.role !== "sales") {
    return NextResponse.json({ error: "Profile is not a salesperson" }, { status: 400 });
  }

  // Convert percentage to decimal (10 → 0.10)
  const rateDecimal = rate / 100;

  // Upsert into commission_rates table
  const { error } = await admin
    .from("commission_rates")
    .upsert(
      {
        sales_person_id: profile_id,
        commission_type: "website_sale",
        rate: rateDecimal,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "sales_person_id,commission_type" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    action: "update_commission_rate",
    entityType: "commission_rate",
    details: { sales_person_id: profile_id, rate_percent: rate },
  });

  return NextResponse.json({ success: true, rate });
}
