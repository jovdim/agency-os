# Template Authoring Guide — SK Agency CRM

Use this guide when asking an AI (or a developer) to create a new section template for the CRM's template library. Following these conventions, the parser will automatically extract every editable field and the composer will let the IT team / clients fill them in without touching HTML.

---

## 1. The big idea

A **template** is a single HTML file representing one section of a website (one navbar, one hero, one footer, etc.). The CRM stores the HTML, parses it once at upload, and lets people edit only the parts marked as editable. Everything else (layout, CSS classes, structure) is locked.

The composer assembles a full website by stacking templates in order (nav → hero → about → services → contact → footer) and filling in each editable field.

---

## 2. File structure

Every template is **one full HTML document** with these required pieces:

```html
<!DOCTYPE html>
<html lang="sk">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>category-NN — short description</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../_common/preview.css">

  <!-- Optional: per-template CSS (extracted on upload, bundled with the section) -->
  <style>
    /* Only styles unique to this variant. Base classes (.hero, .container, etc.) live in the global stylesheet. */
  </style>
</head>
<body>

<!-- Optional: preview banner. Stripped on upload — only what's between SECTION markers ships. -->
<div class="preview-banner">
  <strong>TEMPLATE PREVIEW: hero-01</strong>
</div>

<!-- ⬇ THE ONLY PART THAT GETS UPLOADED ⬇ -->
<!-- SECTION:hero:start -->
<!--
  TEMPLATE: hero-01
  LAYOUT:   short description of the layout
  EDITABLE: list of every data-field used
-->
<section class="...">
  <!-- the actual section -->
</section>
<!-- SECTION:hero:end -->
<!-- ⬆ END OF UPLOADED REGION ⬆ -->

<!-- Optional: spacer / preview-only content below. Ignored on upload. -->

</body>
</html>
```

### What gets uploaded

The parser extracts:
- **HTML body**: only the content between `<!-- SECTION:CATEGORY:start -->` and `<!-- SECTION:CATEGORY:end -->`
- **CSS**: every `<style>` block in the `<head>` (concatenated)
- **Schema**: every `data-field` attribute, mapped to a field type

Everything else (the `<!DOCTYPE>`, preview banner, scripts loading `preview.js`, etc.) is **stripped**.

---

## 3. SECTION markers

Required. Format:

```html
<!-- SECTION:CATEGORY:start -->
... your section HTML ...
<!-- SECTION:CATEGORY:end -->
```

Where `CATEGORY` is one of:

| Category | Use for |
|---|---|
| `nav` | Site navigation / navbar (shared across all pages) |
| `hero` | Above-the-fold hero / banner |
| `about` | Who we are / company intro |
| `services` | What we offer (services grid, list, cards) |
| `gallery` | Photo gallery / portfolio grid |
| `reviews` | Testimonials / customer reviews |
| `faq` | Frequently asked questions |
| `cta` | Call-to-action banner |
| `contact` | Contact info / contact form |
| `footer` | Site footer (shared across all pages) |
| `map` | Embedded map / location |

Category determines where the template appears in the rail and which slot it fills.

---

## 4. Editable fields — `data-field`

Mark every editable element with `data-field="some_key"`. The parser auto-detects the type from the element:

### Field types

| Type | Detected when | What it stores |
|---|---|---|
| `image` | `<img data-field>` OR any element with `style="background-image: url(...)"` | URL of an uploaded image |
| `link` | `<a data-field data-type="link">` (explicit) | `{label, href}` — both editable |
| `longtext` | text content > 100 chars OR contains `<br>` | multiline text |
| `text` | anything else | single-line text |

### Naming convention for keys

- Lowercase
- Snake_case
- Prefix with the section category (`hero_headline`, `about_image`, `services_subtitle`)
- Be specific: `hero_cta_primary` is better than `hero_button`

### Examples — text

```html
<h1 data-field="hero_headline">Výkopové práce po celom Slovensku</h1>
<p data-field="hero_subheadline">Profesionálne pracujeme s bagrom priamo na Vašom pozemku.</p>
```

The default text inside the element becomes the placeholder shown in the editor. Keep it realistic — it's what the IT person sees as a starting point.

### Examples — image

```html
<!-- An <img> tag -->
<img data-field="about_image" src="https://images.pexels.com/photos/.../sample.jpg" alt="">

<!-- A background image on any element -->
<section data-field="hero_bg" style="background-image: url('https://images.pexels.com/photos/.../bg.jpg')">
  ...
</section>
```

**For the `src` value, use a real placeholder image URL** (Pexels free CDN works great). The composer shows this image until the client replaces it.

### Examples — link

A link field captures BOTH the visible label AND the `href` URL. Mark with `data-type="link"`:

```html
<!-- Phone CTA: client edits both the displayed text AND the tel: link -->
<a data-field="nav_phone" data-type="link" href="tel:+421900000000">0900 000 000</a>

<!-- Menu item: client edits both label and where it points -->
<a data-field="nav_link_services" data-type="link" href="#services">Služby</a>

<!-- Social link in a footer -->
<a data-field="footer_facebook" data-type="link" href="https://facebook.com/yourpage">Facebook</a>
```

