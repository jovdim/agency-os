# Website Structure Rules — Dashboard Integration v2

Build a normal website. Write real HTML with real content. The dashboard inline editor auto-detects editable elements via `data-field` attributes. These rules cover everything needed for dashboard compatibility, SEO, GDPR, and accessibility.

**Read this FIRST before coding. These are non-negotiable.**

---

## 1. FILE STRUCTURE

```
project/
  index.html                  — homepage
  about.html                  — subpage (in root, not /pages/)
  services.html
  pieskovanie-kovu.html       — service subpage
  pieskovanie-dreva.html
  contact.html
  privacy.html                — privacy policy (required by GDPR)
  style.css                   — all styles + CSS custom properties for theming
  script.js                   — interactivity ONLY (menu, scroll, accordion)
  images/                     — all images (WebP preferred)
  robots.txt
  sitemap.xml                 — required for multi-page sites
  404.html
```

### Rules

- No frameworks, no build tools — plain HTML/CSS/JS
- Each HTML page is self-contained with all its content written directly in the HTML
- Subpages in ROOT directory — NOT in `/pages/` (cleaner URLs, better SEO)
- `script.js` handles interactivity only — NOT content loading
- Dashboard scripts (`proposal-widget.js`, `contact-handler.js`, `editor-helper.js`) are auto-injected at deploy — NEVER include them manually

---

## 2. THEMING — CSS CUSTOM PROPERTIES

All theme values in `:root` in style.css. To change the entire look, just change the variables.

```css
:root {
  /* Colors */
  --color-primary: #c8963e;
  --color-secondary: #1a1a1a;
  --color-accent: #d4a843;
  --color-dark: #0a0a0a;
  --color-light: #f5f0eb;
  --color-text: #333333;
  --color-text-light: #666666;
  --color-text-on-dark: #e8e2d9;
  --color-bg: #ffffff;
  --color-bg-alt: #f8f6f3;

  /* Typography */
  --font-heading: "Space Grotesk", sans-serif;
  --font-body: "DM Sans", sans-serif;

  /* Layout */
  --max-width: 1200px;
  --section-padding: 80px 0;
  --border-radius: 8px;
  --transition: 0.3s ease;
}
```

Use these variables everywhere in CSS:

```css
h1,
h2,
h3 {
  font-family: var(--font-heading);
  color: var(--color-dark);
}
body {
  font-family: var(--font-body);
  color: var(--color-text);
}
.btn-primary {
  background: var(--color-primary);
  border-radius: var(--border-radius);
}
section {
  padding: var(--section-padding);
  max-width: var(--max-width);
  margin: 0 auto;
}
```

---

## 3. EDITABLE ELEMENTS — `data-field` REQUIRED

Every element the client can edit MUST have a `data-field` attribute. This is how the dashboard editor identifies what's editable — like Webflow and WordPress.

### Text Elements

```html
<h1 data-field="headline">Mobilné pieskovanie a čistenie povrchov</h1>
<p data-field="subheadline">po celom Slovensku</p>
<p data-field="description">
  SandWave mení staré a znečistené povrchy na čisté...
</p>
<a href="#contact" class="btn" data-field="cta_text">Zistiť viac</a>
<span data-field="phone">0940 220 868</span>
```

### Images

```html
<img
  data-field="hero_image"
  src="images/hero.webp"
  alt="Pieskovanie fasády"
  width="1920"
  height="1080"
/>
<img
  data-field="about_image"
  src="images/about.webp"
  alt="Tím pri práci"
  width="800"
  height="600"
  loading="lazy"
  decoding="async"
/>
```

### Background Images

```html
<section
  class="hero"
  data-field="hero_bg"
  style="background-image: url('images/hero-bg.webp')"
>
  <h1 data-field="headline">Mobilné pieskovanie</h1>
</section>
```

### Repeating Items (Services, Gallery, Team, FAQ)

Each repeating item container gets `data-item`. Each editable element inside gets `data-field`.

