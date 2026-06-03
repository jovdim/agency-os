/**
 * Shared loader for the live-client detail page.
 *
 * All three role wrappers (/super, /tech, /sales/live-clients/[id])
 * fetch the same rows with the same joins; the only differences are
 * (a) the role guard at the server-page level, and (b) sales' extra
 * authorization check that gates access to own-organic OR migrated
 * proposals.
 *
 * Returns null only when the proposal doesn't exist. Used to gate on
 * status='paid' too — relaxed 2026-05-20 so the staff-side domain +
 * business-email request UI (`Setup` section inside the Site card)
 * also renders on not-yet-paid proposals. Reason: a client may pay
 * externally and tech sets up domain/email FIRST, then marks paid.
 *
 * Non-paid proposals will return real Site card data but empty
 * Payment / Credits / journey data — those cards already handle null
 * fields with "—" placeholders so the unpaid view degrades cleanly.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { ClientDetailData } from "./client-detail-client";

export async function loadClientDetail(
  proposalId: string,
): Promise<ClientDetailData | null> {
  const admin = createAdminClient();

  const { data: proposal } = await admin
    .from("proposals")
    .select(
      `
        id,
        slug,
        company_name,
        status,
        paid_at,
        created_at,
        base_price,
        discount_price,
        price,
        is_migrated,
        sales_person_id,
        client_temp_password,
        contacts(contact_person, email, phone, town, industry, business_email),
        sites(id, subdomain, domain, domain_status, requested_domain, domain_auth_code, requested_email_prefix, owner_id, last_published_at, site_url, credit_balances(balance))
      `,
    )
    .eq("id", proposalId)
    .maybeSingle();

  if (!proposal) return null;
  // Gate relaxed 2026-05-20: previously returned null when status !==
  // "paid" so the live-client detail was strictly for paying clients.
  // We now also surface unpaid proposals because the staff-side domain
  // + business-email request UI lives inside the Site card and tech /
  // sales need to access it before payment too. Sales-side scoping
  // still blocks non-paid via salesCanViewProposal below.

  const contact = Array.isArray(proposal.contacts)
    ? proposal.contacts[0]
    : proposal.contacts;
  const site = Array.isArray(proposal.sites)
    ? proposal.sites[0]
    : proposal.sites;

  // ── Payments (sum confirmed) ──
  const { data: payments } = await admin
    .from("payments")
    .select("amount, status, payment_method")
    .eq("proposal_id", proposalId);
  const confirmed = (payments ?? []).filter((p) => p.status === "confirmed");
  const totalPaid = confirmed.reduce(
    (s, p) => s + Number(p.amount ?? 0),
    0,
  );
  // Pick the first confirmed payment's method as the display value —
  // multi-method splits are rare enough that showing the primary is
  // fine for an admin overview. Detailed payment history lives in
  // /super/payments for the corner cases.
  const primaryMethod = confirmed[0]?.payment_method ?? null;

  // ── Invoice number (latest for this site) ──
  let invoiceNumber: string | null = null;
  if (site?.id) {
    const { data: invoice } = await admin
      .from("invoices")
      .select("invoice_number")
      .eq("site_id", site.id)
      .order("issued_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    invoiceNumber = invoice?.invoice_number ?? null;
  }

  // ── Salesperson name (only for organic rows) ──
  let salespersonName: string | null = null;
  if (!proposal.is_migrated && proposal.sales_person_id) {
    const { data: sp } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", proposal.sales_person_id)
      .maybeSingle();
    salespersonName = sp?.full_name ?? null;
  }

  // ── Credit balance ──
  // sites.credit_balances joins one-to-one in practice; pick the
  // first if the typings happen to return an array.
  const creditBalances = site && "credit_balances" in site
    ? (site as { credit_balances?: { balance: number } | { balance: number }[] }).credit_balances
    : null;
  const creditRecord = Array.isArray(creditBalances)
    ? creditBalances[0]
    : creditBalances;
  const creditBalance = Number(creditRecord?.balance ?? 0);

  // Final amount paid — prefer summed confirmed payments, fall back
  // to the proposal's price fields when no payment row was written
  // (defensive: shouldn't happen on migrated rows since the API
  // creates a payment, but legacy paths might skip).
  const amountPaid =
    totalPaid > 0
      ? totalPaid
      : Number(proposal.price ?? proposal.discount_price ?? proposal.base_price ?? 0);

  // ── Active services (ongoing subscriptions) ──
  // services row per ongoing thing we're providing — hosting, custom
  // domain, business email, SEO, etc. Filtered to is_active so soft-
  // deleted rows stay archived but don't show up on the dashboard.
  // Order by created_at so additions land at the bottom of the card.
  let activeServices: ClientDetailData["services_active"] = [];
  if (site?.id) {
    const { data: svcRows } = await admin
      .from("services")
      .select("id, type, name, price, starts_at")
      .eq("site_id", site.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    activeServices = (svcRows ?? []).map((r) => ({
      id: r.id,
      type: r.type ?? "custom",
      name: r.name ?? "",
      price: r.price != null ? Number(r.price) : null,
      starts_at: r.starts_at ?? null,
    }));
  }

  // Provisioned business email + password live on the owner's profile
  // (set by tech when sending the Hostinger creds). Look it up here so
  // the Site card can show "email_ready" state without a second round-
  // trip from the client component. Skipped when no owner yet.
  let provisionedBusinessEmail: string | null = null;
  if (site?.owner_id) {
    const { data: ownerProfile } = await admin
      .from("profiles")
      .select("business_email")
      .eq("id", site.owner_id)
      .maybeSingle();
    provisionedBusinessEmail = ownerProfile?.business_email ?? null;
  }

  return {
    proposal_id: proposal.id,
    site_id: site?.id ?? null,
    company_name: proposal.company_name ?? "Unknown",
    contact_person: contact?.contact_person ?? null,
    email: contact?.email ?? null,
    phone: contact?.phone ?? null,
    town: contact?.town ?? null,
    industry: contact?.industry ?? null,
    business_email: contact?.business_email ?? null,
    subdomain: site?.subdomain ?? null,
    custom_domain: site?.domain ?? null,
    domain_status: site?.domain_status ?? null,
    requested_domain:
      (site as { requested_domain?: string | null })?.requested_domain ?? null,
    domain_auth_code:
      (site as { domain_auth_code?: string | null })?.domain_auth_code ?? null,
    requested_email_prefix:
      (site as { requested_email_prefix?: string | null })?.requested_email_prefix ??
      null,
    provisioned_business_email: provisionedBusinessEmail,
    amount_paid: amountPaid,
    // No fallback to created_at: that was harmless when this loader
    // was paid-only (paid_at was always set), but since 2026-05-20
    // the gate was dropped and unpaid proposals can flow through.
    // Falling back to created_at would render the proposal-creation
    // date as if it were a payment date on the Payment card, which
    // is wrong. Show null instead — the "—" placeholder reads as
    // "no payment recorded".
    paid_at: proposal.paid_at ?? null,
    invoice_number: invoiceNumber,
    payment_method: primaryMethod,
    is_migrated: proposal.is_migrated ?? false,
    last_published_at: site?.last_published_at ?? null,
    current_password: proposal.client_temp_password ?? null,
    salesperson: salespersonName,
    credit_balance: creditBalance,
    proposal_slug: proposal.slug ?? null,
    services_active: activeServices,
  };
}

/**
 * Sales-side authorization check — sales can only view OWN organic
 * proposals OR any migrated row. Used by /sales/live-clients/[id].
 */
export async function salesCanViewProposal(
  proposalId: string,
  salesPersonId: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("proposals")
    .select("sales_person_id, is_migrated, status")
    .eq("id", proposalId)
    .maybeSingle();
  if (!data) return false;
  if (data.status !== "paid") return false;
  if (data.is_migrated === true) return true;
  return data.sales_person_id === salesPersonId;
}
