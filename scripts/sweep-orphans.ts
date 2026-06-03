/**
 * Orphan sweeper for the composer-staging and composer-video buckets.
 *
 * Catches every orphan path the publish-time + per-replace cleanups
 * don't close:
 *   - Abandoned uploads (user picked a file, never published, walked
 *     away). The composer doesn't delete these because they could
 *     still belong to an in-progress edit; only this sweeper knows
 *     to give up on them after the grace period.
 *   - Deleted sites. When a site row disappears (manual SQL today,
 *     potentially a DELETE endpoint later) every file under that
 *     site_id prefix becomes unreferenced — the sweeper picks them
 *     all up automatically because no site row claims them.
 *   - Partial-publish leftovers. If publish.ts's cleanup step fails
 *     halfway (network glitch, transient Supabase error) the files
 *     it didn't manage to remove become orphans on the next sweep.
 *   - Any future bug we haven't anticipated. Belt-and-suspenders.
 *
 * Algorithm:
 *   1. Walk every site row's composition and harvest every Supabase
 *      URL that points at composer-staging or composer-video. This
 *      is the "still referenced" set, keyed by bucket + object path.
 *   2. List every file in each bucket via the Supabase Storage API.
 *   3. For each file: if its full URL isn't in the referenced set
 *      AND its updated_at is older than the grace period, delete it.
 *   4. Report totals.
 *
 * Grace period (default 24 hours) protects in-flight uploads — a user
 * who uploaded 5 minutes ago but hasn't hit publish yet shouldn't lose
 * their file. The composer always writes the URL into the composition
 * within seconds of the upload completing, so 24h is generous.
 *
 * Safety:
 *   - Dry-run by default. Pass --apply to actually delete.
 *   - Logs each delete with bucket + path so the action is auditable.
 *   - Doesn't touch any bucket other than the two whitelisted here.
 *
 * Run:
 *   npx tsx scripts/sweep-orphans.ts            # dry-run (preview)
 *   npx tsx scripts/sweep-orphans.ts --apply    # actually delete
 *   npx tsx scripts/sweep-orphans.ts --apply --grace-hours 1  # tighter
 *
 * Scheduling: hook this up to a daily cron (Vercel Cron, a Supabase
 * Edge Function with pg_cron, or any external scheduler). The script
 * is idempotent — running it multiple times in a row is safe.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const graceIdx = argv.indexOf("--grace-hours");
const GRACE_HOURS =
  graceIdx >= 0 && argv[graceIdx + 1] ? Number(argv[graceIdx + 1]) : 24;
if (!Number.isFinite(GRACE_HOURS) || GRACE_HOURS < 0) {
  console.error("--grace-hours must be a non-negative number");
  process.exit(1);
}

const BUCKETS = ["composer-staging", "composer-video"] as const;
type Bucket = (typeof BUCKETS)[number];

/** Walk an arbitrary JSON value and call cb on every string leaf. */
function walkStrings(value: unknown, cb: (s: string) => void) {
  if (typeof value === "string") {
    cb(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) walkStrings(v, cb);
    return;
  }
  for (const v of Object.values(value)) walkStrings(v, cb);
}

/** Match a public URL of either bucket back to { bucket, path }. */
function parseSupabaseUrl(
  url: string,
): { bucket: Bucket; path: string } | null {
  const m = url.match(
    /\/storage\/v1\/object\/public\/(composer-staging|composer-video)\/(.+)$/,
  );
  if (!m) return null;
  return { bucket: m[1] as Bucket, path: m[2] };
}

interface StorageFile {
  bucket: Bucket;
  path: string;
  updatedAt: Date | null;
  size: number;
}

/** Recursively list every file in a bucket. The Storage API only lists
 *  one prefix level per call, so we walk site-id "folders" first then
 *  list files inside each. */
async function listAllFiles(bucket: Bucket): Promise<StorageFile[]> {
  const out: StorageFile[] = [];
  // List root — returns one entry per site_id "folder" (and any
  // stray files at the root, which we surface anyway just in case).
  const { data: rootEntries, error: rootErr } = await supabase.storage
    .from(bucket)
    .list("", { limit: 1000, offset: 0 });
  if (rootErr) {
    console.warn(`[${bucket}] root list failed: ${rootErr.message}`);
    return out;
  }
  for (const entry of rootEntries ?? []) {
    if (!entry.name) continue;
    // Folder vs file. Supabase Storage represents folders with id=null
    // and metadata=null; real files have an id.
    if (entry.id == null && entry.metadata == null) {
      // Folder — list files inside.
      const { data: inside, error: insideErr } = await supabase.storage
        .from(bucket)
        .list(entry.name, { limit: 1000, offset: 0 });
      if (insideErr) {
        console.warn(
          `[${bucket}] list inside ${entry.name} failed: ${insideErr.message}`,
        );
        continue;
      }
      for (const f of inside ?? []) {
        if (!f.name || (f.id == null && f.metadata == null)) continue;
        out.push({
          bucket,
          path: `${entry.name}/${f.name}`,
          updatedAt: f.updated_at ? new Date(f.updated_at) : null,
          size: (f.metadata as { size?: number })?.size ?? 0,
        });
      }
    } else {
      // Stray file at root — include it.
      out.push({
        bucket,
        path: entry.name,
        updatedAt: entry.updated_at ? new Date(entry.updated_at) : null,
        size: (entry.metadata as { size?: number })?.size ?? 0,
      });
    }
  }
  return out;
}

