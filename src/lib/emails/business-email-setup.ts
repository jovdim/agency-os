/**
 * Email template for the "Business email" timeline step. Used
 * by both the server (sends the actual email) and the client (renders
 * a live preview inside the Compose dialog), so this MUST stay
 * framework-free — no React, no server-only imports.
 *
 *   - The email looks like a plain email, NOT a styled card. Just
 *     paragraphs on a white background, max-width centred. No big
 *     white card with rounded corners, no auto-injected agency
 *     footer — the signature already carries the legal address.
 *   - The default body IS the hand-written template
 *     (forwarded mailbox + Hostinger creds + Gmail-integration
 *     upsell + signature). The tech can edit anything in the
 *     compose dialog.
 *   - Three baked-in placeholders get replaced when the default body
 *     is built: the business email, the contact's personal email,
 *     and the Hostinger password.
 */

export interface BusinessEmailSetupArgs {
  /** Display name used in the dialog title only (not the email body). */
  companyName: string;
  /**
   * The fully composed Tiptap-style HTML body produced by the rich
   * editor in the dialog. Falls back to the Slovak default when
   * blank/null.
   */
  bodyHtml?: string | null;
  /**
   * For the fallback path only: used to fill the credentials lines +
   * "personal email" sentence in the default body when no `bodyHtml`
   * is provided.
   */
  defaults?: {
    contactPersonalEmail: string;
    businessEmail: string;
    businessEmailPassword: string;
  };
}

/**
 * Default email body — hand-written template covering:
 *   1. Notice that the business mailbox was created.
 *   2. Forwarding-to-Gmail explanation.
 *   3. Hostinger login lines.
 *   4. Pitch for the $49 Gmail-integration upsell.
 *   5. Signature + legal company line.
 *
 * Returns Tiptap-shaped HTML so the editor hydrates cleanly. The
 * three credentials values are baked in once at build time — if the
 * tech later edits them in the dialog, they'll either edit the body
 * manually or click "Reset body" to rebuild from the new values.
 */
/**
 * Literals used when an input field is empty at body-build time.
 * Exported so the dialog's runSync() can target the SAME strings
 * during find-and-replace — without that, sync's "if prev.X is truthy"
 * guards would skip empty-prev cases and leave the placeholders in the
 * body untouched (the dots-in-preview / wrong-recipient-email bug
 * hit 2026-05-27 on first send).
 */
export const FALLBACK_BUSINESS_EMAIL = "info@yourcompany.com";
export const FALLBACK_PERSONAL_EMAIL = "your-address@gmail.com";
export const FALLBACK_BUSINESS_EMAIL_PASSWORD = "••••••";
/** Local-part of the catch-all example sentence ("orders@<domain>"). */
export const CATCH_ALL_LOCAL_PART = "orders";

