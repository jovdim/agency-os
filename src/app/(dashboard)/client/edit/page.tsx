import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * /client/edit — Redirects to the client's site editor.
 * Each client has one website, so we find it and redirect.
 */
export const dynamic = "force-dynamic";

export default async function ClientEditRedirect() {
  const { profile } = await requireRole("client");
  const supabase = await createClient();

  const { data: sites } = await supabase
    .from("sites")
    .select("id")
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (sites && sites.length > 0) {
    redirect(`/client/sites/${sites[0].id}/edit`);
  }

  // No site — redirect to dashboard which shows the waiting state
  redirect("/client");
}
