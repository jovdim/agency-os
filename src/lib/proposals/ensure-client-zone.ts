/**
 * ensureClientZone — provision a client auth account + reassign site
 * ownership for a proposal. Idempotent: safe to call multiple times.
 * If the site already has a `client`-role owner, the function returns
 * `{ ok: true, was_created: false }` without touching anything.
 *
 * Used from two places:
 *
 *   1. POST /api/proposals/[id]/create-client-zone — the manual button
 *      (still active for password regen / custom passwords / tech-
 *      controlled overrides; full route is the surface area for those
 *      edge cases).
 *
 *   2. POST /api/sites/[id]/publish — fired best-effort after a
 *      successful publish so the client zone exists by the time sales
 *      hits "Send to client" (Peter 2026-05-23: client zone should
 *      auto-happen at publish; no separate manual step required for
 *      the common case).
 *
 * Failure mode for the publish call site: log + return { ok: false }
 * but never throw — a failed zone provision must not roll back a
 * successful publish. The manual button is still available as a
 * recovery path.
 *
 * Logic mirror: this helper is intentionally a SUBSET of the manual
 * route's logic — it covers ONLY the "create from scratch" path, not
 * password rotation. If you ever extend the manual route's behavior,
 * decide explicitly whether the new behavior should also auto-run on
 * publish (most won't).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const PUBLISH_COST_EUR = 12.5;
const DEFAULT_STARTER_EUR = 37.5;

export interface EnsureClientZoneResult {
  ok: boolean;
  /** Reason string when ok=false. */
  error?: string;
  /** True iff this call provisioned a fresh auth user. False on idempotent re-runs. */
  was_created: boolean;
  /** Set when ok=true. Login email = contact email. */
  email?: string;
  /** Temp password (only set when was_created=true, OR when re-fetched from proposal row). */
  password?: string | null;
  /** Site id linked to the proposal. */
  site_id?: string;
}

/**
 * Best-effort: returns { ok: false, error } instead of throwing.
 * Callers are responsible for checking `ok` and logging if they care.
 */
