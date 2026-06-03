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

/**
 * Create a Cloudflare Pages project connected to a GitHub repo.
 */
export async function createPagesProject(
  projectName: string,
  githubRepoFullName: string,
): Promise<{ id: string; subdomain: string }> {
  const accountId = getAccountId();
  const owner = process.env.GITHUB_OWNER;

  const body = {
    name: projectName,
    production_branch: "main",
    source: {
      type: "github",
      config: {
        owner,
        repo_name: githubRepoFullName.split("/").pop(),
        production_branch: "main",
        deployments_enabled: true,
      },
    },
    build_config: {
      build_command: "",
      destination_dir: "",
    },
  };

  const doCreate = async () => {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/pages/projects`,
      {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(body),
      },
    );
    return res.json();
  };

  let data = await doCreate();

  // If project already exists (from a prior failed deploy), delete the stale one and retry once.
  const alreadyExists =
    !data.success &&
    Array.isArray(data.errors) &&
    data.errors.some(
      (e: { code?: number; message?: string }) =>
        e.code === 8000002 ||
        (typeof e.message === "string" && e.message.toLowerCase().includes("already exists")),
    );

  if (alreadyExists) {
    try {
      await deletePagesProject(projectName);
      data = await doCreate();
    } catch (delErr) {
      throw new Error(
        `CF Pages project '${projectName}' exists and could not be deleted automatically: ${
          delErr instanceof Error ? delErr.message : String(delErr)
        }. Delete it manually in Cloudflare dashboard.`,
      );
    }
  }

  if (!data.success) {
    throw new Error(
      `Failed to create CF Pages project: ${JSON.stringify(data.errors)}`,
    );
  }

  return {
    id: data.result.id,
    subdomain: data.result.subdomain,
  };
}

/**
 * Delete a Cloudflare Pages project by name.
 * Used to clean up after failed deploys so a retry doesn't collide.
 */
export async function deletePagesProject(projectName: string): Promise<void> {
  const accountId = getAccountId();
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}`,
    { method: "DELETE", headers: getHeaders() },
  );
  // 404 is fine — already gone
  if (res.status === 404) return;
  const data = await res.json();
  if (!data.success) {
    throw new Error(
      `Failed to delete CF Pages project '${projectName}': ${JSON.stringify(data.errors)}`,
    );
  }
}

/**
 * Add a custom domain to a Cloudflare Pages project.
 * Also creates the CNAME DNS record in the zone.
 */
export async function setCustomDomain(
  projectName: string,
  domain: string,
): Promise<void> {
  const accountId = getAccountId();

  // 1. Create the CNAME DNS record pointing to the Pages project
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!zoneId) {
    throw new Error(
      "CLOUDFLARE_ZONE_ID is not configured — cannot create DNS records for custom domain",
    );
  }

  const pagesTarget = `${projectName}.pages.dev`;

  // Check if record already exists
  const checkRes = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(domain)}`,
    { headers: getHeaders() },
  );
  const checkData = await checkRes.json();
  const existing = checkData.result?.[0];

  if (existing) {
    // Update existing record
    const updateRes = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/dns_records/${existing.id}`,
      {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({
          type: "CNAME",
          name: domain,
          content: pagesTarget,
          proxied: true,
        }),
      },
    );
    const updateData = await updateRes.json();
    if (!updateData.success) {
      throw new Error(
        `Failed to update DNS record for ${domain}: ${JSON.stringify(updateData.errors)}`,
      );
    }
    console.log(`DNS record updated: ${domain} -> ${pagesTarget}`);
  } else {
    // Create new CNAME record
    const dnsRes = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/dns_records`,
      {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          type: "CNAME",
          name: domain,
          content: pagesTarget,
          proxied: true,
        }),
      },
    );
    const dnsData = await dnsRes.json();
    if (!dnsData.success) {
      throw new Error(
        `Failed to create DNS record for ${domain}: ${JSON.stringify(dnsData.errors)}`,
      );
    }
    console.log(`DNS record created: ${domain} -> ${pagesTarget}`);
  }

  // 2. Wait for DNS record to propagate within Cloudflare's internal systems
  console.log("Waiting 5s for DNS propagation...");
  await new Promise((r) => setTimeout(r, 5000));

  // 3. Register the custom domain on the Pages project (with retry)
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/domains`,
      {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ name: domain }),
      },
    );

    const data = await res.json();
    if (data.success) {
      console.log(`Custom domain ${domain} registered on Pages project`);
      return;
    }

    const alreadyExists = data.errors?.some(
      (e: { code: number }) => e.code === 8000040,
    );
    if (alreadyExists) {
      console.log(`Custom domain ${domain} already registered on Pages project`);
      return;
    }

    if (attempt === 0) {
      console.warn(`Domain registration attempt 1 failed, retrying in 10s: ${JSON.stringify(data.errors)}`);
      await new Promise((r) => setTimeout(r, 10000));
    } else {
      throw new Error(
        `Failed to register custom domain ${domain} on Pages: ${JSON.stringify(data.errors)}`,
      );
    }
  }
}

