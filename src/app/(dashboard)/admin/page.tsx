import { requireRole } from "@/lib/auth/guards";
import Link from "next/link";
import { ShieldCheck, ArrowRight, Lifebuoy as LifeBuoy } from "@phosphor-icons/react/ssr";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  await requireRole("administrator");

  return (
    <div className="dash-root max-w-3xl space-y-8">
      {/* Page header — calm title + one-line subtitle. No gradient needed for
          a notice surface; the hierarchy carries it. */}
      <header className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Administrator
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Reporting and oversight tools for this area.
        </p>
      </header>

      {/* Notice panel — explains the consolidation with a quiet violet chip and
          a clear next step, instead of a bare paragraph. */}
      <section className="dash-panel overflow-hidden">
        <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
          <span className="dash-chip inline-flex h-12 w-12 items-center justify-center rounded-xl">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold tracking-tight">
              Consolidating into Super Admin
            </h2>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              This area is being consolidated into the Super Admin dashboard.
              Contact your super admin for access.
            </p>
          </div>
          <Link
            href="/super"
            className="dash-row group mt-1 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold"
          >
            <span className="dash-accent">Go to Super Admin</span>
            <ArrowRight className="dash-accent h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      {/* Quiet helper row — where to turn if access is needed. */}
      <div className="dash-hairline flex items-center gap-3 rounded-xl border px-4 py-3 text-sm text-muted-foreground">
        <span className="dash-chip inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          <LifeBuoy className="h-4 w-4" />
        </span>
        <span>
          Need something from this area? Reach out to your super admin to have it
          enabled for your account.
        </span>
      </div>
    </div>
  );
}
