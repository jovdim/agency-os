import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";

/**
 * GET /api/sites/[id]/domain — Get domain status for a site
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const admin = createAdminClient();

  // proposal_id pulled in too — needed for the sales-role ownership
  // narrowing below ("only the owning salesperson can act on a site
  // tied to their proposal").
  const { data: site, error } = await admin
    .from("sites")
    .select(
      "id, name, proposal_id, owner_id, domain_status, requested_domain, domain_auth_code, domain_notes, domain_decided_at, requested_email_prefix",
    )
    .eq("id", id)
    .single();

  if (error || !site)
    return NextResponse.json({ error: "Site not found" }, { status: 404 });

  // Access matrix:
  //   tech_admin / super_admin / administrator → always allowed
  //   sales       → allowed iff they own the linked proposal
  //                 (added 2026-05-10 so shared timeline UI works)
  //   client      → allowed iff site.owner_id === user.id
  //   anything else → 403
  const role = user.app_metadata?.role as string;
  if (["administrator", "super_admin", "tech_admin"].includes(role)) {
    // Allowed — fall through.
  } else if (role === "sales") {
    if (!site.proposal_id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const { data: linkedProposal } = await admin
      .from("proposals")
      .select("sales_person_id")
      .eq("id", site.proposal_id)
      .maybeSingle();
    if (!linkedProposal || linkedProposal.sales_person_id !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
  } else {
    if (site.owner_id !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
  }

  // Strip internal columns we only used for the access check before
  // sending the row back to the client.
  const { proposal_id: _pid, owner_id: _oid, ...publicSite } = site as Record<string, unknown>;

  return NextResponse.json({ domain: publicSite });
}

/**
 * PUT /api/sites/[id]/domain — Update domain selection
 * Body: { domain_status, requested_domain?, domain_auth_code? }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const admin = createAdminClient();

  // Fetch site (proposal_id also pulled for the sales ownership guard;
  // domain_requested_by + email_requested_by drive the staff-notification
  // hop when status flips to active).
  const { data: site } = await admin
    .from("sites")
    .select(
      "id, owner_id, proposal_id, domain_status, domain_requested_by, email_requested_by, name",
    )
    .eq("id", id)
    .single();

  if (!site)
    return NextResponse.json({ error: "Site not found" }, { status: 404 });

  // Access matrix mirrors the GET handler:
  //   tech_admin / super_admin / administrator → admin-equivalent
  //   sales       → admin-equivalent for the proposal they own (so the
  //                  shared timeline UI on /sales/proposals/[id] can
  //                  flip domain_status to "active" the same way IT
  //                  does — added 2026-05-10)
  //   client      → can request register_new / transfer / decided_later
  //                  on their OWN site only
  const role = user.app_metadata?.role as string;
  let isAdmin = ["administrator", "super_admin", "tech_admin"].includes(role);

  if (role === "sales") {
    if (!site.proposal_id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const { data: linkedProposal } = await admin
      .from("proposals")
      .select("sales_person_id")
      .eq("id", site.proposal_id)
      .maybeSingle();
    if (!linkedProposal || linkedProposal.sales_person_id !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    // Treat the owning salesperson as admin for the rest of the
    // checks (admin-only statuses, notes, etc.).
    isAdmin = true;
  } else if (!isAdmin) {
    // Client (or any other non-staff role): own-site only.
    if (site.owner_id !== user.id)
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const {
    domain_status,
    requested_domain,
    domain_auth_code,
    requested_email_prefix,
  } = body as {
    domain_status?: string;
    requested_domain?: string;
    domain_auth_code?: string;
    requested_email_prefix?: string | null;
  };

  // ── Prefix-only update fast path ─────────────────────────────────
  // The /client/domain UI has an independent "email name" form that
  // saves just `requested_email_prefix` without touching domain state.
  // Skip status validation + the admin notification email when we
  // detect that shape (no domain_status in body, only the prefix).
  const isPrefixOnlyUpdate =
    !domain_status && requested_email_prefix !== undefined;
  if (isPrefixOnlyUpdate) {
    // Sanitize the same way the full-update path does below.
    let prefixValue: string | null = null;
    if (
      requested_email_prefix !== null &&
      requested_email_prefix !== ""
    ) {
      const cleaned = String(requested_email_prefix)
        .trim()
        .toLowerCase()
        .split("@")[0]
        .replace(/[^a-z0-9._-]/g, "")
        .slice(0, 32);
      if (!cleaned) {
        return NextResponse.json(
          {
            error: "Email prefix must contain at least one letter or number",
          },
          { status: 400 },
        );
      }
      prefixValue = cleaned;
    }

    // Track WHO submitted the prefix request so we can ping them on
    // the dashboard once super provisions the mailbox. Staff request
    // (tech / sales / super) → store the actor's id. Client (owner)
    // request → leave email_requested_by null; owner_id is the implicit
    // requester in that case. Clearing the prefix clears attribution too.
    const isStaffSubmitter = isAdmin; // tech/sales-own/super treated as admin above
    const prefixUpdate: Record<string, unknown> = {
      requested_email_prefix: prefixValue,
    };
    if (prefixValue === null) {
      prefixUpdate.email_requested_by = null;
    } else if (isStaffSubmitter) {
      prefixUpdate.email_requested_by = user.id;
    }

    const { data, error } = await admin
      .from("sites")
      .update(prefixUpdate)
      .eq("id", id)
      .select("id, requested_email_prefix, email_requested_by")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logAudit({
      userId: user.id,
      action: "update_email_prefix",
      entityType: "site",
      entityId: id,
      details: {
        requested_email_prefix: prefixValue,
        submitted_by_staff: isStaffSubmitter,
      },
    });

    return NextResponse.json({ site: data });
  }

  const validStatuses = [
    "register_new",
    "register_in_progress",
    "transfer",
    "transfer_in_progress",
    "decided_later",
    "active",
    "rejected",
  ];
  if (!domain_status || !validStatuses.includes(domain_status)) {
    return NextResponse.json(
      { error: "Invalid domain_status. Must be one of: " + validStatuses.join(", ") },
      { status: 400 },
    );
  }

  // Only admins can move to in-progress / active / rejected
  const adminOnlyStatuses = ["register_in_progress", "transfer_in_progress", "active", "rejected"];
  if (adminOnlyStatuses.includes(domain_status) && !isAdmin) {
    return NextResponse.json(
      { error: "Only admins can set this status" },
      { status: 403 },
    );
  }

  // Validate based on status
  if (domain_status === "register_new") {
    if (!requested_domain?.trim()) {
      return NextResponse.json(
        { error: "Domain name is required" },
        { status: 400 },
      );
    }
    // Basic domain format validation
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;
    if (!domainRegex.test(requested_domain.trim())) {
      return NextResponse.json(
        { error: "Invalid domain format" },
        { status: 400 },
      );
    }
  }

  if (domain_status === "transfer") {
    if (!requested_domain?.trim()) {
      return NextResponse.json(
        { error: "Domain name is required for transfer" },
        { status: 400 },
      );
    }
    if (!domain_auth_code?.trim()) {
      return NextResponse.json(
        { error: "Authorization code (EPP) is required for domain transfer" },
        { status: 400 },
      );
    }
  }

  const updates: Record<string, unknown> = {
    domain_status,
    domain_decided_at: new Date().toISOString(),
  };

  if (requested_domain !== undefined)
    updates.requested_domain = requested_domain.trim().toLowerCase();
  if (domain_auth_code !== undefined)
    updates.domain_auth_code = domain_auth_code.trim();

  // Optional client-requested email prefix (e.g. "info" → info@<their-domain>).
  // Lowercased + stripped of any "@..." the client might paste in. Empty
  // string clears the field. Length-capped so a malicious client can't
  // stuff arbitrary data into the column. Tech reads this during email
  // provisioning; see migration 00059.
  if (requested_email_prefix !== undefined) {
    if (requested_email_prefix === null || requested_email_prefix === "") {
      updates.requested_email_prefix = null;
    } else {
      const cleaned = String(requested_email_prefix)
        .trim()
        .toLowerCase()
        .split("@")[0]
        .replace(/[^a-z0-9._-]/g, "")
        .slice(0, 32);
      if (!cleaned) {
        return NextResponse.json(
          { error: "Email prefix must contain at least one letter or number" },
          { status: 400 },
        );
      }
      updates.requested_email_prefix = cleaned;
    }
  }

  // When the (admin-only) status flips to 'active', also write the canonical
  // `domain` column so render/publish + timeline state can read a single
  // source of truth.
  if (domain_status === "active" && requested_domain) {
    updates.domain = requested_domain.trim().toLowerCase();
  }

  // Admin can also set notes
  if (isAdmin && body.domain_notes !== undefined) {
    updates.domain_notes = body.domain_notes;
  }

  // ── Attribution: who submitted this request? ──
  // Fresh staff-submitted request (register_new / transfer / decided_later)
  // captures the actor so the in-app banner can ping them when super
  // marks active later. Client submissions leave the column null —
  // owner_id is the implicit requester in that case. Clearing through
  // a status change (e.g. back to decided_later) also clears so a
  // future request gets fresh attribution.
  const newRequestStatuses = ["register_new", "transfer", "decided_later"];
  if (newRequestStatuses.includes(domain_status)) {
    updates.domain_requested_by = isAdmin ? user.id : null;
  }

  const { data, error } = await admin
    .from("sites")
    .update(updates)
    .eq("id", id)
    .select("id, domain_status, requested_domain, domain_decided_at")
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    userId: user.id,
    action: "update_domain",
    entityType: "site",
    entityId: id,
    details: { domain_status, requested_domain, is_admin: isAdmin },
  });

  // ── In-app notification: domain went active ──
  // When super (or any admin) flips to 'active', drop a row into
  // staff_notifications addressed to whoever originally requested
  // the work. Recipient defaults to domain_requested_by (the staff
  // submitter); if that's null, the client themselves was the
  // requester and we notify the owner_id instead so the client also
  // sees the banner in their zone.
  //
  // Skipped when the recipient is the same person who just flipped
  // the status (no point banner-pinging yourself for your own action).
  // Skipped on previously-already-active rows so a no-op PUT doesn't
  // generate duplicate banners.
  if (
    domain_status === "active" &&
    site.domain_status !== "active"
  ) {
    const recipientId = site.domain_requested_by ?? site.owner_id ?? null;
    if (recipientId && recipientId !== user.id) {
      const domainLabel =
        (updates.domain as string | undefined) ??
        (requested_domain ? requested_domain.trim().toLowerCase() : null);
      await admin.from("staff_notifications").insert({
        recipient_id: recipientId,
        kind: "domain_active",
        site_id: id,
        payload: {
          domain: domainLabel,
          site_name: site.name ?? null,
        },
      });
    }
  }

  // Notify admin via email when a fresh request comes in (register_new /
  // transfer). Reuses the SAME email body the client-side submissions
  // were already triggering (Peter 2026-05-20: staff-submitted requests
  // are at least as important as client-submitted ones — they shouldn't
  // be silently visible only on /super/domains). Whoever submitted is
  // labelled in the body so super can route follow-ups correctly: client
  // submissions stay neutral; staff submissions name the actor + role.
  if (domain_status === "register_new" || domain_status === "transfer") {
    try {
      const adminEmail = process.env.SMTP_USER || "info@youragency.com";
      const dashboardUrl =
        process.env.NEXT_PUBLIC_SITE_URL || "https://youragency-zone.vercel.app";
      const requestType =
        domain_status === "register_new"
          ? "New domain registration"
          : "Domain transfer";

      // Fetch site + client info for the email body
      const { data: siteInfo } = await admin
        .from("sites")
        .select("name, owner_id")
        .eq("id", id)
        .single();

      let clientEmail = "(unknown)";
      let clientName = "(unknown)";
      if (siteInfo?.owner_id) {
        const { data: { user: authUser } } = await admin.auth.admin.getUserById(siteInfo.owner_id);
        clientEmail = authUser?.email || clientEmail;
        const { data: profile } = await admin
          .from("profiles")
          .select("full_name")
          .eq("id", siteInfo.owner_id)
          .single();
        clientName = profile?.full_name || clientEmail;
      }

      // Submitter attribution. Client submissions (the only ones this
      // path used to handle) keep the original "Client submitted a request"
      // language so existing routines stay familiar. Staff submissions
      // name the actor + role so super knows who to ping back — sales
      // for the original brief, tech for site-build context.
      const isStaffSubmitter = isAdmin;
      let submitterName = clientName;
      let submitterRoleLabel = "Client";
      let introLine = "A client submitted a domain management request.";
      if (isStaffSubmitter) {
        const { data: actorProfile } = await admin
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .single();
        submitterName = actorProfile?.full_name || user.email || "(unknown)";
        submitterRoleLabel =
          role === "super_admin"
            ? "Administrator"
            : role === "tech_admin"
              ? "IT team"
              : role === "sales"
                ? "Salesperson"
                : role === "administrator"
                  ? "Administrator"
                  : "Team";
        introLine = `${submitterRoleLabel} (${submitterName}) submitted a request on behalf of the client.`;
      }

      await sendEmail({
        to: adminEmail,
        subject: `New domain request — ${requested_domain || "(no domain)"}`,
        html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5">
<div style="max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e5e5">
    <h1 style="margin:0 0 16px;font-size:20px;color:#111">New domain request</h1>
    <p style="margin:0 0 12px;font-size:14px;color:#333;line-height:1.6">
      ${introLine}
    </p>

    <div style="margin:16px 0;padding:16px;background:#f8f9fa;border-radius:8px;border:1px solid #e5e5e5">
      <p style="margin:0 0 6px;font-size:13px;color:#333"><strong>Type:</strong> ${requestType}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#333"><strong>Domain:</strong> ${requested_domain || "—"}</p>
      ${domain_status === "transfer" && domain_auth_code ? `<p style="margin:0 0 6px;font-size:13px;color:#333"><strong>EPP code:</strong> ${domain_auth_code}</p>` : ""}
      ${(updates.requested_email_prefix as string | null) ? `<p style="margin:0 0 6px;font-size:13px;color:#333"><strong>Requested email:</strong> ${updates.requested_email_prefix}@${requested_domain || "(domain)"}</p>` : ""}
      <p style="margin:0 0 6px;font-size:13px;color:#333"><strong>Website:</strong> ${siteInfo?.name || "—"}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#333"><strong>Client:</strong> ${clientName}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#333"><strong>Client email:</strong> ${clientEmail}</p>
      <p style="margin:0;font-size:13px;color:#333"><strong>Submitted by:</strong> ${submitterName}${isStaffSubmitter ? ` (${submitterRoleLabel})` : ""}</p>
    </div>

    <div style="text-align:center;margin:24px 0 0">
      <a href="${dashboardUrl}/super/domains" target="_blank" style="display:inline-block;background:#111;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">
        Open domain management →
      </a>
    </div>
  </div>

  <div style="text-align:center;padding:24px 0;font-size:11px;color:#999">
    <p style="margin:0;line-height:1.5">This project is funded and operated by the business consulting agency <strong>Your Agency</strong> and was created to support the digitalization of small and medium-sized businesses as an affordable form of professional web and marketing solutions.</p>
  </div>
</div>
</body>
</html>`,
        type: "global",
      });
    } catch (mailErr) {
      console.error("[Domain] Admin notification email failed:", mailErr);
      // Non-blocking
    }
  }

  return NextResponse.json({ site: data });
}
