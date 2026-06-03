import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { TechProposalForm } from "./tech-proposal-form";

export const dynamic = "force-dynamic";

export default async function TechNewProposalPage({
  searchParams,
}: {
  searchParams: Promise<{ contact_id?: string }>;
}) {
  await requireRole("tech_admin");
  const { contact_id } = await searchParams;

  let contact = null;
  if (contact_id) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("contacts")
      .select("*")
      .eq("id", contact_id)
      .single();
    contact = data;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <TechProposalForm contact={contact} />
    </div>
  );
}
