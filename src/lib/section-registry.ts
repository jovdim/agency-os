/**
 * Section Type Registry
 *
 * This registry provides COMMON section type definitions as starting templates.
 * It is NOT a restrictive list -- custom section types are fully supported.
 *
 * When creating a new site, the content.json from the vibe-coded website
 * dictates the actual sections. If a section type is not in this registry,
 * the dashboard will still render it using its fields dynamically.
 */

export type FieldType =
  | "text"
  | "textarea"
  | "url"
  | "image"
  | "icon"
  | "color"
  | "boolean"
  | "number"
  | "email"
  | "phone"
  | "date"
  | "select"
  | "richtext";

export interface FieldDefinition {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface RepeaterFieldDefinition {
  name: string;
  label: string;
  itemFields: FieldDefinition[];
  minItems?: number;
  maxItems?: number;
}

export interface SectionTypeDefinition {
  type: string;
  label: string;
  description: string;
  icon: string;
  fields: FieldDefinition[];
  repeaters: RepeaterFieldDefinition[];
}

export const SECTION_REGISTRY: SectionTypeDefinition[] = [
  {
    type: "navigation",
    label: "Navigation",
    description: "Site navigation bar with logo, menu links, and optional CTA",
    icon: "menu",
    fields: [
      { name: "logo_text", label: "Logo Text", type: "text", required: false },
      {
        name: "logo_image",
        label: "Logo Image",
        type: "image",
        required: false,
      },
      {
        name: "cta_text",
        label: "CTA Button Text",
        type: "text",
        required: false,
      },
      {
        name: "cta_url",
        label: "CTA Button Link",
        type: "url",
        required: false,
      },
    ],
    repeaters: [
      {
        name: "links",
        label: "Menu Links",
        itemFields: [
          { name: "label", label: "Label", type: "text", required: true },
          { name: "url", label: "URL", type: "url", required: true },
        ],
      },
    ],
  },
  {
    type: "hero",
    label: "Hero",
    description: "Main banner with headline, subheadline, and call-to-action",
    icon: "layout-template",
    fields: [
      { name: "headline", label: "Headline", type: "text", required: true },
      {
        name: "subheadline",
        label: "Subheadline",
        type: "text",
        required: false,
      },
      { name: "cta_text", label: "Button Text", type: "text", required: false },
      { name: "cta_url", label: "Button Link", type: "url", required: false },
      {
        name: "cta_text_2",
        label: "Second Button Text",
        type: "text",
        required: false,
      },
      {
        name: "cta_url_2",
        label: "Second Button Link",
        type: "url",
        required: false,
      },
      {
        name: "background_image",
        label: "Background Image",
        type: "image",
        required: false,
      },
      { name: "image", label: "Side Image", type: "image", required: false },
    ],
    repeaters: [],
  },
  {
    type: "about",
    label: "About",
    description: "About section with text content and optional image",
    icon: "info",
    fields: [
      { name: "headline", label: "Headline", type: "text", required: true },
      { name: "text", label: "Content", type: "textarea", required: true },
      { name: "image", label: "Image", type: "image", required: false },
    ],
    repeaters: [],
  },
  {
    type: "services_grid",
    label: "Services (Grid)",
    description: "Grid of service items with titles, descriptions, and icons",
    icon: "grid-3x3",
    fields: [
      { name: "headline", label: "Headline", type: "text", required: true },
      {
        name: "subheadline",
        label: "Subheadline",
        type: "text",
        required: false,
      },
    ],
    repeaters: [
      {
        name: "items",
        label: "Services",
        itemFields: [
          { name: "title", label: "Title", type: "text", required: true },
          {
            name: "description",
            label: "Description",
            type: "textarea",
            required: true,
          },
          { name: "icon", label: "Icon", type: "icon", required: false },
          { name: "image", label: "Image", type: "image", required: false },
          { name: "url", label: "Link", type: "url", required: false },
        ],
      },
    ],
  },
  {
    type: "gallery",
    label: "Gallery",
    description: "Image gallery with optional captions",
    icon: "images",
    fields: [
      { name: "headline", label: "Headline", type: "text", required: true },
    ],
    repeaters: [
      {
        name: "items",
        label: "Images",
        itemFields: [
          { name: "image", label: "Image", type: "image", required: true },
          { name: "caption", label: "Caption", type: "text", required: false },
          {
            name: "alt_text",
            label: "Alt Text",
            type: "text",
            required: false,
          },
        ],
      },
    ],
  },
  {
    type: "testimonials",
    label: "Testimonials",
    description: "Customer reviews and testimonials",
    icon: "message-square-quote",
    fields: [
      { name: "headline", label: "Headline", type: "text", required: true },
      {
        name: "subheadline",
        label: "Subheadline",
        type: "text",
        required: false,
      },
    ],
    repeaters: [
      {
        name: "items",
        label: "Testimonials",
        itemFields: [
          {
            name: "text",
            label: "Review Text",
            type: "textarea",
            required: true,
          },
          {
            name: "author",
            label: "Author Name",
            type: "text",
            required: true,
          },
          {
            name: "role",
            label: "Role / Title",
            type: "text",
            required: false,
          },
          { name: "avatar", label: "Avatar", type: "image", required: false },
          {
            name: "rating",
            label: "Rating (1-5)",
            type: "number",
            required: false,
          },
        ],
      },
    ],
  },
  {
    type: "faq",
    label: "FAQ",
    description: "Frequently asked questions with answers",
    icon: "circle-help",
    fields: [
      { name: "headline", label: "Headline", type: "text", required: true },
      {
        name: "subheadline",
        label: "Subheadline",
        type: "text",
        required: false,
      },
    ],
    repeaters: [
      {
        name: "items",
        label: "Questions",
        itemFields: [
          { name: "question", label: "Question", type: "text", required: true },
          { name: "answer", label: "Answer", type: "textarea", required: true },
        ],
      },
    ],
  },
  {
    type: "contact",
    label: "Contact",
    description:
      "Contact information with address, phone, email, and optional map",
    icon: "phone",
    fields: [
      { name: "headline", label: "Headline", type: "text", required: true },
      {
        name: "subheadline",
        label: "Subheadline",
        type: "text",
        required: false,
      },
      { name: "address", label: "Address", type: "text", required: false },
      { name: "phone", label: "Phone", type: "text", required: false },
      { name: "email", label: "Email", type: "text", required: false },
      {
        name: "map_embed_url",
        label: "Map Embed URL",
        type: "url",
        required: false,
      },
    ],
    repeaters: [],
  },
  {
    type: "footer",
    label: "Footer",
    description: "Page footer with copyright, links, and social media",
    icon: "panel-bottom",
    fields: [
      {
        name: "copyright_text",
        label: "Copyright Text",
        type: "text",
        required: true,
      },
      { name: "logo_text", label: "Logo Text", type: "text", required: false },
      {
        name: "logo_image",
        label: "Logo Image",
        type: "image",
        required: false,
      },
      {
        name: "description",
        label: "Footer Description",
        type: "textarea",
        required: false,
      },
    ],
    repeaters: [
      {
        name: "links",
        label: "Footer Links",
        itemFields: [
          { name: "label", label: "Label", type: "text", required: true },
          { name: "url", label: "URL", type: "url", required: true },
        ],
      },
      {
        name: "social",
        label: "Social Media Links",
        itemFields: [
          { name: "platform", label: "Platform", type: "text", required: true },
          { name: "url", label: "URL", type: "url", required: true },
          { name: "icon", label: "Icon", type: "icon", required: false },
        ],
      },
    ],
  },
  {
    type: "cta_banner",
    label: "CTA Banner",
    description: "Call-to-action banner with headline and button",
    icon: "megaphone",
    fields: [
      { name: "headline", label: "Headline", type: "text", required: true },
      {
        name: "subheadline",
        label: "Subheadline",
        type: "text",
        required: false,
      },
      { name: "cta_text", label: "Button Text", type: "text", required: true },
      { name: "cta_url", label: "Button Link", type: "url", required: true },
      {
        name: "background_image",
        label: "Background Image",
        type: "image",
        required: false,
      },
    ],
    repeaters: [],
  },
  {
    type: "pricing",
    label: "Pricing",
    description: "Pricing plans with features",
    icon: "credit-card",
    fields: [
      { name: "headline", label: "Headline", type: "text", required: true },
      {
        name: "subheadline",
        label: "Subheadline",
        type: "text",
        required: false,
      },
    ],
    repeaters: [
      {
        name: "items",
        label: "Plans",
        itemFields: [
          { name: "plan", label: "Plan Name", type: "text", required: true },
          { name: "price", label: "Price", type: "text", required: true },
          {
            name: "description",
            label: "Description",
            type: "text",
            required: false,
          },
          {
            name: "cta_text",
            label: "Button Text",
            type: "text",
            required: false,
          },
          {
            name: "cta_url",
            label: "Button Link",
            type: "url",
            required: false,
          },
          {
            name: "highlighted",
            label: "Highlighted",
            type: "boolean",
            required: false,
          },
        ],
        maxItems: 6,
      },
    ],
  },
  {
    type: "team",
    label: "Team",
    description: "Team members with photos and roles",
    icon: "users",
    fields: [
      { name: "headline", label: "Headline", type: "text", required: true },
      {
        name: "subheadline",
        label: "Subheadline",
        type: "text",
        required: false,
      },
    ],
    repeaters: [
      {
        name: "items",
        label: "Members",
        itemFields: [
          { name: "name", label: "Name", type: "text", required: true },
          { name: "role", label: "Role", type: "text", required: true },
          { name: "image", label: "Photo", type: "image", required: false },
          { name: "bio", label: "Bio", type: "textarea", required: false },
        ],
      },
    ],
  },
  {
    type: "stats",
    label: "Statistics",
    description: "Numerical statistics with labels",
    icon: "bar-chart-3",
    fields: [
      { name: "headline", label: "Headline", type: "text", required: false },
    ],
    repeaters: [
      {
        name: "items",
        label: "Stats",
        itemFields: [
          { name: "value", label: "Value", type: "text", required: true },
          { name: "label", label: "Label", type: "text", required: true },
          { name: "icon", label: "Icon", type: "icon", required: false },
        ],
      },
    ],
  },
  {
    type: "features",
    label: "Features",
    description: "Feature highlights with icons and descriptions",
    icon: "sparkles",
    fields: [
      { name: "headline", label: "Headline", type: "text", required: true },
      {
        name: "subheadline",
        label: "Subheadline",
        type: "text",
        required: false,
      },
    ],
    repeaters: [
      {
        name: "items",
        label: "Features",
        itemFields: [
          { name: "title", label: "Title", type: "text", required: true },
          {
            name: "description",
            label: "Description",
            type: "textarea",
            required: true,
          },
          { name: "icon", label: "Icon", type: "icon", required: false },
          { name: "image", label: "Image", type: "image", required: false },
        ],
      },
    ],
  },
];

export function getSectionType(
  type: string,
): SectionTypeDefinition | undefined {
  return SECTION_REGISTRY.find((s) => s.type === type);
}

export function getSectionTypeNames(): string[] {
  return SECTION_REGISTRY.map((s) => s.type);
}

/**
 * Infer a field type from its name and value.
 * Used by buildDynamicSectionDef for custom (non-registry) sections.
 */
function guessFieldType(name: string, value: unknown): FieldType {
  const n = name.toLowerCase();
  if (
    /image|avatar|photo|thumbnail|logo|background|banner|cover|pic|img/.test(n)
  )
    return "image";
  if (/url|link|href|website/.test(n)) return "url";
  if (/email/.test(n)) return "email";
  if (/phone|tel|mobile/.test(n)) return "phone";
  if (/color/.test(n)) return "color";
  if (/date/.test(n)) return "date";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string" && value.length > 100) return "textarea";
  if (
    /description|text|content|body|bio|summary|about|paragraph|message/.test(n)
  )
    return "textarea";
  return "text";
}

/**
 * Build a dynamic section definition from actual field data.
 * Used when a section type is not found in the static registry (custom sections).
 */
export function buildDynamicSectionDef(
  type: string,
  fields: Record<string, unknown>,
): SectionTypeDefinition {
  const fieldDefs: FieldDefinition[] = [];
  const repeaterDefs: RepeaterFieldDefinition[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      // It's a repeater
      const itemFields: FieldDefinition[] = [];
      if (
        value.length > 0 &&
        typeof value[0] === "object" &&
        value[0] !== null
      ) {
        for (const [itemKey, itemVal] of Object.entries(
          value[0] as Record<string, unknown>,
        )) {
          if (itemKey === "id") continue;
          itemFields.push({
            name: itemKey,
            label: itemKey
              .replace(/_/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase()),
            type: guessFieldType(itemKey, itemVal),
            required: false,
          });
        }
      }
      repeaterDefs.push({
        name: key,
        label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        itemFields,
      });
    } else {
      fieldDefs.push({
        name: key,
        label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        type: guessFieldType(key, value),
        required: false,
      });
    }
  }

  return {
    type,
    label: type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    description: `Custom section: ${type}`,
    icon: "file-text",
    fields: fieldDefs,
    repeaters: repeaterDefs,
  };
}

export type { FieldType as SectionFieldType };
