/**
 * Inspect a proposal's banner-relevant state: QR cache, prices, show_banner,
 * site subdomain. Helps debug "QR not showing" symptoms by surfacing
 * what the public data endpoint will return.
 *
 * Usage: npx tsx scripts/inspect-proposal-banner.ts <proposal-id>
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: <proposal-id>");
    process.exit(1);
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: p, error } = await supabase
    .from("proposals")
    .select(
      "id, slug, status, show_banner, base_price, discount_price, discount_expires_at, qr_cached_amount, qr_image_cache, variable_symbol, company_name",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !p) {
    console.error("not found:", error?.message);
    process.exit(1);
  }
  console.log("proposal:", p.id, "→", p.company_name);
  console.log("status              :", p.status);
  console.log("show_banner         :", p.show_banner);
  console.log("base_price          :", p.base_price);
  console.log("discount_price      :", p.discount_price);
  console.log("discount_expires_at :", p.discount_expires_at);
  console.log("qr_cached_amount    :", p.qr_cached_amount);
  console.log(
    "qr_image_cache      :",
    p.qr_image_cache
      ? `${p.qr_image_cache.slice(0, 40)}… (${p.qr_image_cache.length} chars)`
      : "NULL",
  );
  console.log("variable_symbol     :", p.variable_symbol);
  console.log("slug                :", p.slug);

  // site
  const { data: site } = await supabase
    .from("sites")
    .select("id, name, slug, last_published_at, is_paid")
    .eq("proposal_id", id)
    .maybeSingle();
  console.log("\nsite:", site);

  // Try the public data endpoint (locally)
  const localUrl = `http://localhost:3000/api/public/proposals/${p.slug}/data`;
  console.log("\nfetching public data endpoint locally…");
  console.log("→", localUrl);
  try {
    const res = await fetch(localUrl);
    const json = await res.json();
    console.log("status:", res.status);
    console.log("active              :", json.active);
    console.log("activePrice         :", json.activePrice);
    console.log(
      "qrImageDataUrl      :",
      json.qrImageDataUrl
        ? `${json.qrImageDataUrl.slice(0, 40)}… (${json.qrImageDataUrl.length} chars)`
        : json.qrImageDataUrl === null
        ? "NULL"
        : "(missing)",
    );
    console.log("variableSymbol      :", json.variableSymbol);
  } catch (e) {
    console.log("local fetch failed:", (e as Error).message);
  }
}
main();
