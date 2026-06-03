import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  async function dl(p: string) {
    const { data } = await sb.storage.from("section-templates").download(p);
    return data ? await data.text() : "";
  }

  const html08 = await dl("services/services-08.html");
  const css08 = await dl("services/services-08.css");
  console.log("services-08.html — chevron buttons:", (html08.match(/services-08__more/g) || []).length, "occurrences");
  console.log("services-08.html — <script> tag present:", html08.includes("<script>"));
  console.log("services-08.css — .is-expanded rule:", css08.includes("is-expanded"));
  console.log("services-08.css — mobile max-height:", css08.includes("max-height: 8em"));
  console.log("services-08.css — chevron .services-08__more rule:", css08.includes(".services-08__more"));
  console.log("---");
  const html09 = await dl("services/services-09.html");
  const css09 = await dl("services/services-09.css");
  console.log("services-09.html — chevron buttons:", (html09.match(/services-09__more/g) || []).length, "occurrences");
  console.log("services-09.html — <script> tag present:", html09.includes("<script>"));
  console.log("services-09.css — .is-expanded rule:", css09.includes("is-expanded"));
  console.log("services-09.css — chevron .services-09__more rule:", css09.includes(".services-09__more"));
}

main();