/**
 * Ensure a custom domain is mapped to a Pages project, fast-path when it
 * already is. Used on every publish: first call sets up the DNS + Pages
 * registration (~5-15s); subsequent calls return in ~100ms after a single
 * GET to verify it's still in place.
 *
 * Returns true if the domain is set up after this call, false if setup
 * failed (caller decides whether to fall back to the .pages.dev URL).
 */
export async function ensureCustomDomain(
  projectName: string,
  domain: string,
): Promise<boolean> {
  const accountId = getAccountId();
  // Fast check: is the domain already registered on this project? CF returns
  // 200 + active record, or 404 / non-success when it's missing.
  try {
    const checkRes = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/domains/${encodeURIComponent(domain)}`,
      { headers: getHeaders() },
    );
    if (checkRes.ok) {
      const checkData = await checkRes.json();
      if (checkData.success && checkData.result?.status === "active") {
        return true; // Already set up — skip the full re-registration dance.
      }
    }
  } catch {
    // Network blip — fall through to the full setup, which has its own retries.
  }

  try {
    await setCustomDomain(projectName, domain);
    return true;
  } catch (err) {
    console.error(
      `[cf] Failed to ensure custom domain ${domain} on ${projectName}:`,
      err,
    );
    return false;
  }
}

/**
 * Update the custom domain on an existing Pages project.
 * Removes the old domain (DNS + Pages registration) and sets the new one.
 */
export async function updateCustomDomain(
  projectName: string,
  oldDomain: string,
  newDomain: string,
): Promise<void> {
  const accountId = getAccountId();
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!zoneId) {
    throw new Error("CLOUDFLARE_ZONE_ID is not configured");
  }

  // 1. Remove old custom domain from Pages project (best effort)
  try {
    await fetch(
      `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/domains/${encodeURIComponent(oldDomain)}`,
      { method: "DELETE", headers: getHeaders() },
    );
    console.log(`Removed old domain ${oldDomain} from Pages project`);
  } catch (err) {
    console.warn(`Failed to remove old domain ${oldDomain} from Pages:`, err);
  }

  // 2. Delete old DNS CNAME record (best effort)
  try {
    const checkRes = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(oldDomain)}`,
      { headers: getHeaders() },
    );
    const checkData = await checkRes.json();
    const existing = checkData.result?.[0];
    if (existing) {
      await fetch(
        `${CF_API_BASE}/zones/${zoneId}/dns_records/${existing.id}`,
        { method: "DELETE", headers: getHeaders() },
      );
      console.log(`Deleted old DNS record for ${oldDomain}`);
    }
  } catch (err) {
    console.warn(`Failed to delete old DNS record for ${oldDomain}:`, err);
  }

  // 3. Set up new custom domain (DNS + Pages registration)
  await setCustomDomain(projectName, newDomain);
}

