import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSiteAdminForSite } from "@/lib/platform/site-admin-guard";

const HOSTCREATORS_API = "https://www.hostcreators.sk/api/v1/host/domain/check";

/**
 * GET /api/sites/[id]/domain/check?domain=example.sk
 * Checks if a domain is available using HostCreators API.
 * Returns availability + pricing info.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { id } = await params;
  if (!user) {
    // Per-site CMS admin (theirdomain.com/admin) — cookie bound to this site.
    const sa = await getSiteAdminForSite(id);
    if (!sa) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const domain = req.nextUrl.searchParams.get("domain")?.trim().toLowerCase();
  if (!domain) {
    return NextResponse.json({ error: "Missing domain parameter" }, { status: 400 });
  }

  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;
  if (!domainRegex.test(domain)) {
    return NextResponse.json({ error: "Invalid domain format" }, { status: 400 });
  }

  const apiToken = process.env.HOSTCREATORS_API_TOKEN;
  if (!apiToken) {
    return NextResponse.json({ error: "Domain check service not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(`${HOSTCREATORS_API}?q=${encodeURIComponent(domain)}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[DomainCheck] HostCreators API error:", res.status, text);
      return NextResponse.json({ error: "Error checking the domain" }, { status: 502 });
    }

    const json = await res.json();
    const data = json.data;

    return NextResponse.json({
      available: data.avail,
      reason: data.avail ? undefined : "The domain is already registered",
      price: data.price ? {
        create: data.price.price_create,
        renew: data.price.price_renew,
        transfer: data.price.price_transfer,
        isPremium: data.price.is_premium,
      } : undefined,
    });
  } catch (err) {
    console.error("[DomainCheck] Failed:", err);
    return NextResponse.json({ error: "Error checking the domain" }, { status: 500 });
  }
}
