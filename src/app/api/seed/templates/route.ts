import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import fs from "fs";
import path from "path";

/**
 * POST /api/seed/templates — Seed 3 starter templates.
 * Super admin only. Reads template files from starter-templates/ directory,
 * inserts DB records, and uploads design files to Supabase Storage.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = user.app_metadata?.role as string;
  if (role !== "super_admin") {
    return NextResponse.json(
      { error: "Super admin access required" },
      { status: 403 },
    );
  }

  const admin = createAdminClient();

  const templates = [
    {
      name: "Plumber Pro",
      industry: "Plumbing",
      design_variant: "modern-dark",
      description:
        "Professional plumbing business template with navy blue and gold accent. Features hero, about, services grid, gallery, testimonials, and contact sections.",
      folder: "plumber",
      colorScheme: { primary: "#1e3a5f", accent: "#f0a500" },
    },
    {
      name: "Ristorante Classico",
      industry: "Restaurant",
      design_variant: "warm-classic",
      description:
        "Elegant restaurant template with warm cream and deep red palette. Includes menu section with prices, photo gallery, reviews, and reservation CTA.",
      folder: "restaurant",
      colorScheme: { primary: "#8b0000", accent: "#d4a017" },
    },
    {
      name: "Beauty Studio",
      industry: "Beauty Salon",
      design_variant: "soft-modern",
      description:
        "Stylish beauty salon template with rose and purple theme. Service cards with pricing badges, frosted glass navigation, and portrait gallery.",
      folder: "salon",
      colorScheme: { primary: "#9b59b6", accent: "#e8a0bf" },
    },
  ];

  const results: { name: string; id?: string; error?: string }[] = [];
  const baseDir = path.join(process.cwd(), "starter-templates");

  for (const tpl of templates) {
    try {
      // Check if template with this name already exists
      const { data: existing } = await admin
        .from("templates")
        .select("id")
        .eq("name", tpl.name)
        .maybeSingle();

      if (existing) {
        results.push({
          name: tpl.name,
          id: existing.id,
          error: "Already exists — skipped",
        });
        continue;
      }

      // Read content.json for the content_schema
      const contentPath = path.join(baseDir, tpl.folder, "content.json");
      const contentSchema = JSON.parse(fs.readFileSync(contentPath, "utf-8"));

      // Insert template record
      const { data: record, error: insertErr } = await admin
        .from("templates")
        .insert({
          name: tpl.name,
          industry: tpl.industry,
          design_variant: tpl.design_variant,
          description: tpl.description,
          content_schema: contentSchema,
          color_scheme: tpl.colorScheme,
          storage_path: `templates/pending`, // Will update after ID is known
          is_active: true,
        })
        .select("id")
        .single();

      if (insertErr || !record) {
        results.push({
          name: tpl.name,
          error: insertErr?.message || "Insert failed",
        });
        continue;
      }

      const templateId = record.id;

      // Update storage_path with actual ID
      await admin
        .from("templates")
        .update({ storage_path: `templates/${templateId}` })
        .eq("id", templateId);

      // Upload design files
      const files = [
        { name: "index.html", contentType: "text/html" },
        { name: "style.css", contentType: "text/css" },
        { name: "script.js", contentType: "application/javascript" },
      ];

      for (const f of files) {
        const filePath = path.join(baseDir, tpl.folder, f.name);
        if (!fs.existsSync(filePath)) continue;

        const content = fs.readFileSync(filePath);
        const storagePath = `${templateId}/${f.name}`;

        const { error: uploadErr } = await admin.storage
          .from("templates")
          .upload(storagePath, content, {
            contentType: f.contentType,
            upsert: true,
          });

        if (uploadErr) {
          console.error(
            `[Seed] Failed to upload ${storagePath}: ${uploadErr.message}`,
          );
        }
      }

      results.push({ name: tpl.name, id: templateId });
    } catch (e) {
      results.push({
        name: tpl.name,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ results });
}
