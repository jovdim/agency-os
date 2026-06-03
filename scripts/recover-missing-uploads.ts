/**
 * Recovery for /_uploads/* files that were silently dropped during a
 * past publish (the silent fetchAndPrepare bug fixed in commit f8d1fb5).
 *
 * Strategy: each Cloudflare Pages deploy lives at its own preview URL
 * `{hash}.{project}.pages.dev`. We list all past deployments, then for
 * each missing file we walk back through history trying each preview
 * URL — first hit wins, we download the bytes and save them locally.
 *
 * Usage:
 *   npx tsx scripts/recover-missing-uploads.ts <project-name> <path1> [path2 …]
 *
 * Example:
 *   npx tsx scripts/recover-missing-uploads.ts ploty-br-nky-mp50f88m \
 *     /_uploads/ee891a88559a7ac08d8dadbfbcd38dfd.jpg \
 *     /_uploads/143846937071d664b1e81ef9d4dd5504.svg
 *
 * Saves recovered bytes to ./recovered/<filename>. After running, the
 * operator can re-upload these to the composer to restore the site.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";

async function main() {
  const [project, ...paths] = process.argv.slice(2);
  if (!project || paths.length === 0) {
    console.error(
      "usage: <project-name> <path1> [path2 ...]\n" +
        "       paths can be /_uploads/abc.jpg or full https://...pages.dev/_uploads/abc.jpg",
    );
    process.exit(1);
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    console.error("Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN");
    process.exit(1);
  }

  // Normalize paths to just the /_uploads/... portion.
  const targets = paths.map((p) => {
    if (p.startsWith("http")) {
      try {
        const u = new URL(p);
        return u.pathname;
      } catch {
        return p;
      }
    }
    return p.startsWith("/") ? p : `/${p}`;
  });

  console.log(`project: ${project}`);
  console.log(`targets:\n${targets.map((t) => `  ${t}`).join("\n")}\n`);

  // List all deployments for this project (paginated).
  console.log("Fetching deployment history from Cloudflare…");
  const deployments: Array<{ id: string; url: string; created_on: string }> = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project}/deployments?page=${page}&per_page=25`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );
    if (!res.ok) {
      console.error(
        `Failed to list deployments: ${res.status} ${await res.text()}`,
      );
      process.exit(1);
    }
    const json = (await res.json()) as {
      success?: boolean;
      result?: Array<{ id: string; url?: string; created_on?: string }>;
    };
    if (!json.success || !json.result) break;
    if (json.result.length === 0) break;
    for (const d of json.result) {
      if (d.url) {
        deployments.push({
          id: d.id,
          url: d.url,
          created_on: d.created_on ?? "",
        });
      }
    }
    if (json.result.length < 25) break;
    page++;
    if (page > 20) break; // safety cap — 500 deployments is plenty
  }
  console.log(`Found ${deployments.length} past deployments.\n`);

  // Try each target against each deployment.
  const outDir = path.join(process.cwd(), "recovered");
  if (!existsSync(outDir)) mkdirSync(outDir);

  const results: Array<{ target: string; status: "ok" | "lost"; from?: string }> = [];

  for (const target of targets) {
    console.log(`→ ${target}`);
    let recovered = false;
    for (const deploy of deployments) {
      const url = `${deploy.url.replace(/\/$/, "")}${target}`;
      try {
        const res = await fetch(url);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const filename = path.basename(target);
          const outPath = path.join(outDir, filename);
          writeFileSync(outPath, buf);
          console.log(
            `   ✓ recovered ${buf.length} bytes from ${deploy.url} (${deploy.created_on})`,
          );
          console.log(`   → saved to recovered/${filename}`);
          results.push({ target, status: "ok", from: deploy.url });
          recovered = true;
          break;
        }
      } catch {
        // network blip, try next deployment
      }
    }
    if (!recovered) {
      console.log(`   ✗ not found in any past deployment`);
      results.push({ target, status: "lost" });
    }
    console.log();
  }

  // Summary
  const okCount = results.filter((r) => r.status === "ok").length;
  const lostCount = results.filter((r) => r.status === "lost").length;
  console.log("─".repeat(60));
  console.log(`Recovered: ${okCount} / ${targets.length}`);
  if (lostCount > 0) {
    console.log(`Lost (need re-upload):`);
    for (const r of results) {
      if (r.status === "lost") console.log(`  - ${r.target}`);
    }
  }
}

main();