```html
<section id="services">
  <h2 data-field="headline">Naše služby</h2>
  <p data-field="subheadline">
    Kompletné služby pieskovania po celom Slovensku
  </p>

  <div class="services-grid">
    <div class="service-card" data-item="svc_1">
      <img
        data-field="image"
        src="images/svc-kov.webp"
        alt="Pieskovanie kovu"
        width="800"
        height="600"
        loading="lazy"
        decoding="async"
      />
      <h3 data-field="title">Pieskovanie kovu</h3>
      <p data-field="description">
        Odstraňovanie hrdze, starých farieb a korózie z plotov, brán a
        konštrukcií.
      </p>
    </div>

    <div class="service-card" data-item="svc_2">
      <img
        data-field="image"
        src="images/svc-drevo.webp"
        alt="Pieskovanie dreva"
        width="800"
        height="600"
        loading="lazy"
        decoding="async"
      />
      <h3 data-field="title">Pieskovanie dreva</h3>
      <p data-field="description">
        Obnova dreveníc, zrubov, pergol a fasád bez chemikálií.
      </p>
    </div>
  </div>
</section>
```

### Naming Conventions

- `data-field`: lowercase, underscore-separated — `headline`, `hero_image`, `cta_text`, `form_submit`
- `data-item`: prefix + number — `svc_1`, `img_1`, `team_1`, `faq_1`, `rev_1`
- Use descriptive names: `hero_headline` not `h1`, `about_image` not `img1`

### What Gets `data-field`

- ✅ Headings (h1-h6)
- ✅ Paragraphs and descriptions
- ✅ Button/link text
- ✅ Images (`<img>` and background-image)
- ✅ Phone numbers, email addresses displayed as text
- ✅ Form submit button text

### What Does NOT Get `data-field`

- ❌ Layout containers (`<div>`, `<section>` wrappers)
- ❌ Decorative elements (borders, shapes, spacers)
- ❌ Icons (SVG, icon fonts)
- ❌ Navigation link labels (structural, not content)
- ❌ Footer copyright text (rarely changed)

### Important

- Client can edit TEXT and IMAGES in existing elements
- Client CANNOT add/remove cards, sections, or structural elements
- Adding/removing items = IT guy updates the HTML
- This is by design — structural changes go through the IT guy

---

## 4. NAVIGATION

```html
<nav role="navigation" aria-label="Hlavná navigácia">
  <a href="/" class="logo">
    <img data-field="logo" src="images/logo.webp" alt="SandWave" height="40" />
  </a>
  <ul class="nav-links">
    <li><a href="#about">O nás</a></li>
    <li><a href="#services">Služby</a></li>
    <li><a href="#gallery">Galéria</a></li>
    <li><a href="#contact">Kontakt</a></li>
  </ul>
  <a href="tel:+421940220868" class="nav-cta" data-field="phone_cta"
    >0940 220 868</a
  >
  <button class="hamburger" aria-label="Menu" aria-expanded="false">
    <span></span><span></span><span></span>
  </button>
</nav>
```

### Rules

- MUST use `<nav>` tag — dashboard scripts inject after `</nav>`
- MUST have hamburger button for mobile with `aria-label="Menu"` and `aria-expanded`
- Nav links = normal `<a href>` tags (anchor links or page URLs)
- Multi-page links: `<a href="about.html">O nás</a>` (same directory)
- `role="navigation"` and `aria-label` for accessibility
- Logo image gets `data-field="logo"` (client can replace it)

---

## 5. CONTACT FORM

```html
<form id="contact-form" novalidate aria-label="Kontaktný formulár">
  <div class="form-group">
    <label for="cf-name">Meno *</label>
    <input
      type="text"
      id="cf-name"
      name="name"
      required
      autocomplete="name"
      aria-required="true"
    />
  </div>
  <div class="form-group">
    <label for="cf-email">Email *</label>
    <input
      type="email"
      id="cf-email"
      name="email"
      required
      autocomplete="email"
      aria-required="true"
    />
  </div>
  <div class="form-group">
    <label for="cf-phone">Telefón</label>
    <input type="tel" id="cf-phone" name="phone" autocomplete="tel" />
  </div>
  <div class="form-group">
    <label for="cf-message">Správa *</label>
    <textarea
      id="cf-message"
      name="message"
      rows="5"
      required
      aria-required="true"
    ></textarea>
  </div>
  <div class="form-consent">
    <label>
      <input
        type="checkbox"
        name="gdpr_consent"
        required
        aria-required="true"
      />
      <span
        >Súhlasím so
        <a href="privacy.html" target="_blank">spracovaním osobných údajov</a>
        *</span
      >
    </label>
  </div>
  <button type="submit" data-field="form_submit">Odoslať správu</button>
</form>
```