/**
 * Remove a subdomain routing on the *.{PROPOSAL_DOMAIN} zone WITHOUT
 * setting a replacement up. Two-step:
 *
 *   1. Remove the domain from the Pages project's custom domains list
 *      (so Cloudflare stops accepting traffic for it on this project)
 *   2. Delete the matching CNAME record from the *.{PROPOSAL_DOMAIN}
 *      zone (so DNS no longer resolves)
 *
 * Both steps are best-effort: a 4xx/5xx from either is logged and
 * swallowed. The caller should treat this as a non-fatal cleanup —
 * the custom domain remains active even if cleanup fails.
 *
 * Used by the custom-domain pipeline's terminal step (per Peter
 * 2026-05-10 v3): once the real custom domain is active and verified
 * serving content, we drop the *.{PROPOSAL_DOMAIN} fallback so the
 * subdomain slot is freed up for new clients.
 *
 * `fullSubdomain` is the full hostname (e.g. "clientname.2dni.sk"),
 * NOT just the subdomain prefix.
 */
export async function removeSubdomainRouting(
  projectName: string,
  fullSubdomain: string,
): Promise<{ pagesRemoved: boolean; dnsRemoved: boolean; errors: string[] }> {
  const accountId = getAccountId();
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const errors: string[] = [];
  let pagesRemoved = false;
  let dnsRemoved = false;

  if (!zoneId) {
    errors.push("CLOUDFLARE_ZONE_ID is not configured");
    return { pagesRemoved, dnsRemoved, errors };
  }

  // 1. Remove from Pages project's custom domains list.
  try {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/domains/${encodeURIComponent(fullSubdomain)}`,
      { method: "DELETE", headers: getHeaders() },
    );
    // 200 = removed, 404 = already gone (treat as success).
    if (res.ok || res.status === 404) {
      pagesRemoved = true;
    } else {
      const body = await res.text().catch(() => "");
      errors.push(`Pages DELETE ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    errors.push(
      `Pages DELETE failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Delete the matching CNAME record from the zone.
  try {
    const checkRes = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(fullSubdomain)}`,
      { headers: getHeaders() },
    );
    const checkData = await checkRes.json();
    const existing = checkData.result?.[0];
    if (!existing) {
      // Already gone — treat as success.
      dnsRemoved = true;
    } else {
      const delRes = await fetch(
        `${CF_API_BASE}/zones/${zoneId}/dns_records/${existing.id}`,
        { method: "DELETE", headers: getHeaders() },
      );
      if (delRes.ok) {
        dnsRemoved = true;
      } else {
        const body = await delRes.text().catch(() => "");
        errors.push(`DNS DELETE ${delRes.status}: ${body.slice(0, 200)}`);
      }
    }
  } catch (err) {
    errors.push(
      `DNS lookup/delete failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { pagesRemoved, dnsRemoved, errors };
}

/**
 * Self-healing cleanup for `*.{PROPOSAL_DOMAIN}` orphan mappings on a
 * single Cloudflare Pages project. Lists every custom domain currently
 * registered on the project, filters to those ending with the proposal
 * domain (so we never touch the client's real `.sk` domain or its
 * `www.` sibling), and removes any that don't match `keepSubdomain`.
 *
 * Why this exists: `updateCustomDomain` is best-effort on the DELETE
 * side — if Cloudflare returns a transient 5xx or the old subdomain is
 * still in a "Verifying" state and refuses deletion, the swallowed
 * failure leaves the old mapping stuck on the project. Across many
 * rapid subdomain changes (or a hiccup-prone window), leftovers pile
 * up — Peter saw three stacked entries before this cleanup landed.
 *
 * SAFETY: this function ONLY operates on the SPECIFIC PROJECT passed
 * in. Each Pages project belongs to exactly one site, so the blast
 * radius is bounded to that one site's CF mappings. Other sites' CF
 * projects are not listed, not inspected, not touched.
 *
 *   - `projectName`: CF Pages project name (one per site)
 *   - `keepSubdomain`: full hostname like "balkar.2dni.sk" — the
 *     subdomain to PRESERVE. Pass `null` when no subdomain should be
 *     kept (e.g. after custom domain went active and we want every
 *     fallback subdomain gone).
 *
 * Returns a summary of what was removed for logging. Best-effort
 * throughout; individual failures are logged + collected but never
 * thrown, so a CF blip doesn't surface to the user mid-flow.
 */
export async function cleanupOrphanedFallbackSubdomains(args: {
  projectName: string;
  keepSubdomain: string | null;
}): Promise<{
  removed: string[];
  errors: string[];
}> {
  const { projectName, keepSubdomain } = args;
  const accountId = getAccountId();
  const proposalDomain = process.env.PROPOSAL_DOMAIN || "";
  const removed: string[] = [];
  const errors: string[] = [];

  if (!proposalDomain) {
    errors.push("PROPOSAL_DOMAIN env var not configured — skipping cleanup");
    return { removed, errors };
  }

  // List every custom domain registered on this project. CF returns
  // them in one response (no pagination on this endpoint).
  let allDomains: Array<{ name?: string }> = [];
  try {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/domains`,
      { headers: getHeaders() },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      errors.push(`List domains ${res.status}: ${body.slice(0, 200)}`);
      return { removed, errors };
    }
    const data = (await res.json()) as {
      success?: boolean;
      result?: Array<{ name?: string }>;
    };
    if (!data.success || !Array.isArray(data.result)) {
      errors.push("List domains returned non-success response");
      return { removed, errors };
    }
    allDomains = data.result;
  } catch (err) {
    errors.push(
      `List domains failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { removed, errors };
  }

  // Filter to ONLY *.{PROPOSAL_DOMAIN} entries. This is the guard
  // that protects real custom domains (balkar.sk, www.balkar.sk) and
  // any other non-fallback mapping from accidental deletion — only
  // the agency's wildcard subdomains are candidates.
  const proposalSuffix = `.${proposalDomain}`;
  const fallbackEntries = allDomains
    .map((d) => d.name)
    .filter((name): name is string => typeof name === "string")
    .filter((name) => name.toLowerCase().endsWith(proposalSuffix.toLowerCase()));

  for (const fallback of fallbackEntries) {
    // Preserve the one we're supposed to keep.
    if (
      keepSubdomain &&
      fallback.toLowerCase() === keepSubdomain.toLowerCase()
    ) {
      continue;
    }
    // Reuse the existing routing-remover so DNS + Pages mapping are
    // BOTH cleaned in one shot. Errors are collected, not thrown.
    const result = await removeSubdomainRouting(projectName, fallback);
    if (result.pagesRemoved && result.dnsRemoved) {
      removed.push(fallback);
      console.log(
        `[cleanupOrphanedFallbackSubdomains] Removed ${fallback} from ${projectName}`,
      );
    } else {
      errors.push(
        `Partial cleanup for ${fallback}: ${result.errors.join("; ")}`,
      );
    }
  }

  return { removed, errors };
}

/**
 * Trigger a new deployment for a Pages project.
 */
export async function triggerDeployment(
  projectName: string,
): Promise<{ id: string; url: string }> {
  const accountId = getAccountId();

  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments`,
    {
      method: "POST",
      headers: getHeaders(),
    },
  );

  const data = await res.json();
  if (!data.success) {
    throw new Error(
      `Failed to trigger deployment: ${JSON.stringify(data.errors)}`,
    );
  }

  return {
    id: data.result.id,
    url: data.result.url,
  };
}

/**
 * Get deployment status for a Pages project.
 */
export async function getDeploymentStatus(
  projectName: string,
): Promise<{ latest_stage: string; url: string } | null> {
  const accountId = getAccountId();

  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments?per_page=1`,
    {
      method: "GET",
      headers: getHeaders(),
    },
  );

  const data = await res.json();
  if (!data.success || !data.result?.length) {
    return null;
  }

  const deployment = data.result[0];
  return {
    latest_stage: deployment.latest_stage?.name || "unknown",
    url: deployment.url,
  };
}

/* ──────────────────────────────────────────────────────────────
   Custom-domain pipeline helpers (added 2026-05-10)

   The functions above operate against a single env-var-configured
   zone (CLOUDFLARE_ZONE_ID, the *.2dni.sk subdomain zone). The
   helpers below take a zoneId argument, so the timeline's "Custom
   domain" step can drive a multi-zone setup — one zone per real
   client .sk domain, auto-created on first use.

   None of these functions depend on CLOUDFLARE_ZONE_ID. They use
   CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID only.
   ────────────────────────────────────────────────────────────── */

/**
 * Look up an existing Cloudflare zone by name. Returns null when no
 * zone with that exact name exists in our account.
 *
 * Cloudflare's zone-list endpoint accepts a `name` query param for
 * exact-match filtering; that's still O(1) in their API even though
 * the list endpoint can also stream all zones.
 */
export async function findZoneByName(
  domain: string,
): Promise<{ id: string; name: string; status: string; nameServers: string[] } | null> {
  const res = await fetch(
    `${CF_API_BASE}/zones?name=${encodeURIComponent(domain)}`,
    { headers: getHeaders() },
  );
  const data = await res.json();
  if (!data.success) {
    throw new Error(
      `findZoneByName(${domain}) failed: ${JSON.stringify(data.errors)}`,
    );
  }
  const hit = data.result?.[0];
  if (!hit) return null;
  return {
    id: hit.id,
    name: hit.name,
    status: hit.status, // "pending" | "active" | "initializing" | "moved" | "deleted"
    // Cloudflare returns name_servers (snake) on the list endpoint.
    nameServers: Array.isArray(hit.name_servers) ? hit.name_servers : [],
  };
}

/**
 * Create a new zone in Cloudflare for `domain`. The zone is "pending"
 * immediately after creation — DNS won't actually resolve through
 * Cloudflare until the customer's registrar points the domain's
 * nameservers at the two `nameServers` returned here.
 *
 * Per Peter 2026-05-10: nameserver delegation is handled by Hostcreator
 * automatically when the customer buys the domain through them, so
 * this normally activates within a few minutes without manual work.
 */
export async function createZone(domain: string): Promise<{
  id: string;
  name: string;
  status: string;
  nameServers: string[];
}> {
  const accountId = getAccountId();

  const res = await fetch(`${CF_API_BASE}/zones`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      name: domain,
      account: { id: accountId },
      // jump_start: false = don't bother trying to import existing
      // DNS records by scraping public DNS. We're going to add only
      // the records we need (apex + www CNAME), so any auto-imported
      // ones would just be noise.
      jump_start: false,
      type: "full",
    }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(
      `createZone(${domain}) failed: ${JSON.stringify(data.errors)}`,
    );
  }
  return {
    id: data.result.id,
    name: data.result.name,
    status: data.result.status,
    nameServers: Array.isArray(data.result.name_servers) ? data.result.name_servers : [],
  };
}

/**
 * Idempotent zone-by-name resolver. Looks up the zone first; if
 * missing, creates it. Either way, returns the zone's id +
 * nameservers for the caller to persist.
 *
 * `isFresh` is true when this call CREATED the zone, false when it
 * existed already — the caller uses this to decide whether to
 * surface "tell the customer to set these nameservers" UI vs.
 * skipping straight to DNS-setup.
 */
export async function findOrCreateZone(domain: string): Promise<{
  id: string;
  name: string;
  status: string;
  nameServers: string[];
  isFresh: boolean;
}> {
  const existing = await findZoneByName(domain);
  if (existing) {
    return { ...existing, isFresh: false };
  }
  const created = await createZone(domain);
  return { ...created, isFresh: true };
}

/**
 * Get the current activation status of a zone. Returned values
 * follow Cloudflare's enum:
 *
 *   "pending"      — zone created but Cloudflare hasn't seen the
 *                    customer's nameservers update yet
 *   "initializing" — nameservers point at us, propagation in progress
 *   "active"       — fully active, DNS resolves through Cloudflare
 *   "moved"        — moved to another account
 *   "deleted"      — soft-deleted
 *
 * Used by the tick endpoint to decide whether to advance from
 * waiting_dns → registering_pages.
 */
export async function getZoneStatus(zoneId: string): Promise<string> {
  const res = await fetch(`${CF_API_BASE}/zones/${zoneId}`, {
    headers: getHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(
      `getZoneStatus(${zoneId}) failed: ${JSON.stringify(data.errors)}`,
    );
  }
  return data.result.status as string;
}

/**
 * Toggle "Always Use HTTPS" on a zone. Without this, plain http://
 * requests don't auto-upgrade to https://, leaving Cloudflare's
 * default mixed-content behavior in place. We always want this on
 * for client sites.
 *
 * Idempotent: setting it to "on" when it's already "on" is a no-op
 * on Cloudflare's side and returns success.
 */
export async function enableAlwaysUseHttps(zoneId: string): Promise<void> {
  const res = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/settings/always_use_https`,
    {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ value: "on" }),
    },
  );
  const data = await res.json();
  if (!data.success) {
    throw new Error(
      `enableAlwaysUseHttps(${zoneId}) failed: ${JSON.stringify(data.errors)}`,
    );
  }
}

