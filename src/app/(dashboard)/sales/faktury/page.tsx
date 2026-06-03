import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { FakturyClient } from "./faktury-client";

export const dynamic = "force-dynamic";

export default async function FakturyPage() {
  const { profile } = await requireRole("sales");
  const admin = createAdminClient();

  // Salesperson sees only THEIR OWN invoice requests. tech_admin /
  // super_admin can also navigate here; for them we don't filter — they
  // see all rows. (Edge case: super_admin already has /super/invoice-
  // requests as the real admin view, so this is just a fallback.)
  const showAll = ["tech_admin", "administrator", "super_admin"].includes(
    profile.role,
  );

  let query = admin
    .from("invoice_requests")
    .select(
      "id, company_name, message, is_done, created_at, admin_response, responded_at, invoice_file_path, invoice_file_name, invoice_file_uploaded_at, sent_to_client_at, sent_to_client_email, contacts:contact_id(email)",
    )
    .order("created_at", { ascending: false });

  if (!showAll) {
    query = query.eq("sales_person_id", profile.id);
  }

  const { data: requests } = await query;

  // Normalize the joined contact relation (Supabase returns array | object)
  // so the client receives a flat shape.
  const normalized = (requests ?? []).map((r) => {
    const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
    return {
      ...r,
      contact_email: (contact as { email?: string | null } | null)?.email ?? null,
    };
  });

  return <FakturyClient requests={normalized} />;
}
