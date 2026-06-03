import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { BalanceClient } from "./balance-client";

export const dynamic = "force-dynamic";

export default async function ClientBalancePage() {
  const { profile } = await requireRole("client");
  const supabase = await createClient();

  // Three parallel lookups — all only need profile.id. Used to run
  // sequentially for no reason.
  const [
    { data: sites },
    { data: transactions },
    { data: payments },
  ] = await Promise.all([
    supabase
      .from("sites")
      .select("id, name, status, credit_balances(balance)")
      .eq("owner_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("credit_transactions")
      .select("*, sites(name)")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("payments")
      .select("*, sites(name), invoices(id, invoice_number)")
      .eq("profile_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <BalanceClient
      sites={sites ?? []}
      transactions={transactions ?? []}
      payments={payments ?? []}
    />
  );
}
