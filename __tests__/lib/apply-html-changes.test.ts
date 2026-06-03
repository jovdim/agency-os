import { describe, it, expect } from "vitest";
import { applyChangesToHtml, type HtmlChange } from "@/lib/apply-html-changes";

const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head><title>Test Site</title></head>
<body>
  <section data-section="hero">
    <h1 data-field="headline">Welcome to Our Site</h1>
    <p data-field="description">We build amazing things for you.</p>
    <img data-field="image" src="images/hero.webp" alt="Hero" />
  </section>
  <section data-section="about">
    <h2 data-field="headline">About Us</h2>
    <p data-field="text">We are a great company with years of experience.</p>
  </section>
  <section data-section="services">
    <h2 data-field="headline">Our Services</h2>
    <div data-item="svc_1">
      <h3 data-field="title">Service One</h3>
      <p data-field="description">Description of service one.</p>
      <img data-field="image" src="images/svc1.webp" alt="Service 1" />
    </div>
    <div data-item="svc_2">
      <h3 data-field="title">Service Two</h3>
      <p data-field="description">Description of service two.</p>
    </div>
  </section>
</body>
</html>`;

// HTML without data attributes — uses CSS path only
const PLAIN_HTML = `<!DOCTYPE html>
<html>
<head><title>Plain Site</title></head>
<body>
  <section>
    <h1>Main Heading</h1>
    <p>Some paragraph text here.</p>
    <img src="images/photo.jpg" alt="Photo" />
  </section>
  <section>
    <h2>Second Section</h2>
    <p>Another paragraph.</p>
  </section>
