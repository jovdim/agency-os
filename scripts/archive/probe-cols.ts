import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function probe(table: string, col: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { error } = await supabase.from(table).select(col).limit(1);
  if (error) {
    console.log(`✗ ${table}.${col}: ${error.message}`);
  } else {
    console.log(`✓ ${table}.${col} exists`);
  }
}

async function main() {
  await probe("sites", "requested_email_prefix");
  await probe("profiles", "business_email");
  await probe("profiles", "business_email_password");
  await probe("profiles", "company_name");
}
main();
