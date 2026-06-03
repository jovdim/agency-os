import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishSite, type PendingFilesMap } from "@/lib/templates/publish";
import { logAudit } from "@/lib/audit";
import { ensureClientZone } from "@/lib/proposals/ensure-client-zone";

// Disable Next.js's automatic fetch caching for THIS route. publishSite →
// renderSite downloads every used section template's HTML + CSS from
// Supabase Storage via `admin.storage.from(...).download(...)`, which
// internally uses native fetch. Without these directives Next caches those
// fetches and the publish flow can serve STALE template HTML/CSS even
// after `scripts/push-template.ts` has rolled a newer version — the
// composer iframe (rendered by the force-dynamic page) shows the new
// template, but the published Cloudflare HTML carries the old version.
// `/api/sites/[id]/render/route.ts` has the same directives for the
// same reason (see memory: project_session_2026-05-13_handoff_v2).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/**
 * POST /api/sites/[id]/publish
 *
 * Renders the site from its composition and uploads to Cloudflare Pages
 * via Direct Upload. Creates a site_versions snapshot. tech_admin or super_admin.
 *
 * Request body — multipart/form-data:
 *   - For each pending image, a field named `file:{uuid}` whose value is the
 *     File bytes the browser stashed in IndexedDB (Phase B).
 *   - Body can also be empty (e.g. legacy revert flow with no pending files).
 *
 * Response — JSON: { success, url, pagesUrl, deploymentId, pageCount, versionId }.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Read role from `user.app_metadata.role` (the JWT claim synced by the
    // 00002 trigger) — same source the autosave PUT endpoint uses. Reading
    // from the `profiles` table here led to a spurious 403 for clients
    // whenever the trigger left profiles.role stale relative to the JWT
    // (autosave worked, publish didn't — mismatched role source). Keeping
    // both endpoints on the same source eliminates that asymmetry.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const role = user.app_metadata?.role as string | undefined;

    // Diagnostic log so a future 403 surfaces what we actually saw. Cheap.
    console.log(
      `[publish] auth check site=${id} user=${user.id} role=${role ?? "(none)"}`,
    );

    // Auth: tech/super admin always; sales iff they own the linked
    // proposal (added 2026-05-10 — shared timeline UI on /sales gives
    // salespeople composer access too); client iff they own the site
    // (Phase C client composer publishes content edits directly). Use
    // admin client for the lookups — RLS may not allow client/sales
    // role SELECTs on sites with only the id known, and we only need
    // the ownership columns.
    if (!["tech_admin", "super_admin"].includes(role ?? "")) {
      if (role === "sales") {
        const admin = createAdminClient();
        const { data: siteRow, error: sErr } = await admin
          .from("sites")
          .select("proposal_id")
          .eq("id", id)
          .maybeSingle();
        if (sErr || !siteRow?.proposal_id) {
          return NextResponse.json({ error: "Site not found" }, { status: 404 });
        }
        const { data: linkedProposal } = await admin
          .from("proposals")
          .select("sales_person_id")
          .eq("id", siteRow.proposal_id)
          .maybeSingle();
        if (!linkedProposal || linkedProposal.sales_person_id !== user.id) {
          console.warn(
            `[publish] sales ownership mismatch site=${id} user=${user.id}`,
          );
          return NextResponse.json(
            { error: "Forbidden — proposal not owned by caller" },
            { status: 403 },
          );
        }
        // Allowed — fall through.
      } else if (role === "client") {
        // Clients no longer publish directly. They submit a request
        // (POST /api/sites/[id]/publish-request) that an IT/tech admin
        // approves on the proposal pipeline page — that approval endpoint
        // is what runs publishSite() and charges the 12.50 € at go-live.
        // Block any direct call here so a crafted request can't bypass
        // review. (Per Peter 2026-05-29: instant client publishes felt
        // like charging for no work; review justifies the charge.)
        console.log(
          `[publish] client direct-publish blocked site=${id} user=${user.id}`,
        );
        return NextResponse.json(
          {
            error:
              "Changes are submitted for approval. Use the “Request publish” button.",
            code: "USE_PUBLISH_REQUEST",
          },
          { status: 403 },
        );
      } else {
        console.warn(
          `[publish] role not allowed site=${id} user=${user.id} role=${role ?? "(none)"}`,
        );
        return NextResponse.json(
          {
            error: "Forbidden — role not allowed",
            ...(process.env.NODE_ENV === "development"
              ? { debug: { role: role ?? null, user_id: user.id } }
              : {}),
          },
          { status: 403 },
        );
      }
    }

    // ── Parse pending files from multipart body, if any ──
    // Older callers (revert API, future internal callers) might POST with no
    // body or content-type: application/json — both are handled gracefully.
    const pendingFiles: PendingFilesMap = new Map();
    const contentType = req.headers.get("content-type") || "";
    if (contentType.startsWith("multipart/form-data")) {
      const form = await req.formData();
      for (const [key, value] of form.entries()) {
        if (!key.startsWith("file:")) continue;
        if (!(value instanceof File)) continue;
        const uuid = key.slice("file:".length);
        const bytes = Buffer.from(await value.arrayBuffer());
        pendingFiles.set(uuid, {
          bytes,
          mimeType: value.type || "application/octet-stream",
          filename: value.name,
        });
      }
    }

    // ?silent=true triggers an auto-republish that doesn't write a
    // site_versions history row. Used by the banner config + disable
    // dialogs so flipping the payment-banner switch (or adjusting
    // its prices/expiry) doesn't pollute the composer's publish
    // history with N entries that all have the same composition.
    // The deploy still happens normally.
    const silent = req.nextUrl.searchParams.get("silent") === "true";
    const reason = silent ? "auto_banner_toggle" : "tech_publish";

    console.log(
      `[publish] starting site=${id} user=${user.id} pending=${pendingFiles.size} silent=${silent}`,
    );

    // No credit charge here. This route only serves staff publishes
    // now (tech / sales / super / banner-toggle / rollback), which are
    // all free. Client publishes go through the request → approve flow
    // (/api/sites/[id]/publish-request + .../approve), and the 12.50 €
    // charge lands in the approve endpoint at go-live. Errors bubble to
    // the outer try/catch below.
    const result = await publishSite(id, user.id, reason, pendingFiles, {
      silent,
    });

    console.log(`[publish] success site=${id} url=${result.url}`);

    // Read the row's fresh `updated_at` AFTER publishSite has finished its
    // last `sites.update`. The composer uses this to keep its
    // `lastSyncedUpdatedAtRef` baseline in sync, so the staleness banner
    // doesn't self-fire on the user who JUST published. Also pull
    // proposal_id while we're at it — used by the auto-flip below so we
    // don't pay for a second round-trip.
    const adminForRead = createAdminClient();
    const { data: freshRow } = await adminForRead
      .from("sites")
      .select("updated_at, proposal_id")
      .eq("id", id)
      .maybeSingle();
    const updatedAt =
      (freshRow as { updated_at?: string | null } | null)?.updated_at ?? null;

    // ── Auto-flip proposal status to "review" on first publish ──
    //
    // Per Peter 2026-05-10: there's no longer a manual "Send to sales"
    // handoff button. Once IT publishes the site, the proposal becomes
    // automatically available to the salesperson — and the sales-side
    // active list filters on `status = 'review'`, so we have to bump
    // the status here for that to work.
    //
    // We only flip from upstream statuses (submitted/building/revision)
    // — anything from `review` onwards (sent/viewed/paid/archived) gets
    // left alone, because those are downstream sales states we
    // shouldn't rewind. Republishes after that are no-ops here.
    //
    // Best-effort: a failed flip doesn't fail the publish. Logging the
    // error is enough — the publish itself succeeded, so the site is
    // live regardless of the status column.
    const proposalId =
      (freshRow as { proposal_id?: string | null } | null)?.proposal_id ?? null;
    if (proposalId) {
      try {
        const { data: prop } = await adminForRead
          .from("proposals")
          .select("status")
          .eq("id", proposalId)
          .maybeSingle();
        const flipFrom = new Set(["submitted", "building", "revision"]);
        if (prop && flipFrom.has(prop.status as string)) {
          const { error: flipErr } = await adminForRead
            .from("proposals")
            .update({ status: "review" })
            .eq("id", proposalId);
          if (flipErr) {
            console.error(
              `[publish] status auto-flip failed proposal=${proposalId}: ${flipErr.message}`,
            );
          } else {
            console.log(
              `[publish] status auto-flipped proposal=${proposalId} ${prop.status} → review`,
            );
          }
        }
      } catch (statusErr) {
        console.error(
          `[publish] status auto-flip threw proposal=${proposalId}:`,
          statusErr,
        );
      }

      // ── Auto-provision client zone on first publish ──
      //
      // Per Peter 2026-05-23: the manual "Create client zone" step is
      // removed from the timeline. The zone is created automatically
      // when IT publishes the site, so the salesperson can click
      // "Send to client" immediately afterwards and the email ships
      // with login credentials baked in.
      //
      // ensureClientZone is idempotent — a republish on a proposal
      // that already has a client owner is a cheap no-op. We swallow
      // any error here because a failed zone provision must NOT roll
      // back the publish (the site is already live on Cloudflare).
      // The manual create-client-zone button stays available as a
      // recovery path if this fails.
      try {
        const zoneResult = await ensureClientZone(proposalId, {
          actorUserId: user.id,
        });
        if (!zoneResult.ok) {
          console.error(
            `[publish] auto client-zone provision failed proposal=${proposalId}: ${zoneResult.error}`,
          );
        } else if (zoneResult.was_created) {
          console.log(
            `[publish] auto client-zone provisioned proposal=${proposalId}`,
          );
        }
      } catch (zoneErr) {
        console.error(
          `[publish] auto client-zone threw proposal=${proposalId}:`,
          zoneErr,
        );
      }
    }

    await logAudit({
      userId: user.id,
      action: "publish_site",
      entityType: "site",
      entityId: id,
      details: {
        deploymentId: result.deploymentId,
        url: result.url,
        pageCount: result.pageCount,
        pendingFilesCount: pendingFiles.size,
      },
    });

    return NextResponse.json({
      success: true,
      // url is the friendly URL when a custom domain is configured (e.g.
      // https://nexedge77.pages.dev), else the .pages.dev URL. This is what
      // the toast + "open in new tab" use, so users see the nice URL.
      url: result.friendlyUrl,
      pagesUrl: result.pagesUrl,
      deploymentUrl: result.url,
      friendlyUrl: result.friendlyUrl,
      customDomain: result.customDomain,
      subdomain: result.subdomain,
      deploymentId: result.deploymentId,
      pageCount: result.pageCount,
      versionId: result.versionId,
      // List of uuids that were just resolved — the browser uses this to
      // delete the matching IndexedDB entries (no longer needed).
      flushedKeys: [...pendingFiles.keys()],
      // Original URL → new URL map. The browser applies these to its in-
      // memory composition so the iframe + sidebar update immediately
      // (instead of waiting for the next router.refresh() cycle, which the
      // composer's `useState(initialComposition)` ignores anyway).
      substitutions: result.substitutions,
      // Post-publish row timestamp — composer captures this to keep its
      // staleness baseline in sync with reality.
      updated_at: updatedAt,
    });
  } catch (err) {
    console.error("[publish] ERROR:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json(
      {
        error: message,
        stack: process.env.NODE_ENV === "development" ? stack : undefined,
      },
      { status: 500 },
    );
  }
}
