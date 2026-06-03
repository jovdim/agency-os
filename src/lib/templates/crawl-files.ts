/**
 * Crawl + error + legal files bundled into every published Cloudflare
 * Pages deployment alongside the rendered HTML.
 *
 * - robots.txt   — tells search engines what they may/may not crawl
 * - sitemap.xml  — full URL list so Google indexes pages without having
 *                   to discover them by following links
 * - 404.html     — branded "page not found" served by Cloudflare for any
 *                   unmatched URL (CF auto-serves /404.html if present)
 * - privacy.html — English GDPR-style privacy policy. Auto-generated
 *                   on every publish so the cookie-bar widget AND the
 *                   "Privacy" link in every footer template have
 *                   a real page to land on instead of 404'ing.
 *
 * Pure module — no server deps — so publish.ts can call these and tests
 * can assert against the exact strings they emit.
 */

import type { SiteTheme } from "./theme";

// ── robots.txt ──────────────────────────────────────────────────────────────

export interface BuildRobotsOptions {
  /** Absolute URL of the live site (e.g. `https://acme.pages.dev`).
   *  Used only for the optional `Sitemap:` line; the rules above it work
   *  without it. */
  siteUrl?: string;
  /** When true, emit a global Disallow so cooperating crawlers skip the
   *  whole site. Belt-and-suspenders with the <meta name="robots"> tag —
   *  some crawlers check robots.txt first and never even fetch the page. */
  noIndex?: boolean;
}

/**
 * Build the robots.txt content for a site.
 *
 *   - Hidden site (no_index=true) → blanket Disallow: /
 *   - Visible site → Allow: / + a Sitemap: pointer when siteUrl is known
 *
 * Always ends with a trailing newline (some crawlers are picky about
 * incomplete final records).
 */
export function buildRobotsTxt(options: BuildRobotsOptions): string {
  if (options.noIndex) {
    return "User-agent: *\nDisallow: /\n";
  }
  const lines = ["User-agent: *", "Allow: /"];
  if (options.siteUrl) {
    const base = options.siteUrl.replace(/\/$/, "");
    lines.push("", `Sitemap: ${base}/sitemap.xml`);
  }
  return lines.join("\n") + "\n";
}

// ── sitemap.xml ─────────────────────────────────────────────────────────────

export interface SitemapImage {
  /** Absolute URL of the image. Must include scheme + host. Relative
   *  `/_uploads/...` paths get prefixed with the site origin by the
   *  caller (publish.ts) before being passed in. */
  loc: string;
  /** Optional alt-text caption. Emitted as `<image:caption>`. Google
   *  uses this as the primary signal for what the image depicts when
   *  ranking it in Image Search. Falls back to omission when empty —
   *  an empty `<image:caption></image:caption>` is worse than nothing. */
  caption?: string;
}

export interface SitemapPage {
  /** Page path as stored in composition.pages[i].path (e.g. "/", "/sluzby"). */
  path: string;
  /** Images that appear on this page. Emitted as Google's
   *  `<image:image>` extension under the page's `<url>` entry — same
   *  sitemap, not a separate file. Google indexes these for Image
   *  Search alongside crawling them from the live page. Optional;
   *  empty / missing → no `<image:image>` blocks for this URL. */
  images?: SitemapImage[];
}

export interface BuildSitemapOptions {
  /** Absolute URL of the live site. Required — sitemap entries are
   *  meaningless without an absolute origin. */
  siteUrl: string;
  /** Pages to include. Sitemap entries are emitted in the order given. */
  pages: SitemapPage[];
  /** Last-modified timestamp (ISO date string, YYYY-MM-DD). When absent,
   *  <lastmod> is omitted — Google handles its absence fine. */
  lastmod?: string;
}

/**
 * Build the sitemap.xml content for a site.
 *
 * Always emits a valid <urlset> even when pages is empty (Google treats
 * an empty sitemap as "no URLs to crawl right now," which is harmless).
 * The home page (path = "/") gets priority 1.0 + changefreq weekly; all
 * other pages get priority 0.8 + changefreq monthly.
 *
 * Images: when a page carries an `images` list, each one is emitted as
 * a `<image:image>` block under that page's `<url>` entry (Google's
 * image-sitemap extension at http://www.google.com/schemas/sitemap-image/1.1).
 * This is what feeds Google Image Search — without it, photos on a
 * tradesman's site rank far worse in Image results than they should
 * given the alt text we attach. Single combined sitemap (not a
 * separate image-sitemap.xml + index) because Google's docs explicitly
 * recommend the inline form: fewer fetches, simpler crawling, no
 * sitemap-index gymnastics for our small page counts.
 *
 * Note: callers (publish.ts) decide whether to emit a sitemap at all —
 * for noindex'd sites we skip emission entirely rather than feeding
 * crawlers a list of URLs we just told them not to index.
 */
