import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Hammer } from "lucide-react";
import Link from "next/link";
import { BuildsClient } from "./builds-client";

export const dynamic = "force-dynamic";

export default async function BuildQueuePage() {
  await requireRole("tech_admin");
  const supabase = await createClient();

  const { data: sites } = await supabase
    .from("sites")
    .select("id, name, slug, status, created_at, updated_at, template_id")
    .in("status", ["queued", "building", "live"])
    .order("created_at", { ascending: false });

  return (
    <div className="dash-root max-w-6xl space-y-8">
      {/* Clean page header — no gradient needed here. Quiet back link above an
          eyebrow + title + one-line subtitle, with a violet icon chip anchoring
          the heading. */}
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="-ml-2 h-8 text-muted-foreground"
        >
          <Link href="/tech">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>

        <div className="flex items-center gap-3.5">
          <span className="dash-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
            <Hammer className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Production
            </p>
            <h1 className="text-2xl font-bold tracking-tight">Build Queue</h1>
          </div>
        </div>
      </div>

      <BuildsClient sites={(sites || []) as never[]} />
    </div>
  );
}
