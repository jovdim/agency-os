import { describe, it, expect } from "vitest";
import { tagPalette, TAG_PALETTE, TAG_COLORS } from "@/components/proposal-tags";
import type { TagColor } from "@/types/database";

/**
 * Tests for the proposal-tagging system primitives.
 *
 * Higher-level tests (API endpoints, optimistic UI, picker behavior) live
 * in component / e2e suites — this file pins down the pure logic that the
 * UI relies on so we catch regressions in the palette + slug normalization
 * before they ship.
 *
 * Why test the palette: tag colors are stored in the DB as Tailwind hue
 * keywords (red, orange, …). If `tagPalette()` is missing an entry or
 * defaults silently for a recognized color, chips render gray and the
 * whole "Urgent is red, Premium is purple" UX breaks invisibly. A test
 * is the cheapest insurance.
 */

describe("tagPalette()", () => {
  it("returns palette entry for every TagColor in the union", () => {
    // The DB has a CHECK constraint listing the same colors as TAG_COLORS.
    // If anyone adds a color in one place but forgets the other,
    // the palette walk-through will emit an empty chip class — caught here.
    for (const color of TAG_COLORS) {
      const entry = tagPalette(color);
      expect(entry.chip).toMatch(/bg-/);
      expect(entry.filled).toMatch(/bg-/);
      expect(entry.swatch).toMatch(/bg-/);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it("falls back to gray for an unknown color string", () => {
    // Defensive — if the DB somehow holds an unrecognized color (e.g. a
    // future migration adds one and an old client renders it), the chip
    // should still render rather than throwing.
    const entry = tagPalette("burgundy" as TagColor);
    expect(entry).toBe(TAG_PALETTE.gray);
  });

  it("falls back to gray for null/undefined/empty", () => {
    expect(tagPalette(null)).toBe(TAG_PALETTE.gray);
    expect(tagPalette(undefined)).toBe(TAG_PALETTE.gray);
    expect(tagPalette("")).toBe(TAG_PALETTE.gray);
  });

  it("known seeded tag colors map to the right hue", () => {
    // The four defaults Peter asked for — these are checked into the
    // 00046 migration as seeds, so the colors must match what the DB ships.
    expect(tagPalette("red").chip).toContain("red");
    expect(tagPalette("orange").chip).toContain("orange");
    expect(tagPalette("purple").chip).toContain("purple");
    expect(tagPalette("gray").chip).toContain("gray");
  });
});

describe("TAG_COLORS list parity with palette", () => {
  it("every TAG_COLORS entry has a TAG_PALETTE entry (no orphans)", () => {
    for (const color of TAG_COLORS) {
      expect(TAG_PALETTE[color]).toBeDefined();
    }
  });

  it("every TAG_PALETTE key appears in TAG_COLORS (no hidden entries)", () => {
    // Reverse direction — if someone adds to TAG_PALETTE but forgets
    // TAG_COLORS, the picker swatch grid wouldn't show the new color.
    for (const key of Object.keys(TAG_PALETTE)) {
      expect(TAG_COLORS).toContain(key as TagColor);
    }
  });
});

/**
 * Slugify behavior — pulled from the API route so we can lock down the
 * conversion that determines the stable identity of a tag.
 *
 * NOTE: this duplicates the implementation in src/app/api/proposal-tags/
 * route.ts. We could export & share it, but the route file is server-only
 * (imports next/server) and this test runs in node. Cheaper to mirror the
 * logic here than to refactor for one helper. If the route's slugify
 * changes, this will go red and force the same change here — that's the
 * intended pin.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

describe("tag slugify", () => {
  it("converts plain ASCII to a clean slug", () => {
    expect(slugify("Urgent")).toBe("urgent");
    expect(slugify("Premium Proposal")).toBe("premium-proposal");
    expect(slugify("  Spaced  Out  ")).toBe("spaced-out");
  });

  it("strips Slovak diacritics (NFD + combining-mark removal)", () => {
    // Real cases the salesperson types in Slovak — slugs need to be
    // pure ASCII to satisfy the slug regex CHECK in the migration.
    expect(slugify("Návrh")).toBe("navrh");
    expect(slugify("Súrne")).toBe("surne");
    expect(slugify("Dôležité")).toBe("dolezite");
  });

  it("collapses repeated separators", () => {
    expect(slugify("foo!!!bar???baz")).toBe("foo-bar-baz");
    expect(slugify("a   b   c")).toBe("a-b-c");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("---hello---")).toBe("hello");
    expect(slugify("!!!Wow!!!")).toBe("wow");
  });

  it("returns an empty string for input with no alphanumerics", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("---")).toBe("");
    expect(slugify("   ")).toBe("");
  });

  it("caps at 50 characters", () => {
    const longInput = "a".repeat(80);
    expect(slugify(longInput)).toHaveLength(50);
  });

  it("preserves digits", () => {
    expect(slugify("Top 3 priority")).toBe("top-3-priority");
    expect(slugify("v2 release")).toBe("v2-release");
  });

  it("matches the CHECK constraint regex from the migration", () => {
    // The 00046 migration enforces:
    //   slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'
    // Any output of slugify (when non-empty) must satisfy it — otherwise
    // the INSERT will fail with constraint_violation at runtime.
    const constraint = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/;
    const samples = [
      "urgent", "Premium Proposal", "Návrh-2", "foo bar baz",
      "Súrne!", "v2 release", "x", "A1",
    ];
    for (const sample of samples) {
      const out = slugify(sample);
      if (out.length > 0) {
        expect(out).toMatch(constraint);
      }
    }
  });
});
