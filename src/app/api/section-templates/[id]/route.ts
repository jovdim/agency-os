import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

const SELECT_COLS =
  "id, category, name, html_path, css_path, preview_image, placeholder_schema, tags, industry_hints, is_published, version, created_at, updated_at";

/**
 * GET /api/section-templates/[id] — fetch one template (with html body inlined)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAuth();
  const { id } = await params;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("section_templates")
    .select(SELECT_COLS)
    .eq("id", id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  // Fetch the HTML body from storage so callers don't need a second roundtrip
  const { data: htmlBlob, error: htmlErr } = await admin.storage
    .from("section-templates")
    .download(data.html_path);

  if (htmlErr) {
    return NextResponse.json({ template: data, html: null });
  }
  const html = await htmlBlob.text();

  let css: string | null = null;
  if (data.css_path) {
    const { data: cssBlob } = await admin.storage
      .from("section-templates")
      .download(data.css_path);
    if (cssBlob) css = await cssBlob.text();
  }

  return NextResponse.json({ template: data, html, css });
}

/**
 * PATCH /api/section-templates/[id] — update metadata (publish/unpublish, tags, preview, industry hints)
 * Auth: tech_admin or super_admin only
 *
 * Body: { is_published?, tags?, industry_hints?, preview_image? }
 * To replace HTML, POST a new file at /api/section-templates (idempotent on category+name).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { profile } = await requireAuth();
  if (!["tech_admin", "super_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json()) as Partial<{
    is_published: boolean;
    tags: string[];
    industry_hints: string[];
    preview_image: string | null;
  }>;

  const update: Record<string, unknown> = {};
  if (typeof body.is_published === "boolean") update.is_published = body.is_published;
  if (Array.isArray(body.tags)) update.tags = body.tags;
  if (Array.isArray(body.industry_hints)) update.industry_hints = body.industry_hints;
  if (body.preview_image !== undefined) update.preview_image = body.preview_image;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("section_templates")
    .update(update)
    .eq("id", id)
    .select(SELECT_COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

/**
 * DELETE /api/section-templates/[id] — remove a template (and its files)
 * Auth: tech_admin or super_admin
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { profile } = await requireAuth();
  if (!["tech_admin", "super_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { data: tpl } = await admin
    .from("section_templates")
    .select("html_path, css_path, preview_image")
    .eq("id", id)
    .single();

  if (tpl) {
    const filesToRemove: string[] = [];
    if (tpl.html_path) filesToRemove.push(tpl.html_path);
    if (tpl.css_path) filesToRemove.push(tpl.css_path);
    if (tpl.preview_image) {
      const thumbPath = extractStoragePath(tpl.preview_image, "section-templates");
      if (thumbPath) filesToRemove.push(thumbPath);
    }
    if (filesToRemove.length > 0) {
      await admin.storage.from("section-templates").remove(filesToRemove);
    }
  }

  const { error } = await admin.from("section_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

function extractStoragePath(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}
