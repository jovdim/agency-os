import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePrice } from "@/lib/payments/proposal-utils";
import { generateVariableSymbol } from "@/lib/payments/bysquare";
import { PaymentsClient } from "./payments-client";

export const dynamic = "force-dynamic";

export default async function SuperPaymentsPage() {
  await requireRole("super_admin");
  const admin = createAdminClient();

  // Fetch payments and awaiting proposals in parallel
  const [{ data: payments }, { data: awaitingProposals }] = await Promise.all([
    admin
      .from("payments")
      .select(
        "*, profiles(full_name, company_name), sites(name), invoices(invoice_number, type)",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("proposals")
      .select(
        "id, slug, company_name, variable_symbol, discount_price, base_price, discount_expires_at, sent_at, contact_id, contacts(contact_person, email)",
      )
      .in("status", ["sent", "viewed"])
      .order("sent_at", { ascending: false }),
  ]);

  const all = payments ?? [];
  const confirmed = all.filter((p) => p.status === "confirmed");
  const failed = all.filter((p) => p.status === "failed");

  // Normalize payments for client component
  const normalizedPayments = all.map((p) => {
    const profile = p.profiles as {
      full_name: string;
      company_name: string | null;
    } | null;
    const site = p.sites as { name: string } | null;
    const invoiceArr = Array.isArray(p.invoices) ? p.invoices : [];
    const invoice = invoiceArr[0] as
      | { invoice_number: string; type: string }
      | undefined;
    return {
      id: p.id,
      profile_name: profile?.full_name ?? null,
      profile_company: profile?.company_name ?? null,
      site_name: site?.name ?? null,
      amount: p.amount ?? 0,
      status: p.status,
      invoice_number: invoice?.invoice_number ?? null,
      created_at: p.created_at,
    };
  });

  // Normalize awaiting proposals
  const normalizedAwaiting = (awaitingProposals ?? []).map((p: any) => {
    const contact = p.contacts as {
      contact_person: string | null;
      email: string | null;
    } | null;
    const vs = p.variable_symbol || generateVariableSymbol(p.id);
    const activePrice = getActivePrice({
      discount_price: p.discount_price,
      base_price: p.base_price,
      discount_expires_at: p.discount_expires_at,
    });
    return {
      id: p.id,
      company_name: p.company_name,
      variable_symbol: vs,
      active_price: activePrice,
      discount_price: p.discount_price,
      base_price: p.base_price,
      discount_expires_at: p.discount_expires_at,
      sent_at: p.sent_at,
      contact_person: contact?.contact_person ?? null,
      contact_email: contact?.email ?? null,
    };
  });

  return (
    <PaymentsClient
      payments={normalizedPayments}
      awaiting={normalizedAwaiting}
      stats={{
        confirmed: confirmed.length,
        pending: normalizedAwaiting.length,
        failed: failed.length,
      }}
    />
  );
}
