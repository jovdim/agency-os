import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * POST /api/proposals/[id]/create-client-zone
 *
 * Creates (or finds) a client auth account from the proposal's contact and
 * reassigns the proposal's site ownership to that user. After this step the
 * client can log in with the returned credentials and edit the site.
 *
 * Caller must be tech_admin, super_admin, or sales (sales-role 2026-05-10:
 * the salesperson view of /sales/proposals/[id] reuses the shared timeline
 * UI and needs to perform the same step actions IT does — including this
 * one. Sales is additionally constrained to proposals they own; non-owners
 * fall through the proposal-not-found check below since the gate-by-id
 * select would still resolve, so we add an explicit ownership check.)
 *
 * Returns: { email, password, site_id, was_created }
 *   - `password` is the temp password we generated; null if the auth user
 *     already existed before this call (we don't have their real password).
 *   - `was_created` indicates whether a new auth user was just created.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = user.app_metadata?.role as string | undefined;
  if (role !== "tech_admin" && role !== "super_admin" && role !== "sales") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: proposalId } = await params;
  const admin = createAdminClient();

  // Optional body:
  //   { regenerate_password?: boolean, custom_password?: string,
  //     starter_credit_eur?: number }
  //
  // - regenerate_password=true  → auto-generate a fresh password, update
  //                                Supabase Auth, save to proposal.
  // - custom_password="…"       → use this exact string instead of auto-
  //                                generating. Tech types it in the UI.
  //                                Wins over regenerate_password if both
  //                                are sent. Min 6 chars (Supabase Auth
  //                                requirement; we surface a clean 400 if
  //                                shorter rather than letting it fail in
  //                                Supabase with a less obvious error).
  // - starter_credit_eur=37.50  → starter balance to grant on first-time
  //                                client zone activation. Must be a
  //                                non-negative multiple of 12.50 (publish
  //                                cost). Default 37.50 (= 3 free
  //                                publishes). Pass 0 to skip the grant
  //                                entirely. Ignored on subsequent calls
  //                                (idempotency: balance>0 → no grant).
  // - neither                   → idempotent first-time create flow.
  //                                Still ensures a password exists (will
  //                                auto-generate if missing).
  const body = await req.json().catch(() => ({}));
  const forceRegenerate = body?.regenerate_password === true;
  const customPasswordRaw =
    typeof body?.custom_password === "string" ? body.custom_password : null;
  const customPassword = customPasswordRaw?.trim() || null;
  if (customPasswordRaw !== null && customPassword !== null && customPassword.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters." },
      { status: 400 },
    );
  }

  // ── Starter credit validation ───────────────────────────────
  // Default 37.50 € (3 publishes). Non-negative, multiple of 12.50,
  // capped at 500 € to catch typos.
  const PUBLISH_COST_EUR = 12.5;
  const DEFAULT_STARTER_EUR = 37.5;
  let starterCreditEur: number = DEFAULT_STARTER_EUR;
  if (body?.starter_credit_eur !== undefined && body?.starter_credit_eur !== null) {
    const raw = Number(body.starter_credit_eur);
    if (!Number.isFinite(raw) || raw < 0) {
      return NextResponse.json(
        { error: "starter_credit_eur must be a non-negative number" },
        { status: 400 },
      );
    }
    if (raw > 500) {
      return NextResponse.json(
        { error: "starter_credit_eur must not exceed 500 €" },
        { status: 400 },
      );
    }
    if (Math.round(raw * 100) % Math.round(PUBLISH_COST_EUR * 100) !== 0) {
      return NextResponse.json(
        { error: `starter_credit_eur must be a multiple of ${PUBLISH_COST_EUR.toFixed(2)} €` },
        { status: 400 },
      );
    }
    starterCreditEur = raw;
  }

  // Load proposal + contact. We pull sales_person_id even though the
  // tech path doesn't need it, so the sales-role ownership check below
  // can short-circuit non-owned proposals before we do any of the
  // expensive auth/upsert work.
  const { data: proposal, error: pErr } = await admin
    .from("proposals")
    .select("id, contact_id, company_name, client_temp_password, sales_person_id, is_migrated, contacts(email, contact_person, company_name)")
    .eq("id", proposalId)
    .single();

  if (pErr || !proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  // Sales-role guard: the assigned salesperson can act on their own
  // proposal, AND any salesperson can act on a MIGRATED row (migrated
  // proposals carry the importing tech/super as sales_person_id only to
  // satisfy the FK). tech_admin/super_admin bypass this entirely. Same
  // notFound-equivalent shape so we don't leak other proposals' existence.
  if (
    role === "sales" &&
    (proposal as { sales_person_id: string }).sales_person_id !== user.id &&
    (proposal as { is_migrated?: boolean }).is_migrated !== true
  ) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  type ContactRow = {
    email: string | null;
    contact_person: string | null;
    company_name: string | null;
  };
  const contactRaw = (proposal as { contacts?: ContactRow | ContactRow[] }).contacts;
  const contact: ContactRow | null = Array.isArray(contactRaw)
    ? contactRaw[0] ?? null
    : contactRaw ?? null;

  if (!contact?.email) {
    return NextResponse.json(
      { error: "Proposal contact has no email — cannot create a client account." },
      { status: 400 },
    );
  }

  // Site must already exist (created on first composer load)
  const { data: site, error: sErr } = await admin
    .from("sites")
    .select("id, owner_id")
    .eq("proposal_id", proposalId)
    .limit(1)
    .maybeSingle();

  if (sErr || !site) {
    return NextResponse.json(
      { error: "No site found for this proposal. Open the composer first to create the site." },
      { status: 400 },
    );
  }

  // If owner_id already maps to a `client`, treat as no-op / re-fetch.
  //
  // Robust to a MISSING profile row: a migrated client can have an auth
  // user + site ownership but NO profile (the migrate route used
  // profiles.update(), which no-ops if the signup trigger didn't fire).
  // Without this fallback the role check below returned false forever, so
  // every call dropped into the "create" branch and RESET the client's
  // password — the "works once, then Invalid credentials after logout"
  // bug. So we also accept "site owner is an auth user for this contact
  // email" and self-heal the missing profile here.
  // CRITICAL: `profiles` has NO `email` column (email lives on auth.users /
  // contacts). The prior `.select("id, role, email, full_name")` errored the
  // whole query → ownerProfile came back null → the role check was ALWAYS
  // false → every call (incl. every publish via ensureClientZone) dropped
  // into the "create" branch and RESET the client's password. That's the
  // "login works once, then Invalid credentials after republish/regenerate"
  // bug. Select real columns only; the login email is the CONTACT email.
  const contactEmailEarly = contact.email.trim().toLowerCase();
  const { data: ownerProfile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", site.owner_id)
    .maybeSingle();

  let effectiveOwner: { id: string; email: string | null } | null =
    ownerProfile?.role === "client"
      ? { id: ownerProfile.id, email: contactEmailEarly }
      : null;

  if (!effectiveOwner && site.owner_id) {
    // Fallback for a genuinely missing profile row (older migrate runs):
    // accept the owner if their auth account matches the contact email +
    // role=client, and self-heal the profile.
    const { data: ownerAuth } = await admin.auth.admin.getUserById(
      site.owner_id,
    );
    const authEmail = ownerAuth?.user?.email?.toLowerCase() ?? null;
    const authRole =
      (ownerAuth?.user?.app_metadata?.role as string | undefined) ??
      (ownerAuth?.user?.user_metadata?.role as string | undefined);
    if (ownerAuth?.user && authEmail === contactEmailEarly && authRole === "client") {
      await admin.from("profiles").upsert(
        {
          id: site.owner_id,
          role: "client",
          full_name:
            contact.contact_person || contact.company_name || authEmail,
          is_active: true,
        },
        { onConflict: "id" },
      );
      effectiveOwner = { id: site.owner_id, email: authEmail };
    }
  }

  // Owner is already a client. Two paths:
  //   - Default: return the saved temp password (idempotent re-fetch).
  //   - Reset:   generate a fresh password, update Supabase Auth, save it.
  // Either way we ALWAYS return a non-null password so the credentials
  // panel never shows "(unknown — user existed)" again.
  if (effectiveOwner) {
    const savedPassword =
      (proposal as { client_temp_password?: string | null }).client_temp_password ?? null;

    // Decide whether to write a new password:
    //   - custom_password present → use that exact string
    //   - regenerate_password=true → auto-generate
    //   - savedPassword missing → auto-generate (heal the unknown-state bug)
    //   - else → no-op, return saved
    const newPassword =
      customPassword ??
      (forceRegenerate || !savedPassword ? generateTempPassword() : null);

    if (newPassword) {
      const { error: pwErr } = await admin.auth.admin.updateUserById(
        effectiveOwner.id,
        { password: newPassword },
      );
      if (pwErr) {
        return NextResponse.json(
          { error: "Failed to update password: " + pwErr.message },
          { status: 500 },
        );
      }
      const { error: pwSaveErr } = await admin
        .from("proposals")
        .update({ client_temp_password: newPassword })
        .eq("id", proposalId);
      if (pwSaveErr) {
        // Auth was already updated, so the new password technically works
        // — but the proposal row didn't get the mirror, which means the
        // timeline panel will look "wrong" on reload. Surface it loudly.
        return NextResponse.json(
          {
            error:
              "Auth password updated but failed to mirror onto proposal row: " +
              pwSaveErr.message,
          },
          { status: 500 },
        );
      }
      await logAudit({
        userId: user.id,
        action: customPassword
          ? "set_custom_client_password"
          : forceRegenerate
            ? "reset_client_password"
            : "create_client_zone",
        entityType: "proposal",
        entityId: proposalId,
        details: { site_id: site.id, auth_user_id: effectiveOwner.id },
      });
      return NextResponse.json({
        email: effectiveOwner.email,
        password: newPassword,
        site_id: site.id,
        was_created: false,
        was_reset: true,
      });
    }

    return NextResponse.json({
      email: effectiveOwner.email,
      password: savedPassword,
      site_id: site.id,
      was_created: false,
      was_reset: false,
    });
  }

  // Find or create the auth user for the contact email.
  const contactEmail = contact.email.trim().toLowerCase();
  const fullName =
    contact.contact_person || contact.company_name || proposal.company_name || contactEmail;

  let authUserId: string | null = null;
  let createdPassword: string | null = null;

  // Try to find existing auth user by email
  const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const matching = usersList?.users?.find(
    (u) => u.email?.toLowerCase() === contactEmail,
  );

  // Determine the password to use across both branches: tech's custom
  // input wins; otherwise auto-generate. We ALWAYS write a password
  // (existing-user path included) so the credentials panel never shows
  // the "(unknown — user existed)" placeholder again.
  const tempPassword = customPassword ?? generateTempPassword();

  if (matching) {
    // Existing auth user (probably created in an earlier flow that never
    // got finalized — or by a different proposal sharing the email). The
    // client can change the password after first login.
    authUserId = matching.id;
    const { error: pwErr } = await admin.auth.admin.updateUserById(
      matching.id,
      { password: tempPassword },
    );
    if (pwErr) {
      return NextResponse.json(
        { error: "Failed to reset password for existing user: " + pwErr.message },
        { status: 500 },
      );
    }
    createdPassword = tempPassword;
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: contactEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role: "client",
      },
    });
    if (createErr || !created?.user) {
      return NextResponse.json(
        { error: "Failed to create auth user: " + (createErr?.message ?? "unknown") },
        { status: 500 },
      );
    }
    authUserId = created.user.id;
    createdPassword = tempPassword;
  }

  // Upsert profile row (in case the trigger didn't fire or this is a brand-new user).
  // NO `email` field — `profiles` has no email column; including it errors the whole
  // upsert (PostgREST rejects the unknown column), leaving the profile row uncreated
  // so the role==="client" idempotency check fails on the next call and re-resets the
  // password. Email lives on auth.users / contacts.
  await admin.from("profiles").upsert(
    {
      id: authUserId,
      full_name: fullName,
      role: "client",
      is_active: true,
    },
    { onConflict: "id" },
  );

  // Reassign site ownership
  const { error: updErr } = await admin
    .from("sites")
    .update({ owner_id: authUserId })
    .eq("id", site.id);
  if (updErr) {
    return NextResponse.json(
      { error: "Failed to reassign site owner: " + updErr.message },
      { status: 500 },
    );
  }

  // Save the temp password on the proposal so the timeline can show it on
  // reload. NOTE: a previous version of this code also set
  // `client_account_created: true`, but that column never existed in any
  // migration. Including it caused Supabase to reject the entire UPDATE
  // (both fields silently failed), which is why the saved password "went
  // missing" after reload — Peter's bug 2026-05-08. Always check the
  // error return; silent .update() calls are how this kind of thing
  // sneaks back in.
  if (createdPassword) {
    const { error: tempPwErr } = await admin
      .from("proposals")
      .update({ client_temp_password: createdPassword })
      .eq("id", proposalId);
    if (tempPwErr) {
      return NextResponse.json(
        {
          error:
            "Auth user created but failed to save temp password on proposal: " +
            tempPwErr.message,
        },
        { status: 500 },
      );
    }
  }

  // Mark contact converted (mirrors createSiteFromProposal)
  if (proposal.contact_id) {
    await admin
      .from("contacts")
      .update({ status: "converted" })
      .eq("id", proposal.contact_id);
  }

  // ── Starter credit grant ──────────────────────────────────
  // Per Peter 2026-05-11: every newly-activated client zone gets a
  // starter balance (default 37.50 € = 3 free publishes), regardless of
  // payment status. Tech can override the amount via starter_credit_eur
  // in the request body — useful for VIP clients who get more, or for
  // proposals where the amount was already negotiated separately.
  //
  // Idempotency: only granted when the site has zero balance. If a tech
  // admin manually pre-granted before clicking "Create client zone", or
  // if this endpoint somehow runs twice, the second pass is a no-op.
  // Pass starter_credit_eur=0 to skip the grant entirely.
  const { data: existingBalance } = await admin
    .from("credit_balances")
    .select("balance")
    .eq("site_id", site.id)
    .maybeSingle();
  const currentBalance = Number(existingBalance?.balance ?? 0);
  const willGrant = currentBalance === 0 && starterCreditEur > 0;

  if (willGrant) {
    if (existingBalance) {
      await admin
        .from("credit_balances")
        .update({ balance: starterCreditEur })
        .eq("site_id", site.id);
    } else {
      await admin
        .from("credit_balances")
        .insert({ site_id: site.id, balance: starterCreditEur });
    }
    await admin.from("credit_transactions").insert({
      site_id: site.id,
      user_id: authUserId,
      amount: starterCreditEur,
      type: "admin_grant",
      note: `Starter grant: ${Math.round(starterCreditEur / PUBLISH_COST_EUR)} free publishes (${starterCreditEur.toFixed(2)} €) on client zone activation`,
    });
    await logAudit({
      userId: user.id,
      action: "starter_credit_granted",
      entityType: "site",
      entityId: site.id,
      details: { amount_eur: starterCreditEur, proposal_id: proposalId },
    });
  }

  await logAudit({
    userId: user.id,
    action: "create_client_zone",
    entityType: "proposal",
    entityId: proposalId,
    details: {
      site_id: site.id,
      auth_user_id: authUserId,
      created_new_user: createdPassword !== null,
      starter_credit_granted: willGrant,
      starter_credit_amount_eur: willGrant ? starterCreditEur : 0,
    },
  });

  // Resolve the password we return to the caller. If the user already existed,
  // fall back to whatever was previously stored on the proposal (if anything).
  const returnedPassword =
    createdPassword ??
    (proposal as { client_temp_password?: string | null }).client_temp_password ??
    null;

  return NextResponse.json({
    email: contactEmail,
    password: returnedPassword,
    site_id: site.id,
    was_created: createdPassword !== null,
    was_reset: false,
  });
}

/**
 * Generate a short, easy-to-dictate temp password. Format:
 *   `NNNNNN`   (6 digits, e.g. `482719`)
 *
 * Peter's call: clients aren't technical, the prior `Welcome-NNNN`
 * (12 chars, mixed-case + dash) was unnecessarily long. 6 digits is
 * the absolute simplest — phone-keyboard friendly (number row only,
 * no shifting), trivial to dictate over the phone in Slovak, and
 * exactly hits Supabase Auth's 6-char minimum.
 *
 * Random source: 6 random digits via Math.random — fine for a one-time
 * temp password the client changes after first login. Not intended for
 * long-term credential security; tech can also override with a custom
 * password from the UI.
 */
function generateTempPassword(): string {
  const digits = Math.floor(100000 + Math.random() * 900000); // 100000-999999
  return digits.toString();
}
