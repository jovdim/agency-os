/**
 * Sanity check: simulate four different service-card image fields with
 * different peer titles + descriptions, and verify the prompt builder
 * now produces four DIFFERENT prompts (vs. the previous behaviour where
 * every klampiarstvo service image got the same generic shot).
 *
 * Run: npx tsx scripts/test-sibling-prompts.ts
 */

import { buildImagePrompt, finalizePrompt } from "../src/lib/ai/image-prompt-builder";

const ctx = {
  companyName: "Klempiarstvo Novák",
  industry: "klampiarstvo (roofing and sheet-metal trade)",
  town: "Žilina",
  services: [
    { title: "Oprava striech" },
    { title: "Výmena žľabov" },
    { title: "Oplechovanie komínov" },
    { title: "Izolácia striech" },
  ],
};

const cases = [
  {
    row: 1,
    sib: {
      title: "Oprava striech",
      description: "Kompletná oprava poškodenej strešnej krytiny",
    },
  },
  {
    row: 2,
    sib: {
      title: "Výmena žľabov",
      description: "Demontáž starých žľabov a montáž nových",
    },
  },
  {
    row: 3,
    sib: {
      title: "Oplechovanie komínov",
      description: "Profesionálne oplechovanie a tesnenie komínov",
    },
  },
  {
    row: 4,
    sib: {
      title: "Izolácia striech",
      description: "Tepelná izolácia striech a podstrešia",
    },
  },
];

console.log("─".repeat(78));
console.log("PER-ROW SERVICE IMAGE PROMPTS — should be DIFFERENT for each row");
console.log("─".repeat(78));
console.log();

for (const c of cases) {
  const p = buildImagePrompt({
    fieldKey: "image",
    sectionCategory: "services",
    siblingFields: c.sib,
    context: ctx,
  });
  console.log(`Row ${c.row} — peer title: "${c.sib.title}"`);
  console.log("  Visible prompt:");
  console.log(`    ${p}`);
  console.log();
}

console.log("─".repeat(78));
console.log("HERO IMAGE — should reference section headline if present");
console.log("─".repeat(78));
console.log();

const heroSibling = {
  headline: "Strechy a žľaby v Žiline",
  subtext: "Profesionálne klampiarske služby s 20-ročnou tradíciou",
};
const heroPrompt = buildImagePrompt({
  fieldKey: "image",
  sectionCategory: "hero",
  siblingFields: heroSibling,
  context: ctx,
});
console.log(`Hero peer headline: "${heroSibling.headline}"`);
console.log("  Visible prompt:");
console.log(`    ${heroPrompt}`);
console.log();
console.log("  Final (with realism enforcer):");
console.log(`    ${finalizePrompt(heroPrompt)}`);
console.log();

console.log("─".repeat(78));
console.log("FALLBACK — no siblings, no proposal services. Should still work.");
console.log("─".repeat(78));
console.log();

const fallbackPrompt = buildImagePrompt({
  fieldKey: "image",
  sectionCategory: "hero",
  context: { companyName: "", industry: "", town: "", services: [] },
});
console.log(`  ${fallbackPrompt}`);
console.log();
