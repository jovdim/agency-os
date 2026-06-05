import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { Sparkles } from "lucide-react";
import { AiSettingsClient } from "@/app/(dashboard)/super/settings/ai/ai-settings-client";

export const dynamic = "force-dynamic";

/**
 * /tech/settings/ai
 *
 * Tech-side mirror of /super/settings/ai. Same client component, same
 * data, same edit access , Peter wears both hats and the agency's
 * tech admins iterate the copywriting guide alongside templates
 * (related work, same tab makes sense).
 *
 * Both pages read/write the SINGLE composer_ai_settings row, so
 * edits made from /tech are visible to /super and vice versa.
 */
export default async function TechAiSettingsPage() {
  await requireRole("tech_admin");
  const admin = createAdminClient();

  const { data: settings } = await admin
    .from("composer_ai_settings")
    .select("id, copywriting_guide, provider, model, is_active, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

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

  // Recent generations list, last 20. Same shape the super page uses,
  // single shared client component so changes to the table render in
  // both places at once.
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
    <div className="dash-root max-w-6xl space-y-8">
      {/* Clean page header — no gradient, no Back button: the settings shell's
          left sub-sidebar + the main app sidebar both stay visible, so the user
          can navigate away without an inline link. A violet icon chip anchors
          the eyebrow + title, with a calm one-line subtitle underneath. */}
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
          <p className="max-w-2xl text-sm text-muted-foreground">
            The Slovak copywriting guide every AI generation reads from. Shared
            across all techs and super admins. One edit applies to every site.
          </p>
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
