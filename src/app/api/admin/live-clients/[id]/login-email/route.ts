import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * PUT /api/admin/live-clients/[id]/login-email
 *
 * Change the email a client uses to log in. Updates BOTH:
 *   - `contacts.email` — the display value across the CRM
 *   - `auth.users.email` (via admin.auth.admin.updateUserById) — the
 *     value Supabase Auth checks against at login
 *
 * Keeping the two in lockstep is critical: if they drift, the client
 * sees one email in their dashboard and tries to log in with another,
 * or vice versa. We always update the auth side FIRST (the source of
 * truth at login time) and roll the contact update only after CF^Auth
 * confirms — so a half-commit leaves auth working with the new email
 * but the CRM still showing the old (recoverable; operator can retry).
 *
 * Body: { email: string }
 *
 * Auth: tech_admin / super_admin / sales (own / migrated).
 *
 * Caveats the dialog explains to the operator:
 *   - Existing sessions are NOT invalidated. Client stays logged in
 *     wherever they're already signed in until they sign out / their
 *     token expires.
 *   - Confirmation email is NOT triggered (we use `email_confirm: true`
 *     so the new address is trusted immediately — matches how the
 *     migrate-client + send-welcome flows handle it).
 *   - Welcome email is not auto-resent — operator decides via the
 *     SendWelcomeEmailDialog whether to ship credentials after.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = user.app_metadata?.role as string;
  if (!["tech_admin", "super_admin", "sales"].includes(role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { id: proposalId } = await params;
  let body: { email?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const newEmail = (body.email ?? "").trim().toLowerCase();
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    return NextResponse.json(
      { error: "Valid email required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: proposal } = await admin
    .from("proposals")
    .select("id, contact_id, sales_person_id, is_migrated")
    .eq("id", proposalId)
    .maybeSingle();
  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }
  if (role === "sales") {
    const owns = proposal.sales_person_id === user.id;
    const isMigrated = proposal.is_migrated === true;
    if (!owns && !isMigrated) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Need site.owner_id to know which auth user to update.
  const { data: site } = await admin
    .from("sites")
    .select("id, owner_id")
    .eq("proposal_id", proposalId)
    .maybeSingle();
  if (!site?.owner_id) {
    return NextResponse.json(
      { error: "No client account linked to this proposal yet" },
      { status: 404 },
    );
  }

  // Conflict check — refuse to point this proposal at an email that's
  // already owned by a DIFFERENT auth user. Otherwise we'd hit a unique-
  // constraint failure from Supabase Auth anyway, but a friendlier 409
  // beats a "user already registered" generic error.
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const conflict = existingUsers?.users?.find(
    (u) =>
      u.email?.toLowerCase() === newEmail && u.id !== site.owner_id,
  );
  if (conflict) {
    return NextResponse.json(
      {
        error: `Another account is already using ${newEmail}. Pick a different email or merge the accounts manually.`,
      },
      { status: 409 },
    );
  }

  // ── Step 1: rotate the auth user's email ──
  // email_confirm: true skips Supabase's confirmation-email roundtrip.
  // We're an admin-side mutation; the operator vouches for the new
  // address. Same flag is used by /api/admin/clients/route.ts on
  // create + by /api/admin/migrate-client.
  const { error: authErr } = await admin.auth.admin.updateUserById(
    site.owner_id,
    { email: newEmail, email_confirm: true },
  );
  if (authErr) {
    return NextResponse.json(
      { error: `Auth update failed: ${authErr.message}` },
      { status: 500 },
    );
  }

  // ── Step 2: rotate the contact record's email ──
  // Only after auth succeeds — keeps the CRM in step with the source
  // of truth, no orphan rows on a partial commit.
  if (proposal.contact_id) {
    const { error: contactErr } = await admin
      .from("contacts")
      .update({ email: newEmail })
      .eq("id", proposal.contact_id);
    if (contactErr) {
      console.error(
        "[LiveClients login-email change] Contact update failed after auth succeeded:",
        contactErr,
      );
      // Non-blocking: auth IS updated, log lets the operator see
      // the partial state for manual cleanup. Returning 200 is
      // honest about the auth side working.
    }
  }

  await logAudit({
    userId: user.id,
    action: "change_login_email",
    entityType: "profile",
    entityId: site.owner_id,
    details: {
      proposal_id: proposalId,
      new_email: newEmail,
    },
  });

  return NextResponse.json({
    success: true,
    email: newEmail,
  });
}
