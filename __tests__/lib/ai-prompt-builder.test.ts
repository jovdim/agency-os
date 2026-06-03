import { describe, it, expect } from "vitest";
import { buildPrompt, type TemplateMeta } from "@/lib/ai/prompt-builder";
import type { SiteComposition } from "@/lib/templates/render";
import type { FieldSchema } from "@/components/composer/placeholder-field";

/**
 * Tests for the prompt builder. Verifies the two pillars of the
 * generation contract:
 *
 *   1. The system prompt is VERBATIM the copywriting guide. No
 *      hidden appendix, no internal rules. (User control over
 *      prompt content is core to Peter's design.)
 *   2. The eligibility rules pick the right fields:
 *      - text/longtext/richtext/link → in
 *      - image/map/contact-shaped → out
 *      - smart-skip-edited only on mode=all
 *      - mode=section never smart-skips
 */

function tplMeta(category: string, schema: Record<string, FieldSchema>): TemplateMeta {
  return { id: `${category}-tpl`, category, schema };
}

function comp(
  sections: Array<{ id: string; template_id: string; overrides?: Record<string, unknown> }>,
): SiteComposition {
  return {
    pages: [
      {
        path: "index.html",
        label: "Domov",
        sections: sections.map((s, i) => ({
          id: s.id,
          template_id: s.template_id,
          order: i,
          content_overrides: (s.overrides ?? {}) as Record<string, never>,
        })),
      },
    ],
  };
}

describe("buildPrompt — system prompt is verbatim the guide", () => {
  it("returns the copywriting guide unmodified as the system prompt", () => {
    const guide = `NO AI FLUFF. Write Slovak.
Lengths: anything you want.
Output: just JSON.`;
    const { systemPrompt } = buildPrompt({
      copywritingGuide: guide,
      composition: comp([{ id: "s1", template_id: "hero-tpl" }]),
      templates: new Map([
        ["hero-tpl", tplMeta("hero", { hero_headline: { type: "text" } as FieldSchema })],
      ]),
      inputs: { companyName: "X", industry: "y", town: "z", services: [] },
      mode: "all",
    });
    expect(systemPrompt).toBe(guide.trim());
    // No appendix, no leading/trailing junk added by the builder.
    expect(systemPrompt).not.toContain("OUTPUT RULES");
    expect(systemPrompt).not.toContain("JSON OUTPUT FORMAT");
  });
});

describe("buildPrompt — field eligibility (mode=all)", () => {
  it("includes text/longtext/richtext/link, excludes image/map/contact", () => {
    const composition = comp([{ id: "s1", template_id: "mixed-tpl" }]);
    const templates = new Map([
      [
        "mixed-tpl",
        tplMeta("hero", {
          hero_headline: { type: "text" } as FieldSchema,
          hero_subheadline: { type: "longtext" } as FieldSchema,
          hero_image: { type: "image" } as FieldSchema,
          hero_cta: { type: "link" } as FieldSchema,
          hero_richtext: { type: "richtext" } as FieldSchema,
          map_address: { type: "map" } as FieldSchema,
          contact_phone: { type: "text" } as FieldSchema,
          customer_email: { type: "text" } as FieldSchema,
          street_address: { type: "text" } as FieldSchema,
        }),
      ],
    ]);

    const { specs } = buildPrompt({
      copywritingGuide: "g",
      composition,
      templates,
      inputs: { companyName: "X", industry: "y", town: "z", services: [] },
      mode: "all",
    });

    expect(specs).toHaveLength(1);
    const fieldKeys = specs[0].fields.map((f) => f.key);
    // Eligible
    expect(fieldKeys).toContain("hero_headline");
    expect(fieldKeys).toContain("hero_subheadline");
    expect(fieldKeys).toContain("hero_cta");
    expect(fieldKeys).toContain("hero_richtext");
    // Skipped
    expect(fieldKeys).not.toContain("hero_image");
    expect(fieldKeys).not.toContain("map_address");
    expect(fieldKeys).not.toContain("contact_phone");
    expect(fieldKeys).not.toContain("customer_email");
    expect(fieldKeys).not.toContain("street_address");
  });

  it("smart-skips fields whose value differs from template default", () => {
    const composition = comp([
      {
        id: "s1",
        template_id: "hero-tpl",
        overrides: {
          // user has typed something custom, must NOT be overwritten
          hero_headline: "Náš vlastný nadpis",
          // still on default, should be filled
          // hero_subheadline omitted = no override = AI fills
        },
      },
    ]);
    const templates = new Map([
      [
        "hero-tpl",
        tplMeta("hero", {
          hero_headline: {
            type: "text",
            default: "Sem napíšte nadpis",
          } as FieldSchema,
          hero_subheadline: {
            type: "longtext",
            default: "Sem napíšte podnadpis",
          } as FieldSchema,
        }),
      ],
    ]);

    const { specs } = buildPrompt({
      copywritingGuide: "g",
      composition,
      templates,
      inputs: { companyName: "X", industry: "y", town: "z", services: [] },
      mode: "all",
    });

    const keys = specs[0]?.fields.map((f) => f.key) ?? [];
    expect(keys).not.toContain("hero_headline"); // edited, skipped
    expect(keys).toContain("hero_subheadline"); // empty, filled
  });
});

