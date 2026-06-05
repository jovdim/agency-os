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
    // Calm, centered single-column form shell matching the redesigned dashboard
    // surfaces (dash-root namespace + generous breathing room). The form's own
    // chrome (header, contact card, field cards, actions) lives in
    // TechProposalForm; this wrapper just frames it.
    <div className="dash-root mx-auto w-full max-w-4xl py-2 sm:py-4">
      <TechProposalForm contact={contact} />
    </div>
  );
}
