/**
 * Tests for the auto-brand SVG generator. The composer feeds these
 * helpers from the Brand panel (theme-panel.tsx) and embeds the
 * resulting SVG as a data URL in nav/footer logo `<img>` tags + the
 * page <head> favicon link. Because the data URL appears in the
 * published HTML directly, the SVG output has to be:
 *   - well-formed (no broken markup),
 *   - safe against injection (XML-escape every interpolated value),
 *   - readable on every brand color (auto white/black letter color),
 *   - and stable enough that two calls with the same input produce
 *     identical bytes (so the iframe doesn't churn on color picker drag).
 */

import { describe, it, expect } from "vitest";
import {
  buildLogoSvg,
  buildFaviconSvg,
  svgToDataUrl,
  firstLetter,
} from "@/lib/composer/logo-generator";

describe("logo-generator", () => {
  describe("buildLogoSvg", () => {
    it("produces a well-formed SVG with the expected structure", () => {
      const svg = buildLogoSvg({ text: "SaFi stav", primaryColor: "#142733" });
      expect(svg).toMatch(/^<svg /);
      expect(svg).toMatch(/<\/svg>$/);
      expect(svg).toContain("xmlns=\"http://www.w3.org/2000/svg\"");
      // One rect (icon block) + two text elements (icon letter + name)
      expect(svg.match(/<rect /g)).toHaveLength(1);
      expect(svg.match(/<text /g)).toHaveLength(2);
    });

    it("paints the icon block with the requested primary color", () => {
      const svg = buildLogoSvg({ text: "Acme", primaryColor: "#a04545" });
      expect(svg).toContain('fill="#a04545"');
    });

    it("uses the first letter of the text inside the icon block", () => {
      const svg = buildLogoSvg({ text: "balkar", primaryColor: "#1d4d8c" });
      // Icon-letter text is the first emitted <text> — pull it out
      // and verify it's the uppercased first character.
      const firstTextMatch = svg.match(/<text [^>]*>([^<]+)<\/text>/);
      expect(firstTextMatch?.[1]).toBe("B");
    });

    it("renders the full company name in the second text element", () => {
      const svg = buildLogoSvg({ text: "SaFi stav", primaryColor: "#142733" });
      expect(svg).toContain(">SaFi stav</text>");
    });

    it("flips the icon-letter color to white on a dark primary", () => {
      const svg = buildLogoSvg({ text: "X", primaryColor: "#0f172a" });
      // First <text> = icon letter, must be white on dark background.
      const firstTextStart = svg.indexOf("<text ");
      const firstTextSlice = svg.slice(firstTextStart, svg.indexOf(">", firstTextStart));
      expect(firstTextSlice).toContain('fill="#ffffff"');
    });

    it("flips the icon-letter color to near-black on a light primary", () => {
      const svg = buildLogoSvg({ text: "X", primaryColor: "#fdf6e3" });
      const firstTextStart = svg.indexOf("<text ");
      const firstTextSlice = svg.slice(firstTextStart, svg.indexOf(">", firstTextStart));
      expect(firstTextSlice).toContain('fill="#0f172a"');
    });

    it("escapes XML-significant characters in the company name", () => {
      // A bug here would let a maliciously-crafted company name break out
      // of the <text> element and inject markup. Pin the escape behavior.
      const svg = buildLogoSvg({
        text: 'A&B "Co." <Ltd>',
        primaryColor: "#142733",
      });
      expect(svg).not.toContain("<Ltd>");
      expect(svg).toContain("&amp;");
      expect(svg).toContain("&lt;Ltd&gt;");
      expect(svg).toContain("&quot;");
    });

    it("falls back to a default primary on bad hex input", () => {
      // Don't emit `fill="not-a-color"` into the SVG — that produces a
      // black icon block with no warning. Instead use the hardcoded
      // default and let the user notice their typo elsewhere.
      const svg = buildLogoSvg({ text: "Acme", primaryColor: "not-a-color" });
      expect(svg).toContain('fill="#142733"');
    });

    it("falls back to 'Logo' when text is empty or whitespace", () => {
      // Defensive — should never happen in practice (Brand panel
      // requires text), but the SVG must always render something readable.
      const svg = buildLogoSvg({ text: "   ", primaryColor: "#142733" });
      expect(svg).toContain(">Logo</text>");
    });

    it("widens the viewBox to fit longer names", () => {
      const short = buildLogoSvg({ text: "AA", primaryColor: "#000000" });
      const long = buildLogoSvg({
        text: "Aquaplastik Slovensko",
        primaryColor: "#000000",
      });
      // Pull viewBox width from each and assert the longer name's SVG is wider.
      const widthOf = (svg: string) => {
        const m = svg.match(/viewBox="0 0 (\d+) /);
        return m ? parseInt(m[1]!, 10) : 0;
      };
      expect(widthOf(long)).toBeGreaterThan(widthOf(short));
    });

    it("is deterministic — same input produces identical bytes", () => {
      // The composer recomputes this on every render pass (it's cheap
      // enough to skip memoization). If two identical inputs produced
      // different bytes, the iframe srcDoc would change every render
      // and reload constantly — preview would flicker on every keystroke.
      const a = buildLogoSvg({ text: "Acme", primaryColor: "#1d4d8c" });
      const b = buildLogoSvg({ text: "Acme", primaryColor: "#1d4d8c" });
      expect(a).toBe(b);
    });
  });

  describe("buildFaviconSvg", () => {
    it("produces a 64×64 SVG with one rect + one centered letter", () => {
      const svg = buildFaviconSvg({ letter: "S", primaryColor: "#142733" });
      expect(svg).toContain('viewBox="0 0 64 64"');
      expect(svg).toContain("<rect ");
      expect(svg).toContain("<text ");
      expect(svg).toContain('text-anchor="middle"');
    });

    it("uses the requested letter, uppercased", () => {
      const svg = buildFaviconSvg({ letter: "a", primaryColor: "#142733" });
      expect(svg).toMatch(/>A<\/text>/);
    });

    it("paints the rect with the brand primary", () => {
      const svg = buildFaviconSvg({ letter: "X", primaryColor: "#a04545" });
      expect(svg).toContain('fill="#a04545"');
    });

    it("flips the letter color based on background luminance", () => {
      const dark = buildFaviconSvg({ letter: "X", primaryColor: "#0f172a" });
      const light = buildFaviconSvg({ letter: "X", primaryColor: "#fdf6e3" });
      // Pull the second fill in each (rect is first, text is second).
      const fills = (svg: string) =>
        Array.from(svg.matchAll(/fill="([^"]+)"/g)).map((m) => m[1]);
      expect(fills(dark)[1]).toBe("#ffffff");
      expect(fills(light)[1]).toBe("#0f172a");
    });

    it("falls back to 'L' when letter is empty", () => {
      const svg = buildFaviconSvg({ letter: "", primaryColor: "#142733" });
      expect(svg).toMatch(/>L<\/text>/);
    });
  });

  describe("svgToDataUrl", () => {
    it("returns a data:image/svg+xml;base64 URL", () => {
      const url = svgToDataUrl("<svg/>");
      expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
    });

    it("round-trips the input bytes through base64 decode", () => {
      const svg = buildLogoSvg({ text: "Acme", primaryColor: "#000000" });
      const url = svgToDataUrl(svg);
      const b64 = url.replace(/^data:image\/svg\+xml;base64,/, "");
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      expect(decoded).toBe(svg);
    });

    it("handles non-ASCII (Slovak accented characters) without throwing", () => {
      // btoa throws InvalidCharacterError on raw non-ASCII; the helper
      // must UTF-8 encode first. Slovak business names commonly contain
      // ž / š / č / etc.
      const svg = buildLogoSvg({
        text: "Žltý kôň",
        primaryColor: "#142733",
      });
      expect(() => svgToDataUrl(svg)).not.toThrow();
      // And the round-trip should reconstruct the original bytes.
      const url = svgToDataUrl(svg);
      const decoded = Buffer.from(
        url.replace(/^data:image\/svg\+xml;base64,/, ""),
        "base64",
      ).toString("utf8");
      expect(decoded).toBe(svg);
    });
  });

  describe("firstLetter", () => {
    it("returns the first non-whitespace character, uppercased", () => {
      expect(firstLetter("acme")).toBe("A");
      expect(firstLetter("  acme")).toBe("A");
      expect(firstLetter("ACME")).toBe("A");
    });

    it("falls back to 'L' on empty / whitespace-only input", () => {
      expect(firstLetter("")).toBe("L");
      expect(firstLetter("   ")).toBe("L");
    });

    it("preserves accented Latin characters (Slovak business names)", () => {
      expect(firstLetter("ŽLTÝ")).toBe("Ž");
      expect(firstLetter("šuhaj")).toBe("Š");
    });
  });
});
