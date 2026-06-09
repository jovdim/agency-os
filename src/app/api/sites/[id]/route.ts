import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteAdminForSite } from "@/lib/platform/site-admin-guard";

/**
 * GET /api/sites/[id] — Get a site with credit balance
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { data: site, error } = await supabase
    .from("sites")
    .select("*, credit_balances(*)")
    .eq("id", id)
    .single();

  if (error || !site)
    return NextResponse.json({ error: "Site not found" }, { status: 404 });

  return NextResponse.json({ site });
}

/**
 * PUT /api/sites/[id] — Update site (status, name, domain, etc.)
 *
 * Auth:
 *   - tech_admin / super_admin → always allowed.
 *   - sales → allowed iff the site is linked to a proposal the caller
 *     owns (added 2026-05-10 so the shared timeline UI on
 *     /sales/proposals/[id] can save composer edits the same way IT
 *     does on /tech). Treated as full staff for the rest of the field
 *     allowlist — sales is a builder now too.
 *   - client → allowed iff the site's `owner_id` matches the caller (Phase
 *     C client composer). The check uses the admin client because the
 *     client role's RLS may not let us SELECT a site row when only the
 *     id is known; verifying owner_id explicitly is the safe path.
 *   - Everyone else → 403.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isClientOwner = false;
  let effectiveRole = "client";

  if (!user) {
    // Per-site CMS admin (theirdomain.com/admin) — no Supabase session, just
    // the host-scoped site-admin cookie. Authorize ONLY for that exact site and
    // restrict to composition edits, exactly like a client owner.
    const sa = await getSiteAdminForSite(id);
    if (!sa)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    isClientOwner = true;
  } else {
    const role = user.app_metadata?.role as string;
    effectiveRole = role;
    if (!["tech_admin", "super_admin"].includes(role)) {
      if (role === "sales") {
        // Sales: must own the linked proposal. Same lookup pattern as
        // /api/sites/[id]/domain — the proposal-level page guard already
        // prevents most navigations to a non-owned site, but a stray
        // request from devtools or a stale tab can still hit this route,
        // so we re-verify here.
        const admin = createAdminClient();
        const { data: siteRow, error: sErr } = await admin
          .from("sites")
          .select("proposal_id")
          .eq("id", id)
          .maybeSingle();
        if (sErr || !siteRow?.proposal_id) {
          return NextResponse.json({ error: "Site not found" }, { status: 404 });
        }
        const { data: linkedProposal } = await admin
          .from("proposals")
          .select("sales_person_id")
          .eq("id", siteRow.proposal_id)
          .maybeSingle();
        if (!linkedProposal || linkedProposal.sales_person_id !== user.id) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        // Fall through — sales is treated as full staff for the field
        // allowlist below (composition, status, name, domain, …).
      } else if (role === "client") {
        const admin = createAdminClient();
        const { data: ownerRow, error: ownerErr } = await admin
          .from("sites")
          .select("owner_id")
          .eq("id", id)
          .maybeSingle();
        if (ownerErr || !ownerRow) {
          return NextResponse.json({ error: "Site not found" }, { status: 404 });
        }
        if (ownerRow.owner_id !== user.id) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        isClientOwner = true;
      } else {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }
  const body = await req.json();

  // ── Composition integrity guard ──
  // A composition write must carry at least one page AND keep the home
  // page (index.html). Without this, a stray/replayed request (or a UI
  // bug) could persist a pages-less or home-less composition that renders
  // to nothing and breaks publish. The composer always satisfies this
  // (home is delete-protected), so this only rejects genuinely malformed
  // payloads. Non-composition writes (status/domain/name) skip the check.
  if (body.composition !== undefined) {
    const comp = body.composition as { pages?: unknown } | null;
    const pages =
      comp && typeof comp === "object"
        ? (comp as { pages?: unknown }).pages
        : undefined;
    if (!Array.isArray(pages) || pages.length === 0) {
      return NextResponse.json(
        { error: "Composition must have at least one page" },
        { status: 400 },
      );
    }
    const hasHome = pages.some(
      (p) =>
        p &&
        typeof p === "object" &&
        (p as { path?: unknown }).path === "index.html",
    );
    if (!hasHome) {
      return NextResponse.json(
        { error: "Composition must include the home page (index.html)" },
        { status: 400 },
      );
    }
  }

  const updates: Record<string, unknown> = {};

  // Client-as-owner can only edit composition (theme/SEO/content live
  // inside it). Status/name/domain/is_legacy are admin-only fields —
  // letting a client set those would let them e.g. flip is_legacy to
  // bypass the composer, or rename their site for tracking purposes.
  if (isClientOwner) {
    if (body.composition !== undefined) updates.composition = body.composition;
  } else {
    if (body.status !== undefined) updates.status = body.status;
    if (body.name !== undefined) updates.name = body.name;
    if (body.domain !== undefined) updates.domain = body.domain;
    if (body.site_url !== undefined) updates.site_url = body.site_url;
    if (body.codebase_link !== undefined)
      updates.codebase_link = body.codebase_link;
    if (body.composition !== undefined) updates.composition = body.composition;
    if (body.is_legacy !== undefined) updates.is_legacy = body.is_legacy;
  }


  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Stamp the editor's role on every composition write so the stale-
  // data banner in the *other* tab can say "Client just made changes"
  // vs "IT team" vs "Salesperson". Skip for non-composition-only edits
  // (e.g. status/domain bumps from background flows) so we don't lie
  // about who edited content.
  //
  // NOTE: this column is added by migration 00050. The retry below
  // makes the write tolerant of the migration not yet being applied
  // (or the PostgREST schema cache not having refreshed) — autosaves
  // MUST NOT silently fail just because the staleness-detection column
  // isn't in the schema yet.
  if (body.composition !== undefined) {
    updates.updated_by_role = effectiveRole;
  }

  const admin = createAdminClient();
  let result = await admin
    .from("sites")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  // 42703 = "undefined_column". If we tried to write `updated_by_role`
  // but the column doesn't exist yet, strip it and retry. Composition
  // edits MUST NOT silently fail because of an out-of-band staleness
  // column.
  if (result.error?.code === "42703" && "updated_by_role" in updates) {
    console.warn(
      "[sites PUT] retrying without updated_by_role — apply migration 00050 to enable team attribution",
    );
    const { updated_by_role: _drop, ...withoutRole } = updates as Record<
      string,
      unknown
    >;
    void _drop;
    result = await admin
      .from("sites")
      .update(withoutRole)
      .eq("id", id)
      .select()
      .single();
  }

  if (result.error)
    return NextResponse.json({ error: result.error.message }, { status: 500 });

  return NextResponse.json({ site: result.data });
}