**When to use `data-type="link"` vs plain `data-field` on `<a>`:**
- Use `data-type="link"` when the URL should be editable per-client (phone, social, external CTAs, anchor targets)
- Use plain `data-field` (without `data-type`) when only the label should change and the link is structural (e.g., always points to `#hero` regardless of client)

When in doubt, prefer `data-type="link"` — it gives the IT person more flexibility.

### Don't use the same data-field key twice

The parser keeps the FIRST occurrence and ignores duplicates. If you need multiple similar items (e.g., service list), give each its own key:

```html
<!-- ✗ WRONG — same key on multiple elements -->
<li data-field="service_link"><a>Service 1</a></li>
<li data-field="service_link"><a>Service 2</a></li>

<!-- ✓ RIGHT — unique keys per slot -->
<li><a data-field="service_1" data-type="link" href="#s1">Service 1</a></li>
<li><a data-field="service_2" data-type="link" href="#s2">Service 2</a></li>
```

---

## 5. CSS

### Use the base CSS classes

Standard layout/utility classes (`.container`, `.hero`, `.btn`, `.btn-primary`, `.section-alt`, `.split`, `.eyebrow`, etc.) live in the project's base stylesheet and are available to every section. Use them — don't redefine.

### Colors — ALWAYS use the 4 theme variables. NEVER hardcode hex.

The composer has a **Theme panel** where the IT guy picks 4 colors per site. Those colors flow into every template via CSS custom properties. If your template hardcodes hex values, picking colors in the composer won't re-skin your section — and that's an instant rejection.

The 4 variables (defined in `public/template-base.css`):

| Variable | What it's for |
|---|---|
| `var(--color-primary)` | Main brand color. Buttons, link hover, active nav, focused inputs, accent borders, important highlights. |
| `var(--color-secondary)` | Dark/contrast color. Headings, footer background, dark hero overlays, button hover, "serious" surfaces. |
| `var(--color-text)` | Body copy — paragraphs, list items, descriptions. |
| `var(--color-bg)` | Main page background. Section backgrounds default to this. |

**Right:**

```css
.about-01 .stat-number { color: var(--color-primary); }
.about-01 h2 { color: var(--color-secondary); }
.about-01 p { color: var(--color-text); }
.about-01 { background: var(--color-bg); }
.about-01 .badge {
  background: var(--color-primary);
  color: #fff; /* white-on-primary is fine — neutral, not theme-driven */
}
```

**Wrong — will not respect the picked palette:**

```css
.about-01 .stat-number { color: #d97f33; }   /* hardcoded brand color */
.about-01 h2 { color: #1c1917; }             /* hardcoded heading color */
.about-01 { background: #ffffff; }           /* hardcoded background */
```

### Allowed exceptions (still no hex for the 4 roles above)

- `#fff` / `#000` for pure white/black on top of a theme color (e.g. white text on a primary button) — these are neutrals, not brand decisions.
- Subtle borders / dividers — use `var(--color-border)` (defined in base CSS).
- Shadows — use `var(--shadow-sm | --shadow-md | --shadow-lg)` (defined in base CSS).
- One-off decorative tints — only if absolutely necessary, and never for the 4 roles above.

### Quick self-check before uploading a template

Search your CSS for `#` (hex codes). If you find any that aren't `#fff`, `#000`, or rgba/hsla one-offs for shadows/overlays, **replace them with the matching theme variable**. The whole point of the theme system is one click in the composer re-skins every section — that only works if every template plays by these rules.

### Per-template CSS — only for variant-specific tweaks

Put any unique styles in a single `<style>` block in `<head>`. Examples of legit per-template CSS:
- A grid layout specific to one variant (`.about-01 .split { grid-template-columns: 1.1fr 1fr; }`)
- A custom decorative element only one variant uses
- A non-default font weight / spacing tweak

Don't redefine base classes (`.btn`, `.hero`, etc.). Your styles are bundled with the section, so global overrides will conflict with other sections on the same page.

---

## 6. JavaScript

If the section needs interactivity (hamburger menu, dropdown toggle, image lightbox), put the script INSIDE the SECTION markers. It travels with the template:

```html
<!-- SECTION:nav:start -->
<nav class="site-nav">
  ...
  <script>
    (function () {
      // Use IIFE to avoid leaking globals
      var nav = document.currentScript.closest('.site-nav');
      if (!nav || nav.dataset.skInit) return; // run once, even if section appears twice
      nav.dataset.skInit = '1';
      // ... your handlers
    })();
  </script>
</nav>
<!-- SECTION:nav:end -->
```

Rules:
- Wrap in an IIFE so variables don't leak
- Use a `data-init` flag so the script doesn't re-bind if the section appears multiple times
- Scope queries to the section (`nav.querySelector(...)`, not `document.querySelector(...)`) so multiple sections of the same template can coexist

