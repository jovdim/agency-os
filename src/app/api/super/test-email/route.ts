import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import nodemailer from "nodemailer";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.hostinger.com",
      port: parseInt(process.env.SMTP_PORT || "465"),
      secure: true,
      auth: { user: email, pass: password },
      connectionTimeout: 10000,
    });

    // Verify connection
    await transporter.verify();

    // Send test email to the same address
    await transporter.sendMail({
      from: email,
      to: email,
      subject: "Test — Business Email Working",
      html: `<p>This is a test email from SK Agency OS.<br>Your business email <strong>${email}</strong> is configured correctly.</p>`,
    });

    return NextResponse.json({ success: true, message: "Connection successful — test email sent" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Test Email] Failed:", message);
    return NextResponse.json({
      success: false,
      error: message.includes("auth") || message.includes("credentials")
        ? "Wrong email or password"
        : message.includes("connect") || message.includes("timeout")
          ? "Cannot connect to SMTP server"
          : `Connection failed: ${message}`,
    }, { status: 400 });
  }
}
