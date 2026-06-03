import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: ir } = await sb.from("invoice_requests").select("*").limit(1);
  if (ir && ir[0]) {
    console.log("invoice_requests columns:", Object.keys(ir[0]).join(", "));
  }
  const { data: inv } = await sb.from("invoices").select("*").limit(1);
  if (inv && inv[0]) {
    console.log("invoices columns:", Object.keys(inv[0]).join(", "));
  } else {
    console.log("invoices table empty or no row visible");
  }
  const { count: irCount } = await sb.from("invoice_requests").select("*", { count: "exact", head: true });
  const { count: invCount } = await sb.from("invoices").select("*", { count: "exact", head: true });
  console.log(`\ninvoice_requests rows: ${irCount}, invoices rows: ${invCount}`);
}
main();
