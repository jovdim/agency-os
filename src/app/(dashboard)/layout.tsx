import { requireAuth } from "@/lib/auth/guards";
import { DashboardShell } from "@/components/layouts/dashboard-shell";
import { countNewProposalsForSalesperson } from "@/lib/sales/proposal-seen";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireAuth();

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
      salesNewCount={salesNewCount}
    >
      {children}
    </DashboardShell>
  );
}
