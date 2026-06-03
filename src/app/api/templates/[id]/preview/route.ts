import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  renderTemplate,
  renderFallbackPage,
  type RenderContent,
} from "@/lib/template-renderer";

/**
 * GET /api/templates/[id]/preview — Render template with its default content_schema.
 *
 * Used by the super admin template list preview dialog.
 * No auth on the render itself (the URL is only exposed to authenticated admin UI).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createAdminClient();

  // 1. Fetch the template record for content_schema
  const { data: template, error } = await supabase
    .from("templates")
    .select("id, name, content_schema")
    .eq("id", id)
    .single();

  if (error || !template) {
    return new NextResponse("Template not found", { status: 404 });
  }

  const content = (template.content_schema as RenderContent) || {
    sections: [],
  };

  // 2. Try to fetch the HTML design from Storage
  const storagePath = `${id}/index.html`;
  const { data: file, error: storageErr } = await supabase.storage
    .from("templates")
    .download(storagePath);

  if (storageErr || !file) {
    // No design files yet — show fallback
    return htmlResponse(renderFallbackPage(content, template.name));
  }

  const htmlTemplate = await file.text();

  // 3. Build assets base URL
  const assetsBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/templates/${id}`;

  // 4. Render with default content
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
