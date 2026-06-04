import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { sendEmail, buildClientWelcomeEmailHtml } from "@/lib/email";
import { generateVariableSymbol } from "@/lib/payments/bysquare";
import crypto from "crypto";

/**
 * POST /api/admin/migrate-client
 *
 * Drop an EXISTING paying client straight into the CRM, skipping the
 * normal proposal → email → QR-payment chain. Creates the whole stack
 * atomically (validate upfront, throw on any failure):
 *
 *   1. Contact row (CRM record)
 *   2. Synthetic proposal (status = paid, is_migrated = true,
 *      no follow-up reminders, no QR widget config)
 *   3. Auth user + client profile
 *   4. Site (is_paid = true, empty composition, ready for composer)
 *   5. Payment row (status = confirmed, payment_method = bank_transfer)
 *   6. Credit balance with starting amount
 *   7. Optionally: send welcome email via Hostinger SMTP
 *
 * NOTE 2026-05-23: invoice creation was removed from this flow.
 * Migrated clients already have a real legal invoice in your
 * external accounting system; auto-generating a phantom FV row
 * was creating a misleading duplicate.
 *
 * The synthetic proposal carries `is_migrated = true` so the composer
 * UI gates out the four chrome sections that don't apply to a paid-
 * since-day-1 row (Send dialog, banner config, timeline, reminders).
 *
 * Commission auto-creation is INTENTIONALLY skipped — there is no
 * salesperson behind a migrated row, the user running the import
 * carries it under their own `sales_person_id` purely so the NOT NULL
 * FK is satisfied. /super/sales-overview filters on `is_migrated` so
 * these never inflate commission reports.
 *
 * Auth: tech_admin or super_admin (sales doesn't create migrations).
 *
 * Body shape:
 *   - company_name (string, required)
 *   - contact_person (string, optional)
 *   - email (string, required — becomes login)
 *   - phone (string, optional)
 *   - town, industry (strings, optional)
 *   - custom_domain (string, optional — their existing .sk etc.)
 *   - business_email (string, optional — an existing mailbox they
 *     arrived with; written to profiles.business_email)
 *   - business_email_password (string, optional — that mailbox's
 *     password; written to profiles.business_email_password)
 *   - subdomain (string, optional — for pages.dev hosting fallback;
 *     auto-generated from company_name when blank)
 *   - amount_paid (number, optional, > 0, EUR — null prices + no payment
 *     row recorded when omitted/blank)
 *   - paid_on (ISO date, optional — defaults to today)
 *   - starting_credits (number, optional — defaults to 50)
 *   - send_welcome_email (boolean, optional — defaults to false)
 *
 * Returns: { proposal_id, site_id, login_email, temp_password,
 *            invoice_number, redirect_to }
 */
