import { createHash } from "crypto";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

function getHeaders(): Record<string, string> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not configured");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function getAccountId(): string {
  const id = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!id) throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured");
  return id;
}

interface CFResponse<T> {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
}

/**
 * Safely parse a fetch Response as a Cloudflare API JSON envelope.
 * If the body is not JSON (e.g. an HTML error page from a 4xx/5xx), surface
 * a readable error instead of letting `JSON.parse` crash with "Unexpected
 * token '<'". The first 300 chars of the body are included so the dev
 * terminal shows what Cloudflare actually returned.
 */
async function parseCFResponse<T>(
  res: Response,
  label: string,
): Promise<CFResponse<T>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as CFResponse<T>;
  } catch {
    const snippet = text.slice(0, 300).replace(/\s+/g, " ");
    throw new Error(
      `${label} returned non-JSON (status ${res.status}): ${snippet}`,
    );
  }
}

/**
 * Run an async fetch step with exponential backoff on transient failures
 * (5xx HTTP statuses, network errors). Cloudflare's edge occasionally
 * returns 502/503/504 HTML pages from `/pages/assets/upload` and similar
 * endpoints — they almost always succeed on retry. Keep `attempts` small;
 * the publish flow already feels slow at 30s+ per click.
 */
async function withRetry<T>(
  label: string,
  fn: () => Promise<Response>,
  attempts = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fn();
      // Retry on server errors, return on everything else (caller handles 4xx).
      if (res.status >= 500 && res.status <= 599 && i < attempts - 1) {
        const delay = 400 * Math.pow(2, i); // 400ms, 800ms, 1600ms
        console.warn(
          `[cf] ${label} returned ${res.status}, retrying in ${delay}ms (attempt ${i + 1}/${attempts})`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const delay = 400 * Math.pow(2, i);
        console.warn(
          `[cf] ${label} threw (${err instanceof Error ? err.message : "unknown"}), retrying in ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }
  throw lastErr ?? new Error(`${label} failed after ${attempts} attempts`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public: ensureProject — create a Direct-Upload Pages project if needed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensure a Cloudflare Pages project exists for direct uploads (no GitHub source).
 * Idempotent — returns the existing project on subsequent calls.
 *
 * Returns the project's pages.dev subdomain (e.g., "myproject.pages.dev").
 */
export async function ensureDirectUploadProject(
  projectName: string,
): Promise<{ name: string; subdomain: string }> {
  const accountId = getAccountId();

  // Check if it exists
  const checkRes = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}`,
    { headers: getHeaders() },
  );
  if (checkRes.ok) {
    const data = await parseCFResponse<{ name: string; subdomain: string }>(
      checkRes,
      "GET pages/projects/:name",
    );
    if (data.success && data.result) {
      return { name: data.result.name, subdomain: data.result.subdomain };
    }
  }

  // Create it (no source = direct upload)
  const createRes = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/pages/projects`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        name: projectName,
        production_branch: "main",
      }),
    },
  );
  const createData = await parseCFResponse<{
    name: string;
    subdomain: string;
  }>(createRes, "POST pages/projects");

  if (!createData.success || !createData.result) {
    const msg = createData.errors?.map((e) => e.message).join("; ") ?? "Unknown";
    throw new Error(`Failed to create CF Pages project: ${msg}`);
  }

  return {
    name: createData.result.name,
    subdomain: createData.result.subdomain,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public: deployFiles — upload assets + create deployment
// ─────────────────────────────────────────────────────────────────────────────

export interface DeploymentFile {
  /** Path relative to site root, e.g. "index.html" or "about.html" */
  path: string;
  content: string | Buffer;
  contentType: string;
}

export interface DeployResult {
  deploymentId: string;
  /** Stable production URL (subdomain.pages.dev) */
  url: string;
}

/**
 * Upload a set of files to a Cloudflare Pages project as a new deployment.
 *
 * Flow:
 * 1. Get a JWT for asset uploads
 * 2. Compute hashes for each file
 * 3. Ask CF which hashes are missing (smart caching)
 * 4. Upload only missing assets
 * 5. POST deployment with the file manifest
 */
export async function deployFiles(
  projectName: string,
  files: DeploymentFile[],
): Promise<DeployResult> {
  if (files.length === 0) throw new Error("No files to deploy");

  const accountId = getAccountId();

  // ── 1. Get upload JWT ──
  const tokenRes = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/upload-token`,
    { method: "GET", headers: getHeaders() },
  );
  const tokenData = await parseCFResponse<{ jwt: string }>(
    tokenRes,
    "GET upload-token",
  );
  if (!tokenData.success || !tokenData.result?.jwt) {
    const msg = tokenData.errors?.map((e) => e.message).join("; ") ?? "Unknown";
    throw new Error(`Failed to get upload token: ${msg}`);
  }
  const jwt = tokenData.result.jwt;

  // ── 2. Compute hashes ──
  type Asset = {
    hash: string;
    base64: string;
    contentType: string;
    path: string;
  };
  const assets: Asset[] = files.map((f) => {
    const buf = typeof f.content === "string" ? Buffer.from(f.content) : f.content;
    const hash = createHash("sha256")
      .update(buf)
      .update(f.contentType) // mix in contentType so files with same body but different type get different hashes
      .digest("hex")
      .slice(0, 32);
    return {
      hash,
      base64: buf.toString("base64"),
      contentType: f.contentType,
      path: f.path,
    };
  });

  // Build manifest: { "/index.html": "hash1", "/about.html": "hash2" }
  const manifest: Record<string, string> = {};
  for (const a of assets) {
    manifest[`/${a.path.replace(/^\//, "")}`] = a.hash;
  }

  // ── 3. Check which hashes CF is missing ──
  const checkRes = await fetch(`${CF_API_BASE}/pages/assets/check-missing`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ hashes: assets.map((a) => a.hash) }),
  });
  const checkData = await parseCFResponse<string[]>(
    checkRes,
    "/pages/assets/check-missing",
  );
  if (!checkData.success) {
    const msg = checkData.errors?.map((e) => e.message).join("; ") ?? "Unknown";
    throw new Error(`Failed to check missing assets: ${msg}`);
  }
  const missingHashes = new Set(checkData.result ?? []);

  // ── 4. Upload missing assets (batched, 100 per call max) ──
  // The /pages/assets/upload endpoint expects the BODY to be the array
  // directly, NOT wrapped in `{ payload: [...] }`. The wrapper form silently
  // 400s with an HTML error page, which previously crashed JSON.parse with
  // "Unexpected token '<', \"<!DOCTYPE \"...".
  const toUpload = assets.filter((a) => missingHashes.has(a.hash));
  const BATCH = 100;
  for (let i = 0; i < toUpload.length; i += BATCH) {
    const batch = toUpload.slice(i, i + BATCH);
    const payload = batch.map((a) => ({
      key: a.hash,
      value: a.base64,
      metadata: { contentType: a.contentType },
      base64: true,
    }));
    const upRes = await withRetry("/pages/assets/upload", () =>
      fetch(`${CF_API_BASE}/pages/assets/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }),
    );
    const upData = await parseCFResponse<unknown>(upRes, "/pages/assets/upload");
    if (!upData.success) {
      const msg = upData.errors?.map((e) => e.message).join("; ") ?? "Unknown";
      throw new Error(`Failed to upload assets: ${msg}`);
    }
  }

  // ── 5. Create deployment ──
  const form = new FormData();
  form.append("manifest", JSON.stringify(manifest));
  form.append("branch", "main");

  const deployRes = await withRetry(
    "POST pages/projects/:name/deployments",
    () =>
      fetch(
        `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
          body: form,
        },
      ),
  );
  const deployData = await parseCFResponse<{
    id: string;
    url: string;
    short_id?: string;
  }>(deployRes, "POST pages/projects/:name/deployments");
  if (!deployData.success || !deployData.result) {
    const msg = deployData.errors?.map((e) => e.message).join("; ") ?? "Unknown";
    throw new Error(`Failed to create deployment: ${msg}`);
  }

  return {
    deploymentId: deployData.result.id,
    url: deployData.result.url,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public: deletePagesProject — for full teardown
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteDirectUploadProject(projectName: string): Promise<void> {
  const accountId = getAccountId();
  await fetch(
    `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}`,
    { method: "DELETE", headers: getHeaders() },
  );
}
