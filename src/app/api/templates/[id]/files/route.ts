import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED_FILES: Record<string, string> = {
  "index.html": "text/html",
  "style.css": "text/css",
  "script.js": "application/javascript",
};

/**
 * GET /api/templates/[id]/files — List template design files in Storage
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const admin = createAdminClient();

  const { data: files, error } = await admin.storage
    .from("templates")
    .list(id, { limit: 20 });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Filter to known design files and add public URLs
  const designFiles = (files || [])
    .filter((f) => f.name in ALLOWED_FILES || f.name.startsWith("thumbnail"))
    .map((f) => {
      const { data } = admin.storage
        .from("templates")
        .getPublicUrl(`${id}/${f.name}`);
      return {
        name: f.name,
        size: f.metadata?.size || 0,
        url: data.publicUrl,
        type: ALLOWED_FILES[f.name] || "application/octet-stream",
      };
    });

  return NextResponse.json({ files: designFiles });
}

/**
 * POST /api/templates/[id]/files — Upload template design files
 * Super admin only. Accepts multipart form data with html, css, js files.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (user.app_metadata?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  // Verify template exists
  const { data: template, error: templateErr } = await admin
    .from("templates")
    .select("id")
    .eq("id", id)
    .single();

  if (templateErr || !template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const formData = await req.formData();
  const uploaded: string[] = [];
  const errors: string[] = [];

  // Process thumbnail upload
  const thumbFile = formData.get("thumbnail") as File | null;
  if (thumbFile && thumbFile.size > 0) {
    const ext = thumbFile.name.split(".").pop() || "png";
    const thumbPath = `${id}/thumbnail.${ext}`;
    const buffer = Buffer.from(await thumbFile.arrayBuffer());
    const { error: thumbErr } = await admin.storage
      .from("templates")
      .upload(thumbPath, buffer, {
        contentType: thumbFile.type || "image/png",
        upsert: true,
      });
    if (thumbErr) {
      errors.push(`thumbnail: ${thumbErr.message}`);
    } else {
      uploaded.push(`thumbnail.${ext}`);
      // Update template record with new thumbnail URL
      const { data: urlData } = admin.storage
        .from("templates")
        .getPublicUrl(thumbPath);
      await admin
        .from("templates")
        .update({ thumbnail_path: urlData.publicUrl })
        .eq("id", id);
    }
  }

  // Process each design file
  for (const [fieldName, expectedFile] of [
    ["html_file", "index.html"],
    ["css_file", "style.css"],
    ["js_file", "script.js"],
  ] as const) {
    const file = formData.get(fieldName) as File | null;
    if (!file || file.size === 0) continue;

    const buffer = Buffer.from(await file.arrayBuffer());
    const storagePath = `${id}/${expectedFile}`;

    const { error: uploadErr } = await admin.storage
      .from("templates")
      .upload(storagePath, buffer, {
        contentType: ALLOWED_FILES[expectedFile],
        upsert: true,
      });

    if (uploadErr) {
      errors.push(`${expectedFile}: ${uploadErr.message}`);
    } else {
      uploaded.push(expectedFile);
    }
  }

  if (errors.length > 0 && uploaded.length === 0) {
    return NextResponse.json(
      { error: "Upload failed", details: errors },
      { status: 500 },
    );
  }

  return NextResponse.json({
    uploaded,
    errors: errors.length > 0 ? errors : undefined,
  });
}
