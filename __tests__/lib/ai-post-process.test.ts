import { describe, it, expect } from "vitest";
import { scrubAiResponse } from "@/lib/ai/post-process";

/**
 * Tests for the final-pass scrubber. The AI's output goes through this
 * before composition state is touched, so the rules here are
 * load-bearing , a regression silently leaks em-dashes onto live
 * client sites.
 *
 * We focus on three behaviours:
 *   1. Em-dash + en-dash become ", " (comma + space)
 *   2. Bullet glyphs at line starts get stripped
 *   3. Nested structures (objects + arrays of objects, the shape AI
 *      returns for repeaters) are walked exhaustively
 */
describe("scrubAiResponse", () => {
  it("replaces em-dash with comma + space", () => {
    const { cleaned, result } = scrubAiResponse({
      hero_headline: "Tradícia — Kvalita — Dôvera",
    });
    expect(cleaned).toEqual({
      hero_headline: "Tradícia, Kvalita, Dôvera",
    });
    expect(result.emDashHits).toBe(2);
  });

  it("replaces en-dash the same way as em-dash", () => {
    const { cleaned, result } = scrubAiResponse({
      tagline: "Rýchlo – spoľahlivo – cenovo dostupne",
    });
    expect(cleaned).toEqual({
      tagline: "Rýchlo, spoľahlivo, cenovo dostupne",
    });
    expect(result.emDashHits).toBe(2);
  });

  it("preserves real hyphens (e-shop, kuchyne-na-mieru)", () => {
    const { cleaned, result } = scrubAiResponse({
      desc: "Náš e-shop ponúka kuchyne-na-mieru.",
    });
    expect(cleaned).toEqual({
      desc: "Náš e-shop ponúka kuchyne-na-mieru.",
    });
    expect(result.emDashHits).toBe(0);
  });

  it("strips bullet glyphs at line starts", () => {
    const { cleaned, result } = scrubAiResponse({
      list: "• Profesionálny prístup\n• 10+ rokov skúseností\n• Záruka kvality",
    });
    expect(cleaned).toEqual({
      list: "Profesionálny prístup\n10+ rokov skúseností\nZáruka kvality",
    });
    expect(result.bulletHits).toBe(3);
  });

  it("walks repeater arrays (services, FAQ items)", () => {
    const input = {
      services_section: {
        services_items: [
          { title: "Návrh — zdarma", description: "Vypracujeme návrh." },
          { title: "Výroba", description: "V našej dielni — Bratislava." },
          { title: "Montáž", description: "Profesionálna inštalácia." },
        ],
      },
    };
    const { cleaned, result } = scrubAiResponse(input);
    expect(cleaned).toEqual({
      services_section: {
        services_items: [
          { title: "Návrh, zdarma", description: "Vypracujeme návrh." },
          { title: "Výroba", description: "V našej dielni, Bratislava." },
          { title: "Montáž", description: "Profesionálna inštalácia." },
        ],
      },
    });
    expect(result.emDashHits).toBe(2);
  });

  it("collapses double commas left behind by adjacent dashes", () => {
    // "X — — Y" is rare but seen in gpt-4o-mini output. Naive replace
    // would leave ", , " in the output.
    const { cleaned } = scrubAiResponse({ text: "Slovo — — Druhé" });
    expect(cleaned).toEqual({ text: "Slovo, Druhé" });
  });

  it("preserves intentional newlines in multi-paragraph fields", () => {
    // Composer about-sections sometimes contain real newlines.
    // The trim should NOT collapse them into a single space.
    const { cleaned } = scrubAiResponse({
      about: "Prvý odsek o firme.\nDruhý odsek o histórii.",
    });
    expect(cleaned).toEqual({
      about: "Prvý odsek o firme.\nDruhý odsek o histórii.",
    });
  });

  it("trims leading/trailing whitespace and collapses internal spaces", () => {
    const { cleaned } = scrubAiResponse({
      title: "   Príliš   medzier   tu   ",
    });
    expect(cleaned).toEqual({ title: "Príliš medzier tu" });
  });

  it("passes through numbers, booleans, and null untouched", () => {
    const { cleaned } = scrubAiResponse({
      count: 5,
      enabled: true,
      missing: null,
    });
    expect(cleaned).toEqual({ count: 5, enabled: true, missing: null });
  });

  it("handles a string at the root, not just objects", () => {
    const { cleaned, result } = scrubAiResponse("Bratislava — najväčšie mesto");
    expect(cleaned).toBe("Bratislava, najväčšie mesto");
    expect(result.emDashHits).toBe(1);
  });

  it("aggregates hit counts across the whole response", () => {
    const { result } = scrubAiResponse({
      a: "Jedno — dva",
      b: { nested: "Tri — štyri — päť" },
      c: ["• prvá", "Šesť — sedem"],
    });
    // a: 1 em-dash, b.nested: 2, c[0]: 1 bullet, c[1]: 1 em-dash → 4 dashes, 1 bullet
    expect(result.emDashHits).toBe(4);
    expect(result.bulletHits).toBe(1);
  });
});