export function buildSitemapXml(options: BuildSitemapOptions): string {
  const base = options.siteUrl.replace(/\/$/, "");
  const lastmodTag = options.lastmod
    ? `\n    <lastmod>${escapeXml(options.lastmod)}</lastmod>`
    : "";

  // Track whether ANY page in the sitemap has images. The xmlns:image
  // declaration is only emitted when needed — keeps small sitemaps
  // minimal and avoids "why is this XML namespace declared but unused"
  // when an author hasn't filled in any images yet.
  let hasImages = false;

  const urlEntries = options.pages
    .map((p) => {
      const path = p.path.startsWith("/") ? p.path : `/${p.path}`;
      const isHome = path === "/";
      const loc = `${base}${path}`;
      const priority = isHome ? "1.0" : "0.8";
      const changefreq = isHome ? "weekly" : "monthly";

      // Image entries for this page. One <image:image> per image; caption
      // omitted entirely when alt is empty (Google prefers a missing tag
      // over an empty one — empty captions can ding the page's signal).
      let imageBlocks = "";
      if (p.images && p.images.length > 0) {
        hasImages = true;
        imageBlocks = p.images
          .map((img) => {
            const captionTag =
              img.caption && img.caption.trim().length > 0
                ? `\n      <image:caption>${escapeXml(img.caption.trim())}</image:caption>`
                : "";
            return `    <image:image>
      <image:loc>${escapeXml(img.loc)}</image:loc>${captionTag}
    </image:image>`;
          })
          .join("\n");
        imageBlocks = `\n${imageBlocks}`;
      }

      return `  <url>
    <loc>${escapeXml(loc)}</loc>${lastmodTag}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>${imageBlocks}
  </url>`;
    })
    .join("\n");

  const imageNs = hasImages
    ? `\n        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${imageNs}>
${urlEntries}
</urlset>
`;
}

// ── 404.html ────────────────────────────────────────────────────────────────

export interface Build404Options {
  /** Site name shown above the 404 — anchors the visitor in the right brand. */
  siteName: string;
  /** Theme tokens (primary + bg). Optional — falls back to neutral defaults
   *  so even untouched-theme sites get a clean error page. */
  theme?: SiteTheme;
}

/**
 * Build a standalone 404.html page.
 *
 * Self-contained: inline CSS, no external dependencies beyond the same
 * Google Fonts the rest of the site uses (Space Grotesk + DM Sans). If
 * the rest of the site is broken, this page still renders.
 *
 * Picks up theme tokens (primary color, background) so the error page
 * matches the brand without coupling to the template engine. Uses
 * sensible neutral defaults when the theme is unset.
 *
 * Cloudflare Pages auto-serves this file for any unmatched URL when
 * present at the deployment root.
 */
export function buildNotFoundHtml(options: Build404Options): string {
  // Theme overrides → CSS custom properties. Defaults match the
  // template-base.css fallbacks so unstyled sites still look intentional.
  const primary = options.theme?.primary?.trim() || "#0f172a";
  const bg = options.theme?.bg?.trim() || "#ffffff";

  // Pick a readable foreground for the primary button. Heuristic: if the
  // primary is dark (luminance < 0.5), use white; else use a near-black.
  // Avoids hardcoding white-on-yellow disasters when someone picks a
  // light primary color.
  const primaryFg = readableTextOn(primary);

  const escapedSiteName = escapeHtml(options.siteName);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Page not found — ${escapedSiteName}</title>
  <meta name="robots" content="noindex">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
      background: ${bg};
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { text-align: center; max-width: 520px; }
    .site-name {
      font-family: 'Space Grotesk', system-ui, sans-serif;
      font-weight: 600;
      font-size: 0.875rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #64748b;
      margin: 0 0 3rem;
    }
    h1 {
      font-family: 'Space Grotesk', system-ui, sans-serif;
      font-size: clamp(4rem, 12vw, 8rem);
      font-weight: 700;
      margin: 0 0 0.5rem;
      color: ${primary};
      line-height: 1;
      letter-spacing: -0.04em;
    }
    h2 {
      font-family: 'Space Grotesk', system-ui, sans-serif;
      font-size: clamp(1.25rem, 3vw, 1.75rem);
      font-weight: 600;
      margin: 0 0 1rem;
      color: #0f172a;
    }
    p {
      font-size: 1rem;
      color: #475569;
      line-height: 1.6;
      margin: 0 0 2rem;
    }
    .home-link {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.875rem 1.75rem;
      background: ${primary};
      color: ${primaryFg};
      text-decoration: none;
      border-radius: 0.5rem;
      font-weight: 500;
      font-size: 0.95rem;
      font-family: 'DM Sans', system-ui, sans-serif;
      transition: opacity 0.2s, transform 0.2s;
    }
    .home-link:hover { opacity: 0.9; transform: translateY(-1px); }
    .home-link:active { transform: translateY(0); }
  </style>
</head>
<body>
  <main class="container">
    <p class="site-name">${escapedSiteName}</p>
    <h1>404</h1>
    <h2>Page not found</h2>
    <p>The page you are looking for does not exist or has been moved.</p>
    <a class="home-link" href="/">← Back to home</a>
  </main>
</body>
</html>
`;
}

// ── privacy.html ────────────────────────────────────────────────────────────

export interface BuildPrivacyOptions {
  /** Site name shown in the header AND used as the controller name in
   *  the body when no separate companyName is provided. */
  siteName: string;
  /** Absolute URL of the live site (e.g. `https://acme.pages.dev`). Shown
   *  in the body and used in the canonical link. Optional — falls back
   *  to a relative reference if not provided. */
  siteUrl?: string;
  /** Theme tokens (primary + bg). Optional — falls back to neutral
   *  defaults so untouched-theme sites get a clean privacy page. */
  theme?: SiteTheme;
}

