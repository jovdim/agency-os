/**
 * GET /api/sales/archive-contacts
 *
 * Returns the salesperson's archived contacts (contacts whose most recent
 * call_log outcome is terminal: not_exists / not_interested / never_contact).
 *
 * Deferred from the initial /sales dashboard load — the archive tab is
 * rarely opened, so we save 3 queries + payload bytes by only fetching it
 * when the user clicks the tab.
 *
 * Response: { contacts: CallingContact[], outcomes: Record<id, {outcome, notes, at}> }
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const TERMINAL_OUTCOMES = ["not_exists", "not_interested", "never_contact"];

export async function GET() {
  const { profile } = await requireRole("sales");
  const admin = createAdminClient();

  // 1) Pull the salesperson's terminal call_logs (most recent first,
  //    capped at 500 to bound payload).
  const { data: terminalLogs } = await admin
    .from("call_logs")
    .select("contact_id, outcome, notes, created_at")
    .eq("sales_person_id", profile.id)
    .in("outcome", TERMINAL_OUTCOMES)
    .order("created_at", { ascending: false })
    .limit(500);

  // 2) Collapse to one row per contact (latest terminal log per contact).
  const latestTerminalPerContact = new Map<
    string,
    { outcome: string; notes: string | null; created_at: string }
  >();
  for (const row of terminalLogs ?? []) {
    if (!row.contact_id) continue;
    if (!latestTerminalPerContact.has(row.contact_id)) {
      latestTerminalPerContact.set(row.contact_id, {
        outcome: row.outcome,
        notes: row.notes,
        created_at: row.created_at,
      });
    }
  }

  const candidateIds = Array.from(latestTerminalPerContact.keys());
  if (candidateIds.length === 0) {
    return NextResponse.json({ contacts: [], outcomes: {} });
  }

  // 3) Verify the OVERALL latest log per contact is still terminal — a
  //    newer log with an in-progress/callback outcome would flip them
  //    out of the archive bucket.
  const { data: latestAnyTerminal } = await admin
    .from("call_logs")
    .select("contact_id, outcome, created_at")
    .eq("sales_person_id", profile.id)
    .in("contact_id", candidateIds)
    .order("created_at", { ascending: false })
    .limit(2000);

  const trulyArchived = new Set<string>();
  const seen = new Set<string>();
  for (const row of latestAnyTerminal ?? []) {
    if (!row.contact_id || seen.has(row.contact_id)) continue;
    seen.add(row.contact_id);
    if (TERMINAL_OUTCOMES.includes(row.outcome)) {
      trulyArchived.add(row.contact_id);
    }
  }

  if (trulyArchived.size === 0) {
    return NextResponse.json({ contacts: [], outcomes: {} });
  }

  // 4) Fetch the contact rows themselves.
  const { data: contacts } = await admin
    .from("contacts")
    .select(
      "id, company_name, contact_person, phone, phones, phone_notes, email, website_url, industry, town, status, notes, source, description, services_offered, total_listings, cities_count, postal_code, source_url, created_at",
    )
    .in("id", Array.from(trulyArchived))
    .eq("assigned_to", profile.id);

  // 5) Build the outcome lookup for the rows we're returning.
  const outcomes: Record<
    string,
    { outcome: string; notes: string | null; at: string }
  > = {};
  for (const c of contacts ?? []) {
    const meta = latestTerminalPerContact.get(c.id);
    if (meta) {
      outcomes[c.id] = {
        outcome: meta.outcome,
        notes: meta.notes,
        at: meta.created_at,
      };
    }
  }

  return NextResponse.json({
    contacts: contacts ?? [],
    outcomes,
  });
}
