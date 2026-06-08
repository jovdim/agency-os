import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Public lead capture for the marketing landing page's "Get a free proposal"
 * form. Drops an unassigned `contacts` row (source = "landing") straight into
 * the CRM pool the super/sales contact pages already manage. No auth — this
 * route sits outside the proxy's auth gate (the matcher excludes /api).
 *
 * Spam guards: a honeypot field + basic validation. (Turnstile can layer on
 * later — see CLAUDE.md contact-form notes.)
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cap = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Honeypot — a bot fills this; a human can't see it. Pretend success.
  if (cap(body.company_website, 200)) {
    return NextResponse.json({ ok: true });
  }

  const name = cap(body.name, 120);
  const email = cap(body.email, 200).toLowerCase();
  const business = cap(body.business, 160);
  const message = cap(body.message, 2000);

  if (!name) {
    return NextResponse.json({ error: "Your name is required." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const noteParts = ["Free-proposal request from the landing page."];
  if (message) noteParts.push(`Project: ${message}`);

  const admin = createAdminClient();
  const { error } = await admin.from("contacts").insert({
    company_name: business || name,
    contact_person: name,
    email,
    notes: noteParts.join("\n"),
    source: "landing",
    status: "new",
    assigned_to: null,
  });

  if (error) {
    console.error("[public/lead] insert failed:", error.message);
    return NextResponse.json(
      { error: "Could not submit right now. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
