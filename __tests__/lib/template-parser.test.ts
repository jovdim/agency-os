import { describe, it, expect } from "vitest";
import {
  parseTemplateHtml,
  applyContentOverrides,
} from "@/lib/templates/parser";

// ─────────────────────────────────────────────────────────────────────────────
//  Sample fixtures
// ─────────────────────────────────────────────────────────────────────────────

const HERO_FULL = `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="../_common/preview.css">
  <style>
    .hero-01 { background: red; }
  </style>
</head>
<body>
<div class="preview-banner">should be stripped</div>
<!-- SECTION:hero:start -->
<section class="hero" data-field="hero_bg" style="background-image:url('https://cdn.example.com/h1.jpg')">
  <div class="hero-inner">
    <h1 data-field="hero_headline">Original headline</h1>
    <p data-field="hero_subheadline">A short subhead.</p>
    <a href="#contact" data-field="hero_cta_primary">Contact us</a>
  </div>
</section>
<!-- SECTION:hero:end -->
<script src="../_common/preview.js"></script>
</body>
</html>`;

const ABOUT_LONG_TEXT = `<!-- SECTION:about:start -->
<section>
  <h2 data-field="about_headline">About</h2>
  <p data-field="about_text">${"Lorem ipsum ".repeat(20)}</p>
</section>
<!-- SECTION:about:end -->`;

const NO_MARKERS_FRAGMENT = `<section>
  <h2 data-field="title">Hello</h2>
  <img data-field="logo" src="/logo.png" alt="">
</section>`;

const NESTED_BG_IMAGE = `<!-- SECTION:hero:start -->
<section style="background-image: url(  '/path with space.jpg'  ); padding: 20px;" data-field="hero_bg">
  <h1 data-field="title">Hi</h1>
</section>
<!-- SECTION:hero:end -->`;

// ─────────────────────────────────────────────────────────────────────────────
//  parseTemplateHtml
// ─────────────────────────────────────────────────────────────────────────────