/**
 * Add (or update) a CNAME record in a specific zone. Idempotent:
 * existing records with the same name + type are PUT-updated to the
 * new content rather than failing or duplicating.
 *
 * `proxied` is true by default because every record we create for a
 * Pages site needs to flow through Cloudflare's proxy (otherwise the
 * Pages custom-domain validation can't see the right intermediate
 * headers).
 *
 * `name` should be the FQDN (e.g. "clientname.sk" or
 * "www.clientname.sk"). Cloudflare also accepts the bare label form
 * but the API behavior diverges in confusing ways; FQDN is safe.
 */
export async function addOrUpdateCnameRecord(args: {
  zoneId: string;
  name: string;
  target: string;
  proxied?: boolean;
}): Promise<void> {
  const { zoneId, name, target } = args;
  const proxied = args.proxied ?? true;

  // Look up an existing record at this name first so we can PUT it
  // instead of POSTing a duplicate.
  const checkRes = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(name)}`,
    { headers: getHeaders() },
  );
  const checkData = await checkRes.json();
  const existing = checkData.result?.[0];

  if (existing) {
    const updateRes = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/dns_records/${existing.id}`,
      {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({
          type: "CNAME",
          name,
          content: target,
          proxied,
        }),
      },
    );
    const updateData = await updateRes.json();
    if (!updateData.success) {
      throw new Error(
        `update CNAME ${name}→${target} failed: ${JSON.stringify(updateData.errors)}`,
      );
    }
    return;
  }

  const createRes = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/dns_records`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        type: "CNAME",
        name,
        content: target,
        proxied,
      }),
    },
  );
  const createData = await createRes.json();
  if (!createData.success) {
    throw new Error(
      `create CNAME ${name}→${target} failed: ${JSON.stringify(createData.errors)}`,
    );
  }
}

/**
 * Add the www→naked 301 redirect for a custom domain. Uses
 * Cloudflare's legacy Page Rules API — Free plan gets 3 page rules
 * per zone, more than enough for one redirect per domain.
 *
 * Idempotent: re-running this on an already-configured zone returns
 * Cloudflare's "duplicate" error, which we swallow as a no-op.
 *
 * `naked` is the apex domain (e.g. "clientname.sk"); the redirect
 * matches `www.{naked}/*` and 301s to `https://{naked}/$1`.
 */