/**
 * Build an English GDPR-style privacy policy page.
 *
 * Auto-generated on every publish. The cookie-bar widget AND the
 * "Privacy" link in every footer template both point to
 * `privacy.html` — without this file, those links 404 on the live site
 * (which is also a GDPR violation: cookies asking for consent need a
 * privacy policy explaining what's being consented to).
 *
 * Coverage: identifies the controller, lists data categories
 * (cookie consent, contact-form submissions, server logs), explains
 * legal basis (legitimate interest + consent), retention period,
 * data-subject rights (access, rectification, erasure, portability,
 * objection, complaint to a supervisory authority), and gives
 * a contact placeholder.
 *
 * Generic by design — does NOT inline company-
 * specific fields like company registration number, address, or DPO email. Points visitors to
 * the site's Contact section for those specifics. Trade-off accepted:
 * keeps the page deliverable on every publish without manual editing,
 * at the cost of not being a "full" GDPR controller identification
 * (which would require the structured legal fields). Earlier draft had
 * yellow placeholder spans like `[Add registration number]` that needed manual
 * edits per site — found those worse than just being generic.
 *
 * Self-contained: inline CSS, no external deps beyond the same Google
 * Fonts the rest of the site uses. Theme-aware so the page matches the
 * brand. Marked noindex — privacy boilerplate shouldn't compete with
 * real pages in search results.
 */
