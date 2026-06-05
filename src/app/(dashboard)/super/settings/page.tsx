import { requireRole } from "@/lib/auth/guards";
import { Settings2, Wrench } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireRole("super_admin");

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Clean page header — title + one-line subtitle. No gradient: this is a
          quiet utility page, so a calm header reads better than a hero band. */}
      <header className="flex items-start gap-4">
        <span className="dash-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
          <Settings2 className="h-5 w-5" />
        </span>
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            System
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            System configuration and preferences for your workspace.
          </p>
        </div>
      </header>

      {/* Calm empty state — nothing to configure yet. Soft card, hairline
          border, blurred shadow via dash-panel; centered icon chip keeps it
          friendly rather than barren. */}
      <section className="dash-panel flex flex-col items-center justify-center px-6 py-16 text-center">
        <span className="dash-chip mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full">
          <Wrench className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium">Nothing to configure here yet</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Configurable options will appear here as they become available.
        </p>
      </section>
    </div>
  );
}
