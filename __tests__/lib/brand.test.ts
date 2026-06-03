/**
 * Tests for the brand resolver — the bridge between composition.brand
 * (auto/custom mode + company text) and the concrete logo/favicon URLs
 * the renderer drops into <img>/<link> tags.
 *
 * The resolver is the single source of truth for "what URL goes into
 * the nav/footer logo and the page favicon." Both renderers (server +
 * browser) call it on every render pass — bugs here would manifest as
 * blank logos, wrong colors, or custom uploads being silently
 * overwritten by auto SVGs.
 */

import { describe, it, expect } from "vitest";
import {
  makeDefaultBrand,
  previewLogoUrl,
  resolveBrand,
} from "@/lib/composer/brand";

describe("brand", () => {
  describe("makeDefaultBrand", () => {
    it("creates an auto-mode record with the given company text", () => {
      const b = makeDefaultBrand("Acme s.r.o.");
      expect(b.mode).toBe("auto");
      expect(b.company_text).toBe("Acme s.r.o.");
      expect(b.custom_logo_url).toBeUndefined();
    });

    it("falls back to 'Logo' when given empty input", () => {
      // The composer auto-inits brand on mount using the site name as the
      // text; if a site somehow has an empty name, we still need a usable
      // brand record — never an empty company_text that renders as a blank
      // SVG.
      expect(makeDefaultBrand("").company_text).toBe("Logo");
      expect(makeDefaultBrand("   ").company_text).toBe("Logo");
    });
  });

  describe("resolveBrand — auto mode", () => {
    it("returns SVG data URLs for both logo and favicon", () => {
      const r = resolveBrand(
        { mode: "auto", company_text: "Acme" },
        { primary: "#142733" },
        "Acme",
      );
      expect(r.logoUrl).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(r.faviconUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    });

    it("encodes the company text into the logo SVG", () => {
      const r = resolveBrand(
        { mode: "auto", company_text: "BalkarSlovakia" },
        { primary: "#142733" },
        "fallback",
      );
      const decoded = Buffer.from(
        r.logoUrl.replace(/^data:image\/svg\+xml;base64,/, ""),
        "base64",
      ).toString("utf8");
      expect(decoded).toContain(">BalkarSlovakia</text>");
    });

    it("encodes the theme primary as the icon-block fill", () => {
      const r = resolveBrand(
        { mode: "auto", company_text: "Acme" },
        { primary: "#a04545" },
        "Acme",
      );
      const decoded = Buffer.from(
        r.logoUrl.replace(/^data:image\/svg\+xml;base64,/, ""),
        "base64",
      ).toString("utf8");
      expect(decoded).toContain('fill="#a04545"');
    });

    it("regenerates a different URL when the primary color changes", () => {
      // The whole point of auto mode is "logo follows theme." If two
      // different primary colors produced the same data URL, the iframe
      // wouldn't recolor on the primary dice.
      const r1 = resolveBrand(
        { mode: "auto", company_text: "Acme" },
        { primary: "#a04545" },
        "Acme",
      );
      const r2 = resolveBrand(
        { mode: "auto", company_text: "Acme" },
        { primary: "#1d4d8c" },
        "Acme",
      );
      expect(r1.logoUrl).not.toBe(r2.logoUrl);
      expect(r1.faviconUrl).not.toBe(r2.faviconUrl);
    });

    it("derives the favicon letter from the first character of company_text", () => {
      const r = resolveBrand(
        { mode: "auto", company_text: "balkar" },
        { primary: "#142733" },
        "Acme",
      );
      const decoded = Buffer.from(
        r.faviconUrl.replace(/^data:image\/svg\+xml;base64,/, ""),
        "base64",
      ).toString("utf8");
      expect(decoded).toContain(">B</text>");
    });
  });

  describe("resolveBrand — custom mode", () => {
    it("returns the custom logo URL verbatim", () => {
      const r = resolveBrand(
        {
          mode: "custom",
          company_text: "Acme",
          custom_logo_url: "/_uploads/abc.png",
        },
        { primary: "#142733" },
        "Acme",
      );
      expect(r.logoUrl).toBe("/_uploads/abc.png");
    });

    it("ignores theme color changes — custom logos never recolor", () => {
      // Critical UX guarantee: once a client uploads their own logo,
      // changing the theme primary must never overwrite or recolor it.
      // Auto-only behavior would surprise them ("why did my logo turn
      // orange?").
      const r1 = resolveBrand(
        {
          mode: "custom",
          company_text: "Acme",
          custom_logo_url: "/_uploads/abc.png",
        },
        { primary: "#a04545" },
        "Acme",
      );
      const r2 = resolveBrand(
        {
          mode: "custom",
          company_text: "Acme",
          custom_logo_url: "/_uploads/abc.png",
        },
        { primary: "#1d4d8c" },
        "Acme",
      );
      expect(r1.logoUrl).toBe(r2.logoUrl);
    });

    it("reuses the custom logo URL as the favicon when no custom_favicon_url is set", () => {
      const r = resolveBrand(
        {
          mode: "custom",
          company_text: "Acme",
          custom_logo_url: "/_uploads/logo.png",
        },
        { primary: "#142733" },
        "Acme",
      );
      expect(r.faviconUrl).toBe("/_uploads/logo.png");
    });

    it("uses custom_favicon_url when provided", () => {
      const r = resolveBrand(
        {
          mode: "custom",
          company_text: "Acme",
          custom_logo_url: "/_uploads/logo.png",
          custom_favicon_url: "/_uploads/favicon.ico",
        },
        { primary: "#142733" },
        "Acme",
      );
      expect(r.faviconUrl).toBe("/_uploads/favicon.ico");
    });

    it("falls back to auto mode when custom mode is set but custom_logo_url is empty", () => {
      // Defensive: shouldn't happen in practice (the panel sets both
      // atomically), but if a malformed brand record arrives we'd rather
      // render the auto logo than leave the slot blank.
      const r = resolveBrand(
        { mode: "custom", company_text: "Acme" },
        { primary: "#142733" },
        "Acme",
      );
      expect(r.logoUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    });
  });

  describe("resolveBrand — legacy fallback", () => {
    it("returns auto-mode SVGs when brand is null/undefined", () => {
      // Legacy sites have no brand field at all. The renderer still
      // needs a valid logo URL — falling back to auto mode using the
      // companyTextFallback (the site name) keeps logos rendering
      // without any migration step.
      const r1 = resolveBrand(null, { primary: "#142733" }, "LegacyCo");
      const r2 = resolveBrand(undefined, { primary: "#142733" }, "LegacyCo");
      expect(r1.logoUrl).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(r2.logoUrl).toMatch(/^data:image\/svg\+xml;base64,/);
      // Both should encode the fallback text into the SVG.
      const decoded = Buffer.from(
        r1.logoUrl.replace(/^data:image\/svg\+xml;base64,/, ""),
        "base64",
      ).toString("utf8");
      expect(decoded).toContain(">LegacyCo</text>");
    });

    it("uses default primary when theme has no primary set", () => {
      // Brand-new site with neither brand nor theme — must still render.
      const r = resolveBrand(null, null, "Acme");
      expect(r.logoUrl).toMatch(/^data:image\/svg\+xml;base64,/);
      const decoded = Buffer.from(
        r.logoUrl.replace(/^data:image\/svg\+xml;base64,/, ""),
        "base64",
      ).toString("utf8");
      expect(decoded).toContain('fill="#142733"');
    });

    it("falls back to 'Logo' when companyTextFallback is empty", () => {
      const r = resolveBrand(null, null, "");
      const decoded = Buffer.from(
        r.logoUrl.replace(/^data:image\/svg\+xml;base64,/, ""),
        "base64",
      ).toString("utf8");
      expect(decoded).toContain(">Logo</text>");
    });
  });

  describe("previewLogoUrl", () => {
    it("returns a data URL containing the input text + color", () => {
      const url = previewLogoUrl("Acme", "#a04545");
      const decoded = Buffer.from(
        url.replace(/^data:image\/svg\+xml;base64,/, ""),
        "base64",
      ).toString("utf8");
      expect(decoded).toContain(">Acme</text>");
      expect(decoded).toContain('fill="#a04545"');
    });

    it("falls back to defaults on empty inputs", () => {
      const url = previewLogoUrl("", "");
      const decoded = Buffer.from(
        url.replace(/^data:image\/svg\+xml;base64,/, ""),
        "base64",
      ).toString("utf8");
      expect(decoded).toContain(">Logo</text>");
      expect(decoded).toContain('fill="#142733"');
    });
  });
});
