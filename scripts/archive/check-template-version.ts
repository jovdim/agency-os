/**
 * Smoke-test: confirm a template's DB row is at the expected version
 * after a push, and that the inlined HTML has the bits we expect.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local" });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

(async () => {
  const { data, error } = await sb
    .from("section_templates")
    .select("name, version")
    .eq("name", "gallery-04")
    .maybeSingle();
  if (error || !data) {
    console.log("✗ gallery-04 not found:", error?.message);
    process.exit(1);
  }
  console.log(`gallery-04 DB row version: v${data.version}`);

  const { data: html } = await sb.storage
    .from("section-templates")
    .download("gallery/gallery-04.html");
  if (!html) {
    console.log("✗ gallery-04 HTML not in storage");
    process.exit(1);
  }
  const body = await html.text();

  const checks = [
    { name: "data-type=video on video_url", regex: /data-field="video_url"[^>]*data-type="video"/ },
    { name: "data-group=media", regex: /data-group="media"/ },
    { name: "MutationObserver for live edit", regex: /new MutationObserver/ },
    { name: "Auto-thumbnail extractor", regex: /extractVideoThumbnail/ },
    { name: "JPEG 0.92 thumbnail quality", regex: /toDataURL\('image\/jpeg', 0\.92\)/ },
  ];
  for (const c of checks) {
    console.log(c.regex.test(body) ? `✓ ${c.name}` : `✗ MISSING: ${c.name}`);
  }
})();
