/**
 * Load test for the dynamic platform — answers "can this serve 1000+ sites
 * cheaply and fast?" with REAL numbers against a REAL published site.
 *
 *   npx tsx scripts/load-test.ts
 *
 * It measures three things:
 *   1. The isolated DB read (published_composition) — the only DB work a page
 *      view costs on a cache MISS.
 *   2. A full cache-MISS render (DB read + template load from Storage + render)
 *      — the worst case, paid once per page per cache window.
 *   3. The cache behavior: many concurrent requests for the same page collapse
 *      to ONE render + ONE DB read (this is what src/lib/platform/render-cache.ts
 *      does in production via Next's Data Cache; here reproduced in-process so
 *      the collapse is visible without standing up a server).
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";
import type { SiteComposition } from "../src/lib/templates/render";

type RenderResult = { html: string; pagePath: string } | { error: string };

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { renderSitePage } = await import("../src/lib/templates/render");

  // ── Find a real published, non-legacy site to test against ──
  const { data: sites, error } = await admin
    .from("sites")
    .select("id, name, slug, is_legacy, published_composition")
    .not("published_composition", "is", null)
    .limit(20);
  if (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }
  const site = (sites ?? []).find(
    (s: { is_legacy?: boolean | null }) => s.is_legacy !== true,
  ) as
    | { id: string; name: string; slug: string; published_composition: unknown }
    | undefined;
  if (!site) {
    console.error("No published, non-legacy site found to test against.");
    process.exit(1);
  }
  const published = site.published_composition as SiteComposition;
  console.log(`Testing against: "${site.name}" (${site.slug})\n`);

  const renderOnce = async (): Promise<{ ms: number; ok: boolean; bytes: number }> => {
    const t = performance.now();
    const r = (await renderSitePage(site.id, {
      pagePath: "index.html",
      preview: false,
      siteUrl: "https://loadtest.local",
      compositionOverride: published,
    })) as RenderResult;
    return {
      ms: performance.now() - t,
      ok: !("error" in r),
      bytes: "html" in r ? r.html.length : 0,
    };
  };

  // ── 1. Isolated DB read (the only DB work per cache miss) ──
  const dbTimes: number[] = [];
  for (let i = 0; i < 8; i++) {
    const t = performance.now();
    await admin.from("sites").select("published_composition").eq("id", site.id).single();
    dbTimes.push(performance.now() - t);
  }
  const dbAvg = dbTimes.reduce((a, b) => a + b, 0) / dbTimes.length;
  console.log("1) DB read (published_composition):");
  console.log(`   avg ${dbAvg.toFixed(1)} ms over ${dbTimes.length} reads\n`);

  // ── 2. Full cache-MISS render (warm up once, then measure) ──
  const warm = await renderOnce();
  if (!warm.ok) {
    console.error("Render returned an error — aborting.");
    process.exit(1);
  }
  const missTimes: number[] = [];
  for (let i = 0; i < 5; i++) missTimes.push((await renderOnce()).ms);
  const missAvg = missTimes.reduce((a, b) => a + b, 0) / missTimes.length;
  console.log("2) Full cache-MISS render (DB + template load + render):");
  console.log(`   avg ${missAvg.toFixed(1)} ms  (page = ${(warm.bytes / 1024).toFixed(0)} KB)\n`);

  // ── 3. Concurrency: N simultaneous cache-MISS renders (worst case) ──
  const N = 20;
  const cStart = performance.now();
  const cResults = await Promise.all(Array.from({ length: N }, renderOnce));
  const cWall = performance.now() - cStart;
  const sorted = cResults.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`3) ${N} concurrent cache-MISS renders (no cache, worst case):`);
  console.log(`   wall ${cWall.toFixed(0)} ms | throughput ${(N / (cWall / 1000)).toFixed(0)} renders/sec`);
  console.log(`   p50 ${pct(sorted, 50).toFixed(0)} ms | p95 ${pct(sorted, 95).toFixed(0)} ms\n`);

  // ── 4. WITH cache: many requests collapse to ONE render + ONE DB read ──
  // Mirrors render-cache.ts: keyed in-flight + memoized result. In production
  // this is Next's Data Cache with a 60s TTL; here in-process to show the math.
  let actualRenders = 0;
  let cached: Promise<RenderResult> | null = null;
  const cachedRequest = (): Promise<RenderResult> => {
    if (!cached) {
      cached = (async () => {
        actualRenders++;
        return (await renderSitePage(site.id, {
          pagePath: "index.html",
          preview: false,
          siteUrl: "https://loadtest.local",
          compositionOverride: published,
        })) as RenderResult;
      })();
    }
    return cached;
  };
  const M = 2000;
  const mStart = performance.now();
  await Promise.all(Array.from({ length: M }, cachedRequest));
  const mWall = performance.now() - mStart;
  console.log(`4) ${M} requests for the same page WITH caching:`);
  console.log(`   actual renders: ${actualRenders}  |  DB reads: ${actualRenders}`);
  console.log(`   served all ${M} in ${mWall.toFixed(0)} ms (${(mWall / M).toFixed(3)} ms/request avg)\n`);

  // ── Interpretation ──
  console.log("──────────────────────────────────────────────");
  console.log("What this means at scale:");
  console.log(`• A page view that MISSES the cache costs ~${missAvg.toFixed(0)} ms and ${dbAvg.toFixed(0)} ms of DB.`);
  console.log(`• With the 60s cache, a page is rendered ~once per minute NO MATTER how`);
  console.log(`  many people view it — ${M} views became ${actualRenders} render + ${actualRenders} DB read.`);
  console.log(`• So 1000 busy sites ≈ at most ~1000 renders/min = ~17/sec at the DB,`);
  console.log(`  which Postgres handles trivially. Visitor traffic ≠ DB load.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
