import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { error } = await supabase
    .from("sites")
    .select("requested_email_prefix")
    .limit(1);
  if (error) {
    console.log("MIGRATION 00059 NOT APPLIED — column missing");
    console.log("Error:", error.message);
    process.exit(1);
  } else {
    console.log("Migration 00059 applied — column exists");
  }
}
main();