### Rules

- `id="contact-form"` is REQUIRED — auto-injected `contact-handler.js` looks for this
- Input names MUST be exactly: `name`, `email`, `phone`, `message`, `gdpr_consent`
- GDPR checkbox MUST NOT be pre-checked, MUST be required
- Every `<input>` has a `<label>` (accessibility)
- Required fields marked with `*` and `aria-required="true"`
- **NEVER add custom form submission JavaScript** — `contact-handler.js` handles everything

---

## 6. IMAGES — Optimization

### Rules

- Format: **WebP** preferred, JPEG/PNG acceptable
- `loading="lazy"` + `decoding="async"` on ALL images EXCEPT the hero/above-fold
- `width` + `height` attributes ALWAYS (prevents layout shift)
- Descriptive `alt` text always (never "image", "photo", or empty on meaningful images)
- `alt=""` ONLY for purely decorative images

### Size Guide

| Image Type            | Max Width | Format      | Quality |
| --------------------- | --------- | ----------- | ------- |
| Hero/Banner           | 1920px    | WebP        | 80%     |
| Section backgrounds   | 1920px    | WebP        | 75%     |
| Service/feature cards | 800px     | WebP        | 80%     |
| Gallery items         | 1200px    | WebP        | 80%     |
| Team photos           | 400px     | WebP        | 85%     |
| Logo                  | 200px     | SVG or WebP | —       |
| Thumbnails            | 400px     | WebP        | 80%     |

### Picture Element (for format fallback)

```html
<picture>
  <source srcset="images/hero.webp" type="image/webp" />
  <img
    src="images/hero.jpg"
    alt="Pieskovanie fasády"
    width="1920"
    height="1080"
  />
</picture>
```

---

## 7. SEO — COMPREHENSIVE

### 7a. HTML Head (required on EVERY page)

```html
<!DOCTYPE html>
<html lang="sk">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    <!-- Page-specific SEO (unique per page!) -->
    <title>Pieskovanie kovu — SandWave | Mobilné pieskovanie</title>
    <meta
      name="description"
      content="Profesionálne pieskovanie kovových povrchov. Odstraňovanie hrdze a starých náterov z plotov, brán a konštrukcií. Mobilné služby po celom Slovensku."
    />
    <meta
      name="keywords"
      content="pieskovanie kovu, odstraňovanie hrdze, čistenie kovov, mobilné pieskovanie"
    />
    <link
      rel="canonical"
      href="https://sandwave.2dni.sk/pieskovanie-kovu.html"
    />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="sk_SK" />
    <meta property="og:site_name" content="SandWave" />
    <meta property="og:title" content="Pieskovanie kovu — SandWave" />
    <meta
      property="og:description"
      content="Profesionálne pieskovanie kovových povrchov..."
    />
    <meta
      property="og:image"
      content="https://sandwave.2dni.sk/images/og-kov.webp"
    />
    <meta
      property="og:url"
      content="https://sandwave.2dni.sk/pieskovanie-kovu.html"
    />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Pieskovanie kovu — SandWave" />
    <meta
      name="twitter:description"
      content="Profesionálne pieskovanie kovových povrchov..."
    />
    <meta
      name="twitter:image"
      content="https://sandwave.2dni.sk/images/og-kov.webp"
    />

    <!-- Favicon -->
    <link rel="icon" href="images/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="images/apple-touch-icon.png" />

    <!-- Performance -->
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;700&display=swap"
      rel="stylesheet"
    />

    <link rel="stylesheet" href="style.css" />
  </head>
</html>
```