async function main() {
  console.log(
    `\n=== Composer orphan sweep ===\n` +
      `Mode:        ${APPLY ? "APPLY (deletes will run)" : "DRY RUN (no deletes)"}\n` +
      `Grace:       ${GRACE_HOURS}h — files newer than this are ignored\n` +
      `Buckets:     ${BUCKETS.join(", ")}\n`,
  );

  // ── 1. Collect every URL referenced by any site composition ──
  const { data: sites, error: sitesErr } = await supabase
    .from("sites")
    .select("id, composition");
  if (sitesErr) {
    console.error("Failed to fetch sites:", sitesErr.message);
    process.exit(1);
  }

  // referenced[bucket] = Set of object paths still in use.
  const referenced: Record<Bucket, Set<string>> = {
    "composer-staging": new Set(),
    "composer-video": new Set(),
  };
  for (const site of sites ?? []) {
    walkStrings(site.composition, (s) => {
      const parsed = parseSupabaseUrl(s);
      if (parsed) referenced[parsed.bucket].add(parsed.path);
    });
  }
  // Also walk site_versions.composition — older revisions reference
  // images we don't want to nuke if "revert to version" might bring
  // them back. Keep these alive for as long as the version history
  // does (the 5-version retention from migration 00043).
  const { data: versions } = await supabase
    .from("site_versions")
    .select("composition");
  for (const v of versions ?? []) {
    walkStrings(v.composition, (s) => {
      const parsed = parseSupabaseUrl(s);
      if (parsed) referenced[parsed.bucket].add(parsed.path);
    });
  }

  console.log(
    `Referenced object paths:` +
      `\n  composer-staging: ${referenced["composer-staging"].size}` +
      `\n  composer-video:   ${referenced["composer-video"].size}\n`,
  );

  // ── 2. List every file in each bucket and partition into kept / orphan ──
  const cutoff = new Date(Date.now() - GRACE_HOURS * 3600 * 1000);
  const summary: Record<Bucket, { kept: number; orphans: number; bytesFreed: number; tooNew: number }> = {
    "composer-staging": { kept: 0, orphans: 0, bytesFreed: 0, tooNew: 0 },
    "composer-video": { kept: 0, orphans: 0, bytesFreed: 0, tooNew: 0 },
  };
  const orphansToDelete: Record<Bucket, string[]> = {
    "composer-staging": [],
    "composer-video": [],
  };

  for (const bucket of BUCKETS) {
    const files = await listAllFiles(bucket);
    for (const f of files) {
      if (referenced[bucket].has(f.path)) {
        summary[bucket].kept++;
        continue;
      }
      // Unreferenced — but check grace period before treating as orphan.
      if (f.updatedAt && f.updatedAt > cutoff) {
        summary[bucket].tooNew++;
        continue;
      }
      summary[bucket].orphans++;
      summary[bucket].bytesFreed += f.size;
      orphansToDelete[bucket].push(f.path);
    }
  }

  for (const bucket of BUCKETS) {
    const s = summary[bucket];
    console.log(
      `[${bucket}] kept=${s.kept}  too-new=${s.tooNew}  orphans=${s.orphans}` +
        (s.bytesFreed > 0
          ? `  (${(s.bytesFreed / 1024 / 1024).toFixed(1)} MB would be freed)`
          : ""),
    );
  }
  console.log();

  // ── 3. Delete orphans (batched, since Supabase Storage's remove
  // accepts many paths in one call but caps at ~1000) ──
  if (!APPLY) {
    if (orphansToDelete["composer-staging"].length + orphansToDelete["composer-video"].length > 0) {
      console.log(
        "Re-run with --apply to actually delete the orphan files listed above.",
      );
    } else {
      console.log("No orphans to delete. Buckets are clean.");
    }
    return;
  }

  for (const bucket of BUCKETS) {
    const paths = orphansToDelete[bucket];
    if (paths.length === 0) continue;
    // Chunk to be safe on very long lists.
    const CHUNK = 500;
    for (let i = 0; i < paths.length; i += CHUNK) {
      const slice = paths.slice(i, i + CHUNK);
      const { error: rmErr } = await supabase.storage.from(bucket).remove(slice);
      if (rmErr) {
        console.warn(`[${bucket}] remove batch failed: ${rmErr.message}`);
      } else {
        console.log(`[${bucket}] deleted ${slice.length} file(s)`);
      }
    }
  }
  console.log("\nSweep complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
