import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile } = await requireRole("client");
  const supabase = await createClient();

  // Fetch payment with invoice
  const { data: payment } = await supabase
    .from("payments")
    .select("*, sites(name), invoices(*)")
    .eq("id", id)
    .eq("profile_id", profile.id)
    .single();

  if (!payment) notFound();

  const invoice = Array.isArray(payment.invoices)
    ? payment.invoices[0]
    : payment.invoices;
  if (!invoice) notFound();

  const lineItems = invoice.line_items as Array<{
    description: string;
    quantity: number;
    unit_price: number;
    vat_rate: number;
    total: number;
  }>;

  const subtotal = invoice.amount - invoice.vat_amount;
  const issuedAt = new Date(invoice.issued_at).toLocaleDateString("en-GB");
  const dueAt = new Date(
    new Date(invoice.issued_at).getTime() + 14 * 24 * 60 * 60 * 1000
  ).toLocaleDateString("en-GB");

  const companyName = process.env.INVOICE_COMPANY_NAME ?? "Your Agency Ltd.";
  const companyAddress = process.env.INVOICE_COMPANY_ADDRESS ?? "[Your Address]";
  const companyIco = process.env.INVOICE_COMPANY_ICO ?? "12345678";
  const companyDic = process.env.INVOICE_COMPANY_DIC ?? "SK12345678";
  const companyIban = process.env.INVOICE_COMPANY_IBAN ?? "SK00 0000 0000 0000 0000 0000";

  return (
    <div>
      {/* Print button (hidden when printing) */}
      <div className="mb-6 flex justify-end print:hidden">
        <Button
          variant="outline"
          onClick={() => window.print()}
          className="gap-2"
        >
          <Printer className="h-4 w-4" />
          Print / Save PDF
        </Button>
      </div>

      {/* Invoice */}
      <div className="max-w-2xl mx-auto bg-white dark:bg-card border rounded-lg p-10 text-sm print:border-none print:shadow-none print:p-0">
        {/* Header */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {invoice.type === "proforma" ? "Proforma Invoice" : "Invoice"}
            </h1>
            <p className="text-muted-foreground text-xs mt-1">
              {invoice.type === "proforma"
                ? "This is not a tax document."
                : "Tax document"}
            </p>
          </div>
          <div className="text-right">
            <p className="font-bold text-lg">{invoice.invoice_number}</p>
            <p className="text-xs text-muted-foreground">
              Issue date: {issuedAt}
            </p>
            <p className="text-xs text-muted-foreground">
              Due date: {dueAt}
            </p>
            {invoice.paid_at && (
              <p className="text-xs text-green-600 font-medium mt-1">
                PAID{" "}
                {new Date(invoice.paid_at).toLocaleDateString("en-GB")}
              </p>
            )}
          </div>
        </div>

        {/* Parties */}
        <div className="grid grid-cols-2 gap-8 mb-8">
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
              Supplier
            </p>
            <p className="font-semibold">{companyName}</p>
            <p className="text-muted-foreground">{companyAddress}</p>
            <p className="text-muted-foreground">Company ID: {companyIco}</p>
            <p className="text-muted-foreground">VAT ID: {companyDic}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
              Customer
            </p>
            <p className="font-semibold">{profile.full_name}</p>
            {profile.company_name && (
              <p className="text-muted-foreground">{profile.company_name}</p>
            )}
            <p className="text-muted-foreground">
              {payment.sites?.name
                ? `Site: ${payment.sites.name}`
                : ""}
            </p>
          </div>
        </div>

        {/* Line items */}
        <table className="w-full mb-6 text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 font-semibold">Description</th>
              <th className="text-right py-2 font-semibold">Quantity</th>
              <th className="text-right py-2 font-semibold">Unit price</th>
              <th className="text-right py-2 font-semibold">VAT</th>
              <th className="text-right py-2 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item, i) => (
              <tr key={i} className="border-b border-dashed">
                <td className="py-3">{item.description}</td>
                <td className="text-right py-3">{item.quantity}×</td>
                <td className="text-right py-3">${item.unit_price.toFixed(2)}</td>
                <td className="text-right py-3">{(item.vat_rate * 100).toFixed(0)}%</td>
                <td className="text-right py-3 font-medium">
                  ${item.total.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end mb-8">
          <div className="w-64 space-y-1">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal (excl. VAT)</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>VAT 20%</span>
              <span>${invoice.vat_amount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-base border-t pt-2 mt-2">
              <span>Total due</span>
              <span>${invoice.amount.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Bank details */}
        <div className="border-t pt-4 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground mb-1">Payment details</p>
          <p>IBAN: {companyIban}</p>
          <p>VS: {invoice.invoice_number.replace("-", "")}</p>
        </div>
      </div>
    </div>
  );
}