**Every page MUST have unique:** title, description, canonical URL, OG image.

### 7b. Pillar Page + Subpage Strategy

- **Homepage** = pillar page — broad overview, links to all service subpages
- **Subpages** = deep content — one specific service per page, 800-2000 words
- **Internal linking**: homepage → subpages via service cards/links, subpages → homepage, subpages → related subpages
- **Breadcrumbs** on every subpage:

```html
<nav aria-label="Breadcrumb" class="breadcrumb">
  <a href="index.html">Domov</a>
  <span>/</span>
  <a href="index.html">Služby</a>
  <span>/</span>
  <span aria-current="page">Pieskovanie kovu</span>
</nav>
```

### 7c. JSON-LD Structured Data

**Homepage — LocalBusiness:**

```html
<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "SandWave",
    "description": "Mobilné pieskovanie a čistenie povrchov po celom Slovensku",
    "telephone": "+421940220868",
    "email": "info@sandwave.sk",
    "url": "https://sandwave.2dni.sk",
    "image": "https://sandwave.2dni.sk/images/og-home.webp",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Jozefa Hanulu 119",
      "addressLocality": "Liptovské Sliače",
      "postalCode": "034 01",
      "addressCountry": "SK"
    },
    "geo": {
      "@type": "GeoCoordinates",
      "latitude": "49.0847",
      "longitude": "19.3836"
    },
    "sameAs": [
      "https://www.facebook.com/sandwave",
      "https://www.instagram.com/sandwave"
    ]
  }
</script>
```

**Service Subpages — Service:**

```html
<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": "Pieskovanie kovu",
    "description": "Odstraňovanie hrdze a starých náterov z kovových povrchov",
    "provider": {
      "@type": "LocalBusiness",
      "name": "SandWave",
      "telephone": "+421940220868"
    },
    "areaServed": {
      "@type": "Country",
      "name": "Slovakia"
    }
  }
</script>
```

**Breadcrumb Schema (on subpages):**

```html
<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "Domov",
        "item": "https://sandwave.2dni.sk/"
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": "Služby",
        "item": "https://sandwave.2dni.sk/#services"
      },
      { "@type": "ListItem", "position": 3, "name": "Pieskovanie kovu" }
    ]
  }
</script>
```

### 7d. Semantic HTML

- One `<h1>` per page — NEVER skip heading levels (h1 → h2 → h3)
- Use semantic tags: `<main>`, `<nav>`, `<section>`, `<article>`, `<footer>`, `<address>`
- Each content section has `id` for anchor linking: `<section id="services">`

### 7e. robots.txt

```
User-agent: *
Allow: /
Sitemap: https://sandwave.2dni.sk/sitemap.xml
```

### 7f. sitemap.xml (required for multi-page)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://sandwave.2dni.sk/</loc>
    <lastmod>2026-04-01</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://sandwave.2dni.sk/pieskovanie-kovu.html</loc>
    <lastmod>2026-04-01</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://sandwave.2dni.sk/pieskovanie-dreva.html</loc>
    <lastmod>2026-04-01</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>
```

### 7g. Performance SEO

- `<link rel="preconnect">` for font CDNs
- `font-display: swap` on all custom fonts
- All images: lazy loaded + explicit width/height
- CSS and JS minified in production
- **Target: Lighthouse 90+ on Performance, Accessibility, Best Practices, SEO**

---

## 8. SCRIPT.JS — INTERACTIVITY ONLY

### Allowed

- Mobile menu toggle (hamburger open/close)
- Smooth scroll for anchor links (**hide #hash from URL**)
- Scroll-to-top button
- FAQ/accordion open/close
- Cookie consent banner (show/hide + localStorage)
- `IntersectionObserver` for scroll-triggered animations
- CSS class toggles for animations
- Carousel: **Swiper** or **Splide** (lightweight, well-supported)
- Lightbox: **GLightbox** (lightweight)

### NOT Allowed

- ❌ GSAP or any heavy animation library
- ❌ Content loading or fetching
- ❌ DOM element creation for content
- ❌ Form submission handling
- ❌ SEO meta tag injection
- ❌ Any library not supported by modern browsers

### Allowed CDN Libraries

- **Tailwind CSS** — utility-first CSS framework (faster development)
- **Swiper** — lightweight carousel/slider
- **Splide** — alternative lightweight carousel
- **GLightbox** — lightweight lightbox for galleries
- **Lucide Icons** — icon library (SVG-based, lightweight)
- **Google Fonts** — web fonts (with GDPR consideration)

### Script/Style Loading Order

```html
<head>
  <!-- Tailwind CSS (if using) -->
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Or link to compiled Tailwind -->
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <!-- ... content ... -->

  <!-- CDN JS libraries first -->
  <script src="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/glightbox/dist/js/glightbox.min.js"></script>
  <!-- Your script LAST before </body> -->
  <script src="script.js"></script>
