import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Try to use the project's existing exec helper if there is one.
  // Otherwise just run the SQL via the rest endpoint by checking for
  // a known RPC named exec_sql. Simplest path here: print the SQL so
  // Peter can run it via the Supabase SQL Editor — safer than blind
  // remote execution for the bucket / policy changes.
  const sql = readFileSync("supabase/migrations/00068_invoice_request_files.sql", "utf8");
  console.log("Migration SQL to apply (paste in Supabase Studio SQL editor):");
  console.log("=".repeat(60));
  console.log(sql);
  console.log("=".repeat(60));
  console.log("Or apply via: supabase db push (if local supabase-cli linked).");

  // Verify the columns + bucket land after Peter applies it.
  const { data: cols } = await sb
    .from("invoice_requests")
    .select("invoice_file_path")
    .limit(1);
  if (cols !== null) {
    const hasCol = cols[0] && "invoice_file_path" in cols[0];
    console.log(`\ncurrent state: invoice_file_path column exists = ${hasCol}`);
  }
}

main();