export function buildDefaultBusinessEmailBody({
  contactPersonalEmail,
  businessEmail,
  businessEmailPassword,
}: {
  contactPersonalEmail: string;
  businessEmail: string;
  businessEmailPassword: string;
}): string {
  const beRaw = businessEmail || FALLBACK_BUSINESS_EMAIL;
  const be = escapeHtml(beRaw);
  const pe = escapeHtml(contactPersonalEmail || FALLBACK_PERSONAL_EMAIL);
  const pw = escapeHtml(businessEmailPassword || FALLBACK_BUSINESS_EMAIL_PASSWORD);

  // Catch-all example uses the same domain as the business email but a
  // different local-part, so the example reads "orders@acmeroofing.com"
  // when the mailbox is "info@acmeroofing.com". Falls back to a generic
  // placeholder when the business email doesn't have a parseable domain.
  const domain = beRaw.split("@")[1] || "yourcompany.com";
  const catchAllExample = escapeHtml(`${CATCH_ALL_LOCAL_PART}@${domain}`);

  const integrationUrl = "https://youragency.com";

  // Each line is its own paragraph so the email reads as Gmail-style
  // text, not a single dense block. The credentials line uses <br>
  // (Tiptap HardBreak) to keep the three rows visually grouped.
  return [
    `<p>Hello,</p>`,

    `<p>we'd like to let you know that we've created a business email for you: ${be}. We've automatically forwarded all messages that arrive at this address to your personal email, so you can read them conveniently without needing to log in to your business mailbox.</p>`,

    `<p>These forwarded messages serve as a "notification" — an alert that business correspondence has been delivered to you. You can also reply to these messages directly from your Gmail. Please note, however, that the recipient will see the reply was sent from your Gmail address ${pe} instead of the business email, which doesn't look professional. That's why we're sending you the login details for your business mailbox:</p>`,

    `<p>Email access: <a href="https://mail.hostinger.com">mail.hostinger.com</a><br>Username: ${be}<br>Password: <strong>${pw}</strong></p>`,

    `<p>If you'd prefer to manage your business emails directly within your Gmail account — including sending messages from the address ${be} — we recommend our add-on service: <a href="${integrationUrl}">Business email integration into Gmail</a> ($49 one-time).</p>`,

    `<p><strong>Benefits of the service:</strong></p>`,
    `<ul><li><strong>Professional impression:</strong> Your replies will be sent from your business address.</li><li><strong>Convenience:</strong> You'll be able to manage your business emails directly from your Gmail on your phone — whether you're at the office, on the road, or waiting in line at the checkout.</li><li><strong>"Catch-all" feature:</strong> If someone makes a typo in the username, or uses a different name (e.g. writes ${catchAllExample} instead of ${be}), the message will still reach you.</li></ul>`,

    `<p>If you're interested in this service, you can order it easily by clicking this link: <a href="${integrationUrl}">Business email integration into Gmail</a>. If you have any questions, don't hesitate to contact us.</p>`,

    `<p>Best regards,</p>`,
    `<p><strong>[Your Name]</strong><br>CEO &amp; Business Consultant<br>Mobile: <a href="tel:+421911787825">0911 78 78 25</a><br>Web: <a href="https://youragency.com">youragency.com</a> – Digital agency</p>`,

    `<p>&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt;</p>`,
    `<p>[Your Agency], [Your Address]</p>`,
  ].join("");
}

/**
 * Default subject line. Tech can override in the dialog.
 */
export function defaultBusinessEmailSubject(companyName: string): string {
  return `Your new business email account — ${companyName}`;
}

/**
 * Builds the full email HTML — same output whether called from a
 * server action (real send) or from the client (preview iframe).
 *
 * Plain-email shell: white background, max-width centred, padding,
 * email-safe font stack. NO card, NO border, NO rounded corners,
 * NO auto-footer. The body the tech composed is the entire email.
 */
