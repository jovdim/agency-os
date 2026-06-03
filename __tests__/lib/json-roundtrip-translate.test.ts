import { describe, it, expect } from "vitest";
import {
  buildTranslationInstructionsBlock,
  DEFAULT_TRANSLATION_GUIDE,
} from "@/lib/composer/json-roundtrip";

/**
 * Tests for the translation instruction block — the prompt the operator
 * pastes into ChatGPT to translate the exported site JSON into another
 * language. The block must (a) name the target language, (b) carry the
 * translation guide, (c) protect brand names / structure, and (d) keep
 * the JSON marker the modal splits on so the existing copy/split logic
 * works. Written in English (it's a tech-facing prompt).
 */
describe("buildTranslationInstructionsBlock", () => {
  it("names the target language as the translation target", () => {
    const block = buildTranslationInstructionsBlock({
      targetLanguageLabel: "Deutsch",
    });
    expect(block).toContain("Deutsch");
    expect(block).toMatch(/TRANSLATE/);
  });

  it("includes the source language when provided", () => {
    const block = buildTranslationInstructionsBlock({
      targetLanguageLabel: "Deutsch",
      sourceLanguageLabel: "Slovenčina",
    });
    expect(block).toContain("Slovenčina");
    expect(block).toContain("Deutsch");
  });

  it("falls back to the default translation guide when none provided", () => {
    const block = buildTranslationInstructionsBlock({
      targetLanguageLabel: "English",
    });
    // a distinctive line from the default guide
    expect(block).toContain("native speaker");
    expect(block).toContain(DEFAULT_TRANSLATION_GUIDE.split("\n")[0]);
  });

  it("uses a custom translation guide when provided", () => {
    const block = buildTranslationInstructionsBlock({
      targetLanguageLabel: "English",
      translationGuide: "ALWAYS use British spelling.",
    });
    expect(block).toContain("ALWAYS use British spelling.");
    expect(block).not.toContain("native speaker");
  });

  it("protects the brand name when companyName is given, omits the block otherwise", () => {
    const withName = buildTranslationInstructionsBlock({
      targetLanguageLabel: "Deutsch",
      companyName: "Ploty Bránky",
    });
    expect(withName).toContain("Ploty Bránky");
    expect(withName).toContain("## Company name");

    const without = buildTranslationInstructionsBlock({
      targetLanguageLabel: "Deutsch",
    });
    // The brand-protection block only appears when a company name is given.
    expect(without).not.toContain("## Company name");
  });

  it("keeps the JSON marker so the modal's split logic still works", () => {
    const block = buildTranslationInstructionsBlock({
      targetLanguageLabel: "Deutsch",
    });
    expect(block).toContain("## JSON to translate");
  });

  it("enforces structural integrity in the format rules", () => {
    const block = buildTranslationInstructionsBlock({
      targetLanguageLabel: "Deutsch",
    });
    expect(block).toMatch(/Do NOT add or remove any keys/);
    expect(block).toMatch(/__seo/);
    expect(block).toMatch(/Only clean JSON/);
  });
});
