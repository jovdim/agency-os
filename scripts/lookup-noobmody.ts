import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // testonelastime site
  const { data: site } = await sb
    .from("sites")
    .select("id, name, slug, owner_id")
    .eq("id", "b64eadfe-a971-496d-8dd2-705bba3b75be")
    .single();
  console.log("testonelastime site:", site);

  if (!site?.owner_id) return;

  const { data: profile } = await sb
    .from("profiles")
    .select("id, full_name, company_name, role, is_active")
    .eq("id", site.owner_id)
    .single();
  console.log("owner profile:", profile);

  const { data: userRes } = await sb.auth.admin.getUserById(site.owner_id);
  console.log("owner email:", userRes?.user?.email);

  const { data: sites } = await sb
    .from("sites")
    .select("id, name, slug, status, created_at")
    .eq("owner_id", site.owner_id);
  console.log("all sites for owner:", sites);

  const { data: proposals } = await sb
    .from("proposals")
    .select("id, slug, company_name, status, sales_person_id")
    .eq("sales_person_id", site.owner_id);
  console.log("proposals where owner is sales_person:", proposals);
}
main().catch(console.error);
