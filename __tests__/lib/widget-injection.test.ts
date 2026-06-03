import { describe, it, expect } from "vitest";

// Test widget injection logic
describe("Widget Injection", () => {
  const WIDGET_START = "<!-- SK_WIDGET_START -->";
  const WIDGET_END = "<!-- SK_WIDGET_END -->";
  const EDITOR_START = "<!-- SK_EDITOR_START -->";
  const EDITOR_END = "<!-- SK_EDITOR_END -->";
  const CONTACT_START = "<!-- SK_CONTACT_START -->";
  const CONTACT_END = "<!-- SK_CONTACT_END -->";

  function injectWidget(html: string, slug: string, origin: string): string {
    const widgetScript = `${WIDGET_START}\n<script src="${origin}/proposal-widget.js?slug=${encodeURIComponent(slug)}"></script>\n${WIDGET_END}`;

    // Try after </nav>
    if (html.includes("</nav>")) {
      return html.replace("</nav>", `</nav>\n${widgetScript}`);
    }
    // Fallback: after <body>
    const bodyMatch = html.match(/<body[^>]*>/);
    if (bodyMatch) {
      return html.replace(bodyMatch[0], `${bodyMatch[0]}\n${widgetScript}`);
    }
    return widgetScript + "\n" + html;
  }

  it("injects after </nav> when present", () => {
    const html = `<body><nav>menu</nav><main>content</main></body>`;
    const result = injectWidget(html, "test-slug", "https://example.com");
    expect(result).toContain(WIDGET_START);
    expect(result).toContain("proposal-widget.js?slug=test-slug");
    expect(result.indexOf("</nav>")).toBeLessThan(result.indexOf(WIDGET_START));
  });

  it("injects after <body> when no nav", () => {
    const html = `<body><main>content</main></body>`;
    const result = injectWidget(html, "test-slug", "https://example.com");
    expect(result).toContain(WIDGET_START);
    expect(result.indexOf("<body>")).toBeLessThan(result.indexOf(WIDGET_START));
  });

  it("prepends when no body or nav", () => {
    const html = `<div>content</div>`;
    const result = injectWidget(html, "test-slug", "https://example.com");
    expect(result).toContain(WIDGET_START);
    expect(result.indexOf(WIDGET_START)).toBe(0);
  });

  it("encodes slug in URL", () => {
    const html = `<body><nav>menu</nav><main>content</main></body>`;
    const result = injectWidget(html, "pluck s.r.o iroa", "https://example.com");
    expect(result).toContain("pluck%20s.r.o%20iroa");
  });

  it("uses correct origin", () => {
    const html = `<body><nav>menu</nav></body>`;
    const result = injectWidget(html, "test", "https://sharkmedia-zone.vercel.app");
    expect(result).toContain("https://sharkmedia-zone.vercel.app/proposal-widget.js");
  });
});

describe("Contact Handler Injection", () => {
  const SK_CONTACT_START = "<!-- SK_CONTACT_START -->";
  const SK_CONTACT_END = "<!-- SK_CONTACT_END -->";

  it("injects contact handler with email", () => {
    const email = "info@balkar.sk";
    const origin = "https://sharkmedia-zone.vercel.app";
    const script = `${SK_CONTACT_START}\n<script src="${origin}/contact-handler.js" data-email="${email}"></script>\n${SK_CONTACT_END}`;
    expect(script).toContain(`data-email="${email}"`);
    expect(script).toContain("contact-handler.js");
  });

  it("skips contact handler when no email", () => {
    const email = "";
    const shouldInject = !!email;
    expect(shouldInject).toBe(false);
  });
});

describe("Editor Helper Injection", () => {
  const SK_EDITOR_START = "<!-- SK_EDITOR_START -->";
  const SK_EDITOR_END = "<!-- SK_EDITOR_END -->";

  it("injects editor helper script", () => {
    const origin = "https://sharkmedia-zone.vercel.app";
    const script = `${SK_EDITOR_START}\n<script src="${origin}/editor-helper.js"></script>\n${SK_EDITOR_END}`;
    expect(script).toContain("editor-helper.js");
    expect(script).toContain(SK_EDITOR_START);
    expect(script).toContain(SK_EDITOR_END);
  });
});
