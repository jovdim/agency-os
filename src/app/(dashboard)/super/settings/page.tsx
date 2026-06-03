import { requireRole } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireRole("super_admin");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-muted-foreground">
        Nothing to configure here yet.
      </p>
    </div>
  );
}
