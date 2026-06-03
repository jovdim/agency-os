import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderSitePage } from "@/lib/templates/render";

// Force every preview render to fetch fresh from storage. Without these the
// Next.js fetch layer can cache the Supabase storage downloads for templates,
// causing the in-CRM iframe to serve a STALE template even after we push a
// new version of the HTML/CSS. Symptom we hit 2026-05-13: editor showed
// new template, preview showed old.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/**
 * GET /api/sites/[id]/render?page=index.html&preview=true
 *
 * Renders a single page from the site's composition for the in-CRM preview iframe.
 * Returns full HTML.
 *
 * Auth: site owner (client viewing their own site) OR tech_admin/super_admin
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, profile } = await requireAuth();
  const { id } = await params;
  const url = new URL(req.url);
  const pagePath = url.searchParams.get("page") || undefined;
  const preview = url.searchParams.get("preview") !== "false"; // default to preview mode

  // Authorization: site owner OR staff
  const admin = createAdminClient();
  const { data: site } = await admin
    .from("sites")
    .select("owner_id, proposal_id")
    .eq("id", id)
    .single();
  if (!site) {
    return new NextResponse("Site not found", { status: 404 });
  }

  const isOwner = site.owner_id === user.id;
  const isStaff = ["tech_admin", "administrator", "super_admin"].includes(
    profile.role,
  );
  // Sales sees its own proposals' renders so the shared timeline +
  // composer iframe preview both work on /sales/proposals/[id].
  // Added 2026-05-10. Verified via the linked proposal's sales_person_id.
  let isSalesOfProposal = false;
  if (!isOwner && !isStaff && profile.role === "sales" && site.proposal_id) {
    const { data: linkedProposal } = await admin
      .from("proposals")
      .select("sales_person_id")
      .eq("id", site.proposal_id)
      .maybeSingle();
    isSalesOfProposal =
      !!linkedProposal && linkedProposal.sales_person_id === user.id;
  }
  if (!isOwner && !isStaff && !isSalesOfProposal) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // For full (non-preview) renders we may need proposal context for
  // script injection (currently just the proposal slug for the payment
  // widget + the show_banner flag). The contacts(business_email) join
  // was removed 2026-05-15 — contact-handler injection is now driven
  // by per-section `form_recipient_email` + `form_enabled` carriers
  // (see render.ts doesCompositionHaveActiveContactForm).
  let proposalSlug: string | null = null;
  // Opt-IN model (Peter 2026-05-15): mirror publish.ts — banner only
  // ships when `proposals.show_banner === true`. Anything else (null,
  // undefined, false, missing proposal link) suppresses it.
  let showBanner = false;
  if (!preview && site.proposal_id) {
    const { data: proposal } = await admin
      .from("proposals")
      .select("slug, show_banner")
      .eq("id", site.proposal_id)
      .single();
    if (proposal) {
      proposalSlug = (proposal as { slug?: string }).slug ?? null;
      const sb = (proposal as { show_banner?: boolean | null }).show_banner;
      showBanner = sb === true;
    }
  }

  const result = await renderSitePage(id, {
    pagePath,
    preview,
    proposalSlug,
    showBanner,
  });

  if ("error" in result) {
    return new NextResponse(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;color:#666;text-align:center"><h2>Cannot render</h2><p>${result.error}</p></body></html>`, {
      status: 200, // 200 so it renders in iframe instead of erroring
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Update last_rendered_at (fire-and-forget)
  admin
    .from("sites")
    .update({ last_rendered_at: new Date().toISOString() })
    .eq("id", id)
    .then();

  return new NextResponse(result.html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
