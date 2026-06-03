import { requireRole } from "@/lib/auth/guards";
import { SettingsSubsidebar } from "./settings-subsidebar";

/**
 * Tech-side settings shell.
 *
 * Wraps every `/tech/settings/*` page with a left sub-sidebar listing
 * the configuration categories. Pattern mirrors VS Code Settings or
 * GitHub repo settings — main app sidebar on the far left, settings
 * sub-sidebar in the middle, page pane on the right.
 *
 * Today only "AI" lives in the sub-sidebar (composer copywriting
 * rules + provider config). Adding a new category later is a one-line
 * change in `settings-subsidebar.tsx` — keeps every settings page
 * predictably reachable from one shared chrome.
 *
 * Role gate enforced here so individual page files don't have to
 * repeat the requireRole call.
 */
export default async function TechSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("tech_admin");

  return (
    <div className="flex gap-6">
      <SettingsSubsidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
