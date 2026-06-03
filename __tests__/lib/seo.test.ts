import { describe, it, expect } from "vitest";
import { buildHeadMeta } from "@/lib/templates/seo";

/**
 * Tests for buildHeadMeta — the SEO + social-share <head> block emitter.
 *
 * Why this matters: when og:image is a relative path (e.g. /_uploads/x.png)
 * external crawlers (FB / WhatsApp / LinkedIn / Twitter / Slack) can't fetch
 * it and fall back to auto-detecting any tiny inline image on the page,
 * which is what produces the "blurry / low quality" share-card thumbnails
 * Peter reported. The fix resolves relative og:image to absolute against
 * `siteUrl` and adds og:image:width/height/type so platforms reserve the
 * right card slot.
 */
describe("buildHeadMeta", () => {
  describe("absolute og:image resolution (the share-card fix)", () => {
    it("resolves relative /_uploads/ paths to absolute when siteUrl is provided", () => {
      const meta = buildHeadMeta(
        {
          title: "Acme",
          description: "We make things",
          og_image_url: "/_uploads/abc.png",
          og_image_width: 1200,
          og_image_height: 630,
        },
        { siteName: "Acme", siteUrl: "https://acme.2dni.sk" },
      );

      // og:image MUST be absolute — this is the whole point.
      expect(meta).toContain(
        '<meta property="og:image" content="https://acme.2dni.sk/_uploads/abc.png">',
      );
      // Width + height for proper card sizing
      expect(meta).toContain('<meta property="og:image:width" content="1200">');
      expect(meta).toContain('<meta property="og:image:height" content="630">');
      // og:image:type for explicit MIME hint
      expect(meta).toContain(
        '<meta property="og:image:type" content="image/png">',
      );
      // og:image:secure_url for the https case
      expect(meta).toContain(
        '<meta property="og:image:secure_url" content="https://acme.2dni.sk/_uploads/abc.png">',
      );
      // og:image:alt for a11y + Twitter
      expect(meta).toContain('<meta property="og:image:alt" content="Acme">');
    });

    it("strips trailing slash from siteUrl before joining (no double-slash)", () => {
      const meta = buildHeadMeta(
        { og_image_url: "/_uploads/abc.png" },
        { siteName: "X", siteUrl: "https://x.2dni.sk/" },
      );
      expect(meta).toContain(
        '<meta property="og:image" content="https://x.2dni.sk/_uploads/abc.png">',
      );
      expect(meta).not.toContain("//_uploads");
    });

    it("leaves absolute https:// og:image URLs unchanged", () => {
      const meta = buildHeadMeta(
        { og_image_url: "https://cdn.example.com/share.png" },
        { siteName: "X", siteUrl: "https://x.2dni.sk" },
      );
      expect(meta).toContain(
        '<meta property="og:image" content="https://cdn.example.com/share.png">',
      );
    });

    it("skips og:image entirely when value is still a `pending:` marker (defensive)", () => {
      // Should never happen post-publish (substitution replaces these),
      // but the helper must not emit garbage if it does.
      const meta = buildHeadMeta(
        { og_image_url: "pending:abc123" },
        { siteName: "X", siteUrl: "https://x.2dni.sk" },
      );
      expect(meta).not.toContain("og:image");
      // Falls back to summary card when no image
      expect(meta).toContain('<meta name="twitter:card" content="summary">');
    });

    it("skips canonical + og:url when no siteUrl is given (preview/edit render)", () => {
      const meta = buildHeadMeta(
        { title: "Preview" },
        { siteName: "Preview" },
      );
      expect(meta).not.toContain("rel=\"canonical\"");
      expect(meta).not.toContain("og:url");
    });
  });

  describe("Twitter cards", () => {
    it("uses summary_large_image when an og:image is present", () => {
      const meta = buildHeadMeta(
        { og_image_url: "https://example.com/x.png" },
        { siteName: "X" },
      );
      expect(meta).toContain(
        '<meta name="twitter:card" content="summary_large_image">',
      );
      expect(meta).toContain('<meta name="twitter:image"');
    });

    it("falls back to summary card when no og:image", () => {
      const meta = buildHeadMeta({ title: "X" }, { siteName: "X" });
      expect(meta).toContain('<meta name="twitter:card" content="summary">');
      expect(meta).not.toContain("twitter:image");
    });
  });

  describe("Title fallback + escaping", () => {
    it("falls back to siteName when seo.title is empty", () => {
      const meta = buildHeadMeta(undefined, { siteName: "FallbackName" });
      expect(meta).toContain("<title>FallbackName</title>");
      expect(meta).toContain(
        '<meta property="og:title" content="FallbackName">',
      );
    });

    it("escapes HTML special chars in title to avoid breaking the head", () => {
      const meta = buildHeadMeta(
        { title: 'Cats & "Dogs" <pets>' },
        { siteName: "X" },
      );
      expect(meta).toContain(
        "<title>Cats &amp; &quot;Dogs&quot; &lt;pets&gt;</title>",
      );
    });
  });

  describe("MIME type detection", () => {
    it("maps .jpg → image/jpeg", () => {
      const meta = buildHeadMeta(
        { og_image_url: "/_uploads/share.jpg" },
        { siteName: "X", siteUrl: "https://x.2dni.sk" },
      );
      expect(meta).toContain(
        '<meta property="og:image:type" content="image/jpeg">',
      );
    });

    it("maps .webp → image/webp", () => {
      const meta = buildHeadMeta(
        { og_image_url: "/_uploads/share.webp" },
        { siteName: "X", siteUrl: "https://x.2dni.sk" },
      );
      expect(meta).toContain(
        '<meta property="og:image:type" content="image/webp">',
      );
    });

    it("ignores query strings + fragments when reading extension", () => {
      const meta = buildHeadMeta(
        { og_image_url: "/_uploads/share.png?v=2#cache" },
        { siteName: "X", siteUrl: "https://x.2dni.sk" },
      );
      expect(meta).toContain(
        '<meta property="og:image:type" content="image/png">',
      );
    });

    it("omits og:image:type when extension is unknown", () => {
      const meta = buildHeadMeta(
        { og_image_url: "/_uploads/noext" },
        { siteName: "X", siteUrl: "https://x.2dni.sk" },
      );
      expect(meta).not.toContain("og:image:type");
    });
  });

  describe("noindex + locale + site_name", () => {
    it("emits robots noindex,nofollow when no_index is true", () => {
      const meta = buildHeadMeta(
        { no_index: true },
        { siteName: "Staging" },
      );
      expect(meta).toContain(
        '<meta name="robots" content="noindex,nofollow">',
      );
    });

    it("defaults locale to sk_SK", () => {
      const meta = buildHeadMeta(undefined, { siteName: "X" });
      expect(meta).toContain('<meta property="og:locale" content="sk_SK">');
    });

    it("respects an explicit locale option", () => {
      const meta = buildHeadMeta(undefined, {
        siteName: "X",
        locale: "en_US",
      });
      expect(meta).toContain('<meta property="og:locale" content="en_US">');
    });

    it("emits og:site_name", () => {
      const meta = buildHeadMeta(undefined, { siteName: "Acme s.r.o." });
      expect(meta).toContain(
        '<meta property="og:site_name" content="Acme s.r.o.">',
      );
    });
  });

  describe("dimension hints", () => {
    it("omits og:image:width/height when only one dim is set", () => {
      // Crawlers reject mismatched/half-set hints — both or neither.
      const meta = buildHeadMeta(
        {
          og_image_url: "https://x.2dni.sk/share.png",
          og_image_width: 1200,
          // height intentionally missing
        },
        { siteName: "X" },
      );
      expect(meta).not.toContain("og:image:width");
      expect(meta).not.toContain("og:image:height");
    });

    it("emits both width + height when both are set", () => {
      const meta = buildHeadMeta(
        {
          og_image_url: "https://x.2dni.sk/share.png",
          og_image_width: 1200,
          og_image_height: 630,
        },
        { siteName: "X" },
      );
      expect(meta).toContain('<meta property="og:image:width" content="1200">');
      expect(meta).toContain('<meta property="og:image:height" content="630">');
    });
  });
});
