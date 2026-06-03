import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TagColor } from "@/types/database";

/**
 * Tag library — rename / recolor / delete a single tag.
 *
 * Permissions:
 *   - PUT (rename / recolor): super_admin always; the tag's creator can
 *     edit their own (matches the RLS policies in 00046).
 *   - DELETE: super_admin OR the tag's creator. Cascades to every
 *     proposal the tag was attached to via the join-table FK, so we
 *     also refuse to delete protected tier slugs (urgent / priority /
 *     basic / premium) — the create-proposal flow seeds those on every
 *     new proposal and relies on them existing.
 *
 * Note: we don't expose a "rename slug" path. Slug stays stable so code
 * that looks up "urgent" by slug doesn't break when someone changes the
 * display name from "Urgent" to "URGENT!!!".
 */

const ALLOWED_COLORS: ReadonlySet<TagColor> = new Set([
  "red", "orange", "amber", "yellow", "green", "emerald",
  "teal", "cyan", "blue", "indigo", "violet", "purple",
  "pink", "rose", "gray", "slate",
]);

/** Protected slugs that DELETE refuses regardless of who's asking. Keep
 *  in sync with PROTECTED_TIER_SLUGS in /api/proposal-tags/route.ts and
 *  TIER_ORDER in components/proposal-tags/tags-field.tsx. */
const PROTECTED_TIER_SLUGS = new Set(["urgent", "priority", "basic", "premium"]);

/** Read role from the profiles table (canonical) rather than the JWT
 *  app_metadata.role, which drifts off in some sessions. Mirrors what
 *  lib/auth/guards.ts `requireAuth` does. Returns "" if no profile is
 *  found so callers can fall through to a Forbidden response. */
async function getRoleForUser(userId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  return (data?.role as string | undefined) ?? "";
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const admin = createAdminClient();

  const { data: existing, error: lookupError } = await admin
    .from("proposal_tags")
    .select("id, created_by")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  }

  const role = await getRoleForUser(user.id);
  const isSuperAdmin = role === "super_admin";
  const isCreator = existing.created_by === user.id;
  if (!isSuperAdmin && !isCreator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { name?: unknown; color?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    if (trimmed.length > 50) return NextResponse.json({ error: "Name too long" }, { status: 400 });
    updates.name = trimmed;
  }
  if (typeof body.color === "string") {
    if (!ALLOWED_COLORS.has(body.color as TagColor)) {
      return NextResponse.json({ error: "Unknown color" }, { status: 400 });
    }
    updates.color = body.color;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("proposal_tags")
    .update(updates)
    .eq("id", id)
    .select("id, name, slug, color, created_by, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tag: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const admin = createAdminClient();

  // Look up the tag first so we can check ownership + protected status.
  const { data: existing, error: lookupError } = await admin
    .from("proposal_tags")
    .select("id, slug, created_by")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  }

  // Tier tags are part of the proposal seed flow — block delete for
  // everyone, including super_admin. Rename / recolor still works.
  if (PROTECTED_TIER_SLUGS.has(existing.slug)) {
    return NextResponse.json(
      { error: "This system tag cannot be deleted." },
      { status: 400 },
    );
  }

  const role = await getRoleForUser(user.id);
  const isSuperAdmin = role === "super_admin";
  const isCreator = existing.created_by === user.id;
  if (!isSuperAdmin && !isCreator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await admin.from("proposal_tags").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
