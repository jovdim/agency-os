/**
 * End-to-end proof that the "Visible in Google search" toggle in the SEO
 * panel actually does what it claims. Walks the full chain:
 *
 *   1. User clicks the switch in the SeoPanel UI
 *   2. onChange fires with the right partial-patch shape
 *   3. updateSeo applies it to composition.seo correctly (true / clears)
 *   4. buildHeadMeta reads the resulting composition.seo and emits (or
 *      omits) <meta name="robots" content="noindex,nofollow"> accordingly
 *
 * If any link in the chain breaks, this test catches it.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SeoPanel } from "@/components/composer/seo-panel";
import { buildHeadMeta, type SiteSeo } from "@/lib/templates/seo";

/**
 * Mirror of the `updateSeo` function in composer-client.tsx — kept
 * inline here so the test pins the exact behavior. If the real one
 * changes shape, this copy must be updated too (and the divergence
 * itself is a useful red flag).
 */
function applyUpdateSeo(
  prev: SiteSeo | undefined,
  patch: Partial<SiteSeo>,
): SiteSeo {
  const seo: Record<string, unknown> = { ...(prev ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === "") {
      delete seo[key];
    } else {
      seo[key] = value;
    }
  }
  return seo as SiteSeo;
}

describe("Search visibility toggle — end-to-end", () => {
  it("default state: toggle is ON (visible) when seo is empty", () => {
    render(
      <SeoPanel
        seo={undefined}
        siteName="Acme"
        siteId="site-1"
        onChange={() => {}}
      />,
    );
    const toggle = screen.getByRole("switch", {
      name: /search engine visibility/i,
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(/search engines can find and index this site/i),
    ).toBeInTheDocument();
  });

  it("hidden state: toggle is OFF when seo.no_index is true", () => {
    render(
      <SeoPanel
        seo={{ no_index: true }}
        siteName="Acme"
        siteId="site-1"
        onChange={() => {}}
      />,
    );
    const toggle = screen.getByRole("switch", {
      name: /search engine visibility/i,
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(/hidden from google, bing, and other search engines/i),
    ).toBeInTheDocument();
    // Warning is shown only in the hidden state.
    expect(
      screen.getByText(/use this for staging or unfinished sites/i),
    ).toBeInTheDocument();
  });

  it("clicking the toggle ON→OFF emits {no_index: true}", () => {
    const onChange = vi.fn();
    render(
      <SeoPanel
        seo={undefined}
        siteName="Acme"
        siteId="site-1"
        onChange={onChange}
      />,
    );
    const toggle = screen.getByRole("switch", {
      name: /search engine visibility/i,
    });
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ no_index: true });
  });

  it("clicking the toggle OFF→ON emits {no_index: undefined} (cleanup)", () => {
    const onChange = vi.fn();
    render(
      <SeoPanel
        seo={{ no_index: true }}
        siteName="Acme"
        siteId="site-1"
        onChange={onChange}
      />,
    );
    const toggle = screen.getByRole("switch", {
      name: /search engine visibility/i,
    });
    fireEvent.click(toggle);
    // We pass undefined (not false) so updateSeo deletes the field
    // entirely instead of bloating composition.seo with no_index:false.
    expect(onChange).toHaveBeenCalledWith({ no_index: undefined });
  });

  it("full chain: ON click → composition update → robots meta tag in HTML", () => {
    // Start visible.
    let composition: SiteSeo | undefined = undefined;
    const onChange = (patch: Partial<SiteSeo>) => {
      composition = applyUpdateSeo(composition, patch);
    };

    const { rerender } = render(
      <SeoPanel
        seo={composition}
        siteName="Acme"
        siteId="site-1"
        onChange={onChange}
      />,
    );

    // Step 1: Click the toggle to hide from search.
    fireEvent.click(
      screen.getByRole("switch", { name: /search engine visibility/i }),
    );
    expect(composition).toEqual({ no_index: true });

    // Step 2: Render the head meta from the updated composition. This
    // is what publish.ts feeds into the live site's <head>.
    const meta = buildHeadMeta(composition, {
      siteName: "Acme",
      siteUrl: "https://acme.2dni.sk",
    });
    expect(meta).toContain(
      '<meta name="robots" content="noindex,nofollow">',
    );

    // Step 3: Re-render the panel with the new composition (mimics the
    // composer's re-render after setComposition). Toggle should now
    // reflect the OFF state.
    rerender(
      <SeoPanel
        seo={composition}
        siteName="Acme"
        siteId="site-1"
        onChange={onChange}
      />,
    );
    expect(
      screen.getByRole("switch", { name: /search engine visibility/i }),
    ).toHaveAttribute("aria-checked", "false");

    // Step 4: Click again to reveal. composition.no_index should be
    // cleaned up (not set to false), and meta should NOT contain robots.
    fireEvent.click(
      screen.getByRole("switch", { name: /search engine visibility/i }),
    );
    expect(composition).toEqual({}); // no_index field deleted entirely
    const metaAfterReveal = buildHeadMeta(composition, {
      siteName: "Acme",
      siteUrl: "https://acme.2dni.sk",
    });
    expect(metaAfterReveal).not.toContain("robots");
  });

  it("preserves other SEO fields when toggling visibility", () => {
    // Real-world case: user has already set title + description + image,
    // then toggles visibility. The toggle must touch ONLY no_index.
    let composition: SiteSeo = {
      title: "Acme s.r.o.",
      description: "Web design agency",
      og_image_url: "/_uploads/share.png",
      og_image_width: 1200,
      og_image_height: 630,
    };
    const onChange = (patch: Partial<SiteSeo>) => {
      composition = applyUpdateSeo(composition, patch);
    };

    render(
      <SeoPanel
        seo={composition}
        siteName="Acme"
        siteId="site-1"
        onChange={onChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: /search engine visibility/i }),
    );

    // Title, description, image, dims all still there.
    expect(composition).toEqual({
      title: "Acme s.r.o.",
      description: "Web design agency",
      og_image_url: "/_uploads/share.png",
      og_image_width: 1200,
      og_image_height: 630,
      no_index: true,
    });
  });
});
