import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: npx tsx scripts/dump-template-html.ts <storage-path>");
    process.exit(1);
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data, error } = await sb.storage.from("section-templates").download(path);
  if (error || !data) {
    console.error("download failed:", error?.message);
    process.exit(1);
  }
  const text = await data.text();
  console.log(text);
}

main();
