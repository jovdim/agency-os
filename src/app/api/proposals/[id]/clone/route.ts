import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/proposals/[id]/clone
 * Clone files from a completed proposal into a target proposal's storage.
 * This allows tech admin to reuse an existing design as a starting point.
 * Auth: tech_admin, administrator, super_admin
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { profile } = await requireAuth();
  const role = profile.role;

  if (!["tech_admin", "administrator", "super_admin"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: sourceId } = await params;
  const body = await req.json();
  const { target_proposal_id } = body as { target_proposal_id: string };

  if (!target_proposal_id) {
    return NextResponse.json(
      { error: "target_proposal_id is required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Verify source proposal exists
  const { data: source } = await admin
    .from("proposals")
    .select("id, company_name")
    .eq("id", sourceId)
    .single();

  if (!source) {
    return NextResponse.json(
      { error: "Source proposal not found" },
      { status: 404 },
    );
  }

  // Verify target proposal exists and is in a buildable state
  const { data: target } = await admin
    .from("proposals")
    .select("id, status")
    .eq("id", target_proposal_id)
    .single();

  if (!target) {
    return NextResponse.json(
      { error: "Target proposal not found" },
      { status: 404 },
    );
  }

  if (!["submitted", "building", "revision"].includes(target.status)) {
    return NextResponse.json(
      { error: "Target proposal must be in submitted, building, or revision status" },
      { status: 400 },
    );
  }

  try {
    const sourcePath = `${sourceId}/site`;
    const targetPath = `${target_proposal_id}/site`;

    // List files in source
    const { data: files, error: listError } = await admin.storage
      .from("proposals")
      .list(sourcePath);

    if (listError || !files || files.length === 0) {
      return NextResponse.json(
        { error: "No files found in source proposal" },
        { status: 404 },
      );
    }

    const copiedFiles: string[] = [];

    // Download and re-upload each file
    for (const file of files) {
      if (file.name === ".emptyFolderPlaceholder") continue;

      const { data: fileData } = await admin.storage
        .from("proposals")
        .download(`${sourcePath}/${file.name}`);

      if (!fileData) continue;

      const { error: uploadError } = await admin.storage
        .from("proposals")
        .upload(`${targetPath}/${file.name}`, fileData, {
          upsert: true,
          contentType: file.metadata?.mimetype || "application/octet-stream",
        });

      if (!uploadError) {
        copiedFiles.push(file.name);
      }
    }

    return NextResponse.json({
      success: true,
      copied_files: copiedFiles,
      source: source.company_name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Clone failed:", message);
    return NextResponse.json(
      { error: "Clone failed", details: message },
      { status: 500 },
    );
  }
}
