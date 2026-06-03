import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SalesDashboardClient } from "./sales-dashboard-client";

export const dynamic = "force-dynamic";

export default async function SalesDashboard() {
  const { profile } = await requireRole("sales");
  const supabase = await createClient();
  const admin = createAdminClient();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    { data: handoverProposals },
    { data: newContacts },
    { data: callbackContacts },
    { count: processedTodayCount },
    { data: todayLogs },
    { data: reminders },
    { count: contactCount },
    { data: allProposals },
    { data: commissions },
    { data: rateRow },
  ] = await Promise.all([
    // Proposals ready to hand over (status = review) + sent proposals needing follow-up
    admin
      .from("proposals")
      .select("id, company_name, status, updated_at, industry, town, contact_id, sent_at, contacts:contact_id(phone), deployments(subdomain)")
      .eq("sales_person_id", profile.id)
      .in("status", ["review", "sent", "viewed"])
      .order("updated_at", { ascending: false }),
    // Contacts to call (new, unprocessed) — first 100 only.
    // Rest fetched on demand via /api/sales/contacts?status=new&offset=…
    admin
      .from("contacts")
      .select("id, company_name, contact_person, phone, phones, phone_notes, email, website_url, industry, town, status, notes, source, description, services_offered, total_listings, cities_count, postal_code, source_url, created_at")
      .eq("assigned_to", profile.id)
      .eq("status", "new")
      .or("client_status.is.null,client_status.neq.client")
      .order("created_at", { ascending: true })
      .limit(100),
    // Callback contacts — first 100 only.
    admin
      .from("contacts")
      .select("id, company_name, contact_person, phone, phones, phone_notes, email, website_url, industry, town, status, notes, source, description, services_offered, total_listings, cities_count, postal_code, source_url, updated_at")
      .eq("assigned_to", profile.id)
      .eq("status", "callback")
      .order("updated_at", { ascending: true })
      .limit(100),
    // Processed today count
    supabase
      .from("call_logs")
      .select("id", { count: "exact", head: true })
      .eq("sales_person_id", profile.id)
      .gte("created_at", todayStart.toISOString()),
    // Today's call logs for history
    supabase
      .from("call_logs")
      .select("id, contact_id, outcome, notes, callback_at, created_at, contacts:contact_id(id, company_name, phone, industry, town)")
      .eq("sales_person_id", profile.id)
      .gte("created_at", todayStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(100),
    // Follow-up reminders
    admin
      .from("proposal_reminders")
      .select("id, proposal_id, reminder_type, due_at, proposals(company_name, contact_id)")
      .eq("sales_person_id", profile.id)
      .eq("is_dismissed", false)
      .lte("due_at", new Date().toISOString())
      .order("due_at", { ascending: true })
      .limit(20),
    // Stats queries
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", profile.id),
    admin
      .from("proposals")
      .select("id, status")
      .eq("sales_person_id", profile.id),
    admin
      .from("commissions")
      .select("amount, is_paid")
      .eq("sales_person_id", profile.id),
    admin
      .from("commission_rates")
      .select("rate")
      .eq("sales_person_id", profile.id)
      .eq("commission_type", "website_sale")
      .maybeSingle(),
  ]);

  const proposals = allProposals ?? [];
  const inProgress = proposals.filter(p => ["submitted", "building", "revision"].includes(p.status));
  const clients = proposals.filter(p => ["accepted", "paid"].includes(p.status));
  const totalEarned = (commissions ?? []).reduce((sum, c) => sum + Number(c.amount), 0);
  const commissionCount = (commissions ?? []).length;
  const commissionRate = rateRow ? Math.round(Number(rateRow.rate) * 100) : 10;

  // ── Wave A: independent follow-up queries in parallel ──
  //   urgentTag       — needed for the urgent-badge count
  //   noAnswerLogs    — retry counter on callback contacts
  //   totalNewCount   — total in "new" bucket (paginated above to 100)
  //   totalCallback   — total in "callback" bucket (paginated above to 100)
  // (In-progress pipeline retired — Active moved to /sales/active.
  //  Archive bucket deferred — fetched lazily on tab click via
  //  /api/sales/archive-contacts.)
  const callbackIds = (callbackContacts ?? []).map(c => c.id);
  const myOpenProposalIds = proposals
    .filter(p => !["paid", "archived"].includes(p.status))
    .map(p => p.id);

  const [
    { data: urgentTag },
    { data: noAnswerLogs },
    { count: totalNewCount },
    { count: totalCallbackCount },
  ] = await Promise.all([
    myOpenProposalIds.length > 0
      ? admin
          .from("proposal_tags")
          .select("id")
          .eq("slug", "urgent")
          .maybeSingle()
      : Promise.resolve({ data: null }),
    callbackIds.length > 0
      ? supabase
          .from("call_logs")
          .select("contact_id")
          .in("contact_id", callbackIds)
          .eq("outcome", "no_answer")
      : Promise.resolve({ data: [] as { contact_id: string }[] }),
    admin
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", profile.id)
      .eq("status", "new")
      .or("client_status.is.null,client_status.neq.client"),
    admin
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", profile.id)
      .eq("status", "callback"),
  ]);

  // Urgent-tag count for the dashboard banner. Counts this salesperson's
  // open proposals attached to the urgent tag (resolved by slug above).
  let urgentCount = 0;
  if (urgentTag && myOpenProposalIds.length > 0) {
    const { count } = await admin
      .from("proposal_tag_assignments")
      .select("proposal_id", { count: "exact", head: true })
      .eq("tag_id", urgentTag.id)
      .in("proposal_id", myOpenProposalIds);
    urgentCount = count ?? 0;
  }

  // no_answer counts → retry counter badge on callback rows.
  const noAnswerCounts: Record<string, number> = {};
  for (const row of noAnswerLogs ?? []) {
    noAnswerCounts[row.contact_id] = (noAnswerCounts[row.contact_id] || 0) + 1;
  }

  // Build a Set of contact IDs that have ACTIVE proposals (not paid/archived/accepted).
  // Used so we can show a secondary "go to proposal" icon even when the latest
  // activity on a contact is something else (e.g. local_market). Archive
  // contacts aren't included here — they'll be enriched on the client when
  // the archive tab loads via /api/sales/archive-contacts.
  const visibleContactIds = Array.from(
    new Set([
      ...(newContacts ?? []).map(c => c.id),
      ...(callbackContacts ?? []).map(c => c.id),
    ])
  );

  const contactsWithProposals: Record<string, boolean> = {};
  if (visibleContactIds.length > 0) {
    const { data: activeProposals } = await admin
      .from("proposals")
      .select("contact_id, status")
      .in("contact_id", visibleContactIds)
      .not("status", "in", "(paid,archived,accepted)");
    for (const p of activeProposals ?? []) {
      if (p.contact_id) contactsWithProposals[p.contact_id] = true;
    }
  }

  return (
    <SalesDashboardClient
      handoverProposals={(handoverProposals ?? []).map(p => ({
        ...p,
        contacts: Array.isArray(p.contacts) ? p.contacts[0] : p.contacts,
        deployments: Array.isArray(p.deployments) ? p.deployments : null,
      }))}
      reminders={(reminders ?? []).map((r) => ({
        ...r,
        proposals: Array.isArray(r.proposals) ? r.proposals[0] : r.proposals,
      }))}
      newContacts={newContacts ?? []}
      callbackContacts={callbackContacts ?? []}
      totalNewCount={totalNewCount ?? 0}
      totalCallbackCount={totalCallbackCount ?? 0}
      archiveContacts={[]}
      archiveOutcomes={{}}
      contactsWithProposals={contactsWithProposals}
      processedTodayCount={processedTodayCount ?? 0}
      todayLogs={todayLogs ?? []}
      noAnswerCounts={noAnswerCounts}
      stats={{
        contactCount: contactCount ?? 0,
        inProgress: inProgress.length,
        reviewCount: (handoverProposals ?? []).filter(p => p.status === "review").length,
        clientCount: clients.length,
        totalEarned,
        commissionRate,
        commissionCount,
      }}
      urgentCount={urgentCount}
    />
  );
}
