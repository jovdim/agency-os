import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { ArrowLeft, Sparkle as Sparkles } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AiSettingsClient } from "./ai-settings-client";

export const dynamic = "force-dynamic";

/**
 * /super/settings/ai
 *
 * One page, one big textarea. Peter (or any super_admin) writes the
 * Slovak copywriting guide here; every AI generation across the
 * platform reads from this single row.
 *
 * Also surfaces:
 *   - the active provider + model (so we can see at a glance whether
 *     the system is on free Gemini or paid Claude),
 *   - the last-30-day generation count + estimated spend (cheap
 *     visibility for budgeting before we add credit gating).
 */
export default async function AiSettingsPage() {
  await requireRole("super_admin");
  const admin = createAdminClient();

  const { data: settings } = await admin
    .from("composer_ai_settings")
    .select("id, copywriting_guide, provider, model, is_active, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Cheap usage roll-up, last 30 days. Computed server-side so the
  // page paints with real numbers instead of a "loading" spinner.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await admin
    .from("ai_generations")
    .select("status, cost_estimate_usd")
    .gte("created_at", since);

  const total = recent?.length ?? 0;
  const successes = (recent ?? []).filter((r) => r.status === "success").length;
  const totalCost = (recent ?? []).reduce(
    (sum, r) => sum + Number(r.cost_estimate_usd ?? 0),
    0,
  );

  // Recent generations list, last 20. Joined to sites for the human-
  // readable site name + the first 60 chars of the error so the table
  // is debugging-useful without a click-through. Computed server-side
  // so the page paints with the data already in hand, no client fetch.
  const { data: recentRows } = await admin
    .from("ai_generations")
    .select(
      "id, site_id, mode, section_id, status, error, duration_ms, input_tokens, output_tokens, created_at, sites(name)",
    )
    .order("created_at", { ascending: false })
    .limit(20);

  type RecentRow = {
    id: string;
    site_id: string;
    mode: "all" | "section";
    section_id: string | null;
    status: "success" | "parse_retry" | "failed";
    error: string | null;
    duration_ms: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    created_at: string;
    sites?: { name: string | null } | { name: string | null }[] | null;
  };

  const recentGenerations = ((recentRows ?? []) as RecentRow[]).map((row) => {
    const siteRel = row.sites;
    const siteName = Array.isArray(siteRel)
      ? siteRel[0]?.name ?? null
      : siteRel?.name ?? null;
    return {
      id: row.id,
      site_id: row.site_id,
      site_name: siteName,
      mode: row.mode,
      section_id: row.section_id,
      status: row.status,
      error: row.error,
      duration_ms: row.duration_ms,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      created_at: row.created_at,
    };
  });

  return (
    <div className="dash-root max-w-5xl space-y-8">
      {/* Clean page header — a quiet Back link, then eyebrow + title with a
          violet icon chip + one-line subtitle. No gradient: this is a settings
          editor, not a dashboard greeting. */}
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="-ml-2 h-8 gap-1.5 text-muted-foreground"
        >
          <Link href="/super/settings">
            <ArrowLeft className="h-4 w-4" />
            Back to settings
          </Link>
        </Button>

        <div className="flex items-start gap-3.5">
          <span className="dash-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Settings
            </p>
            <h1 className="text-3xl font-bold tracking-tight">
              AI content generation
            </h1>
            <p className="text-sm text-muted-foreground">
              The Slovak copywriting guide every AI generation reads from. One
              edit applies to every site immediately.
            </p>
          </div>
        </div>
      </div>

      <AiSettingsClient
        initialSettings={
          settings
            ? {
                id: settings.id,
                copywriting_guide: settings.copywriting_guide,
                provider: settings.provider,
                model: settings.model,
                is_active: settings.is_active,
                updated_at: settings.updated_at,
              }
            : null
        }
        usage={{
          last30DaysTotal: total,
          last30DaysSuccess: successes,
          last30DaysCostUsd: totalCost,
        }}
        recentGenerations={recentGenerations}
      />
    </div>
  );
}
