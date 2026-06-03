import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/templates — List templates
 * All authenticated users can see active templates.
 * Super admin can also see inactive ones.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = user.app_metadata?.role as string;
  const industry = req.nextUrl.searchParams.get("industry");

  const admin = createAdminClient();
  let query = admin
    .from("templates")
    .select("*")
    .order("created_at", { ascending: false });

  // Non-super_admin only sees active templates
  if (role !== "super_admin") {
    query = query.eq("is_active", true);
  }

  if (industry) {
    query = query.eq("industry", industry);
  }

  const { data, error } = await query;

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ templates: data });
}

/**
 * POST /api/templates — Create a new template
 * Super admin only. Accepts multipart form data.
 */
export async function POST(req: NextRequest) {
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

  const formData = await req.formData();
  const name = formData.get("name") as string;
  const industry = formData.get("industry") as string;
  const designVariant = (formData.get("design_variant") as string) || "default";
  const description = formData.get("description") as string | null;
  const contentJson = formData.get("content_json") as string;
  const thumbnail = formData.get("thumbnail") as File | null;
  const colorSchemeRaw = formData.get("color_scheme") as string | null;
  const htmlFile = formData.get("html_file") as File | null;
  const cssFile = formData.get("css_file") as File | null;
  const jsFile = formData.get("js_file") as File | null;

  if (!name || !industry || !contentJson) {
    return NextResponse.json(
      { error: "Name, industry, and content_json are required" },
      { status: 400 },
    );
  }

  // Parse and validate content.json
  let contentSchema: { sections: Record<string, unknown>[] };
  try {
    const parsed = JSON.parse(contentJson);
    if (parsed.sections && Array.isArray(parsed.sections)) {
      contentSchema = parsed;
    } else if (Array.isArray(parsed)) {
      contentSchema = { sections: parsed };
    } else {
      return NextResponse.json(
        { error: "Invalid content.json: must have a sections array" },
        { status: 400 },
      );
    }

    for (let i = 0; i < contentSchema.sections.length; i++) {
      if (!contentSchema.sections[i].type) {
        return NextResponse.json(
          { error: `Section ${i + 1} is missing a 'type' field` },
          { status: 400 },
        );
      }
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON format" }, { status: 400 });
  }

  let colorScheme = null;
  if (colorSchemeRaw) {
    try {
      colorScheme = JSON.parse(colorSchemeRaw);
    } catch {
      /* ignore invalid color scheme */
    }
  }

  const admin = createAdminClient();

  // Generate storage path
  const tempId = crypto.randomUUID();
  const storagePath = `templates/${tempId}`;

  // Upload thumbnail if provided
  let thumbnailPath: string | null = null;
  if (thumbnail && thumbnail.size > 0) {
    const ext = thumbnail.name.split(".").pop() || "png";
    const thumbStoragePath = `${storagePath}/thumbnail.${ext}`;
    const buffer = Buffer.from(await thumbnail.arrayBuffer());

    const { error: uploadError } = await admin.storage
      .from("templates")
      .upload(thumbStoragePath, buffer, {
        contentType: thumbnail.type,
        upsert: true,
      });

    if (!uploadError) {
      const { data: urlData } = admin.storage
        .from("templates")
        .getPublicUrl(thumbStoragePath);
      thumbnailPath = urlData.publicUrl;
    }
  }

  // Insert template row
  const { data: template, error: insertError } = await admin
    .from("templates")
    .insert({
      name,
      industry,
      design_variant: designVariant,
      storage_path: storagePath,
      thumbnail_path: thumbnailPath,
      color_scheme: colorScheme,
      description,
      content_schema: contentSchema,
      is_active: true,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Upload design files (index.html, style.css, script.js) to Storage
  const templateId = template.id;
  const designFiles: [File | null, string, string][] = [
    [htmlFile, "index.html", "text/html"],
    [cssFile, "style.css", "text/css"],
    [jsFile, "script.js", "application/javascript"],
  ];

  for (const [file, filename, contentType] of designFiles) {
    if (!file || file.size === 0) continue;
    const buffer = Buffer.from(await file.arrayBuffer());
    await admin.storage
      .from("templates")
      .upload(`${templateId}/${filename}`, buffer, {
        contentType,
        upsert: true,
      });
  }

  return NextResponse.json({ template }, { status: 201 });
}
