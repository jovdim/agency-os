import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { ProposalWizard } from "./proposal-wizard";

export const dynamic = "force-dynamic";

export default async function NewProposalPage({
  searchParams,
}: {
  searchParams: Promise<{ contactId?: string }>;
}) {
  const { profile } = await requireRole("sales");
  const supabase = await createClient();
  const { contactId } = await searchParams;

  // Fetch contacts assigned to this sales person
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, company_name, contact_person, phone, email, industry, town, quoted_price")
    .eq("assigned_to", profile.id)
    .order("company_name", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-3xl px-1 py-2 sm:py-4">
      <ProposalWizard
        contacts={contacts || []}
        preSelectedContactId={contactId}
      />
    </div>
  );
}
