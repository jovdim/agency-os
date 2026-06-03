"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { StaffNotificationBanner } from "@/components/notifications/staff-notification-banner";
import type { UserRole } from "@/types/database";

export function DashboardShell({
  children,
  userName,
  role,
  hasLegacySite = false,
  salesNewCount = 0,
}: {
  children: React.ReactNode;
  userName: string;
  role: UserRole;
  /** True if the current client owns at least one legacy site — gates the
   *  change-requests sidebar entry. Always false for non-client roles. */
  hasLegacySite?: boolean;
  /** Unread NEW-proposal count for the sales role's sidebar badge. Always
   *  0 for non-sales roles. Computed in layout.tsx via
   *  countNewProposalsForSalesperson(). */
  salesNewCount?: number;
}) {
  const pathname = usePathname();
  const isEditorFullscreen =
    pathname.includes("/sites/") && pathname.endsWith("/edit");
  const isDialer = pathname === "/sales/dialer";

  if (isEditorFullscreen || isDialer) {
    return (
      <div className="h-screen overflow-hidden">
        <main className="h-full overflow-auto bg-background">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar role={role} hasLegacySite={hasLegacySite} salesNewCount={salesNewCount} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar userName={userName} role={role} />
        <main className="flex-1 overflow-auto p-6 bg-background">
          {/* Domain + business-email completion banners. Self-fetches
              /api/notifications on mount; silent when empty. Sits
              above all page content so a fresh "active" event is the
              first thing the requester sees on the next load. */}
          <StaffNotificationBanner role={role} />
          {children}
        </main>
      </div>
    </div>
  );
}
