import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/proposals — List proposals
 * Sales see own proposals; admin/super see all.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = user.app_metadata?.role as string;
  const status = req.nextUrl.searchParams.get("status");

  const admin = createAdminClient();
  let query = admin
    .from("proposals")
    .select(
      "*, templates(name, industry, thumbnail_path), contacts(company_name, contact_person)",
    )
    .order("created_at", { ascending: false });

  // Sales see only own proposals
  if (role === "sales") {
    query = query.eq("sales_person_id", user.id);
  }

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ proposals: data });
}

/**
 * POST /api/proposals — Create a new proposal
 * Sales, administrator, or super_admin can create.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = user.app_metadata?.role as string;
  if (!["sales", "tech_admin", "administrator", "super_admin"].includes(role)) {
    return NextResponse.json(
      { error: "Access denied" },
      { status: 403 },
    );
  }

  const body = await req.json();
  const {
    contact_id,
    company_name,
    industry,
    town,
    services,
    price,
    base_price,
    requirements,
    /**
     * Optional tag_ids attached at proposal-creation time. When omitted,
     * the API auto-attaches the seeded "basic" tag so the IT side always
     * sees a priority signal even if the salesperson didn't pick one.
     * Sales can change tags later from the Active section.
     */
    tag_ids,
  } = body;
  const tagIdsRaw: unknown = tag_ids;

  if (!company_name) {
    return NextResponse.json(
      { error: "company_name is required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // If tech admin creates proposal, set sales_person_id to the contact's assigned salesperson
  let salesPersonId = user.id;
  if (role === "tech_admin" && contact_id) {
    const { data: contact } = await admin
      .from("contacts")
      .select("assigned_to")
      .eq("id", contact_id)
      .single();
    if (contact?.assigned_to) {
      salesPersonId = contact.assigned_to;
    }
  }

  // Generate unique slug
  const baseSlug = company_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const randomSuffix = Math.random().toString(36).slice(2, 6);
  const slug = `${baseSlug}-${randomSuffix}`;

  const { data: proposal, error: insertError } = await admin
    .from("proposals")
    .insert({
      slug,
      contact_id: contact_id || null,
      sales_person_id: salesPersonId,
      built_by: role === "tech_admin" ? user.id : null,
      company_name,
      industry: industry || null,
      town: town || null,
      services: services || [],
      content_overrides: { sections: [] },
      status: "submitted",
      price: price != null && !isNaN(Number(price)) ? Number(price) : null,
      discount_price: price != null && !isNaN(Number(price)) ? Number(price) : null,
      base_price: base_price != null && !isNaN(Number(base_price)) ? Number(base_price) : 299,
      requirements: requirements || null,
    })
    .select(
      "*, contacts(company_name, contact_person)",
    )
    .single();

  if (insertError) {
    console.error("Proposal insert error:", insertError);
    return NextResponse.json({ error: insertError.message, details: insertError.details, hint: insertError.hint }, { status: 500 });
  }

  // ─── Tag attachment ───
  // If the caller passed an explicit list of tag_ids we use that; otherwise
  // we auto-attach the seeded "basic" tag so IT always knows the priority
  // tier. Failures here are logged but don't fail the request — a proposal
  // without tags is still usable, and Sales can fix from the Active row.
  let tagIdsToAttach: string[] = [];
  if (Array.isArray(tagIdsRaw) && tagIdsRaw.length > 0) {
    tagIdsToAttach = tagIdsRaw.filter((t): t is string => typeof t === "string" && t.length > 0);
  } else {
    const { data: basicTag } = await admin
      .from("proposal_tags")
      .select("id")
      .eq("slug", "basic")
      .maybeSingle();
    if (basicTag?.id) tagIdsToAttach = [basicTag.id];
  }

  if (tagIdsToAttach.length > 0) {
    const { error: tagErr } = await admin
      .from("proposal_tag_assignments")
      .insert(
        tagIdsToAttach.map(tag_id => ({
          proposal_id: proposal.id,
          tag_id,
          assigned_by: user.id,
        })),
      );
    if (tagErr) {
      console.error("Proposal tag attach error (non-fatal):", tagErr);
    }
  }

  return NextResponse.json({ proposal }, { status: 201 });
}
