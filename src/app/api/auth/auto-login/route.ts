import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";

// AES-256-CBC requires exactly 32 bytes. Pad the fallback so dev doesn't crash.
const ENCRYPTION_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 32) ||
  "default-key-change-me-in-prod!!!"
).padEnd(32, "0").slice(0, 32);

function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(":");
  if (parts.length !== 2) throw new Error("Invalid token format");
  const iv = Buffer.from(parts[0], "hex");
  const encrypted = Buffer.from(parts[1], "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY, "utf-8"), iv);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY, "utf-8"), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

/**
 * GET /api/auth/auto-login?token=ENCRYPTED
 * Auto-logs in a client using encrypted email:password token.
 * Redirects to client dashboard on success.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing_token", req.url));
  }

  try {
    const decrypted = decrypt(decodeURIComponent(token));
    const [email, password] = decrypted.split("|");

    if (!email || !password) {
      return NextResponse.redirect(new URL("/login?error=invalid_token", req.url));
    }

    // Sign in using Supabase admin to get a session
    const admin = createAdminClient();

    // Sign in directly with email + password (no magic link, no expiry)
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase(),
      password,
    });

    if (signInError || !signInData?.session) {
      console.error("[AutoLogin] Sign-in failed:", signInError);
      return NextResponse.redirect(new URL("/login?error=sign_in_failed", req.url));
    }

    // Get user role for redirect
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", signInData.user.id)
      .single();

    const roleRoutes: Record<string, string> = {
      client: "/client",
      sales: "/sales",
      tech_admin: "/tech",
      administrator: "/admin",
      super_admin: "/super",
    };

    const redirectPath = roleRoutes[profile?.role || "client"] || "/client";
    return NextResponse.redirect(new URL(redirectPath, req.url));
  } catch (err) {
    console.error("[AutoLogin] Decryption/login failed:", err);
    return NextResponse.redirect(new URL("/login?error=invalid_token", req.url));
  }
}
