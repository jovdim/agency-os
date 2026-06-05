import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { PaymentsClient } from "./payments-client";

export const dynamic = "force-dynamic";

export default async function SuperPaymentsPage() {
  await requireRole("super_admin");
  const admin = createAdminClient();

  const { data: payments } = await admin
    .from("payments")
    .select(
      "*, profiles(full_name, company_name), sites(name), invoices(invoice_number, type)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const all = payments ?? [];
  const confirmed = all.filter((p) => p.status === "confirmed");
  const failed = all.filter((p) => p.status === "failed");

  // Total revenue = sum of confirmed payment amounts — the focal "good news"
  // metric the payments page leads with.
  const revenue = confirmed.reduce(
    (sum, p) => sum + (Number(p.amount) || 0),
    0,
  );

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

  return (
    <PaymentsClient
      payments={normalizedPayments}
      stats={{
        confirmed: confirmed.length,
        failed: failed.length,
        revenue,
      }}
    />
  );
}