describe("buildPrompt — mode=section never smart-skips", () => {
  it("includes ALL eligible fields in the targeted section, even edited ones", () => {
    const composition = comp([
      {
        id: "s1",
        template_id: "hero-tpl",
        overrides: { hero_headline: "Custom title the user typed" },
      },
    ]);
    const templates = new Map([
      [
        "hero-tpl",
        tplMeta("hero", {
          hero_headline: { type: "text", default: "default" } as FieldSchema,
          hero_subheadline: { type: "longtext", default: "default" } as FieldSchema,
        }),
      ],
    ]);

    const { specs } = buildPrompt({
      copywritingGuide: "g",
      composition,
      templates,
      inputs: { companyName: "X", industry: "y", town: "z", services: [] },
      mode: "section",
      sectionId: "s1",
    });

    expect(specs).toHaveLength(1);
    const keys = specs[0].fields.map((f) => f.key);
    expect(keys).toContain("hero_headline"); // overwritten, user opted in
    expect(keys).toContain("hero_subheadline");
  });
});

describe("buildPrompt — services + custom prompt forwarding", () => {
  it("includes the company info and services in the user prompt", () => {
    const { userPrompt } = buildPrompt({
      copywritingGuide: "g",
      composition: comp([{ id: "s1", template_id: "hero-tpl" }]),
      templates: new Map([
        [
          "hero-tpl",
          tplMeta("hero", { hero_headline: { type: "text" } as FieldSchema }),
        ],
      ]),
      inputs: {
        companyName: "AB Pieskovanie",
        industry: "pieskovanie",
        town: "Bratislava",
        services: [
          { title: "Pieskovanie plotov", description: "rez hrdze" },
          { title: "Renovácia karosérií" },
        ],
      },
      mode: "all",
    });

    expect(userPrompt).toContain("AB Pieskovanie");
    expect(userPrompt).toContain("pieskovanie");
    expect(userPrompt).toContain("Bratislava");
    expect(userPrompt).toContain("Pieskovanie plotov");
    expect(userPrompt).toContain("rez hrdze"); // description forwarded
    expect(userPrompt).toContain("Renovácia karosérií");
  });

  it("includes the custom prompt when provided", () => {
    const { userPrompt } = buildPrompt({
      copywritingGuide: "g",
      composition: comp([{ id: "s1", template_id: "hero-tpl" }]),
      templates: new Map([
        [
          "hero-tpl",
          tplMeta("hero", { hero_headline: { type: "text" } as FieldSchema }),
        ],
      ]),
      inputs: { companyName: "X", industry: "y", town: "z", services: [] },
      mode: "all",
      customPrompt: "make it luxury, mention 20 percent winter discount",
    });

    expect(userPrompt).toContain("luxury");
    expect(userPrompt).toContain("20 percent winter discount");
  });
});