describe("parseTemplateHtml", () => {
  it("extracts category from SECTION markers", () => {
    const result = parseTemplateHtml(HERO_FULL);
    expect(result.category).toBe("hero");
  });

  it("extracts CSS from <style> blocks", () => {
    const result = parseTemplateHtml(HERO_FULL);
    expect(result.css).toContain(".hero-01 { background: red; }");
  });

  it("strips the preview-banner and surrounding HTML doc", () => {
    const result = parseTemplateHtml(HERO_FULL);
    expect(result.html).not.toContain("preview-banner");
    expect(result.html).not.toContain("<!DOCTYPE");
    expect(result.html).not.toContain("preview.js");
  });

  it("walks data-field elements to build placeholder schema", () => {
    const result = parseTemplateHtml(HERO_FULL);
    expect(result.placeholderSchema).toHaveProperty("hero_bg");
    expect(result.placeholderSchema).toHaveProperty("hero_headline");
    expect(result.placeholderSchema).toHaveProperty("hero_subheadline");
    expect(result.placeholderSchema).toHaveProperty("hero_cta_primary");
  });

  it("detects background-image as image type", () => {
    const result = parseTemplateHtml(HERO_FULL);
    const bg = result.placeholderSchema.hero_bg;
    expect(bg.type).toBe("image");
    expect(bg.default_src).toBe("https://cdn.example.com/h1.jpg");
  });

  it("detects <img> as image type", () => {
    const result = parseTemplateHtml(NO_MARKERS_FRAGMENT);
    const logo = result.placeholderSchema.logo;
    expect(logo.type).toBe("image");
    expect(logo.default_src).toBe("/logo.png");
  });

  it("detects short text as text type", () => {
    const result = parseTemplateHtml(HERO_FULL);
    expect(result.placeholderSchema.hero_headline.type).toBe("text");
    expect(result.placeholderSchema.hero_headline.default).toBe(
      "Original headline",
    );
  });

  it("detects long text (>100 chars) as longtext", () => {
    const result = parseTemplateHtml(ABOUT_LONG_TEXT);
    expect(result.placeholderSchema.about_text.type).toBe("longtext");
  });

  it("treats <a> with data-field as text (label, not href) by default", () => {
    const result = parseTemplateHtml(HERO_FULL);
    const cta = result.placeholderSchema.hero_cta_primary;
    expect(cta.type).toBe("text");
    expect(cta.default).toBe("Contact us");
  });

  it("treats <a data-field data-type='link'> as a link field with both label + href", () => {
    const html = `<section>
      <a data-field="nav_phone" data-type="link" href="tel:+421900123456">Call us</a>
    </section>`;
    const result = parseTemplateHtml(html);
    expect(result.placeholderSchema.nav_phone.type).toBe("link");
    expect(result.placeholderSchema.nav_phone.default).toBe("Call us");
    expect(result.placeholderSchema.nav_phone.default_href).toBe(
      "tel:+421900123456",
    );
  });

  it("ignores data-type='link' on non-<a> elements", () => {
    const html = `<section>
      <h1 data-field="title" data-type="link">Just text</h1>
    </section>`;
    const result = parseTemplateHtml(html);
    expect(result.placeholderSchema.title.type).toBe("text");
  });

  it("returns null category when no SECTION markers", () => {
    const result = parseTemplateHtml(NO_MARKERS_FRAGMENT);
    expect(result.category).toBeNull();
  });

  it("still parses fields when no SECTION markers", () => {
    const result = parseTemplateHtml(NO_MARKERS_FRAGMENT);
    expect(Object.keys(result.placeholderSchema)).toHaveLength(2);
    expect(result.placeholderSchema.title.type).toBe("text");
    expect(result.placeholderSchema.logo.type).toBe("image");
  });

  it("parses background-image url with spaces in URL", () => {
    const result = parseTemplateHtml(NESTED_BG_IMAGE);
    expect(result.placeholderSchema.hero_bg.type).toBe("image");
    expect(result.placeholderSchema.hero_bg.default_src).toBe(
      "/path with space.jpg",
    );
  });

  it("preserves field order in fieldOrder", () => {
    const result = parseTemplateHtml(HERO_FULL);
    expect(result.fieldOrder).toEqual([
      "hero_bg",
      "hero_headline",
      "hero_subheadline",
      "hero_cta_primary",
    ]);
  });

  it("does not duplicate fields if data-field key appears twice", () => {
    const html = `<section>
      <h1 data-field="title">First</h1>
      <h1 data-field="title">Second</h1>
    </section>`;
    const result = parseTemplateHtml(html);
    expect(Object.keys(result.placeholderSchema)).toEqual(["title"]);
    // First occurrence wins
    expect(result.placeholderSchema.title.default).toBe("First");
  });

  it("returns empty schema for HTML with no data-field attributes", () => {
    const result = parseTemplateHtml("<section><h1>No fields</h1></section>");
    expect(result.placeholderSchema).toEqual({});
    expect(result.fieldOrder).toEqual([]);
  });

  describe("map type (iframe + data-type=\"map\")", () => {
    // Locks in the parser → MapField composer UI handshake. The Brand /
    // Contact / Map composer fields all branch on schema.type at the
    // PlaceholderField router; if the parser regresses to emitting
    // type:"text" here the editor would silently drop back to a single
    // input with no Address/Coordinates toggle. Pin the contract.

    const MAP_FRAGMENT = `<!-- SECTION:map:start -->
<div class="map-01">
  <iframe data-field="map_address" data-type="map"
    src="https://maps.google.com/maps?q=Hlavn%C3%A1%2012%2C%20%C5%BDilina&t=&z=15&ie=UTF8&iwloc=B&output=embed"
    title="Mapa"></iframe>
</div>
<!-- SECTION:map:end -->`;

    it("emits type=\"map\" (not \"text\") for an iframe with data-type=\"map\"", () => {
      const result = parseTemplateHtml(MAP_FRAGMENT);
      expect(result.placeholderSchema.map_address?.type).toBe("map");
    });

    it("extracts the q= parameter as the default address", () => {
      // The default surfaces as the input's placeholder in the composer.
      // Sales sees what the template was authored with so they can
      // recognize the "this is just an example" context.
      const result = parseTemplateHtml(MAP_FRAGMENT);
      expect(result.placeholderSchema.map_address?.default).toBe(
        "Hlavná 12, Žilina",
      );
    });

    it("accepts a coordinate string as the default when authored that way", () => {
      const fragment = `<!-- SECTION:map:start -->
<iframe data-field="loc" data-type="map"
  src="https://maps.google.com/maps?q=48.1486%2C17.1077&t=&z=15&output=embed"></iframe>
<!-- SECTION:map:end -->`;
      const result = parseTemplateHtml(fragment);
      expect(result.placeholderSchema.loc?.type).toBe("map");
      expect(result.placeholderSchema.loc?.default).toBe("48.1486,17.1077");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  applyContentOverrides
// ─────────────────────────────────────────────────────────────────────────────

describe("applyContentOverrides", () => {
  const SAMPLE = `<section data-field="bg" style="background-image: url('/old-bg.jpg'); padding: 20px">
  <h1 data-field="headline">Old headline</h1>
  <img data-field="logo" src="/old-logo.png" srcset="/old-logo@2x.png 2x">
  <a data-field="cta" href="#old">Old label</a>
</section>`;

  const SCHEMA = {
    bg: { type: "image" as const, default_src: "/old-bg.jpg" },
    headline: { type: "text" as const, default: "Old headline" },
    logo: { type: "image" as const, default_src: "/old-logo.png" },
    cta: { type: "text" as const, default: "Old label" },
  };

  it("replaces text content", () => {
    const out = applyContentOverrides(
      SAMPLE,
      { headline: "New headline" },
      SCHEMA,
    );
    expect(out).toContain(">New headline<");
    expect(out).not.toContain(">Old headline<");
  });

  it("replaces <img> src", () => {
    const out = applyContentOverrides(
      SAMPLE,
      { logo: "https://cdn.example.com/new-logo.png" },
      SCHEMA,
    );
    expect(out).toContain('src="https://cdn.example.com/new-logo.png"');
    expect(out).not.toContain("/old-logo.png");
  });

  it("strips srcset when replacing <img> (avoids stale 2x)", () => {
    const out = applyContentOverrides(
      SAMPLE,
      { logo: "https://cdn.example.com/new-logo.png" },
      SCHEMA,
    );
    expect(out).not.toContain("srcset");
  });

  it("replaces background-image URL while preserving other style props", () => {
    const out = applyContentOverrides(
      SAMPLE,
      { bg: "https://cdn.example.com/new-bg.jpg" },
      SCHEMA,
    );
    expect(out).toContain(
      "background-image: url('https://cdn.example.com/new-bg.jpg')",
    );
    expect(out).toContain("padding: 20px");
    expect(out).not.toContain("/old-bg.jpg");
  });

  it("treats <a data-field> override as text (label), not href", () => {
    const out = applyContentOverrides(
      SAMPLE,
      { cta: "Click me!" },
      SCHEMA,
    );
    expect(out).toContain(">Click me!<");
    // href should NOT change
    expect(out).toContain('href="#old"');
  });

  it("ignores keys not in schema", () => {
    const out = applyContentOverrides(
      SAMPLE,
      { ghost: "should not appear", headline: "Real" },
      SCHEMA,
    );
    expect(out).toContain(">Real<");
    expect(out).not.toContain("should not appear");
  });

  it("is a no-op when overrides is empty", () => {
    const out = applyContentOverrides(SAMPLE, {}, SCHEMA);
    expect(out).toContain(">Old headline<");
    expect(out).toContain('src="/old-logo.png"');
  });

  it("handles bg-image when no existing background-image in style", () => {
    const html = `<section data-field="bg" style="padding: 10px">x</section>`;
    const schema = { bg: { type: "image" as const, default_src: "" } };
    const out = applyContentOverrides(html, { bg: "/new.jpg" }, schema);
    expect(out).toContain("background-image: url('/new.jpg')");
    expect(out).toContain("padding: 10px");
  });

  // ── Link type ──
  describe("link type", () => {
    const LINK_HTML = `<a data-field="phone" data-type="link" href="tel:+421900111222">Call</a>`;
    const LINK_SCHEMA = {
      phone: {
        type: "link" as const,
        default: "Call",
        default_href: "tel:+421900111222",
      },
    };

    it("updates both label and href when value is { label, href }", () => {
      const out = applyContentOverrides(
        LINK_HTML,
        { phone: { label: "Volajte", href: "tel:+421999000111" } },
        LINK_SCHEMA,
      );
      expect(out).toContain(">Volajte<");
      expect(out).toContain('href="tel:+421999000111"');
    });

    it("updates only label if href is omitted", () => {
      const out = applyContentOverrides(
        LINK_HTML,
        { phone: { label: "Zavolajte" } },
        LINK_SCHEMA,
      );
      expect(out).toContain(">Zavolajte<");
      expect(out).toContain('href="tel:+421900111222"');
    });

    it("updates only href if label is omitted", () => {
      const out = applyContentOverrides(
        LINK_HTML,
        { phone: { href: "https://wa.me/421900111222" } },
        LINK_SCHEMA,
      );
      expect(out).toContain(">Call<");
      expect(out).toContain('href="https://wa.me/421900111222"');
    });

    it("treats a bare string value as the label (backwards compat)", () => {
      const out = applyContentOverrides(
        LINK_HTML,
        { phone: "Volajte" },
        LINK_SCHEMA,
      );
      expect(out).toContain(">Volajte<");
      expect(out).toContain('href="tel:+421900111222"');
    });
  });
});
