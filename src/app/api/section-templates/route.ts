import { NextRequest, NextResponse } from "next/server";
import { imageSize } from "image-size";
import { requireAuth } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseTemplateHtml } from "@/lib/templates/parser";

const VALID_CATEGORIES = [
  "nav",
  "hero",
  "about",
  "services",
  "gallery",
  "reviews",
  "faq",
  "cta",
  "contact",
  "footer",
  "map",
  // Subpage section kit — building blocks for inner/service-detail pages
  // (page hero, breadcrumb+intro, topical blocks, process, pricing, …).
  // The composer rail already exposes the "subpage" slot; this allowlist
  // lets the web upload UI accept them too (push-template.ts never gated
  // on this list).
  "subpage",
] as const;

type Category = (typeof VALID_CATEGORIES)[number];

function isCategory(s: string): s is Category {
  return (VALID_CATEGORIES as readonly string[]).includes(s);
}

// Per-category thumbnail aspect-ratio rules.
// ratio = width / height. Permissive bounds — IT shouldn't have to nail exact pixels,
// but a 16:9 hero shot uploaded to a "nav" slot will be caught.
const ASPECT_RULES: Record<
  Category | "tile",
  { minRatio: number; maxRatio: number; example: string }
> = {
  nav: { minRatio: 5, maxRatio: 20, example: "1200×100 (≈ 12:1)" },
  footer: { minRatio: 2.5, maxRatio: 9, example: "1200×200 (≈ 6:1)" },
  cta: { minRatio: 2, maxRatio: 9, example: "1200×200 (≈ 6:1) — wide banner" },
  hero: { minRatio: 1.2, maxRatio: 2.2, example: "1200×675 (16:9)" },
  about: { minRatio: 1.2, maxRatio: 2.2, example: "1200×675 (16:9)" },
  services: { minRatio: 1.2, maxRatio: 2.2, example: "1200×675 (16:9)" },
  gallery: { minRatio: 1.2, maxRatio: 2.2, example: "1200×675 (16:9)" },
  reviews: { minRatio: 1.2, maxRatio: 2.2, example: "1200×675 (16:9)" },
  faq: { minRatio: 1.2, maxRatio: 2.2, example: "1200×675 (16:9)" },
  contact: { minRatio: 1.2, maxRatio: 2.2, example: "1200×675 (16:9)" },
  map: { minRatio: 1.2, maxRatio: 2.2, example: "1200×675 (16:9)" },
  subpage: { minRatio: 1.2, maxRatio: 2.2, example: "1200×675 (16:9)" },
  tile: { minRatio: 1.2, maxRatio: 2.2, example: "1200×675 (16:9)" },
};

const MIN_THUMB_WIDTH = 600;

function validateThumbnailDimensions(
  buffer: ArrayBuffer,
  category: Category,
): { width: number; height: number } | { error: string } {
  let dims: { width?: number; height?: number };
  try {
    dims = imageSize(new Uint8Array(buffer));
  } catch {
    return { error: "Could not read image dimensions. Is it a valid PNG/JPG/WebP?" };
  }
  const w = dims.width;
  const h = dims.height;
  if (!w || !h) {
    return { error: "Could not read image dimensions. Is it a valid PNG/JPG/WebP?" };
  }
  if (w < MIN_THUMB_WIDTH) {
    return {
      error: `Thumbnail too small. Got ${w}×${h}, need at least ${MIN_THUMB_WIDTH}px wide. For ${category}, ${ASPECT_RULES[category].example}.`,
    };
  }
  const ratio = w / h;
  const rule = ASPECT_RULES[category];
  if (ratio < rule.minRatio || ratio > rule.maxRatio) {
    return {
      error: `Thumbnail aspect ratio is wrong for ${category}. Got ${w}×${h} (≈ ${ratio.toFixed(1)}:1). Expected: ${rule.example}.`,
    };
  }
  return { width: w, height: h };
}

const SELECT_COLS =
  "id, category, name, html_path, css_path, preview_image, placeholder_schema, tags, industry_hints, is_published, version, created_at, updated_at";

/**
 * GET /api/section-templates — list section templates, optionally filtered by category
 *
 * Query params:
 *   category?  one of nav|hero|about|...
 *   include_unpublished?  "true" to include drafts (tech/super admin only)
 */
export async function GET(req: NextRequest) {
  const { profile } = await requireAuth();
  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const includeUnpublished =
    url.searchParams.get("include_unpublished") === "true" &&
    ["tech_admin", "super_admin"].includes(profile.role);

  const admin = createAdminClient();
  let query = admin
    .from("section_templates")
    .select(SELECT_COLS)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (category && isCategory(category)) {
    query = query.eq("category", category);
  }
  if (!includeUnpublished) {
    query = query.eq("is_published", true);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ templates: data ?? [] });
}

/**
 * POST /api/section-templates — upload + register a section template
 * Auth: tech_admin or super_admin only
 *
 * Multipart form-data:
 *   file: the HTML file
 *   category?: override category (otherwise extracted from <!-- SECTION:X:start --> markers)
 *   name?: override name (otherwise derived from file name without .html)
 *   preview_image?: URL of an externally-hosted thumbnail
 *   tags?: comma-separated
 *   industry_hints?: comma-separated
 */
