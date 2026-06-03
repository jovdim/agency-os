import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
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
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/tech">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Build Queue</h1>
      </div>

      <BuildsClient sites={(sites || []) as never[]} />
    </div>
  );
}