</body>
</html>
```

### Smooth Scroll — Hide Hash from URL

```js
// Anchor links scroll smoothly WITHOUT showing #hash in URL bar
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.querySelector(link.getAttribute("href"));
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
```

### Animations — CSS + IntersectionObserver Only

```css
/* style.css */
.fade-up {
  opacity: 0;
  transform: translateY(30px);
  transition:
    opacity 0.6s ease,
    transform 0.6s ease;
}
.fade-up.visible {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .fade-up {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
```

```js
// script.js
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target); // animate once
      }
    });
  },
  { threshold: 0.1 },
);

document.querySelectorAll(".fade-up").forEach((el) => observer.observe(el));
```

---

## 9. GDPR & LEGAL COMPLIANCE (Required for EU/Slovakia)

### Cookie Consent Banner

Required if using ANY cookies or tracking (including Google Fonts CDN, analytics).

```html
<div
  id="cookie-banner"
  class="cookie-banner"
  role="alert"
  style="display: none;"
>
  <p>Táto stránka používa cookies na zlepšenie vášho zážitku.</p>
  <div class="cookie-actions">
    <button id="cookie-accept" class="btn btn-primary">Súhlasím</button>
    <button id="cookie-decline" class="btn btn-outline">Odmietnuť</button>
  </div>
</div>
```

script.js handles:

- Show banner if no stored preference
- Store choice in `localStorage`
- Load analytics/tracking ONLY after consent
- **Fines for non-compliance: up to €20 million**

### Privacy Policy Page

- Mandatory separate page (`privacy.html`)
- Must include: company name, IČO, address, what data is collected, how it's processed, GDPR rights (access, deletion, portability), contact info
- Written in Slovak

### Google Fonts

- **Recommended**: self-host fonts (no GDPR issue)
- **If using CDN**: disclose in privacy policy + cookie consent required

### Footer Legal Links

```html
<footer>
  <a href="privacy.html">Ochrana osobných údajov</a>
