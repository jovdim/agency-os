import { describe, it, expect } from "vitest";
import type { InlineChange } from "@/app/(dashboard)/client/sites/[id]/edit/changes-panel";

describe("InlineChange format", () => {
  it("has all required fields for text changes", () => {
    const change: InlineChange = {
      id: "change_123",
      file_path: "index.html",
      css_path: "body > section:nth-of-type(1) > h1",
      section: "hero",
      field: "headline",
      item_id: null,
      action: "update_text",
      old_value: "Old Heading",
      new_value: "New Heading",
      element_tag: "H1",
      element_preview: "hero → headline",
      timestamp: Date.now(),
    };

    expect(change.action).toBe("update_text");
    expect(change.file_path).toBe("index.html");
    expect(change.css_path).toBeTruthy();
    expect(change.old_value).not.toBe(change.new_value);
  });

  it("has all required fields for image changes", () => {
    const change: InlineChange = {
      id: "change_456",
      file_path: "index.html",
      css_path: "body > section:nth-of-type(1) > img",
      section: "hero",
      field: "image",
      item_id: null,
      action: "replace_image",
      old_value: "images/old-hero.webp",
      new_value: "https://storage.example.com/new-hero.webp",
      element_tag: "IMG",
      element_preview: "hero → image",
      timestamp: Date.now(),
    };

    expect(change.action).toBe("replace_image");
    expect(change.element_tag).toBe("IMG");
  });

  it("supports repeater item changes with item_id", () => {
    const change: InlineChange = {
      id: "change_789",
      file_path: "index.html",
      css_path: "body > section:nth-of-type(3) > div:nth-of-type(1) > h3",
      section: "services",
      field: "title",
      item_id: "svc_1",
      action: "update_text",
      old_value: "Service One",
      new_value: "Premium Service",
      element_tag: "H3",
      element_preview: "services → title",
      timestamp: Date.now(),
    };

    expect(change.item_id).toBe("svc_1");
    expect(change.section).toBe("services");
    expect(change.field).toBe("title");
  });

  it("supports changes without data attributes (CSS path only)", () => {
    const change: InlineChange = {
      id: "change_abc",
      file_path: "about.html",
      css_path: "body > main > section:nth-of-type(2) > p:nth-of-type(1)",
      section: null,
      field: null,
      item_id: null,
      action: "update_text",
      old_value: "Original text",
      new_value: "Updated text",
      element_tag: "P",
      element_preview: "P",
      timestamp: Date.now(),
    };

    expect(change.section).toBeNull();
    expect(change.field).toBeNull();
    expect(change.css_path).toBeTruthy();
  });

  it("supports multi-page changes with different file paths", () => {
    const homeChange: InlineChange = {
      id: "change_1",
      file_path: "index.html",
      css_path: "body > section > h1",
      action: "update_text",
      old_value: "Home Heading",
      new_value: "New Home Heading",
      element_tag: "H1",
      element_preview: "H1",
      timestamp: Date.now(),
    };

    const aboutChange: InlineChange = {
      id: "change_2",
      file_path: "about.html",
      css_path: "body > section > h1",
      action: "update_text",
      old_value: "About Heading",
      new_value: "New About Heading",
      element_tag: "H1",
      element_preview: "H1",
      timestamp: Date.now(),
    };

    expect(homeChange.file_path).not.toBe(aboutChange.file_path);
    // Same CSS path is fine — they're in different files
    expect(homeChange.css_path).toBe(aboutChange.css_path);
  });
});

describe("change deduplication", () => {
  it("same element edited twice should keep original old_value", () => {
    const changes: InlineChange[] = [];

    // First edit
    const change1: InlineChange = {
      id: "change_1",
      file_path: "index.html",
      css_path: "body > section > h1",
      action: "update_text",
      old_value: "Original",
      new_value: "First Edit",
      element_tag: "H1",
      element_preview: "H1",
      timestamp: Date.now(),
    };
    changes.push(change1);

    // Second edit on same element — old_value should stay as "Original"
    const change2: InlineChange = {
      ...change1,
      id: "change_2",
      old_value: "Original", // Kept from first edit
      new_value: "Second Edit",
      timestamp: Date.now() + 1000,
    };

    // Replace existing change for same element
    const idx = changes.findIndex(
      (c) => c.css_path === change2.css_path && c.file_path === change2.file_path
    );
    if (idx >= 0) {
      change2.old_value = changes[idx].old_value; // Keep original
      changes[idx] = change2;
    }

    expect(changes).toHaveLength(1);
    expect(changes[0].old_value).toBe("Original");
    expect(changes[0].new_value).toBe("Second Edit");
  });
});
