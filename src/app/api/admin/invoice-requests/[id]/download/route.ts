/**
 * Generate a short-lived signed URL for an invoice request's PDF and
 * either redirect to it (GET) or return JSON with the URL.
 *
 * Auth: the salesperson who submitted the request, OR any tech_admin /
 * super_admin. Anyone else gets 403.
 *
 * Behaviour: ?json=1 returns { url, file_name } for inline embed; default
 * is a 302 redirect to the signed Storage URL (browsers download/preview
 * directly).
 *
 * Why a signed URL instead of a public bucket: invoices carry client
 * billing data and must not be world-readable. Signed URL expires in
 * 10 minutes — long enough for a download to start, short enough that a
 * leaked link goes stale fast.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

const SIGNED_URL_TTL_SECONDS = 600; // 10 minutes

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { profile } = await requireAuth();
  const { id: requestId } = await params;
  const admin = createAdminClient();

  // Fetch the request — need invoice_file_path + sales_person_id for
  // both the access check and the URL signing.
  const { data: request } = await admin
    .from("invoice_requests")
    .select(
      "id, sales_person_id, invoice_file_path, invoice_file_name, company_name",
    )
    .eq("id", requestId)
    .single();
  if (!request) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!request.invoice_file_path) {
    return NextResponse.json(
      { error: "No invoice file uploaded yet" },
      { status: 404 },
    );
  }

  // Access check: must be the requesting salesperson OR a tech_admin+
  const isOwner = profile.id === request.sales_person_id;
  const isStaff = ["tech_admin", "administrator", "super_admin"].includes(
    profile.role,
  );
  if (!isOwner && !isStaff) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Generate signed URL
  const { data: signed, error: signErr } = await admin.storage
    .from("invoices")
    .createSignedUrl(request.invoice_file_path, SIGNED_URL_TTL_SECONDS, {
      download: request.invoice_file_name ?? "invoice.pdf",
    });
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: `Could not generate URL: ${signErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  // ?json=1 → return JSON, otherwise 302 redirect to the signed URL
  const wantsJson = new URL(req.url).searchParams.get("json") === "1";
  if (wantsJson) {
    return NextResponse.json({
      url: signed.signedUrl,
      file_name: request.invoice_file_name,
      expires_in: SIGNED_URL_TTL_SECONDS,
    });
  }
  return NextResponse.redirect(signed.signedUrl);
}
