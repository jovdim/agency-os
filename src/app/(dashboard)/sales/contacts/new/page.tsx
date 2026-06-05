import { requireRole } from "@/lib/auth/guards";
import { UserPlus } from "lucide-react";
import { NewContactForm } from "./new-contact-form";

export default async function NewContactPage() {
  await requireRole("sales");

  return (
    <div className="dash-root mx-auto max-w-2xl space-y-6">
      {/* Page header — calm, no gradient. The form below carries its own
          compact back-link + section cards; this frames the task. */}
      <div className="flex items-start gap-3.5">
        <span className="dash-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
          <UserPlus className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Sales · CRM
          </p>
          <h1 className="text-2xl font-bold tracking-tight">New Contact</h1>
          <p className="text-sm text-muted-foreground">
            Capture a fresh lead — company, contact person, and what the tech
            team should know.
          </p>
        </div>
      </div>

      <NewContactForm />
    </div>
  );
}