export async function addWwwRedirectPageRule(args: {
  zoneId: string;
  naked: string;
}): Promise<void> {
  const { zoneId, naked } = args;
  const wildcard = `www.${naked}/*`;

  const res = await fetch(`${CF_API_BASE}/zones/${zoneId}/pagerules`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      targets: [
        {
          target: "url",
          constraint: { operator: "matches", value: wildcard },
        },
      ],
      actions: [
        {
          id: "forwarding_url",
          value: { url: `https://${naked}/$1`, status_code: 301 },
        },
      ],
      status: "active",
      priority: 1,
    }),
  });
  const data = await res.json();
  if (data.success) return;

  // Cloudflare returns code 1004 for "duplicate page rule" — that's
  // fine, the rule we wanted exists. Same idempotent behavior as
  // already-registered Pages domains in setCustomDomain above.
  const isDuplicate = (data.errors ?? []).some(
    (e: { code?: number; message?: string }) =>
      e.code === 1004 ||
      (typeof e.message === "string" && /duplicate/i.test(e.message)),
  );
  if (isDuplicate) return;

  throw new Error(
    `addWwwRedirectPageRule(${naked}) failed: ${JSON.stringify(data.errors)}`,
  );
}

/**
 * Register a domain on a Cloudflare Pages project — the API call
 * that needs the zone to be active in our account. Extracted from
 * the older setCustomDomain so the custom-domain pipeline can call
 * it independently of DNS-record creation (which it does itself
 * via addOrUpdateCnameRecord with the right zoneId).
 *
 * Returns `"registered"` on success, `"already_exists"` if the
 * domain was already registered (idempotent re-runs), and `"dns_setup"`
 * for the soft-failure Cloudflare returns when the zone isn't fully
 * verified yet — caller should wait + retry.
 */
