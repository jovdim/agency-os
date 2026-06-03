import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";

// CORS headers for cross-origin requests from deployed sites
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { to, name, email, phone, message, _hp_check, _t } = body;

    // Honeypot check — bots fill hidden fields
    if (_hp_check) {
      // Silently accept to not tip off bots
      return NextResponse.json({ success: true }, { headers: corsHeaders });
    }

    // Time check — reject if submitted < 2 seconds after page load
    if (_t && Date.now() - Number(_t) < 2000) {
      console.log("[Contact Form] Rejected: too fast submission", { timeDiff: Date.now() - Number(_t) });
      return NextResponse.json({ success: true }, { headers: corsHeaders });
    }

    // Validate required fields
    if (!to || !name?.trim() || !email?.trim()) {
      return NextResponse.json(
        { error: "Please fill in your name and email." },
        { status: 400, headers: corsHeaders }
      );
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json(
        { error: "Invalid email." },
        { status: 400, headers: corsHeaders }
      );
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || "unknown";

    // Rate limiting — max 3 submissions per IP per hour
    const admin = createAdminClient();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("contact_submissions")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ip)
      .gte("created_at", oneHourAgo);

    if ((count ?? 0) >= 10) {
      return NextResponse.json(
        { error: "Too many messages. Please try again later." },
        { status: 429, headers: corsHeaders }
      );
    }

    // Store submission
    await admin.from("contact_submissions").insert({
      to_email: to.trim(),
      sender_name: name.trim(),
      sender_email: email.trim(),
      sender_phone: phone?.trim() || null,
      message: message?.trim() || null,
      ip_address: ip,
    });

    // Send email
    const senderName = name.trim();
    const senderEmail = email.trim();
    const senderPhone = phone?.trim();
    const senderMessage = message?.trim();

    const emailResult = await sendEmail({
      to: to.trim(),
      subject: `New message from your website from ${senderName}`,
      replyTo: senderEmail,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#1e293b;margin-bottom:16px;">New message from your website</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;width:100px;">Name</td>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#1e293b;font-weight:500;">${senderName}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">Email</td>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;"><a href="mailto:${senderEmail}" style="color:#2563eb;">${senderEmail}</a></td>
            </tr>
            ${senderPhone ? `<tr>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">Phone</td>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;"><a href="tel:${senderPhone}" style="color:#2563eb;">${senderPhone}</a></td>
            </tr>` : ''}
            ${senderMessage ? `<tr>
              <td style="padding:8px 12px;color:#64748b;vertical-align:top;">Message</td>
              <td style="padding:8px 12px;color:#1e293b;white-space:pre-wrap;">${senderMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
            </tr>` : ''}
          </table>
          <p style="margin-top:24px;font-size:12px;color:#94a3b8;">
            This email was sent automatically from the contact form on your website.
            Reply directly to this email to contact the sender.
          </p>
        </div>
      `,
    });

    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (err) {
    console.error("[Contact Form] Error:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500, headers: corsHeaders }
    );
  }
}
