/**
 * Tests for the curated palette helpers used by:
 *   - The "Generate full site" scaffold (random primary)
 *   - The randomize dice in the ThemePanel (random per-color reroll)
 *
 * The avoid-the-current-color behavior matters for UX: clicking dice and
 * getting back the same hex you already had makes the button feel broken.
 */

import { describe, it, expect } from "vitest";
import {
  PRIMARY_PALETTE,
  BG_PALETTE,
  pickRandomColor,
  pickScaffoldPrimary,
} from "@/lib/composer/scaffold-palette";

describe("scaffold-palette", () => {
  describe("PRIMARY_PALETTE", () => {
    it("has at least 10 entries (variety check)", () => {
      // If someone trims the palette below 10, the scaffold's "feels
      // different each time" promise breaks. Guard rail.
      expect(PRIMARY_PALETTE.length).toBeGreaterThanOrEqual(10);
    });

    it("every entry is a valid 6-char hex", () => {
      for (const c of PRIMARY_PALETTE) {
        expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });

    it("has no duplicates", () => {
      const set = new Set(PRIMARY_PALETTE.map((c) => c.toLowerCase()));
      expect(set.size).toBe(PRIMARY_PALETTE.length);
    });
  });

  describe("BG_PALETTE", () => {
    it("has at least 6 entries", () => {
      expect(BG_PALETTE.length).toBeGreaterThanOrEqual(6);
    });

    it("every entry is a valid 6-char hex", () => {
      for (const c of BG_PALETTE) {
        expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });

    it("every entry is a LIGHT color (luminance > 0.85)", () => {
      // Random rolling into a dark bg would break sections that derive
      // text colors / button styles from --color-bg. The palette is
      // light-only by design — this test pins that.
      for (const hex of BG_PALETTE) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        expect(luminance, `${hex} should be light`).toBeGreaterThan(0.85);
      }
    });
  });

  describe("pickRandomColor", () => {
    it("returns a color from the palette", () => {
      const picked = pickRandomColor(PRIMARY_PALETTE);
      expect(PRIMARY_PALETTE).toContain(picked);
    });

    it("never returns the avoid value (when palette has alternatives)", () => {
      // Run many trials — with even chance of collision per trial,
      // 200 iterations would catch a broken implementation reliably.
      const target = PRIMARY_PALETTE[0]!;
      for (let i = 0; i < 200; i++) {
        const picked = pickRandomColor(PRIMARY_PALETTE, target);
        expect(picked).not.toBe(target);
      }
    });

    it("matches the avoid value case-insensitively", () => {
      // Color inputs sometimes return uppercase hex (#FFFFFF) while the
      // palette stores lowercase (#ffffff). Avoid-comparison must be
      // case-insensitive or we'd return the same color the user already had.
      const target = PRIMARY_PALETTE[0]!;
      for (let i = 0; i < 200; i++) {
        const picked = pickRandomColor(PRIMARY_PALETTE, target.toUpperCase());
        expect(picked.toLowerCase()).not.toBe(target.toLowerCase());
      }
    });

    it("returns the only entry when palette is single-color (no infinite loop)", () => {
      // Edge case: palette of length 1 with avoid set. We accept returning
      // that one value rather than spinning forever — better-than-nothing
      // semantics. Real palettes never hit this, but the helper must be safe.
      const picked = pickRandomColor(["#abcdef"], "#abcdef");
      expect(picked).toBe("#abcdef");
    });

    it("handles undefined avoid (no filter)", () => {
      const picked = pickRandomColor(PRIMARY_PALETTE);
      expect(PRIMARY_PALETTE).toContain(picked);
    });
  });

  describe("pickScaffoldPrimary", () => {
    it("returns one of the PRIMARY_PALETTE colors", () => {
      const picked = pickScaffoldPrimary();
      expect(PRIMARY_PALETTE).toContain(picked);
    });

    it("returns different colors over many calls (randomness sanity)", () => {
      const picks = new Set<string>();
      for (let i = 0; i < 50; i++) picks.add(pickScaffoldPrimary());
      // With 16 colors over 50 trials, we should hit at least 5 distinct
      // values — anything below indicates the RNG is broken or biased.
      expect(picks.size).toBeGreaterThanOrEqual(5);
    });
  });
});