export async function POST(req: NextRequest) {
  // ── Auth ──
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = user.app_metadata?.role as string;
  if (!["tech_admin", "super_admin"].includes(role)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // ── Body parsing + validation (upfront, before any side effects) ──
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const company_name = stringField(body, "company_name");
  const contact_person = optionalString(body, "contact_person");
  const email = stringField(body, "email")?.toLowerCase();
  const phone = optionalString(body, "phone");
  const town = optionalString(body, "town");
  const industry = optionalString(body, "industry");
  const custom_domain = optionalString(body, "custom_domain");
  // Existing business email the client arrived with + its mailbox
  // password. Both optional. When present they're written to
  // profiles.business_email / business_email_password — the columns the
  // client zone reads to mark the email setup "done" and show credentials.
  const business_email = optionalString(body, "business_email")?.toLowerCase();
  const business_email_password = optionalString(body, "business_email_password");
  const rawSubdomain = stringField(body, "subdomain").toLowerCase();
  const userProvidedSubdomain = rawSubdomain.length > 0;
  // Price is optional — sometimes the historical amount is unknown. We
  // treat missing/blank as "no price recorded" (null prices, no payment
  // row) rather than coercing to 0, which would read as a real $0 sale.
  const hasAmount =
    body.amount_paid != null && String(body.amount_paid).trim() !== "";
  const amount_paid: number | null = hasAmount ? Number(body.amount_paid) : null;
  const paid_on_raw = optionalString(body, "paid_on");
  const starting_credits = body.starting_credits != null
    ? Number(body.starting_credits)
    : 50;
  const send_welcome_email = body.send_welcome_email === true;

  if (!company_name) {
    return NextResponse.json({ error: "company_name is required" }, { status: 400 });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }
  if (
    business_email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(business_email)
  ) {
    return NextResponse.json(
      { error: "business_email must be a valid address, or be omitted" },
      { status: 400 },
    );
  }
  // Subdomain is optional. When typed it must be a valid host label;
  // when blank we auto-generate one from the company name below — migrated
  // clients serve from their own domain, so the pages.dev subdomain is just
  // an internal hosting handle they never see.
  if (
    userProvidedSubdomain &&
    !/^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/.test(rawSubdomain)
  ) {
    return NextResponse.json(
      { error: "subdomain must be 1–50 chars, lowercase letters/digits/hyphens, no leading/trailing hyphen" },
      { status: 400 },
    );
  }
  let subdomain = userProvidedSubdomain
    ? rawSubdomain
    : subdomainBase(company_name);
  if (hasAmount && (!Number.isFinite(amount_paid) || (amount_paid as number) <= 0)) {
    return NextResponse.json({ error: "amount_paid must be a positive number" }, { status: 400 });
  }
  if (!Number.isFinite(starting_credits) || starting_credits < 0) {
    return NextResponse.json({ error: "starting_credits must be 0 or higher" }, { status: 400 });
  }

  // Parse paid_on — defaults to today if omitted/empty. We accept any
  // ISO-shaped string that `new Date()` likes, then re-serialize so the
  // DB sees a clean ISO timestamp.
  let paidOnIso: string;
  if (paid_on_raw) {
    const parsed = new Date(paid_on_raw);
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "paid_on must be a valid date" }, { status: 400 });
    }
    paidOnIso = parsed.toISOString();
  } else {
    paidOnIso = new Date().toISOString();
  }

  const admin = createAdminClient();

  // ── Uniqueness pre-checks ──
  // We check BEFORE creating anything so a duplicate doesn't leave
  // half-written rows scattered across tables. Auth user uniqueness
  // is checked at create time (the createUser call returns an error
  // we can detect), but we look it up here too for a clean 409
  // response before doing any work.
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const dupUser = existingUsers?.users?.find(
    (u) => u.email?.toLowerCase() === email,
  );
  if (dupUser) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 },
    );
  }

  // Subdomain uniqueness — site row uses it as a routing key. A
  // user-typed subdomain that's taken is a hard 409 (they should pick
  // another). An AUTO-generated one (blank input) silently gets a short
  // random suffix so a name clash never blocks the migration.
  const { data: dupSub } = await admin
    .from("sites")
    .select("id")
    .eq("subdomain", subdomain)
    .maybeSingle();
  if (dupSub) {
    if (userProvidedSubdomain) {
      return NextResponse.json(
        { error: `Subdomain "${subdomain}" is already taken` },
        { status: 409 },
      );
    }
    subdomain = `${subdomain}-${crypto.randomBytes(2).toString("hex")}`;
  }

  // ── Pre-computed identifiers ──
  const tempPassword = crypto.randomBytes(5).toString("hex");
  const proposalSlug = makeUniqueSlug(company_name);
  // Site slug — we keep it close to subdomain for predictability, but
  // append a short random suffix in case some other site already grabbed
  // that exact slug (slugs and subdomains share company-name origin).
  const siteSlug = `${subdomain}-${crypto.randomBytes(2).toString("hex")}`;

  // Track resources created so we can attempt cleanup on failure. Not
  // a true transaction (Supabase JS client doesn't expose one) but
  // catches the common "auth user landed, proposal insert failed"
  // case and avoids orphan auth rows.
  let createdAuthUserId: string | null = null;
  let createdContactId: string | null = null;
  let createdProposalId: string | null = null;
  let createdSiteId: string | null = null;

  try {
    // ── 1. Contact row ──
    // Mirrors how the CRM stores contacts elsewhere. We pre-fill
    // client_status = 'client' since they're already paid — same value
    // the payment-confirm route sets on organic contacts after payment.
    const { data: contact, error: contactErr } = await admin
      .from("contacts")
      .insert({
        company_name,
        contact_person: contact_person || null,
        email,
        phone: phone || null,
        town: town || null,
        industry: industry || null,
        // Migrated clients skip the entire prospecting funnel — they
        // arrive as a confirmed customer, not a lead.
        status: "converted",
        client_status: "client",
        // The recipient address for any contact form on their site —
        // prefers the real business email when the operator captured one,
        // otherwise falls back to their login/primary email.
        business_email: business_email || email,
        assigned_to: user.id,
      })
      .select("id")
      .single();
    if (contactErr || !contact) {
      throw new Error(`Contact insert failed: ${contactErr?.message}`);
    }
    createdContactId = contact.id;

    // ── 2. Auth user ──
    const { data: newUser, error: authErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: contact_person || company_name,
        role: "client",
      },
    });
    if (authErr || !newUser?.user) {
      throw new Error(`Auth user creation failed: ${authErr?.message}`);
    }
    createdAuthUserId = newUser.user.id;

    // ── 3. Profile upsert ──
    // The auth-create trigger USUALLY inserts a profile row (role='client',
    // full_name from metadata) which we'd patch here. But the trigger can
    // silently no-op (its INSERT is `on conflict do nothing`, and a bad
    // role cast / race can skip it) — leaving an auth user with NO profile.
    // That broke every downstream idempotency check (profile.role ===
    // "client"), so the client-zone endpoints kept resetting the password:
    // "login works once, then Invalid credentials after logout". UPSERT (not
    // update) guarantees the profile exists regardless of the trigger.
    await admin.from("profiles").upsert(
      {
        id: createdAuthUserId,
        role: "client",
        full_name: contact_person || company_name,
        company_name,
        phone: phone || null,
        is_active: true,
        // Only set when the operator captured an existing mailbox. We
        // avoid writing nulls here so a future re-run / partial update
        // can't blank out a value set elsewhere — the columns already
        // default to null on a fresh profile. Setting these lights up
        // the client zone's "email already set up" state (steps 2 + 3
        // of /client/domain).
        ...(business_email ? { business_email } : {}),
        ...(business_email_password
          ? { business_email_password }
          : {}),
      },
      { onConflict: "id" },
    );

    // ── 4. Synthetic proposal ──
    // sales_person_id MUST be set (NOT NULL FK to profiles). We use
    // the importing user (tech_admin / super_admin) so the FK is
    // satisfied; the is_migrated flag is what downstream code uses to
    // exclude this row from commission + sales-overview reports.
    const variableSymbol = generateVariableSymbol(
      crypto.randomBytes(8).toString("hex"),
    );
    const { data: proposal, error: proposalErr } = await admin
      .from("proposals")
      .insert({
        slug: proposalSlug,
        contact_id: createdContactId,
        sales_person_id: user.id,
        built_by: user.id,
        template_id: null,
        company_name,
        industry: industry || null,
        town: town || null,
        services: [],
        content_overrides: { sections: [] },
        // Already-paid customer — no draft/submitted/sent steps.
        status: "paid",
        paid_at: paidOnIso,
        is_migrated: true,
        // Banner toggle OFF — never inject the payment QR widget on
        // sites whose owner already paid.
        show_banner: false,
        price: amount_paid,
        base_price: amount_paid,
        discount_price: amount_paid,
        variable_symbol: variableSymbol,
        client_temp_password: tempPassword,
      })
      .select("id")
      .single();
    if (proposalErr || !proposal) {
      throw new Error(`Proposal insert failed: ${proposalErr?.message}`);
    }
    createdProposalId = proposal.id;

    // ── 5. Site row ──
    // is_paid: true means the unpaid_publish_gate never fires for this
    // site. is_legacy: false so the composer (not the old GitHub+
    // cheerio editor) handles edits. composition is intentionally
    // empty — tech rebuilds it in the composer.
    const liveDate = new Date(paidOnIso);
    const nextBilling = new Date(paidOnIso);
    nextBilling.setFullYear(nextBilling.getFullYear() + 1);

    const { data: site, error: siteErr } = await admin
      .from("sites")
      .insert({
        name: company_name,
        slug: siteSlug,
        subdomain,
        domain: custom_domain || null,
        owner_id: createdAuthUserId,
        proposal_id: createdProposalId,
        status: "live",
        is_paid: true,
        is_legacy: false,
        composition: { pages: [] },
        // Treat them as having an active custom domain when one was
        // provided — super_admin still has to point DNS at Cloudflare
        // afterwards, but the status flag unblocks the live-domain UI.
        domain_status: custom_domain ? "active" : "none",
        requested_domain: custom_domain || null,
        website_live_date: liveDate.toISOString().split("T")[0],
        next_billing_date: nextBilling.toISOString().split("T")[0],
        billing_cycle_months: 12,
        client_temp_password: tempPassword,
      })
      .select("id")
      .single();
    if (siteErr || !site) {
      throw new Error(`Site insert failed: ${siteErr?.message}`);
    }
    createdSiteId = site.id;

    // Cross-link the contact to the new auth user.
    await admin
      .from("contacts")
      .update({ client_user_id: createdAuthUserId })
      .eq("id", createdContactId);

    // ── 6. Payment ──
    // Only when the amount is known. payments.amount is NOT NULL, so a
    // blank price can't be recorded as a real row — and a $0 confirmed
    // payment would falsely read as a zero-value sale in revenue. When
    // the price is unknown we skip the row entirely; the site is still
    // is_paid = true, so nothing downstream is gated by it. The detail
    // page falls back to "—" when no payment exists.
    if (amount_paid != null) {
      const { data: payment, error: paymentErr } = await admin
        .from("payments")
        .insert({
          profile_id: createdAuthUserId,
          site_id: createdSiteId,
          proposal_id: createdProposalId,
          amount: amount_paid,
          currency: "USD",
          // We don't know how the original migration was paid; bank
          // transfer is the historical default in Peter's flow. The
          // description tags it as a migration for audit clarity.
          payment_method: "bank_transfer",
          status: "confirmed",
          description: `Migration of existing client - VS: ${variableSymbol}`,
        })
        .select("id")
        .single();
      if (paymentErr || !payment) {
        throw new Error(`Payment insert failed: ${paymentErr?.message}`);
      }
    }

    // ── 7. Invoice — REMOVED 2026-05-23 ──
    // Migrated clients already paid you externally and the real
    // legal invoice for that payment lives in your offline accounting
    // system. Auto-generating an FV-YYYYMMDD-NNN row in our DB was
    // creating a phantom invoice that's not a real Slovak accounting
    // document, which confused the Payment card on the Live Clients
    // detail page. The Invoice row is now hidden for migrated rows;
    // organic clients (who pay through the dashboard QR banner) still
    // get a real invoice from /api/admin/payments/confirm.

    // ── 8. Credit balance ──
    await admin.from("credit_balances").upsert(
      {
        site_id: createdSiteId,
        balance: starting_credits,
      },
      { onConflict: "site_id" },
    );

    // ── 9. Optional welcome email ──
    if (send_welcome_email) {
      try {
        const dashboardUrl =
          process.env.NEXT_PUBLIC_CLIENT_URL ||
          process.env.NEXT_PUBLIC_SITE_URL ||
          "https://client.pages.dev";
        const loginUrl = `${dashboardUrl}/login`;
        const html = buildClientWelcomeEmailHtml({
          fullName: contact_person || company_name,
          companyName: company_name,
          loginEmail: email,
          loginPassword: tempPassword,
          loginUrl,
        });
        const result = await sendEmail({
          to: email,
          subject: `Your client zone — ${company_name}`,
          html,
          type: "client",
        });
        if (!result.success) {
          console.error("[MigrateClient] Welcome email failed:", result.error);
        }
      } catch (err) {
        // Non-blocking — the client account is already real and
        // usable; super admin can manually resend credentials later
        // via /super/users.
        console.error("[MigrateClient] Welcome email exception:", err);
      }
    }

    // ── 10. Audit log ──
    // createdProposalId is narrowed to `string | null` by the cleanup
    // pattern, but at this point we've successfully written every
    // upstream row — proposalId is definitely non-null. The `??""`
    // satisfies the audit helper's `string` requirement without
    // adding a runtime branch.
    await logAudit({
      userId: user.id,
      action: "migrate_client",
      entityType: "proposal",
      entityId: createdProposalId ?? "",
      details: {
        company_name,
        email,
        subdomain,
        custom_domain: custom_domain || null,
        // Record whether a business email was captured, but never the
        // password itself — audit details are not a secrets store.
        business_email: business_email || null,
        business_email_provided: !!business_email,
        business_email_password_provided: !!business_email_password,
        amount_paid,
        paid_on: paidOnIso,
        starting_credits,
        welcome_email_sent: send_welcome_email,
      },
    });

    return NextResponse.json({
      success: true,
      proposal_id: createdProposalId,
      site_id: createdSiteId,
      contact_id: createdContactId,
      login_email: email,
      temp_password: tempPassword,
      // Helper the UI can use to redirect straight into the composer
      // — same composer the organic flow uses, just with chrome
      // hidden on is_migrated.
      redirect_to: `/tech/proposals/${createdProposalId}/composer`,
    });
  } catch (err) {
    // Best-effort cleanup — Supabase JS doesn't expose transactions,
    // so we manually unwind in reverse order. Each step is wrapped
    // in its own try so a failed cleanup doesn't mask the original
    // error.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[MigrateClient] Atomic operation failed:", message);

    if (createdSiteId) {
      try { await admin.from("sites").delete().eq("id", createdSiteId); }
      catch (e) { console.error("[MigrateClient] Cleanup site failed:", e); }
    }
    if (createdProposalId) {
      try { await admin.from("proposals").delete().eq("id", createdProposalId); }
      catch (e) { console.error("[MigrateClient] Cleanup proposal failed:", e); }
    }
    if (createdAuthUserId) {
      try { await admin.auth.admin.deleteUser(createdAuthUserId); }
      catch (e) { console.error("[MigrateClient] Cleanup auth user failed:", e); }
    }
    if (createdContactId) {
      try { await admin.from("contacts").delete().eq("id", createdContactId); }
      catch (e) { console.error("[MigrateClient] Cleanup contact failed:", e); }
    }

    return NextResponse.json(
      { error: message, partial_cleanup: true },
      { status: 500 },
    );
  }
}

// ── Small body-parsing helpers ─────────────────────────────────────────
function stringField(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === "string" ? v.trim() : "";
}
function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
/**
 * Build a slug from the company name + a short random suffix so two
 * migrations of "Balkar s.r.o." don't collide. The slug is used both
 * for the proposals.slug column (UNIQUE) and as the public proposal
 * URL — but migrated proposals never publish a public proposal page,
 * so the slug is purely internal.
 */
function makeUniqueSlug(companyName: string): string {
  const base = companyName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "client";
  return `${base}-${crypto.randomBytes(3).toString("hex")}`;
}

/**
 * Slugify a company name into a valid subdomain host label, used when
 * the operator leaves the subdomain blank. Capped at 40 chars so a
 * uniqueness suffix (`-xxxx`) still fits inside the 50-char limit, and
 * trimmed of any leading/trailing hyphen so it passes the host-label
 * regex. Falls back to "client" when the name has no usable characters.
 */
function subdomainBase(companyName: string): string {
  return (
    companyName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "client"
  );
}
