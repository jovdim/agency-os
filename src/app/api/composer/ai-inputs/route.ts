import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/composer/ai-inputs?site_id=...
 *
 * Returns the prefilled values for the AI Generate modal: company
 * name, industry, town, and the salesperson's services list. The
 * modal renders these as editable fields so the tech can review +
 * tweak before hitting Generate.
 *
 * Auth: tech/super always; client when they own the site. Same gate
 * as /api/composer/ai-generate.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const siteId = req.nextUrl.searchParams.get("site_id");
  if (!siteId) {
    return NextResponse.json({ error: "site_id required" }, { status: 400 });
  }

  const role = user.app_metadata?.role as string | undefined;
  const admin = createAdminClient();

  // Resolve the site's proposal_id and verify access in one round trip.
  const { data: site } = await admin
    .from("sites")
    .select("id, name, owner_id, proposal_id")
    .eq("id", siteId)
    .maybeSingle();
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }
  // Sales sees its own proposals' inputs (added 2026-05-10 — shared
  // composer parity). Verified via the linked proposal's sales_person_id
  // since site.owner_id is typically the SALES user before client
  // handover anyway, but we want the *real* ownership signal here.
  let salesAllowed = false;
  if (role === "sales" && site.proposal_id) {
    const { data: linkedProposal } = await admin
      .from("proposals")
      .select("sales_person_id")
      .eq("id", site.proposal_id)
      .maybeSingle();
    salesAllowed =
      !!linkedProposal && linkedProposal.sales_person_id === user.id;
  }
  const isAllowed =
    role === "tech_admin" ||
    role === "super_admin" ||
    salesAllowed ||
    (role === "client" && site.owner_id === user.id);
  if (!isAllowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Default response shape , used when there's no proposal (e.g. a
  // standalone client site created via /tech/clients with no proposal
  // attached). The modal still renders, the user fills in everything
  // by hand.
  const fallback = {
    companyName: site.name ?? "",
    industry: "",
    town: "",
    services: [] as Array<{ title: string; description: string }>,
    // Brand-contact pre-fill values — empty when there's no linked
    // proposal contact. Composer reads these on first mount and stamps
    // them into composition.brand if brand.phone / brand.email are
    // still empty (i.e. the tech-admin hasn't typed their own yet).
    contactPhone: "",
    contactEmail: "",
  };

  if (!site.proposal_id) {
    return NextResponse.json({ inputs: fallback });
  }

  // Pull both proposal-level fields AND the linked contact's phone /
  // email in one query via Supabase's relational select. Same join
  // pattern other composer pages already use (the proposal's
  // contacts(business_email) join). business_email is the email that
  // should appear ON the website (contact form recipient); legacy
  // `email` is the lead-facing inbox we use for sales contact, so
  // business_email wins when both are set.
  const { data: proposal } = await admin
    .from("proposals")
    .select(
      "id, company_name, industry, town, services, contacts(phone, phones, email, business_email)",
    )
    .eq("id", site.proposal_id)
    .maybeSingle();
  if (!proposal) {
    return NextResponse.json({ inputs: fallback });
  }

  // proposals.services is stored as TEXT[] , just titles. The modal
  // gives the tech a description column they can fill in to give the
  // AI more signal per service. We start them with empty descriptions.
  const titles: string[] = Array.isArray(proposal.services)
    ? proposal.services
    : [];
  const services = titles.map((title) => ({ title, description: "" }));

  // contacts is returned as an array (Supabase relational shape) even
  // though contact_id is a single FK. Take [0] defensively.
  const contactRow = (proposal as { contacts?: unknown }).contacts;
  const contact = (Array.isArray(contactRow)
    ? contactRow[0]
    : contactRow) as
    | {
        phone?: string | null;
        phones?: string[] | null;
        email?: string | null;
        business_email?: string | null;
      }
    | undefined
    | null;

  // Phone resolution — prefer the newer multi-phone array (contacts.
  // phones[0] is the canonical primary in the broad-database schema),
  // fall back to the legacy single contacts.phone field. Empty string
  // when neither is set.
  const phoneFromArray =
    Array.isArray(contact?.phones) && contact.phones.length > 0
      ? (contact.phones[0] ?? "").trim()
      : "";
  const contactPhone = phoneFromArray || (contact?.phone ?? "").trim();

  // Email resolution — business_email is the website-facing inbox
  // (where contact-form submissions go). Fall back to lead email,
  // which is at least a real address even if it's the salesperson's
  // contact for the lead rather than the client's public address.
  const contactEmail =
    (contact?.business_email ?? "").trim() || (contact?.email ?? "").trim();

  return NextResponse.json({
    inputs: {
      companyName: proposal.company_name ?? site.name ?? "",
      industry: proposal.industry ?? "",
      town: proposal.town ?? "",
      services,
      contactPhone,
      contactEmail,
    },
  });
}
