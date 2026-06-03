import nodemailer from "nodemailer";

/**
 * Email accounts:
 * 1. Global (info@youragency.com / SMTP_USER) — proposals, welcome emails, payment confirmations, all system emails
 * 2. Sales fallback (sales@youragency.com) — for salespeople without personal business email
 * 3. Per-salesperson (e.g. erik@youragency.com) — individual sales outreach
 * 4. Paid (paid@youragency.com / SMTP_PAID_USER) — reserved for future use
 */

const smtpHost = process.env.SMTP_HOST || "smtp.hostinger.com";
const smtpPort = parseInt(process.env.SMTP_PORT || "465");

function createTransporter(user: string, pass: string) {
  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: true,
    auth: { user, pass },
  });
}

// Global transporter (legacy)
const globalTransporter = process.env.SMTP_USER && process.env.SMTP_PASS
  ? createTransporter(process.env.SMTP_USER, process.env.SMTP_PASS)
  : null;

type EmailType = "client" | "sales" | "global";

interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  /** Optional CC recipients. Accepts a comma-separated string
   *  ("a@x.com, b@x.com") or a string array — both are passed straight
   *  through to nodemailer which handles either shape. Use sparingly:
   *  CC'd addresses see the To address too, so don't CC privately-
   *  intended recipients (use BCC for that — not yet wired). */
  cc?: string | string[];
  /** Which email account to use. Default: "global" */
  type?: EmailType;
  /** Per-salesperson credentials (overrides type if provided) */
  senderEmail?: string;
  senderPassword?: string;
  /** Optional file attachments (forwarded to nodemailer) */
  attachments?: EmailAttachment[];
}

function getCredentials(type: EmailType): { user: string; pass: string } | null {
  switch (type) {
    case "client":
      // Client emails use the same global info@youragency.com account
      break;
    case "sales":
      if (process.env.SMTP_SALES_USER && process.env.SMTP_SALES_PASS)
        return { user: process.env.SMTP_SALES_USER, pass: process.env.SMTP_SALES_PASS };
      break;
  }
  // Global fallback: info@youragency.com
  if (process.env.SMTP_USER && process.env.SMTP_PASS)
    return { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  return null;
}

export async function sendEmail({ to, subject, html, replyTo, cc, type = "global", senderEmail, senderPassword, attachments }: SendEmailOptions) {
  // Priority: personal > type-specific > global fallback
  let smtpUser: string | undefined;
  let smtpPass: string | undefined;

  if (senderEmail && senderPassword) {
    smtpUser = senderEmail;
    smtpPass = senderPassword;
  } else {
    const creds = getCredentials(type);
    if (creds) {
      smtpUser = creds.user;
      smtpPass = creds.pass;
    }
  }

  if (!smtpUser || !smtpPass) {
    console.warn(
      "[Email] Not configured — add SMTP_USER and SMTP_PASS to .env.local to enable email sending.",
    );
    return {
      success: false,
      error:
        "Email is not configured yet. Add SMTP credentials (SMTP_USER, SMTP_PASS) to .env.local to enable sending.",
    };
  }

  const transporter = (type === "global" && !senderEmail && globalTransporter)
    ? globalTransporter
    : createTransporter(smtpUser, smtpPass);

  try {
    const info = await transporter.sendMail({
      from: smtpUser,
      to,
      cc,
      subject,
      html,
      replyTo,
      attachments,
    });
    console.log("[Email] Sent:", info.messageId, "to:", to, "cc:", cc ?? "(none)", "from:", smtpUser);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error("[Email] Send failed:", err);
    return { success: false, error: String(err) };
  }
}


/**
 * Parse a user-typed CC string into a validated array of addresses.
 * Accepts comma- OR semicolon-separated input (operators paste from
 * both Gmail and Outlook). Trims whitespace, lower-cases, dedupes.
 * Returns `{ ok: true, cc: [...] }` on success — including an empty
 * array when the input is blank (no CC, no error). Returns
 * `{ ok: false, error }` when any segment fails the email regex.
 *
 * Used by both compose dialogs' API routes (proposal send + Hostinger
 * mailbox login) so the validation message is identical from either
 * surface.
 */
export function parseCcInput(
  raw: unknown,
): { ok: true; cc: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, cc: [] };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: "CC must be a string." };
  }
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, cc: [] };

  const parts = trimmed
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  const seen = new Set<string>();
  const cc: string[] = [];
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const addr of parts) {
    if (!re.test(addr)) {
      return { ok: false, error: `Invalid CC address: ${addr}` };
    }
    if (!seen.has(addr)) {
      seen.add(addr);
      cc.push(addr);
    }
  }
  return { ok: true, cc };
}