export async function ensureClientZone(
  proposalId: string,
  options?: {
    /** User id for audit attribution. Falls back to a system marker. */
    actorUserId?: string;
    /** Starter credit grant in $. Defaults to 37.50 (3 publishes).
     *  Pass 0 to skip the grant. Ignored when balance > 0 already. */
    starterCreditEur?: number;
  },
): Promise<EnsureClientZoneResult> {
  const starterCreditEur = options?.starterCreditEur ?? DEFAULT_STARTER_EUR;
  const actor = options?.actorUserId ?? "system:publish";

  const admin = createAdminClient();

  // 1. Load proposal + contact
  const { data: proposal, error: pErr } = await admin
    .from("proposals")
    .select(
      "id, contact_id, company_name, client_temp_password, contacts(email, contact_person, company_name)",
    )
    .eq("id", proposalId)
    .single();
  if (pErr || !proposal) {
    return { ok: false, was_created: false, error: "Proposal not found" };
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
    return {
      ok: false,
      was_created: false,
      error: "Contact has no email",
    };
  }

  // 2. Find linked site. A proposal can have multiple sites in the DB
  // (legacy composer auto-create duplicates), so we must prefer the
  // ACTUALLY-PUBLISHED one when dups exist — otherwise we'd reassign
  // ownership on a stale draft and leave the live site orphaned.
  // last_published_at DESC NULLS LAST: published rows first, newest first.
  const { data: site } = await admin
    .from("sites")
    .select("id, owner_id")
    .eq("proposal_id", proposalId)
    .order("last_published_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!site) {
    return { ok: false, was_created: false, error: "No site linked yet" };
  }

  // 3. Idempotency. The site is "already provisioned to a client" when its
  //    owner is an auth user for the contact's email. Historically this was
  //    keyed ONLY on profiles.role === "client" — but a MISSING profile row
  //    (the migrate path used profiles.update(), a no-op when the on-signup
  //    trigger didn't fire) made the check return false forever. Every later
  //    call then fell through to the "provision" branch below and RESET the
  //    client's password to a fresh random value — exactly the "login works
  //    once, then Invalid credentials after logout" bug.
  //
  //    Fix: ALSO treat the zone as provisioned when the site owner is an
  //    existing auth user whose email matches the contact AND whose
  //    metadata role is client. In that case SELF-HEAL the profile (upsert
  //    role=client) and return the SAVED password — never silently rotating
  //    a login the client is already using.
  // CRITICAL: `profiles` has NO `email` column (email lives on auth.users /
  // contacts). The prior `.select("id, role, email")` errored the whole
  // query → ownerProfile was null → this idempotency check was ALWAYS false
  // → every call (and this runs on EVERY publish) dropped into the provision
  // branch below and RESET the client's password. That's the "login works
  // once, then Invalid credentials after republish" bug. Select real columns
  // only; the login email is the CONTACT email.
  const normalizedContactEmail = contact.email.trim().toLowerCase();
  const { data: ownerProfile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", site.owner_id)
    .maybeSingle();

  let ownerIsClient = ownerProfile?.role === "client";
  if (!ownerIsClient && site.owner_id) {
    // Fallback for a genuinely missing profile row (older migrate runs):
    // accept the owner if their auth account matches the contact email +
    // role=client, and self-heal the profile.
    const { data: ownerAuth } = await admin.auth.admin.getUserById(
      site.owner_id,
    );
    const authEmail = ownerAuth?.user?.email?.toLowerCase();
    const authRole =
      (ownerAuth?.user?.app_metadata?.role as string | undefined) ??
      (ownerAuth?.user?.user_metadata?.role as string | undefined);
    if (
      ownerAuth?.user &&
      authEmail === normalizedContactEmail &&
      authRole === "client"
    ) {
      ownerIsClient = true;
      await admin.from("profiles").upsert(
        {
          id: site.owner_id,
          role: "client",
          full_name:
            contact.contact_person ||
            contact.company_name ||
            proposal.company_name ||
            authEmail,
          is_active: true,
        },
        { onConflict: "id" },
      );
    }
  }

  if (ownerIsClient) {
    return {
      ok: true,
      was_created: false,
      email: normalizedContactEmail,
      password: proposal.client_temp_password ?? null,
      site_id: site.id,
    };
  }

  // 4. Provision the auth user. Re-use an existing auth row if the
  //    email is already registered (e.g. a prior abandoned proposal);
  //    otherwise create a new one.
  const contactEmail = contact.email.trim().toLowerCase();
  const fullName =
    contact.contact_person || contact.company_name || proposal.company_name || contactEmail;
  const tempPassword = generateTempPassword();

  const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const matching = usersList?.users?.find(
    (u) => u.email?.toLowerCase() === contactEmail,
  );

  let authUserId: string;
  if (matching) {
    const { error: pwErr } = await admin.auth.admin.updateUserById(matching.id, {
      password: tempPassword,
    });
    if (pwErr) {
      return {
        ok: false,
        was_created: false,
        error: `Failed to reset password for existing user: ${pwErr.message}`,
      };
    }
    authUserId = matching.id;
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: contactEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName, role: "client" },
    });
    if (createErr || !created?.user) {
      return {
        ok: false,
        was_created: false,
        error: `Failed to create auth user: ${createErr?.message ?? "unknown"}`,
      };
    }
    authUserId = created.user.id;
  }

  // 5. Upsert profile (covers trigger-not-fired + brand-new-user cases).
  //    NO `email` field — `profiles` has no email column; including it
  //    errors the whole upsert (PostgREST rejects the unknown column),
  //    which left the profile row uncreated and forced the next publish
  //    to self-heal via the fallback. Email lives on auth.users / contacts.
  await admin.from("profiles").upsert(
    {
      id: authUserId,
      full_name: fullName,
      role: "client",
      is_active: true,
    },
    { onConflict: "id" },
  );

  // 6. Reassign site ownership
  const { error: ownErr } = await admin
    .from("sites")
    .update({ owner_id: authUserId })
    .eq("id", site.id);
  if (ownErr) {
    return {
      ok: false,
      was_created: false,
      error: `Failed to reassign site owner: ${ownErr.message}`,
    };
  }

  // 7. Save the temp password on the proposal so the timeline /
  //    Live-Clients panel can show it on reload.
  const { error: pwSaveErr } = await admin
    .from("proposals")
    .update({ client_temp_password: tempPassword })
    .eq("id", proposalId);
  if (pwSaveErr) {
    return {
      ok: false,
      was_created: true,
      error: `Auth user created but failed to save temp password on proposal: ${pwSaveErr.message}`,
      email: contactEmail,
      password: tempPassword,
      site_id: site.id,
    };
  }

  // 8. Mark contact converted
  if (proposal.contact_id) {
    await admin
      .from("contacts")
      .update({ status: "converted" })
      .eq("id", proposal.contact_id);
  }

  // 9. Starter credit grant — only when balance is zero. Same logic
  //    as the manual create-client-zone route.
  if (starterCreditEur > 0) {
    const { data: existingBalance } = await admin
      .from("credit_balances")
      .select("balance")
      .eq("site_id", site.id)
      .maybeSingle();
    const currentBalance = Number(existingBalance?.balance ?? 0);
    if (currentBalance === 0) {
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
        note: `Starter grant: ${Math.round(starterCreditEur / PUBLISH_COST_EUR)} free publishes ($${starterCreditEur.toFixed(2)}) on auto client zone activation`,
      });
    }
  }

  await logAudit({
    userId: actor,
    action: "auto_create_client_zone",
    entityType: "proposal",
    entityId: proposalId,
    details: {
      site_id: site.id,
      auth_user_id: authUserId,
      reused_existing_auth: !!matching,
    },
  });

  return {
    ok: true,
    was_created: true,
    email: contactEmail,
    password: tempPassword,
    site_id: site.id,
  };
}

/**
 * 6 random digits — matches the format the manual route uses. Trivial
 * for clients to read over the phone in Slovak; meets Supabase Auth's
 * 6-char minimum. Not intended as a long-term password.
 */
function generateTempPassword(): string {
  const digits = Math.floor(100000 + Math.random() * 900000);
  return digits.toString();
}
