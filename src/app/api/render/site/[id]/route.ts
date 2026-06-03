import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  renderTemplate,
  renderFallbackPage,
  type RenderContent,
} from "@/lib/template-renderer";

/**
 * GET /api/render/site/[id] — Render a live site as a full HTML page.
 *
 * Reads sections from the `sections` table (not proposal content_overrides).
 * Used for iframe previews in dashboard (tech admin editor, client view).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createAdminClient();

  // 1. Fetch site with template_id
  const { data: site, error } = await supabase
    .from("sites")
    .select("id, name, template_id")
    .eq("id", id)
    .single();

  if (error || !site) {
    return new NextResponse("Site not found", { status: 404 });
  }

  // 2. Fetch sections for this site
  const { data: sections } = await supabase
    .from("sections")
    .select("type, label, order, fields")
    .eq("site_id", id)
    .order("order", { ascending: true });

  const content: RenderContent = {
    sections: (sections || []).map((s) => ({
      type: s.type,
      label: s.label,
      order: s.order,
      fields: (s.fields || {}) as Record<string, unknown>,
    })),
  };

  // 3. If no template, return fallback
  if (!site.template_id) {
    return htmlResponse(renderFallbackPage(content, site.name));
  }

  // 4. Try to fetch the HTML template from Storage
  const storagePath = `${site.template_id}/index.html`;
  const { data: file, error: storageErr } = await supabase.storage
    .from("templates")
    .download(storagePath);

  if (storageErr || !file) {
    return htmlResponse(renderFallbackPage(content, site.name));
  }

  const htmlTemplate = await file.text();

  // 5. Build base URL for relative asset resolution
  const assetsBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/templates/${site.template_id}`;

  // 6. Render and return
  const rendered = renderTemplate(htmlTemplate, content, assetsBase);
  return htmlResponse(rendered);
}

function htmlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
    },
  });
}
