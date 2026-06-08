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
  const phone = cap(body.phone, 40);
  const business = cap(body.business, 160);
  const message = cap(body.message, 2000);

  // Every field is required.
  if (!name) {
    return NextResponse.json({ error: "Your name is required." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json({ error: "A phone number is required." }, { status: 400 });
  }
  if (!business) {
    return NextResponse.json({ error: "Your business name is required." }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "Please tell us what you need." }, { status: 400 });
  }

  const notes = [
    "Free-proposal request from the landing page.",
    `Phone: ${phone}`,
    `Project: ${message}`,
  ].join("\n");

  const admin = createAdminClient();
  const base = {
    company_name: business,
    contact_person: name,
    email,
    notes,
    source: "landing",
    status: "new",
    assigned_to: null,
  };

  // Insert with the phone on its own column. If a contact with this phone
  // already exists (unique violation), keep the lead anyway — the number is
  // also preserved in the notes above.
  let { error } = await admin
    .from("contacts")
    .insert({ ...base, phone, phones: [phone] });
  if (error && error.code === "23505") {
    ({ error } = await admin.from("contacts").insert(base));
  }

  if (error) {
    console.error("[public/lead] insert failed:", error.message);
    return NextResponse.json(
      { error: "Could not submit right now. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