</body>
</html>`;

describe("applyChangesToHtml", () => {
  // ───────────────────────────────────────────────
  // TEXT CHANGES WITH DATA ATTRIBUTES
  // ───────────────────────────────────────────────

  describe("text changes with data attributes", () => {
    it("updates a standalone text field by data-section + data-field", () => {
      const changes: HtmlChange[] = [{
        css_path: "body > section:nth-of-type(1) > h1",
        section: "hero",
        field: "headline",
        action: "update_text",
        old_value: "Welcome to Our Site",
        new_value: "Welcome to SandWave",
      }];

      const { html, result } = applyChangesToHtml(SAMPLE_HTML, changes);

      expect(result.applied).toHaveLength(1);
      expect(result.conflicts).toHaveLength(0);
      expect(html).toContain("Welcome to SandWave");
      expect(html).not.toContain("Welcome to Our Site");
    });

    it("updates the correct section when multiple sections have same field name", () => {
      const changes: HtmlChange[] = [{
        css_path: "",
        section: "about",
        field: "headline",
        action: "update_text",
        old_value: "About Us",
        new_value: "Who We Are",
      }];

      const { html, result } = applyChangesToHtml(SAMPLE_HTML, changes);

      expect(result.applied).toHaveLength(1);
      expect(html).toContain("Who We Are");
      // Hero headline should remain unchanged
      expect(html).toContain("Welcome to Our Site");
    });

    it("updates a field within a repeater item by data-item", () => {
      const changes: HtmlChange[] = [{
        css_path: "",
        section: "services",
        field: "title",
        item_id: "svc_1",
        action: "update_text",
        old_value: "Service One",
        new_value: "Premium Service",
      }];

      const { html, result } = applyChangesToHtml(SAMPLE_HTML, changes);

      expect(result.applied).toHaveLength(1);
      expect(html).toContain("Premium Service");
      // svc_2 should remain unchanged
      expect(html).toContain("Service Two");
    });

    it("updates repeater item description without affecting other items", () => {
      const changes: HtmlChange[] = [{
        css_path: "",
        section: "services",
        field: "description",
        item_id: "svc_2",
        action: "update_text",
        old_value: "Description of service two.",
        new_value: "Updated description for service two.",
      }];

      const { html, result } = applyChangesToHtml(SAMPLE_HTML, changes);

      expect(result.applied).toHaveLength(1);
      expect(html).toContain("Updated description for service two.");
      expect(html).toContain("Description of service one.");
    });
  });

  // ───────────────────────────────────────────────
  // TEXT CHANGES WITH CSS PATH ONLY
  // ───────────────────────────────────────────────

  describe("text changes with CSS path only (no data attributes)", () => {
    it("updates text using CSS path when no data attributes exist", () => {
      const changes: HtmlChange[] = [{
        css_path: "body > section:nth-of-type(1) > h1",
        action: "update_text",
        old_value: "Main Heading",
        new_value: "New Main Heading",
      }];

      const { html, result } = applyChangesToHtml(PLAIN_HTML, changes);

      expect(result.applied).toHaveLength(1);
      expect(result.conflicts).toHaveLength(0);
      expect(html).toContain("New Main Heading");
      expect(html).not.toContain(">Main Heading<");
    });

    it("updates paragraph in second section via CSS path", () => {
      const changes: HtmlChange[] = [{
        css_path: "body > section:nth-of-type(2) > p",
        action: "update_text",
        old_value: "Another paragraph.",
        new_value: "Updated paragraph text.",
      }];

      const { html, result } = applyChangesToHtml(PLAIN_HTML, changes);

      expect(result.applied).toHaveLength(1);
      expect(html).toContain("Updated paragraph text.");
      // First section paragraph should be unchanged
      expect(html).toContain("Some paragraph text here.");
    });
  });

  // ───────────────────────────────────────────────
  // IMAGE CHANGES
  // ───────────────────────────────────────────────

  describe("image changes", () => {
    it("replaces image src using data attributes", () => {
      const changes: HtmlChange[] = [{
        css_path: "",
        section: "hero",
        field: "image",
        action: "replace_image",
        old_value: "images/hero.webp",
        new_value: "https://storage.example.com/new-hero.webp",
      }];

      const { html, result } = applyChangesToHtml(SAMPLE_HTML, changes);

      expect(result.applied).toHaveLength(1);
      expect(html).toContain('src="https://storage.example.com/new-hero.webp"');
      expect(html).not.toContain('src="images/hero.webp"');
    });

    it("replaces image within a repeater item", () => {
      const changes: HtmlChange[] = [{
        css_path: "",
        section: "services",
        field: "image",
        item_id: "svc_1",
        action: "replace_image",
        old_value: "images/svc1.webp",
        new_value: "https://storage.example.com/new-svc1.webp",
      }];

      const { html, result } = applyChangesToHtml(SAMPLE_HTML, changes);

      expect(result.applied).toHaveLength(1);
      expect(html).toContain('src="https://storage.example.com/new-svc1.webp"');
    });

    it("replaces image using CSS path when no data attributes", () => {
      const changes: HtmlChange[] = [{
        css_path: "body > section:nth-of-type(1) > img",
        action: "replace_image",
        old_value: "images/photo.jpg",
        new_value: "https://storage.example.com/new-photo.jpg",
      }];

      const { html, result } = applyChangesToHtml(PLAIN_HTML, changes);

      expect(result.applied).toHaveLength(1);
      expect(html).toContain('src="https://storage.example.com/new-photo.jpg"');
    });
  });

  // ───────────────────────────────────────────────
  // CONFLICT DETECTION
  // ───────────────────────────────────────────────

  describe("conflict detection", () => {
    it("detects text conflict when old_value doesn't match current", () => {
      const changes: HtmlChange[] = [{
        css_path: "",
        section: "hero",
        field: "headline",
        action: "update_text",
        old_value: "WRONG OLD VALUE",
        new_value: "New Headline",
      }];

      const { result } = applyChangesToHtml(SAMPLE_HTML, changes);

      expect(result.applied).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].reason).toContain("modified since");
      expect(result.conflicts[0].current_value).toBe("Welcome to Our Site");
    });

    it("detects image conflict when old_value doesn't match current src", () => {
      const changes: HtmlChange[] = [{
        css_path: "",
        section: "hero",
        field: "image",
        action: "replace_image",
        old_value: "images/WRONG.webp",
        new_value: "https://storage.example.com/new.webp",
      }];

      const { result } = applyChangesToHtml(SAMPLE_HTML, changes);

      expect(result.applied).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].reason).toContain("modified since");
    });

    it("detects element not found conflict", () => {
      const changes: HtmlChange[] = [{
        css_path: "body > section:nth-of-type(99) > h1",
        section: "nonexistent",
        field: "headline",
        action: "update_text",
        old_value: "Something",
        new_value: "New Value",
      }];

      const { result } = applyChangesToHtml(SAMPLE_HTML, changes);

      expect(result.applied).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].reason).toContain("not found");
    });

    it("handles invalid CSS selector gracefully", () => {
      const changes: HtmlChange[] = [{
        css_path: "!!!invalid[[[selector",
        action: "update_text",
        old_value: "Something",
        new_value: "New Value",
      }];

      const { result } = applyChangesToHtml(SAMPLE_HTML, changes);

      expect(result.applied).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
    });
  });

  // ───────────────────────────────────────────────
  // MULTIPLE CHANGES
  // ───────────────────────────────────────────────

  describe("multiple changes in one batch", () => {
    it("applies multiple text changes across different sections", () => {
      const changes: HtmlChange[] = [
        {
          css_path: "",
          section: "hero",
          field: "headline",
          action: "update_text",
          old_value: "Welcome to Our Site",
          new_value: "New Hero Headline",
        },
        {
          css_path: "",
          section: "about",
          field: "headline",
          action: "update_text",
          old_value: "About Us",
          new_value: "New About Headline",
        },
        {
          css_path: "",
          section: "services",
          field: "title",
          item_id: "svc_1",
          action: "update_text",
          old_value: "Service One",
          new_value: "New Service Name",
        },
      ];

      const { html, result } = applyChangesToHtml(SAMPLE_HTML, changes);

      expect(result.applied).toHaveLength(3);
      expect(result.conflicts).toHaveLength(0);
      expect(html).toContain("New Hero Headline");
      expect(html).toContain("New About Headline");
      expect(html).toContain("New Service Name");
    });

    it("applies some changes and flags conflicts for others", () => {
      const changes: HtmlChange[] = [
        {
          css_path: "",
          section: "hero",
          field: "headline",
          action: "update_text",
          old_value: "Welcome to Our Site",
          new_value: "This Will Apply",
        },
        {
          css_path: "",
          section: "hero",
          field: "description",
          action: "update_text",
          old_value: "WRONG OLD VALUE",
          new_value: "This Will Conflict",
        },
      ];

      const { html, result } = applyChangesToHtml(SAMPLE_HTML, changes);

      expect(result.applied).toHaveLength(1);
      expect(result.conflicts).toHaveLength(1);
      expect(html).toContain("This Will Apply");
      expect(html).not.toContain("This Will Conflict");
    });
  });

  // ───────────────────────────────────────────────
  // FALLBACK: DATA ATTRIBUTES → CSS PATH
  // ───────────────────────────────────────────────

  describe("identification fallback", () => {
    it("falls back to CSS path when data attributes don't match", () => {
      const changes: HtmlChange[] = [{
        css_path: "body > section:nth-of-type(1) > h1",
        section: "nonexistent_section",
        field: "headline",
        action: "update_text",
        old_value: "Welcome to Our Site",
        new_value: "Found via CSS Path",
      }];

      const { html, result } = applyChangesToHtml(SAMPLE_HTML, changes);

      expect(result.applied).toHaveLength(1);
      expect(html).toContain("Found via CSS Path");
    });

    it("uses data attributes first even when CSS path would also work", () => {
      const changes: HtmlChange[] = [{
        css_path: "body > section:nth-of-type(2) > h2",
        section: "hero",
        field: "headline",
        action: "update_text",
        old_value: "Welcome to Our Site",
        new_value: "Data Attributes Win",
      }];

      // data-section="hero" data-field="headline" is in the first section (h1)
      // CSS path points to second section (h2)
      // Data attributes should take priority
      const { html, result } = applyChangesToHtml(SAMPLE_HTML, changes);

      expect(result.applied).toHaveLength(1);
      expect(html).toContain("Data Attributes Win");
      // The h1 in hero section should be updated, not the h2 in about
      expect(html).toContain("About Us");
    });
  });

  // ───────────────────────────────────────────────
  // EDGE CASES
  // ───────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty changes array", () => {
      const { html, result } = applyChangesToHtml(SAMPLE_HTML, []);

      expect(result.applied).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
      // cheerio normalizes whitespace/self-closing tags, so check key content
      expect(html).toContain("Welcome to Our Site");
      expect(html).toContain("data-section");
    });

    it("preserves HTML structure after changes", () => {
      const changes: HtmlChange[] = [{
        css_path: "",
        section: "hero",
        field: "headline",
        action: "update_text",
        old_value: "Welcome to Our Site",
        new_value: "New Headline",
      }];

      const { html } = applyChangesToHtml(SAMPLE_HTML, changes);

      // Should still have all the structure
      expect(html).toContain('data-section="hero"');
      expect(html).toContain('data-field="headline"');
      expect(html).toContain('data-section="about"');
      expect(html).toContain('data-section="services"');
      expect(html).toContain('data-item="svc_1"');
      expect(html).toContain('data-item="svc_2"');
    });

    it("handles text with special characters", () => {
      const htmlWithSpecial = `<html><body><section data-section="test"><p data-field="text">Price: 299 EUR</p></section></body></html>`;
      const changes: HtmlChange[] = [{
        css_path: "",
        section: "test",
        field: "text",
        action: "update_text",
        old_value: "Price: 299 EUR",
        new_value: "New price: 199 EUR",
      }];

      const { html, result } = applyChangesToHtml(htmlWithSpecial, changes);
      expect(result.applied).toHaveLength(1);
      expect(html).toContain("New price: 199 EUR");
    });

    it("handles whitespace differences in old_value comparison", () => {
      const htmlWithSpaces = `<section data-section="test"><h1 data-field="title">  Hello World  </h1></section>`;
      const changes: HtmlChange[] = [{
        css_path: "",
        section: "test",
        field: "title",
        action: "update_text",
        old_value: "Hello World",
        new_value: "New Title",
      }];

      const { html, result } = applyChangesToHtml(htmlWithSpaces, changes);
      expect(result.applied).toHaveLength(1);
      expect(html).toContain("New Title");
    });
  });
});
