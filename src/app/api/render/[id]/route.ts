import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/render/[id] — Render a proposal as a full HTML page.
 *
 * Serves the actual website files uploaded by tech admin to Supabase Storage.
 * Falls back to deployed site URL if available, or a placeholder if nothing exists yet.
 *
 * No auth: the UUID is the access control (unguessable).
 * Used for iframe previews in dashboard + public proposal pages.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createAdminClient();

  // 1. Fetch proposal
  const { data: proposal, error } = await supabase
    .from("proposals")
    .select("id, company_name, template_id, content_overrides")
    .eq("id", id)
    .single();

  if (error || !proposal) {
    return new NextResponse("Proposal not found", { status: 404 });
  }

  // 2. Try to serve the uploaded site files from proposals storage bucket
  const { data: indexFile } = await supabase.storage
    .from("proposals")
    .download(`${id}/site/index.html`);

  if (indexFile) {
    let html = await indexFile.text();

    // Resolve relative CSS/JS references to storage URLs
    const storageBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/proposals/${id}/site`;

    // Replace relative references to style.css and script.js with absolute storage URLs
    html = html.replace(
      /href=["'](?:\.\/)?style\.css["']/g,
      `href="${storageBase}/style.css"`,
    );
    html = html.replace(
      /src=["'](?:\.\/)?script\.js["']/g,
      `src="${storageBase}/script.js"`,
    );

    return htmlResponse(html);
  }

  // 3. If no uploaded files, check if there's a template-based render (legacy)
  if (proposal.template_id) {
    const { renderTemplate, renderFallbackPage } =
      await import("@/lib/template-renderer");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = (proposal.content_overrides as any) || {
      sections: [],
    };

    const storagePath = `${proposal.template_id}/index.html`;
    const { data: file } = await supabase.storage
      .from("templates")
      .download(storagePath);

    if (file) {
      const htmlTemplate = await file.text();
      const assetsBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/templates/${proposal.template_id}`;
      return htmlResponse(renderTemplate(htmlTemplate, content, assetsBase));
    }

    return htmlResponse(renderFallbackPage(content, proposal.company_name));
  }

  // 4. No files uploaded yet — show a waiting message
  return htmlResponse(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${proposal.company_name}</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #fafafa;
      color: #666;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    h1 { color: #333; margin-bottom: 0.5rem; }
    p { font-size: 1.1rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${proposal.company_name}</h1>
    <p>Website is being built by our tech team.</p>
    <p style="font-size: 0.9rem; margin-top: 1rem;">Check back soon!</p>
  </div>
</body>
</html>`);
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
