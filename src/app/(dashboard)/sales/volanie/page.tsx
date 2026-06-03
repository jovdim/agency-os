import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { VolanieClient } from "./volanie-client";

export const dynamic = "force-dynamic";

// Cap each status bucket on the initial load. The page is a sequential
// calling queue (currentIndex pointer), not a paged table — pagination
// controls would break the UX. Capping at 200 gives a sales person a
// reasonable working set; when they exhaust it the page refreshes and
// pulls the next 200. Without a cap, a salesperson assigned 50k contacts
// would download all of them on every render.
const QUEUE_LIMIT = 200;

export default async function VolaniePage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string }>;
}) {
  const { profile } = await requireRole("sales");
  const { contact: startContactId } = await searchParams;
  const supabase = await createClient();
  const admin = createAdminClient();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    { data: newContacts },
    { data: callbackContacts },
    { count: processedTodayCount },
    { data: todayLogs },
  ] = await Promise.all([
    admin
      .from("contacts")
      .select("id, company_name, contact_person, phone, phones, phone_notes, email, website_url, industry, town, status, notes, source, description, services_offered, total_listings, cities_count, source_url, created_at")
      .eq("assigned_to", profile.id)
      .eq("status", "new")
      .or("client_status.is.null,client_status.neq.client")
      .order("created_at", { ascending: true })
      .limit(QUEUE_LIMIT),
    admin
      .from("contacts")
      .select("id, company_name, contact_person, phone, phones, phone_notes, email, website_url, industry, town, status, notes, source, description, services_offered, total_listings, cities_count, source_url, updated_at")
      .eq("assigned_to", profile.id)
      .eq("status", "callback")
      .order("updated_at", { ascending: true })
      .limit(QUEUE_LIMIT),
    supabase
      .from("call_logs")
      .select("id", { count: "exact", head: true })
      .eq("sales_person_id", profile.id)
      .gte("created_at", todayStart.toISOString()),
    supabase
      .from("call_logs")
      .select("id, outcome")
      .eq("sales_person_id", profile.id)
      .gte("created_at", todayStart.toISOString()),
  ]);

  // Count today's outcomes
  const todayProposals = (todayLogs || []).filter(l => l.outcome === "send_proposal").length;
  const todayInvoices = (todayLogs || []).filter(l => l.outcome === "send_invoice").length;

  // Merge new + callback, new first
  const allContacts = [...(newContacts || []), ...(callbackContacts || [])];

  // If a specific contact was requested via ?contact=<id>, ensure it's loaded
  // even if it's not in "new" or "callback" status (e.g. from Active tab).
  let orderedContacts = allContacts;
  if (startContactId) {
    const alreadyInList = allContacts.some(c => c.id === startContactId);
    if (!alreadyInList) {
      const { data: requestedContact } = await admin
        .from("contacts")
        .select("id, company_name, contact_person, phone, phones, phone_notes, email, website_url, industry, town, status, notes, source, description, services_offered, total_listings, cities_count, source_url, created_at")
        .eq("id", startContactId)
        .eq("assigned_to", profile.id)
        .single();
      if (requestedContact) {
        orderedContacts = [requestedContact, ...allContacts];
      }
    } else {
      const targetIdx = allContacts.findIndex(c => c.id === startContactId);
      if (targetIdx > 0) {
        orderedContacts = [allContacts[targetIdx], ...allContacts.slice(0, targetIdx), ...allContacts.slice(targetIdx + 1)];
      }
    }
  }

  return (
    <VolanieClient
      contacts={orderedContacts}
      stats={{
        callsToday: processedTodayCount ?? 0,
        proposalsToday: todayProposals,
        invoicesToday: todayInvoices,
        totalContacts: orderedContacts.length,
      }}
    />
  );
}