export function buildBusinessEmailSetupHtml(args: BusinessEmailSetupArgs): string {
  const rawBody =
    (args.bodyHtml ?? "").trim().length > 0
      ? (args.bodyHtml as string)
      : args.defaults
        ? buildDefaultBusinessEmailBody(args.defaults)
        : "";

  const styledBody = inlineStyleBody(rawBody);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!--
  Disable Apple Mail's auto-detection of email addresses, phone
  numbers, dates, and physical addresses. Without this, iOS Mail
  wraps any "looks-like-email" text in a blue link the moment the
  recipient opens the message. Apple respects it; Gmail doesn't —
  Gmail's de-link treatment is handled at body-build time by
  preventEmailAutoLink().
-->
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="x-apple-disable-message-reformatting">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ffffff;color:#1f1f1f">
<div style="max-width:640px;margin:0 auto;padding:32px 24px;font-size:14px;line-height:1.6">
${styledBody}
</div>
</body>
</html>`;
}

/* ─────────────────────────────────────────────────────────────
   Tiptap → email-safe HTML. Mirrors the helper in
   src/lib/email.ts so per-template tweaks don't leak.
   ───────────────────────────────────────────────────────────── */

function inlineStyleBody(html: string): string {
  const styled = html
    .replace(/<p>/g, '<p style="margin:0 0 14px;font-size:14px;color:#1f1f1f;line-height:1.6">')
    .replace(/<h1>/g, '<h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#111;line-height:1.3">')
    .replace(/<h2>/g, '<h2 style="margin:0 0 14px;font-size:18px;font-weight:600;color:#111;line-height:1.3">')
    .replace(/<h3>/g, '<h3 style="margin:14px 0 8px;font-size:15px;font-weight:600;color:#111">')
    .replace(/<ul>/g, '<ul style="margin:8px 0 14px;padding-left:22px;color:#1f1f1f">')
    .replace(/<ol>/g, '<ol style="margin:8px 0 14px;padding-left:22px;color:#1f1f1f">')
    .replace(/<li>/g, '<li style="margin:4px 0;font-size:14px;line-height:1.6">')
    .replace(/<a /g, '<a style="color:#2563eb;text-decoration:underline" ')
    .replace(/<blockquote>/g, '<blockquote style="margin:12px 0;padding:8px 16px;border-left:3px solid #ddd;color:#555;font-style:italic">')
    .replace(/<strong>/g, '<strong style="font-weight:600;color:#111">');

  return preventEmailAutoLink(styled);
}

/**
 * Stop Gmail / Outlook / iOS Mail from auto-wrapping plain email
 * addresses in mailto links. Three complementary moves:
 *
 *   1. Insert a U+200B zero-width space right after the `@` so the
 *      email pattern matcher can't see "local@domain.tld" as one
 *      continuous string — visually identical, defeats the regex.
 *
 *   2. Insert a SECOND U+200B right before the final `.tld` so
 *      Gmail's URL detector can't pick up the bare domain
 *      ("test.sk", "gmail.com") as a standalone clickable link once
 *      step 1 has stripped the email match. Without this Gmail
 *      auto-links the domain alone — pattern: plain "info@", blue
 *      underlined "test.sk". Caught 2026-05-19.
 *
 *   3. Wrap each match in a span whose style inherits everything
 *      (color, decoration, weight) from the surrounding body so that
 *      even if a stubborn client still wraps the address in a link,
 *      the link styling can't bleed through. Belt-and-braces with
 *      the format-detection meta tag in the email <head>.
 *
 * Emails inside an existing <a> tag are intentionally NOT touched —
 * if the tech wrote a hand-coded mailto link, keep it linkable.
 * The walker uses a simple split-on-tag tokenizer and a stack-of-one
 * "are we inside an <a>?" flag instead of a real HTML parser; good
 * enough for the email-safe HTML we produce here.
 */
function preventEmailAutoLink(html: string): string {
  // Match local@domain.tld — same shape the API route accepts at /api/public/contact.
  const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  const ZWSP = "​";
  // font-weight:600 — 2026-05-19: every email in the body should
  // render bold (no per-occurrence <strong> wrapping in the template
  // needed; the post-processor does it uniformly). Same weight as
  // inlineStyleBody emits for <strong>, so emails look consistent
  // with any explicitly-bolded labels around them.
  const STYLE =
    "color:inherit;text-decoration:none;font-weight:600;border:0;background:transparent";
  const parts = html.split(/(<[^>]+>)/);
  let inAnchor = 0;
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        // Tag token. Track <a>...</a> nesting depth so we don't
        // touch the inner text of links the tech wrote on purpose.
        if (/^<a\b/i.test(part)) inAnchor++;
        else if (/^<\/a\s*>/i.test(part)) inAnchor = Math.max(0, inAnchor - 1);
        return part;
      }
      if (inAnchor > 0) return part;
      return part.replace(EMAIL_RE, (addr) => {
        // Two ZWSPs: one after `@` (kills the email pattern), one
        // before the final `.tld` (kills the bare-domain URL
        // pattern that Gmail otherwise picks up). For
        // multi-segment domains like "mail.hostinger.com" the second
        // ZWSP lands before the LAST dot — works for both "x.sk"
        // and "x.co.uk" shapes since we anchor on `$`.
        const broken = addr
          .replace("@", "@" + ZWSP)
          .replace(/\.([A-Za-z]{2,})$/, ZWSP + ".$1");
        return `<span style="${STYLE}">${broken}</span>`;
      });
    })
    .join("");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
