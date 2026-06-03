import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/upload
 * Uploads a file to Supabase Storage.
 * Auth: any authenticated user
 */
export async function POST(req: NextRequest) {
  const { profile } = await requireAuth();

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const bucket = (formData.get("bucket") as string) || "logos";

  // Only tech_admin+ can upload to proposals bucket
  if (bucket === "proposals" && !["tech_admin", "administrator", "super_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const customPath = formData.get("path") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // 10MB limit for site files, 2MB for others
  const maxSize = bucket === "proposals" ? 10 * 1024 * 1024 : 2 * 1024 * 1024;
  if (file.size > maxSize) {
    return NextResponse.json(
      { error: `File too large (max ${maxSize / (1024 * 1024)}MB)` },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Ensure bucket exists
  await admin.storage.createBucket(bucket, { public: true }).catch(() => {});

  // Use custom path if provided, otherwise generate unique filename
  let uploadPath: string;
  if (customPath) {
    uploadPath = customPath;
  } else {
    const ext = file.name.split(".").pop() || "png";
    uploadPath = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  }

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadErr } = await admin.storage
    .from(bucket)
    .upload(uploadPath, arrayBuffer, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadErr) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  const { data: urlData } = admin.storage.from(bucket).getPublicUrl(uploadPath);

  return NextResponse.json({ url: urlData.publicUrl });
}

/**
 * DELETE /api/upload
 * Deletes a file from Supabase Storage.
 * Body: { path: string, bucket: string }
 * Auth: tech_admin, administrator, super_admin
 */
export async function DELETE(req: NextRequest) {
  const { profile } = await requireAuth();
  if (!["tech_admin", "administrator", "super_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { path, bucket = "proposals" } = await req.json();
  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.storage.from(bucket).remove([path]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
