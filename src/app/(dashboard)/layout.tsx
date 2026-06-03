import { requireAuth } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/layouts/dashboard-shell";
import { countNewProposalsForSalesperson } from "@/lib/sales/proposal-seen";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireAuth();

  // For clients only: detect if they own any legacy (pre-composer) site.
  // The change-requests UI ("My changes" sidebar entry, dashboard tiles,
  // /client/requests page) is only meaningful for legacy sites — composer-
  // based sites publish edits directly with no review queue. So we hide
  // the whole change-requests surface from fully-modern clients while
  // keeping it functional for anyone who still has a legacy site.
  let hasLegacySite = false;
  if (profile.role === "client") {
    const supabase = await createClient();
    const { data } = await supabase
      .from("sites")
      .select("id")
      .eq("owner_id", profile.id)
      .eq("is_legacy", true)
      .limit(1);
    hasLegacySite = (data?.length ?? 0) > 0;
  }

  // For sales role only: count of "NEW" proposals (published by IT but not
  // yet opened by the salesperson) for the sidebar badge on "Active".
  // Helper returns 0 on any failure so a flaky query never breaks the chrome.
  let salesNewCount = 0;
  if (profile.role === "sales") {
    salesNewCount = await countNewProposalsForSalesperson(profile.id);
  }

  return (
    <DashboardShell
      userName={profile.full_name}
      role={profile.role}
      hasLegacySite={hasLegacySite}
      salesNewCount={salesNewCount}
    >
      {children}
    </DashboardShell>
  );
}
