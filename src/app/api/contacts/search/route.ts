import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Direct lookup by ID (used when pre-filling from contact_id param)
  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (id) {
    const { data: contact } = await admin
      .from("contacts")
      .select("id, company_name, contact_person, email, phone")
      .eq("id", id)
      .single();

    if (!contact) return NextResponse.json({ contacts: [] });

    // Also fetch deployment info for this contact's proposal
    let deployment: { site_url: string; codebase_link: string | null } | null = null;
    const { data: proposal } = await admin
      .from("proposals")
      .select("id")
      .eq("contact_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (proposal) {
      const { data: dep } = await admin
        .from("deployments")
        .select("subdomain, github_repo")
        .eq("proposal_id", proposal.id)
        .eq("deploy_status", "live")
        .limit(1)
        .single();

      if (dep) {
        const ghOwner = process.env.GITHUB_OWNER;
        deployment = {
          site_url: `https://${dep.subdomain}.pages.dev`,
          codebase_link: dep.github_repo && ghOwner
            ? `https://github.com/${ghOwner}/${dep.github_repo}`
            : null,
        };
      }
    }

    return NextResponse.json({
      contacts: [{ ...contact, deployment: deployment ?? undefined }],
    });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ contacts: [] });
  }

  const pattern = `%${q}%`;

  const { data: contacts } = await admin
    .from("contacts")
    .select("id, company_name, contact_person, email, phone")
    .or(
      `company_name.ilike.${pattern},contact_person.ilike.${pattern},email.ilike.${pattern}`
    )
    .limit(10);

  return NextResponse.json({ contacts: contacts ?? [] });
}