export async function POST(req: NextRequest) {
  const { profile } = await requireAuth();
  if (!["tech_admin", "super_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > 1 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Template HTML too large (max 1MB)" },
      { status: 400 },
    );
  }

  const html = await file.text();
  const parsed = parseTemplateHtml(html);

  const categoryRaw = (
    (form.get("category") as string | null) ||
    parsed.category ||
    ""
  ).toLowerCase();
  if (!categoryRaw || !isCategory(categoryRaw)) {
    return NextResponse.json(
      {
        error: `Could not determine category. Provide one of: ${VALID_CATEGORIES.join(", ")}, or include <!-- SECTION:X:start --> markers in the HTML.`,
      },
      { status: 400 },
    );
  }
  const category = categoryRaw;

  const nameRaw =
    (form.get("name") as string | null) ||
    file.name.replace(/\.html?$/i, "");
  const name = nameRaw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!name) {
    return NextResponse.json({ error: "Invalid template name" }, { status: 400 });
  }

  const tags = parseList(form.get("tags") as string | null);
  const industry_hints = parseList(form.get("industry_hints") as string | null);
  const thumbnail = form.get("thumbnail") as File | null;

  const admin = createAdminClient();

  // Upload HTML body
  const htmlPath = `${category}/${name}.html`;
  const { error: htmlUploadErr } = await admin.storage
    .from("section-templates")
    .upload(htmlPath, parsed.html, { contentType: "text/html", upsert: true });
  if (htmlUploadErr) {
    return NextResponse.json(
      { error: `HTML upload failed: ${htmlUploadErr.message}` },
      { status: 500 },
    );
  }

  // Upload CSS (if any)
  let cssPath: string | null = null;
  if (parsed.css.trim()) {
    cssPath = `${category}/${name}.css`;
    const { error: cssUploadErr } = await admin.storage
      .from("section-templates")
      .upload(cssPath, parsed.css, { contentType: "text/css", upsert: true });
    if (cssUploadErr) {
      return NextResponse.json(
        { error: `CSS upload failed: ${cssUploadErr.message}` },
        { status: 500 },
      );
    }
  }

  // Upsert template row (uniqueness is by category+name)
  const { data: existing } = await admin
    .from("section_templates")
    .select("id, version, preview_image")
    .eq("category", category)
    .eq("name", name)
    .maybeSingle();

  // Handle thumbnail upload + cleanup of old thumbnail on replace
  let preview_image: string | null = existing?.preview_image ?? null;
  if (thumbnail && thumbnail.size > 0) {
    if (thumbnail.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Thumbnail too large (max 5MB)" },
        { status: 400 },
      );
    }

    const thumbBuffer = await thumbnail.arrayBuffer();
    const dimsCheck = validateThumbnailDimensions(thumbBuffer, category);
    if ("error" in dimsCheck) {
      return NextResponse.json({ error: dimsCheck.error }, { status: 400 });
    }

    // Delete the old thumbnail first (so we don't orphan files in storage)
    if (existing?.preview_image) {
      const oldPath = extractStoragePath(existing.preview_image, "section-templates");
      if (oldPath) {
        await admin.storage.from("section-templates").remove([oldPath]);
      }
    }

    const ext = thumbnail.name.split(".").pop()?.toLowerCase() || "png";
    const thumbPath = `${category}/${name}-thumb-${Date.now()}.${ext}`;
    const { error: thumbErr } = await admin.storage
      .from("section-templates")
      .upload(thumbPath, thumbBuffer, {
        contentType: thumbnail.type,
        upsert: true,
      });
    if (thumbErr) {
      return NextResponse.json(
        { error: `Thumbnail upload failed: ${thumbErr.message}` },
        { status: 500 },
      );
    }
    const { data: thumbUrl } = admin.storage
      .from("section-templates")
      .getPublicUrl(thumbPath);
    preview_image = thumbUrl.publicUrl;
  }

  const row = {
    category,
    name,
    html_path: htmlPath,
    css_path: cssPath,
    preview_image,
    placeholder_schema: parsed.placeholderSchema,
    tags,
    industry_hints,
    is_published: true,
    version: existing ? existing.version + 1 : 1,
  };

  const warnings: string[] = [];
  const fieldCount = Object.keys(parsed.placeholderSchema).length;
  if (fieldCount === 0) {
    warnings.push(
      "No data-field attributes found in the section. Nothing will be editable on this template — the IT team needs to add data-field=\"...\" to the elements that should be editable.",
    );
  }
  if (!parsed.category) {
    warnings.push(
      `Could not auto-detect category from <!-- SECTION:X:start --> markers; defaulted to "${category}".`,
    );
  }

  if (existing) {
    const { data, error } = await admin
      .from("section_templates")
      .update(row)
      .eq("id", existing.id)
      .select(SELECT_COLS)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ template: data, replaced: true, warnings, field_count: fieldCount });
  }

  const { data, error } = await admin
    .from("section_templates")
    .insert(row)
    .select(SELECT_COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { template: data, replaced: false, warnings, field_count: fieldCount },
    { status: 201 },
  );
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Pulls the storage path out of a Supabase public URL.
 * e.g. "https://xxx.supabase.co/storage/v1/object/public/section-templates/hero/x-thumb.png"
 *      -> "hero/x-thumb.png"
 * Returns null if the URL doesn't look like a Supabase Storage URL for this bucket.
 */
function extractStoragePath(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}