export function buildProposalEmailHtml({
  bodyHtml,
  companyName,
  liveUrl,
  salesPersonName,
  loginEmail,
  loginPassword,
  loginUrl,
}: {
  bodyHtml: string;
  companyName: string;
  liveUrl: string;
  salesPersonName: string | null;
  loginEmail?: string | null;
  loginPassword?: string | null;
  loginUrl?: string | null;
}): string {
  // 2026-05-23: credentials moved out of the auto-appended HTML
  // block and into the editable body via mustache placeholders
  // ({client_email}, {client_password}, {login_url}) so the
  // salesperson can edit / reorder / drop them from the body if
  // they want — and the WhatsApp variant uses the same body shape.
  //
  // The plain-email shell now ships a clean styled footer (legal
  // address + youragency.com link) below the editable body. The
  // signature ("Best regards, [Your Agency]") lives in the body; the
  // footer is server-rendered so it's consistent across all sends.
  const dashboardUrl =
    loginUrl ||
    (process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/login`
      : process.env.NEXT_PUBLIC_SITE_URL
        ? `${process.env.NEXT_PUBLIC_SITE_URL}/login`
        : "https://your-agency.vercel.app/login");

  const fullBody = resolvePlaceholders(bodyHtml, {
    website_link: liveUrl,
    salesperson_name: salesPersonName ?? "Your Agency Team",
    client_email: loginEmail ?? "",
    client_password: loginPassword ?? "",
    login_url: dashboardUrl,
  });

  // companyName kept in the signature for callers who haven't
  // updated, but not referenced by the new layout — body owns
  // company-name display when the salesperson wants it.
  void companyName;

  return wrapPlainEmailShell(fullBody);
}

/**
 * Mustache-style placeholder replacement. Used by the proposal
 * email so the salesperson-composed body can reference values
 * (live URL, salesperson name) that only land server-side. Intent:
 * less brittle than asking sales to remember to paste the URL,
 * less complicated than building the body fully server-side.
 *
 * Single-brace tokens ({foo}) are replaced both anchored
 * standalone and inside Tiptap link href attributes
 * (`<a href="{website_link}">…</a>`). Unknown tokens are left
 * intact so a typo'd `{webiste_link}` is visible in the rendered
 * email rather than silently disappearing.
 */
function resolvePlaceholders(
  bodyHtml: string,
  values: Record<string, string>,
): string {
  let out = bodyHtml;
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const safeText = escapeHtml(value);
    // Replace inside href="{key}" attributes with the un-escaped
    // value (URLs already URL-encoded; HTML-escaping breaks them).
    out = out.replace(
      new RegExp(`(href\\s*=\\s*["'])\\{${key}\\}(["'])`, "g"),
      `$1${value}$2`,
    );
    // Replace inline body occurrences with the HTML-escaped value.
    out = out.replace(new RegExp(`\\{${key}\\}`, "g"), safeText);
  }
  return out;
}

/**
 * Plain-email shell — white background, max-width centred, no
 * card, no auto-injected CTA. Mirrors the shape of
 * buildBusinessEmailSetupHtml so the two surfaces feel identical
 * from the client's inbox. Body (greeting, content, signature)
 * lives in the editable area; this shell auto-appends a small
 * styled footer with the legal company info + youragency.com link
 * so every send has a clean, consistent attribution line. The dialog
 * preview mirrors this footer block — keep the two in sync if you
 * change the styling.
 */
function wrapPlainEmailShell(bodyHtml: string): string {
  const styledBody = inlineStyleBody(bodyHtml);
  // KEEP IN SYNC with the dialog's preview-side footer block in
  // src/components/proposal-timeline/send-proposal-dialog.tsx —
  // any styling change here needs to land there too so the preview
  // matches what ships.
  const footer = `
    <div style="margin-top:36px;padding:24px 20px 0;border-top:1px solid #eaeaea;font-size:11px;color:#888;text-align:center;line-height:1.7">
      <p style="margin:0 0 12px;line-height:1.7">
        <strong style="color:#555">[Your Agency]</strong> is a business consulting agency that helps small and medium-sized businesses with digitalization through affordable professional web and marketing solutions.
      </p>
      <p style="margin:0;font-size:10px;color:#aaa;line-height:1.6">
        [Your Address] &nbsp;·&nbsp; <a href="https://youragency.com" style="color:#aaa;text-decoration:underline">youragency.com</a>
      </p>
    </div>`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ffffff;color:#1f1f1f">
<div style="max-width:640px;margin:0 auto;padding:32px 24px;font-size:14px;line-height:1.6">
${styledBody}
${footer}
</div>
</body>
</html>`;
}

/**
 * Builds a follow-up email HTML.
 * Generic wrapper — rich text body + optional CTA.
 */
export function buildFollowUpEmailHtml({
  bodyHtml,
  companyName,
  liveUrl,
  salesPersonName,
}: {
  bodyHtml: string;
  companyName: string;
  liveUrl: string | null;
  salesPersonName: string | null;
}): string {
  return wrapEmailShell({
    bodyHtml,
    companyName,
    ctaUrl: liveUrl,
    ctaLabel: liveUrl ? "View website" : null,
    salesPersonName,
    footerUrl: liveUrl,
  });
}

/**
 * Shared email shell — wraps rich text body in a styled email template.
 */
function wrapEmailShell({
  bodyHtml,
  companyName,
  ctaUrl,
  ctaLabel,
  salesPersonName,
  footerUrl,
}: {
  bodyHtml: string;
  companyName: string;
  ctaUrl: string | null;
  ctaLabel: string | null;
  salesPersonName: string | null;
  footerUrl: string | null;
}): string {
  // Convert Tiptap HTML tags to inline-styled email-safe HTML
  const styledBody = inlineStyleBody(bodyHtml);

  const ctaBlock = ctaUrl && ctaLabel
    ? `<div style="text-align:center;margin:24px 0 16px">
        <a href="${escapeHtml(ctaUrl)}" target="_blank" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:600">
          ${escapeHtml(ctaLabel)}
        </a>
      </div>`
    : "";

  const urlBlock = footerUrl
    ? `<p style="text-align:center;font-size:12px;color:#888;margin:8px 0 0">
        <a href="${escapeHtml(footerUrl)}" style="color:#2563eb;text-decoration:underline">${escapeHtml(footerUrl)}</a>
      </p>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5">
<div style="max-width:600px;margin:0 auto;padding:24px">
  <!-- Card -->
  <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e5e5">
    <!-- Body -->
    <div style="font-size:14px;color:#333;line-height:1.6;margin-bottom:8px">
      ${styledBody}
      ${salesPersonName ? `<p style="margin:16px 0 0;font-weight:600">${escapeHtml(salesPersonName)}</p>` : ""}
    </div>

    <!-- Company Name -->
    <div style="text-align:center;margin:24px 0 8px">
      <h1 style="margin:0;font-size:22px;color:#111">${escapeHtml(companyName)}</h1>
    </div>

    ${ctaBlock}
    ${urlBlock}
  </div>

  <!-- Footer -->
  <div style="text-align:center;padding:24px 0;font-size:11px;color:#999">
    <p style="margin:0;line-height:1.5">This project is funded and operated by the business consulting agency <strong>[Your Agency]</strong> and was created to support the digitalization of small and medium-sized businesses as an affordable form of professional web and marketing solutions.</p>
  </div>
</div>
</body>
</html>`;
}

/**
 * Add inline styles to Tiptap HTML for email client compatibility.
 */
function inlineStyleBody(html: string): string {
  return html
    .replace(/<p>/g, '<p style="margin:0 0 8px;font-size:14px;color:#333;line-height:1.6">')
    .replace(/<h2>/g, '<h2 style="margin:16px 0 8px;font-size:18px;font-weight:600;color:#111">')
    .replace(/<h3>/g, '<h3 style="margin:12px 0 6px;font-size:16px;font-weight:600;color:#111">')
    .replace(/<ul>/g, '<ul style="margin:4px 0 8px;padding-left:20px;color:#333">')
    .replace(/<ol>/g, '<ol style="margin:4px 0 8px;padding-left:20px;color:#333">')
    .replace(/<li>/g, '<li style="margin:2px 0;font-size:14px">')
    .replace(/<a /g, '<a style="color:#2563eb;text-decoration:underline" ')
    .replace(/<blockquote>/g, '<blockquote style="margin:8px 0;padding:8px 16px;border-left:3px solid #ddd;color:#666;font-style:italic">');
}

/**
 * Builds the welcome email for a newly created client account.
 * Contains login credentials + link to their dashboard.
 */
export function buildClientWelcomeEmailHtml({
  fullName,
  companyName,
  loginEmail,
  loginPassword,
  siteUrl,
  loginUrl,
  customMessage,
}: {
  fullName: string;
  companyName?: string;
  loginEmail: string;
  loginPassword: string;
  siteUrl?: string;
  loginUrl: string;
  customMessage?: string;
}): string {
  const siteName = companyName || fullName;

  const customBlock = customMessage
    ? `<div style="margin:16px 0;padding:16px;background:#fffbeb;border-radius:8px;border:1px solid #fde68a;font-size:14px;color:#333;line-height:1.6;white-space:pre-wrap">${escapeHtml(customMessage)}</div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5">
<div style="max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e5e5">
    <h1 style="margin:0 0 16px;font-size:22px;color:#111">Your client zone is ready</h1>

    <p style="margin:0 0 8px;font-size:14px;color:#333;line-height:1.6">
      Hello${fullName ? `, ${escapeHtml(fullName)}` : ""},
    </p>
    <p style="margin:0 0 12px;font-size:14px;color:#333;line-height:1.6">
      we're sending you access to the client zone for <strong>${escapeHtml(siteName)}</strong>, where you can manage your website.
    </p>
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6">
      We've added <strong>€50 in credit</strong> to your account, which you can use to send us change requests directly through the client zone.
    </p>

    ${customBlock}

    <div style="margin:20px 0;padding:20px;background:#f8f9fa;border-radius:8px;border:1px solid #e5e5e5">
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:0.5px">Login details</p>
      <p style="margin:0 0 4px;font-size:13px;color:#333">Login: <a href="${escapeHtml(loginUrl)}" style="color:#2563eb;text-decoration:underline">${escapeHtml(loginUrl.replace(/^https?:\/\//, "").replace(/\/login$/, ""))}</a></p>
      <p style="margin:0 0 4px;font-size:13px;color:#333">Email: <strong>${escapeHtml(loginEmail)}</strong></p>
      <p style="margin:0 0 0;font-size:13px;color:#333">Password: <strong>${escapeHtml(loginPassword)}</strong></p>
    </div>

    <div style="text-align:center;margin:24px 0 16px">
      <a href="${escapeHtml(loginUrl)}" target="_blank" style="display:inline-block;background:#111;color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:600">
        Log in →
      </a>
    </div>

    ${siteUrl ? `<p style="margin:8px 0 0;font-size:13px;color:#666;text-align:center">Your website: <a href="${escapeHtml(siteUrl)}" style="color:#2563eb;text-decoration:underline">${escapeHtml(siteUrl)}</a></p>` : ""}

    <p style="margin:24px 0 0;font-size:13px;color:#666;line-height:1.5">
      After logging in, you can edit the text and images on your website directly through the visual editor, or simply send us a change request.
    </p>
  </div>

  <div style="text-align:center;padding:24px 0;font-size:11px;color:#999">
    <p style="margin:0;line-height:1.5">This project is funded and operated by the business consulting agency <strong>[Your Agency]</strong> and was created to support the digitalization of small and medium-sized businesses as an affordable form of professional web and marketing solutions.</p>
  </div>
</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
