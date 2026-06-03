import { requireRole } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  await requireRole("administrator");

  return (
    <div className="max-w-xl space-y-3 py-12">
      <h1 className="text-xl font-semibold">Administrator</h1>
      <p className="text-sm text-muted-foreground">
        This area is being consolidated into the Super Admin dashboard.
        Contact your super admin for access.
      </p>
    </div>
  );
}
