/**
 * GET /api/super/banner-diagnostic?proposal_id=...
 *     /api/super/banner-diagnostic?slug=...
 *
 * One-shot diagnostic for the payment banner. Runs every check
 * required for the BySquare banner to render on the deployed
 * site, in order, and returns a structured report. Each step is
 * either `pass`, `fail`, or `warn` with a human explanation.
 *
 * Use this when sales reports "I toggled the banner but I don't
 * see it on the live site" — the diagnostic walks through the
 * full chain (status, toggle, slug, deploy, script tag, JS file
 * reachable, API response) and pinpoints which link is broken.
 *
 * Restricted to super_admin since it leaks proposal slugs +
 * deploy URLs to the caller.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

interface Check {
  step: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

export async function GET(req: NextRequest) {
  // Auth: super_admin only.
  await requireRole("super_admin");

  const url = new URL(req.url);
  const proposalId = url.searchParams.get("proposal_id");
  const slugParam = url.searchParams.get("slug");
  if (!proposalId && !slugParam) {
    return NextResponse.json(
      { error: "Provide ?proposal_id=… or ?slug=…" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const checks: Check[] = [];

  // ── 1. Load the proposal ──────────────────────────────────
  const query = admin
    .from("proposals")
    .select("id, slug, status, show_banner, company_name");
  const { data: proposal, error: pErr } = await (proposalId
    ? query.eq("id", proposalId).maybeSingle()
    : query.eq("slug", slugParam ?? "").maybeSingle());

  if (pErr || !proposal) {
    checks.push({
      step: "Load proposal",
      status: "fail",
      detail: `Proposal not found (${pErr?.message ?? "no row"})`,
    });
    return NextResponse.json({ checks });
  }
  checks.push({
    step: "Load proposal",
    status: "pass",
    detail: `Found proposal "${proposal.company_name}" (slug=${proposal.slug ?? "(none)"}, status=${proposal.status})`,
  });

  // ── 2. Slug exists ────────────────────────────────────────
  if (!proposal.slug) {
    checks.push({
      step: "Slug present",
      status: "fail",
      detail:
        "Proposal has no slug. The banner needs a slug to fetch its data — slug is set by the Send-to-client flow (PUT /api/proposals/[id] with status=sent).",
    });
  } else {
    checks.push({
      step: "Slug present",
      status: "pass",
      detail: proposal.slug,
    });
  }

  // ── 3. Status is sent / viewed ────────────────────────────
  // Banner only shows for these two states (see API at
  // /api/public/proposals/[slug]/data — paid + everything else
  // returns active:false).
  if (proposal.status === "sent" || proposal.status === "viewed") {
    checks.push({
      step: "Status allows banner",
      status: "pass",
      detail: `Status is "${proposal.status}".`,
    });
  } else if (proposal.status === "paid") {
    checks.push({
      step: "Status allows banner",
      status: "warn",
      detail:
        'Status is "paid". The banner intentionally hides on paid proposals — the customer already paid, no need to show "pay now". This is by design.',
    });
  } else {
    checks.push({
      step: "Status allows banner",
      status: "fail",
      detail: `Status is "${proposal.status}". Banner only shows when status is "sent" or "viewed". Send the proposal email first (Send-to-client step on the timeline).`,
    });
  }

  // ── 4. show_banner toggle is on ──────────────────────────
  const sb = (proposal as { show_banner?: boolean | null }).show_banner;
  const showBanner = sb !== false; // null/undefined treated as on
  if (showBanner) {
    checks.push({
      step: "show_banner toggle is ON",
      status: "pass",
      detail: "Toggle is on.",
    });
  } else {
    checks.push({
      step: "show_banner toggle is ON",
      status: "fail",
      detail:
        'Toggle is OFF on the proposal. Flip "Show payment banner on site" on the Send-to-client step in the sales timeline.',
    });
  }

  // ── 5. Find the deployed site for this proposal ──────────
  const { data: site } = await admin
    .from("sites")
    .select("id, site_url, subdomain, last_published_at")
    .eq("proposal_id", proposal.id)
    .maybeSingle();
  const liveUrl =
    site?.site_url ||
    (site?.subdomain ? `https://${site.subdomain}.pages.dev` : null);

  if (!site) {
    checks.push({
      step: "Site exists for proposal",
      status: "fail",
      detail: "No site row linked to this proposal. Build + publish the site first via the composer.",
    });
    return NextResponse.json({ checks, liveUrl: null });
  }
  if (!site.last_published_at) {
    checks.push({
      step: "Site has been published",
      status: "fail",
      detail:
        "Site row exists but last_published_at is null — the site has never been published. Open the composer and click Publish.",
    });
    return NextResponse.json({ checks, liveUrl });
  }
  checks.push({
    step: "Site has been published",
    status: "pass",
    detail: `Last published at ${site.last_published_at}. Live at ${liveUrl}.`,
  });

  if (!liveUrl) {
    checks.push({
      step: "Live URL available",
      status: "fail",
      detail: "Site has no site_url and no subdomain. Cannot fetch deployed HTML.",
    });
    return NextResponse.json({ checks, liveUrl: null });
  }

  // ── 6. Deployed HTML contains the script tag (and right format) ──
  let deployedHtml = "";
  try {
    const htmlRes = await fetch(liveUrl, { cache: "no-store" });
    if (!htmlRes.ok) {
      checks.push({
        step: "Deployed HTML reachable",
        status: "fail",
        detail: `GET ${liveUrl} returned HTTP ${htmlRes.status}.`,
      });
      return NextResponse.json({ checks, liveUrl });
    }
    deployedHtml = await htmlRes.text();
    checks.push({
      step: "Deployed HTML reachable",
      status: "pass",
      detail: `Fetched ${deployedHtml.length.toLocaleString()} bytes.`,
    });
  } catch (err) {
    checks.push({
      step: "Deployed HTML reachable",
      status: "fail",
      detail: `Fetch failed: ${(err as Error).message}`,
    });
    return NextResponse.json({ checks, liveUrl });
  }

  // Look for the widget script tag and pull its full src so we
  // can verify the origin too — the most pernicious bug pattern
  // is a relative `/proposal-widget.js` path on a Cloudflare-Pages
  // deployment, which loads (because we used to bundle it) but
  // then hits a 404 on its API call (because there's no
  // /api/... on the static deploy).
  const widgetTagMatch = deployedHtml.match(
    /<script[^>]*src=["']([^"']*proposal-widget\.js[^"']*)["'][^>]*>/i,
  );
  const widgetSrc = widgetTagMatch ? widgetTagMatch[1] : null;

  if (!widgetSrc) {
    checks.push({
      step: "<script src='…/proposal-widget.js'> tag present",
      status: "fail",
      detail:
        "No proposal-widget.js script tag found in the deployed HTML. The site needs to be republished — the render layer only emits this tag when the site is linked to a proposal slug.",
    });
  } else {
    const isAbsolute = /^https?:\/\//i.test(widgetSrc);
    const isOnDashboard =
      isAbsolute &&
      typeof process.env.NEXT_PUBLIC_SITE_URL === "string" &&
      widgetSrc.startsWith(
        process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, ""),
      );

    if (!isAbsolute) {
      checks.push({
        step: "Widget script src points at dashboard origin",
        status: "fail",
        detail: `Script src is relative ("${widgetSrc}"). The widget computes its API base from its own URL — a relative path makes it call /api/... on the deployed site, which 404s because Cloudflare Pages doesn't serve the API. Republish to pick up the fix that emits an absolute URL.`,
      });
    } else if (!isOnDashboard) {
      checks.push({
        step: "Widget script src points at dashboard origin",
        status: "warn",
        detail: `Script loads from "${widgetSrc}" — that's an absolute URL but not the configured dashboard (NEXT_PUBLIC_SITE_URL). Check that's correct.`,
      });
    } else {
      checks.push({
        step: "Widget script src points at dashboard origin",
        status: "pass",
        detail: `Loads from ${widgetSrc}.`,
      });
    }

    // Slug presence in the URL — needs to be there one way or
    // another for the widget to know which proposal to fetch.
    const hasSlug =
      /[?&]slug=/i.test(widgetSrc) || /data-proposal-slug=/i.test(deployedHtml);
    if (hasSlug) {
      checks.push({
        step: "Slug passed to widget",
        status: "pass",
        detail: "Slug is in the script URL or data attribute.",
      });
    } else {
      checks.push({
        step: "Slug passed to widget",
        status: "fail",
        detail:
          "Script tag found but no slug in the URL (?slug=…) or as a data-proposal-slug attribute. Republish the site.",
      });
    }
  }

  // ── 7. The widget JS file itself is reachable ────────────
  // Now that the script src is absolute, this fetches the
  // dashboard's copy (single source of truth, no per-deploy
  // bundling). We still try the relative path as a fallback —
  // some legacy deploys may have it bundled in, which is harmless.
  const widgetSrcAbsolute =
    widgetSrc && /^https?:\/\//i.test(widgetSrc)
      ? widgetSrc
      : liveUrl.replace(/\/$/, "") + "/proposal-widget.js";
  try {
    const jsRes = await fetch(widgetSrcAbsolute, { cache: "no-store" });
    if (jsRes.ok) {
      const len = (await jsRes.text()).length;
      checks.push({
        step: "Widget JS file fetchable",
        status: "pass",
        detail: `${jsRes.status} OK · ${len.toLocaleString()} bytes from ${widgetSrcAbsolute}`,
      });
    } else {
      checks.push({
        step: "Widget JS file fetchable",
        status: "fail",
        detail: `${widgetSrcAbsolute} returned HTTP ${jsRes.status}.`,
      });
    }
  } catch (err) {
    checks.push({
      step: "Widget JS file fetchable",
      status: "fail",
      detail: `Fetch of ${widgetSrcAbsolute} failed: ${(err as Error).message}`,
    });
  }

  // ── 8. The public API would return active:true ───────────
  // We compute the same way the API does (status + show_banner)
  // rather than HTTP-fetching to avoid an extra round-trip + the
  // QR-image generation cost.
  const apiWouldBeActive =
    showBanner && (proposal.status === "sent" || proposal.status === "viewed");
  if (apiWouldBeActive) {
    checks.push({
      step: "Public API returns active:true",
      status: "pass",
      detail: `/api/public/proposals/${proposal.slug}/data will return active:true with the current row state.`,
    });
  } else {
    checks.push({
      step: "Public API returns active:true",
      status: "fail",
      detail:
        "API will return active:false because the prior status / toggle checks failed. See the checks above.",
    });
  }

  // ── Roll-up summary ──────────────────────────────────────
  const failures = checks.filter((c) => c.status === "fail").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  const summary =
    failures > 0
      ? `${failures} failure${failures === 1 ? "" : "s"} — banner will NOT render. Fix the failed checks above.`
      : warnings > 0
        ? `All required checks pass · ${warnings} warning${warnings === 1 ? "" : "s"}. Banner should render.`
        : "All checks pass · banner should render correctly.";

  return NextResponse.json({
    summary,
    liveUrl,
    proposalId: proposal.id,
    slug: proposal.slug,
    status: proposal.status,
    checks,
  });
}
