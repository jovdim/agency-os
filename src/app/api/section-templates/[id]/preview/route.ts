import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/section-templates/[id]/preview
 * Returns a full HTML document with the section embedded + base CSS + per-template CSS,
 * suitable for rendering in an iframe.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAuth();
  const { id } = await params;
  const admin = createAdminClient();

  const { data: tpl, error } = await admin
    .from("section_templates")
    .select("category, name, html_path, css_path")
    .eq("id", id)
    .single();

  if (error || !tpl) {
    return new NextResponse("Template not found", { status: 404 });
  }

  const { data: htmlBlob } = await admin.storage
    .from("section-templates")
    .download(tpl.html_path);

  if (!htmlBlob) {
    return new NextResponse("Template HTML missing", { status: 500 });
  }

  const sectionHtml = await htmlBlob.text();

  let templateCss = "";
  if (tpl.css_path) {
    const { data: cssBlob } = await admin.storage
      .from("section-templates")
      .download(tpl.css_path);
    if (cssBlob) templateCss = await cssBlob.text();
  }

  // Per-category preview backdrop. Navbars use position: fixed (nav-02,
  // nav-03, nav-04, nav-06) which means the iframe is empty below the
  // nav — gives a misleading "floating in a void" preview. To show
  // what these navs actually look like in real use, we put a fake
  // hero-style backdrop UNDERNEATH the section so glass/floating nav
  // styles have something to render against. Other categories don't
  // need this — their sections fill the iframe themselves.
  const navBackdrop = tpl.category === "nav"
    ? `<div style="
        height: 600px;
        background-image:
          linear-gradient(135deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.05) 100%),
          url('https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=1600&q=80&auto=format');
        background-size: cover;
        background-position: center;
        position: relative;
      ">
        <div style="
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: rgba(255,255,255,0.92);
          font-family: 'Space Grotesk', sans-serif;
          font-size: 0.85rem;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          text-shadow: 0 1px 3px rgba(0,0,0,0.3);
        ">Navbar preview over a hero image</div>
      </div>`
    : "";

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview: ${tpl.category}/${tpl.name}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/template-base.css">
  ${templateCss ? `<style>${templateCss}</style>` : ""}
  <style>
    body { margin: 0; pointer-events: none; }
    a { pointer-events: none; }
  </style>
</head>
<body>
${sectionHtml}
${navBackdrop}
</body>
</html>`;

  return new NextResponse(fullHtml, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
}