</footer>
```

---

## 10. ACCESSIBILITY (WCAG 2.1 AA — Required EU June 2025)

- **Color contrast**: 4.5:1 for normal text, 3:1 for large text
- **Keyboard navigation**: all interactive elements via Tab/Enter/Escape
- **Focus outlines**: NEVER remove without visible replacement
- **Skip link**: first element in `<body>`:

```html
<a href="#main" class="skip-link">Preskočiť na obsah</a>
```

```css
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  padding: 8px;
  z-index: 100;
}
.skip-link:focus {
  top: 0;
}
```

- **ARIA labels**: `aria-label` on icon-only buttons, `aria-expanded` on toggles, `aria-required="true"` on required inputs
- **Form labels**: every `<input>` has `<label>`, required fields marked with `*`
- **Image alt text**: descriptive text, `alt=""` ONLY for decorative images
- **Motion sensitivity**: `@media (prefers-reduced-motion: reduce)` disables all animations

---

## 11. MULTI-PAGE SITES

- All HTML files in **ROOT directory** (not in `/pages/`)
- URL: `sandwave.2dni.sk/pieskovanie-kovu.html` ✅ (not `sandwave.2dni.sk/pages/pieskovanie-kovu.html` ❌)
- Each HTML file has full `<head>` with **unique** title, description, OG tags
- Shared `style.css` and `script.js` (same directory — no `../` needed)
- Navigation: `<a href="about.html">O nás</a>`
- Breadcrumbs on every subpage
- `sitemap.xml` lists all pages
- `<body data-page="pieskovanie-kovu">` for page-specific styling/JS

---

## 12. VALIDATION CHECKLIST

### Structure

- [ ] All editable text has `data-field`
- [ ] All editable images have `data-field`
- [ ] Repeater items have `data-item`
- [ ] No dashboard scripts included manually
- [ ] script.js has no content loading logic
- [ ] No GSAP or heavy animation libraries

### Navigation

- [ ] Uses `<nav>` tag (not `<div>`)
- [ ] Has hamburger button with `aria-label`
- [ ] All links work (anchors + page URLs)

### Contact Form

- [ ] `id="contact-form"` present
- [ ] Correct input names: name, email, phone, message, gdpr_consent
- [ ] GDPR checkbox NOT pre-checked, is required
- [ ] No custom submit handler JavaScript

### SEO

- [ ] Unique `<title>` per page
- [ ] Unique `<meta name="description">` per page
- [ ] `<link rel="canonical">` per page
- [ ] OG tags (title, description, image, url) per page
- [ ] Twitter Card tags per page
- [ ] JSON-LD structured data (LocalBusiness on home, Service on subpages)
- [ ] BreadcrumbList schema on subpages
- [ ] One `<h1>` per page, proper h1→h2→h3 hierarchy
- [ ] `<html lang="sk">`
- [ ] `robots.txt` present
- [ ] `sitemap.xml` with all pages (multi-page sites)
- [ ] Breadcrumbs on subpages
- [ ] Favicon (SVG + apple-touch-icon)

### GDPR

- [ ] Cookie consent banner (if using any tracking/cookies)
- [ ] Privacy policy page with all required info
- [ ] GDPR checkbox on contact form
- [ ] Footer link to privacy policy
- [ ] Analytics loaded ONLY after consent

### Accessibility

- [ ] Color contrast WCAG AA (4.5:1 text, 3:1 large text)
- [ ] Skip link as first body element
- [ ] Focus outlines visible on all interactive elements
- [ ] Every image has descriptive `alt` text
- [ ] `aria-label` on icon-only buttons
- [ ] `aria-expanded` on toggles (hamburger, accordion)
- [ ] `@media (prefers-reduced-motion: reduce)` disables animations
- [ ] Every form input has a `<label>`

### Performance

- [ ] All images: WebP, lazy loaded, width/height set
- [ ] `<link rel="preconnect">` for font CDN
- [ ] `font-display: swap` on custom fonts
- [ ] CSS animations only (no GSAP)
- [ ] script.js last before `</body>`
- [ ] Target: **Lighthouse 90+** all categories

---

## 13. COMMON MISTAKES

1. **Missing `data-field`** on editable elements — editor won't detect them
2. **Using `<div>` instead of `<nav>`** — breaks dashboard widget injection
3. **Adding form submission JavaScript** — conflicts with auto-injected contact-handler.js
4. **Pre-checking GDPR checkbox** — illegal, fines up to €20M
5. **No cookie consent** when using Google Fonts CDN or analytics
6. **No `<html lang="sk">`** — hurts SEO and accessibility
7. **Including dashboard scripts manually** — they'll duplicate and conflict
8. **Missing `width`/`height` on images** — causes layout shift, hurts Lighthouse
9. **Using GSAP or heavy animation libraries** — use CSS animations + IntersectionObserver instead
10. **Skipping heading levels** (h1 → h3) — hurts SEO and accessibility
11. **Same title/description on all pages** — each page needs unique SEO meta
12. **No breadcrumbs on subpages** — hurts SEO and user navigation
13. **Putting subpages in `/pages/` directory** — keep in root for cleaner URLs
14. **Showing #hash in URL** on anchor click — use `e.preventDefault()` + `scrollIntoView`
