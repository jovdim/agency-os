/**
 * Download the about-08 HTML from Supabase Storage and confirm the
 * <span data-field="bullet"> wrap is actually there (not stale).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data: blob } = await supabase.storage
    .from("section-templates")
    .download("about/about-08.html");
  if (!blob) {
    console.log("no blob");
    return;
  }
  const html = await blob.text();
  const lines = html.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("data-field=\"bullet\"")) {
      console.log(`line ${i + 1}: ${lines[i].trim()}`);
    }
  }
}
main();