---

## 7. Each category — what fields are typical

### `nav`
Required-ish fields:
- `nav_logo` (image) — company logo, client uploads their own
- `nav_link_*` (link) — main menu items, label + href editable
- `nav_phone` (link) — phone CTA with `tel:` href

Use a real placeholder image URL (Pexels works). Client replaces it with their logo. If a variant doesn't have a logo image (text-only nav), use `nav_logo_text` as text instead.

### `hero`
Typical fields:
- `hero_bg` (image) — background image
- `hero_headline` (text)
- `hero_subheadline` (longtext)
- `hero_cta_primary` (link or text) — primary CTA label/url
- `hero_cta_secondary` (link or text) — secondary CTA

### `about`
Typical fields:
- `about_eyebrow` (text)
- `about_headline` (text)
- `about_text_1`, `about_text_2` (longtext)
- `about_image` (image)
- `about_feature_1` … `about_feature_4` (text) — bullet list items

### `services`
Typical fields per card (3–6 cards):
- `service_N_title` (text)
- `service_N_description` (longtext)
- `service_N_icon` (image, optional)

### `gallery`
- A list of images: `gallery_image_1` … `gallery_image_N`. Fixed count for v1.

### `reviews`
- `review_N_text` (longtext)
- `review_N_author` (text)
- `review_N_company` (text)
- `review_N_avatar` (image, optional)

### `faq`
- `faq_N_question` (text)
- `faq_N_answer` (longtext)

### `contact`
- `contact_address` (text)
- `contact_phone` (link, with tel: href)
- `contact_email` (link, with mailto: href)
- `contact_hours` (longtext)

### `footer`
- `footer_text` (longtext)
- `footer_phone` (link)
- `footer_email` (link)
- Social links (each `data-type="link"`)

### `cta` / `map`
Lightweight banners. Keep field count low.

---

## 8. Field defaults — make them realistic

The default values inside `data-field` elements appear as placeholders in the editor. They're also what gets shipped if the client doesn't change them. Use real-sounding Slovak business copy as the default, not "Lorem ipsum" or "[YOUR HEADLINE HERE]". Examples:

```html
<!-- ✓ Good — realistic, ready to ship if not changed -->
<h1 data-field="hero_headline">Výkopové a zemné práce po celom Slovensku</h1>

<!-- ✗ Bad — looks broken if not edited -->
<h1 data-field="hero_headline">[INSERT HEADLINE]</h1>
```

For images, use real Pexels URLs that match the section type:
- Construction → search "construction" or "excavation" on Pexels
- Restaurants → "restaurant interior"
- Garden services → "garden landscaping"

---

## 9. Common mistakes the parser will catch (or fail silently on)

| Mistake | What happens |
|---|---|
| No `<!-- SECTION:X:start -->` markers | Whole HTML uploaded as the section, including `<head>`, breaks render |
| Same `data-field` key on multiple elements | Only the first is kept; second is silently ignored |
| `data-field` on `<img>` and `data-type="link"` together | `data-type="link"` only applies to `<a>`; img is treated as image |
| Inline event handlers (`onclick="..."`) | They work but are blocked by some CSP setups; prefer addEventListener inside a script block |
| Loading external JS (`<script src="https://..."></script>`) | Blocked by some browsers; bundle inline if possible |
| Hardcoding image URLs that block hotlinking | Use Pexels or similar free hotlink-friendly CDNs for placeholders |

---

## 10. Reference: the parser

The full parser logic lives at `src/lib/templates/parser.ts`. The render logic (server) at `src/lib/templates/render.ts`. The browser-side render at `src/lib/templates/render-browser.ts`. They share the same field convention so what you see in the composer preview matches what gets published.

---

## 11. Quick prompt for AI

When asking an AI to create a new template, paste this prompt:

> Create a new HTML template for the SK Agency CRM section library. Follow the conventions in TEMPLATE_AUTHORING_GUIDE.md exactly. The category is **{nav | hero | about | services | gallery | reviews | faq | cta | contact | footer | map}**. Layout: **{describe}**. Industry: **{e.g., construction, gardening}**. Required editable fields: **{list them}**. Use data-field attributes. For links that should have editable URLs (phone, social, external CTAs), use `data-type="link"`. Wrap everything in `<!-- SECTION:CATEGORY:start --> ... <!-- SECTION:CATEGORY:end -->`. Use realistic Slovak business defaults. Use Pexels for placeholder images. Keep custom CSS minimal — assume base classes exist. Include a self-contained `<script>` only if interactivity is needed.

---

## 12. Example — see `public/sample-templates/nav-01.html`

The committed `public/sample-templates/nav-01.html` is a working reference: text logo, 5 menu links + 4 services dropdown items + phone CTA, all with `data-type="link"`. Self-contained hamburger script. Per-template `<style>` block for the text-logo styling.