export function buildPrivacyHtml(options: BuildPrivacyOptions): string {
  const primary = options.theme?.primary?.trim() || "#0f172a";
  const bg = options.theme?.bg?.trim() || "#ffffff";
  const escapedSiteName = escapeHtml(options.siteName);
  const escapedSiteUrl = options.siteUrl
    ? escapeHtml(options.siteUrl.replace(/\/$/, ""))
    : "";
  // Today's date in English format (12 May 2026) so the "effective from" date
  // doesn't read as January-1st default forever.
  const today = new Date();
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const effectiveDate = `${today.getDate()} ${monthNames[today.getMonth()]} ${today.getFullYear()}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy — ${escapedSiteName}</title>
  <meta name="robots" content="noindex">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
      background: ${bg};
      color: #0f172a;
      line-height: 1.7;
      padding: 4rem 1.5rem;
    }
    .container { max-width: 760px; margin: 0 auto; }
    .home-link {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-family: 'Space Grotesk', system-ui, sans-serif;
      font-size: 0.85rem;
      font-weight: 500;
      color: #475569;
      text-decoration: none;
      margin-bottom: 2.5rem;
      transition: color 0.2s ease;
    }
    .home-link:hover { color: ${primary}; }
    h1 {
      font-family: 'Space Grotesk', system-ui, sans-serif;
      font-size: clamp(1.75rem, 4vw, 2.5rem);
      font-weight: 600;
      margin: 0 0 0.5rem;
      color: #0f172a;
      letter-spacing: -0.02em;
    }
    .effective {
      font-size: 0.88rem;
      color: #64748b;
      margin: 0 0 2.5rem;
    }
    h2 {
      font-family: 'Space Grotesk', system-ui, sans-serif;
      font-size: 1.2rem;
      font-weight: 600;
      margin: 2.5rem 0 0.75rem;
      color: #0f172a;
    }
    p, li {
      font-size: 1rem;
      color: #334155;
      margin: 0 0 1rem;
    }
    ul, ol { padding-left: 1.5rem; margin: 0 0 1rem; }
    li { margin-bottom: 0.5rem; }
    a {
      color: ${primary};
      text-decoration: underline;
    }
    a:hover { opacity: 0.8; }
    .meta {
      margin-top: 3rem;
      padding-top: 2rem;
      border-top: 1px solid #e2e8f0;
      font-size: 0.85rem;
      color: #64748b;
    }
  </style>
</head>
<body>
  <main class="container">
    <a class="home-link" href="/">← Back to home</a>
    <h1>Privacy Policy</h1>
    <p class="effective">Effective from: ${effectiveDate}</p>

    <p>This privacy policy explains how the operator of the website <strong>${escapedSiteName}</strong>${escapedSiteUrl ? ` (<a href="${escapedSiteUrl}">${escapedSiteUrl}</a>)` : ""} processes the personal data of visitors in accordance with the General Data Protection Regulation (GDPR) and applicable data protection law.</p>

    <h2>1. Data Controller</h2>
    <p>The controller of personal data processed through this website is the entity operating <strong>${escapedSiteName}</strong>. Specific contact details (business name, registered address, registration number, email and phone) can be found in the <strong>Contact</strong> section on the main page. For matters relating to the processing of personal data, you can reach us using the contact details published on the website.</p>

    <h2>2. What Personal Data We Process</h2>
    <ul>
      <li><strong>Contact form data</strong> — name, email, phone number and message content that you voluntarily provide when completing the form.</li>
      <li><strong>Technical data (cookies)</strong> — functional cookies that remember your consent to processing. No tracking or marketing cookies are used without your explicit consent.</li>
      <li><strong>Server logs</strong> — IP address, browser type, access time — automatically recorded by the hosting provider for operational and security purposes.</li>
    </ul>

    <h2>3. Purpose and Legal Basis for Processing</h2>
    <ul>
      <li><strong>Handling contact form enquiries</strong> — the legal basis is the controller's legitimate interest in responding to your enquiry (Art. 6(1)(f) GDPR).</li>
      <li><strong>Functional cookies</strong> — the legal basis is your consent given by clicking "Accept" on the cookie bar (Art. 6(1)(a) GDPR).</li>
      <li><strong>Server logs</strong> — the legal basis is the legitimate interest in the operation and security of the website.</li>
    </ul>

    <h2>4. Retention Period</h2>
    <p>We retain contact form data for as long as necessary to handle your request and thereafter for a maximum of <strong>3 years</strong> for any further consultation. Server logs are kept for a maximum of <strong>30 days</strong>. Cookie consent is valid for <strong>12 months</strong>, after which it is requested again.</p>

    <h2>5. Recipients of Personal Data</h2>
    <p>We do not share your personal data with any third parties, except for the following processors who provide technical operations on our behalf:</p>
    <ul>
      <li><strong>Hosting provider</strong> — your hosting provider (international transfers, where applicable, are protected by Standard Contractual Clauses)</li>
      <li><strong>Email provider</strong> — your email service provider</li>
    </ul>

    <h2>6. Your Rights</h2>
    <p>Under the GDPR, you have the right:</p>
    <ul>
      <li>to access your personal data (Art. 15 GDPR)</li>
      <li>to rectify inaccurate or incomplete data (Art. 16 GDPR)</li>
      <li>to erase data that is no longer needed for the original purpose (Art. 17 GDPR)</li>
      <li>to restrict processing (Art. 18 GDPR)</li>
      <li>to data portability in a standard format (Art. 20 GDPR)</li>
      <li>to object to processing (Art. 21 GDPR)</li>
      <li>to withdraw consent at any time, where processing is based on consent (Art. 7(3) GDPR)</li>
    </ul>
    <p>Please direct requests using the contact details listed in the <strong>Contact</strong> section on the main page (email or phone).</p>

    <h2>7. Complaint to a Supervisory Authority</h2>
    <p>If you believe that your personal data is being processed in breach of the GDPR, you have the right to lodge a complaint with your local data protection authority.</p>

    <h2>8. Changes to This Policy</h2>
    <p>We may update this policy from time to time. The current version is always available on this page. The date of the latest change is shown in the document header.</p>

    <p class="meta">This document is generated automatically when the website is published. Last updated: ${effectiveDate}.</p>
  </main>
</body>
</html>
`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Pick a readable foreground (#fff or near-black) for a given background. */
function readableTextOn(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return "#ffffff"; // fallback for non-hex (e.g. CSS keywords)
  // sRGB relative luminance per WCAG 2.x.
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? "#0f172a" : "#ffffff";
}

function parseHex(input: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3)
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** XML 1.0 spec — same five chars as HTML plus the apostrophe. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
