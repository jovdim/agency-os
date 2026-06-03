import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TagColor } from "@/types/database";

/**
 * Proposal tag library — list + create.
 *
 * Scope: shared across the team (one library for the whole agency, not
 * per-user). Reading is open to any authenticated user; creating is
 * restricted to sales+ via RLS, but we re-check here defensively.
 */

const ALLOWED_COLORS: ReadonlySet<TagColor> = new Set([
  "red", "orange", "amber", "yellow", "green", "emerald",
  "teal", "cyan", "blue", "indigo", "violet", "purple",
  "pink", "rose", "gray", "slate",
]);

const ALLOWED_ROLES = new Set(["sales", "tech_admin", "administrator", "super_admin"]);

/** System "tier" tags seeded at install time. These slugs are protected:
 *  they cannot be deleted from the library by anyone (including super
 *  admins) because the create-proposal flow expects them to exist as a
 *  fixed priority signal for the IT team. Renaming/recoloring is still
 *  allowed via the PUT route — just not delete. Keep this list in sync
 *  with TIER_ORDER in components/proposal-tags/tags-field.tsx. */
const PROTECTED_TIER_SLUGS = new Set(["urgent", "priority", "basic", "premium"]);

/**
 * Convert a free-text tag name into a stable slug. Used so the same logical
 * tag can be looked up by code (e.g. "urgent") even if a user later renames
 * the display name. Mirrors the SQL CHECK on proposal_tags.slug.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    // Strip diacritics so accented names ("Proposal") slug cleanly.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/** GET /api/proposal-tags — list every tag in the shared library.
 *
 *  Each tag carries a server-computed `can_delete` flag so the picker
 *  UI can show a trash affordance only on rows the current user is
 *  actually permitted to delete. Rule: not a protected tier slug, AND
 *  (you created it OR you're super_admin). Never trust the client to
 *  enforce — the DELETE handler re-checks. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Read role from the profiles table — that's the canonical source the
  // rest of the auth system uses (see lib/auth/guards.ts `requireAuth`).
  // app_metadata.role drifted off in previous sessions and silently broke
  // permission checks; profiles.role is the synced truth.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = (profile?.role as string | undefined) ?? "";
  const isSuperAdmin = role === "super_admin";

  const { data, error } = await admin
    .from("proposal_tags")
    .select("id, name, slug, color, created_by, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const tags = (data ?? []).map((t) => ({
    ...t,
    can_delete:
      !PROTECTED_TIER_SLUGS.has(t.slug) &&
      (isSuperAdmin || t.created_by === user.id),
  }));

  return NextResponse.json({ tags });
}

/** POST /api/proposal-tags — create a new tag (sales+). */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = (user.app_metadata?.role as string | undefined) ?? "";
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { name?: unknown; color?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (name.length > 50) {
    return NextResponse.json({ error: "Name too long (max 50)" }, { status: 400 });
  }

  const color = typeof body.color === "string" ? body.color : "gray";
  if (!ALLOWED_COLORS.has(color as TagColor)) {
    return NextResponse.json({ error: "Unknown color" }, { status: 400 });
  }

  const slug = slugify(name);
  if (!slug) {
    // Slug is empty — name was all punctuation/whitespace.
    return NextResponse.json(
      { error: "Name must contain letters or numbers" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // If a tag with this slug already exists, return it (idempotent create —
  // means sales typing "urgent" twice doesn't error out, they just get
  // back the existing one and the picker shows it as already in the list).
  const { data: existing } = await admin
    .from("proposal_tags")
    .select("id, name, slug, color, created_by, created_at")
    .eq("slug", slug)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ tag: existing, existed: true });
  }

  const { data, error } = await admin
    .from("proposal_tags")
    .insert({
      name,
      slug,
      color,
      created_by: user.id,
    })
    .select("id, name, slug, color, created_by, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tag: data, existed: false }, { status: 201 });
}
