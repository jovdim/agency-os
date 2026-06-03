import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { InvoiceRequestsClient } from "./invoice-requests-client";

export const dynamic = "force-dynamic";

export default async function InvoiceRequestsPage() {
  await requireRole("super_admin");
  const supabase = createAdminClient();

  // Pending and Done split into separate queries running in parallel.
  // Pre-refactor we pulled ALL invoice_requests on every page load and
  // filtered client-side, which grew unbounded over time. Pending is
  // unbounded by design (it's the active work queue — typically small)
  // but `done` is bounded to the last 200 so the page stays fast even
  // after years of operation. If super admin needs older done rows,
  // add a "Load more" later; for now this matches the typical use case
  // (review the recent backlog).
  const [{ data: pendingRaw }, { data: doneRaw }] = await Promise.all([
    supabase
      .from("invoice_requests")
      .select("id, contact_id, company_name, message, is_done, created_at, sales_person_id, admin_response, responded_at, invoice_file_path, invoice_file_name, invoice_file_uploaded_at, profiles:sales_person_id(full_name)")
      .eq("is_done", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("invoice_requests")
      .select("id, contact_id, company_name, message, is_done, created_at, sales_person_id, admin_response, responded_at, invoice_file_path, invoice_file_name, invoice_file_uploaded_at, profiles:sales_person_id(full_name)")
      .eq("is_done", true)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const pending = pendingRaw ?? [];
  const done = doneRaw ?? [];

  return (
    <InvoiceRequestsClient
      pending={pending.map(r => ({ ...r, profiles: Array.isArray(r.profiles) ? r.profiles[0] : r.profiles }))}
      done={done.map(r => ({ ...r, profiles: Array.isArray(r.profiles) ? r.profiles[0] : r.profiles }))}
    />
  );
}