export async function registerPagesDomain(
  projectName: string,
  domain: string,
): Promise<"registered" | "already_exists" | "dns_setup"> {
  const accountId = getAccountId();

  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/domains`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ name: domain }),
    },
  );
  const data = await res.json();
  if (data.success) return "registered";

  const errs: Array<{ code?: number; message?: string }> = data.errors ?? [];
  if (errs.some((e) => e.code === 8000040)) return "already_exists";
  // Common message during the few-minute "DNS setup" window after
  // a fresh zone is created: "DNS validation failed", "could not
  // resolve", "zone not active" etc. We treat any non-success that
  // isn't "already exists" as a soft retry signal — the caller's
  // tick loop will come back in 30 sec.
  if (
    errs.some((e) =>
      typeof e.message === "string" &&
      /dns|resolve|validat|zone.*not.*active|setup/i.test(e.message),
    )
  ) {
    return "dns_setup";
  }
  throw new Error(
    `registerPagesDomain(${projectName}, ${domain}) failed: ${JSON.stringify(errs)}`,
  );
}

/**
 * Read the activation status of a domain on a Pages project.
 * Returns Cloudflare's status enum: "pending" while SSL is being
 * provisioned, "active" once cert is live and the domain is fully
 * served, "deactivated" / "deleted" otherwise.
 */
export async function getPagesDomainStatus(
  projectName: string,
  domain: string,
): Promise<{ status: string; certificateAuthority: string | null } | null> {
  const accountId = getAccountId();

  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/pages/projects/${projectName}/domains/${encodeURIComponent(domain)}`,
    { headers: getHeaders() },
  );
  if (!res.ok) {
    // 404 is the normal "not registered" case — treat as null so the
    // caller can decide what to do.
    if (res.status === 404) return null;
    const text = await res.text().catch(() => "");
    throw new Error(
      `getPagesDomainStatus(${domain}) ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  const data = await res.json();
  if (!data.success) {
    throw new Error(
      `getPagesDomainStatus(${domain}) failed: ${JSON.stringify(data.errors)}`,
    );
  }
  return {
    status: (data.result?.status as string) ?? "unknown",
    certificateAuthority:
      (data.result?.certificate_authority as string) ?? null,
  };
}
