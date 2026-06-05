import { describe, it, expect } from "vitest";
import { INLINE_EDITOR_SCRIPT, INLINE_EDITOR_CSS } from "@/lib/inline-editor-script";

describe("inline-editor-script", () => {
  describe("exports", () => {
    it("exports INLINE_EDITOR_SCRIPT as a non-empty string", () => {
      expect(typeof INLINE_EDITOR_SCRIPT).toBe("string");
      expect(INLINE_EDITOR_SCRIPT.length).toBeGreaterThan(100);
    });

    it("exports INLINE_EDITOR_CSS as a non-empty string", () => {
      expect(typeof INLINE_EDITOR_CSS).toBe("string");
      expect(INLINE_EDITOR_CSS.length).toBeGreaterThan(50);
    });
  });

  describe("script content", () => {
    it("contains IIFE wrapper", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("(function()");
      expect(INLINE_EDITOR_SCRIPT).toContain("'use strict'");
    });

    it("handles TEXT_EDIT_START postMessage", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("TEXT_EDIT_START");
    });

    it("handles TEXT_EDIT_COMPLETE postMessage", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("TEXT_EDIT_COMPLETE");
    });

    it("handles TEXT_EDIT_CANCEL postMessage", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("TEXT_EDIT_CANCEL");
    });

    it("handles IMAGE_REPLACED postMessage", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("IMAGE_REPLACED");
    });

    it("handles EDITOR_READY postMessage", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("EDITOR_READY");
    });

    it("handles parent messages: UPDATE_IMAGE_SRC", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("UPDATE_IMAGE_SRC");
    });

    it("handles parent messages: REVERT_FIELD", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("REVERT_FIELD");
    });

    it("handles parent messages: HIGHLIGHT_ELEMENT", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("HIGHLIGHT_ELEMENT");
    });

    it("handles parent messages: SCROLL_TO_SECTION", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("SCROLL_TO_SECTION");
    });

    it("sets contenteditable on text elements", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("contenteditable");
    });

    it("generates CSS paths for element identification", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("generateCssPath");
      expect(INLINE_EDITOR_SCRIPT).toContain("nth-of-type");
    });

    it("prevents link navigation in edit mode", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("preventDefault");
      expect(INLINE_EDITOR_SCRIPT).toContain("a[href]");
    });

    it("handles Enter key to confirm edit", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("Enter");
      expect(INLINE_EDITOR_SCRIPT).toContain("confirmEdit");
    });

    it("handles Escape key to cancel edit", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("Escape");
      expect(INLINE_EDITOR_SCRIPT).toContain("cancelEdit");
    });

    it("checks for data-section attributes", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("data-section");
    });

    it("checks for data-field attributes", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("data-field");
    });

    it("checks for data-item attributes", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("data-item");
    });

    it("uses data-field based detection", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("data-field");
      expect(INLINE_EDITOR_SCRIPT).toContain("getFieldInfo");
    });

    it("handles IMG and background-image elements", () => {
      expect(INLINE_EDITOR_SCRIPT).toContain("IMG");
      expect(INLINE_EDITOR_SCRIPT).toContain("isBgImage");
      expect(INLINE_EDITOR_SCRIPT).toContain("backgroundImage");
    });
  });

  describe("CSS content", () => {
    it("has data-field hover styles", () => {
      // Hover is now selector-based (no class) — applies to any element with data-field
      expect(INLINE_EDITOR_CSS).toContain("[data-field]:hover");
    });

    it("has active class styles", () => {
      expect(INLINE_EDITOR_CSS).toContain("sk-editor-active");
    });

    it("has highlight class styles", () => {
      expect(INLINE_EDITOR_CSS).toContain("sk-editor-highlight");
    });

    it("has changed class styles", () => {
      expect(INLINE_EDITOR_CSS).toContain("sk-editor-changed");
    });

    it("has highlight scale transform for images", () => {
      // Images use a smooth scale-up instead of a pulse animation
      expect(INLINE_EDITOR_CSS).toContain("img.sk-editor-highlight");
      expect(INLINE_EDITOR_CSS).toContain("scale(1.05)");
    });
  });
});
