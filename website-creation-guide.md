# Website Generation Guide

You are building a professional, production-ready website that looks like it was designed by a top-tier agency. Follow every rule below exactly.

---

## HOW TO USE THIS GUIDE

Just copy the prompt below, fill in the business info, and paste it. The AI reads this guide automatically and handles everything — design direction, colors, fonts, layout, animations, all 4 files. You don't need to explain anything technical.

**Copy this prompt and fill in the blanks:**

```
Today we are going to create a new proposal website. Read the website-creation-guide.md and follow it exactly. Here is all the information:

Business name:
Industry:
Location:
Services they offer:

Contact info:
- Phone:
- Email:
- Address:
- Working hours:

Images (paste any URLs — bazos, facebook, google, whatever they have):

Brands/materials they work with (if any):

Extra notes (years in business, selling points, anything special):

Create the full website — content.json, index.html, style.css, script.js. Use GSAP + ScrollTrigger for animations.
```

That's it. No need to pick colors, fonts, sections, or anything. Just dump the info and go.

---

## CRITICAL: UNIQUE DESIGN EVERY TIME

**You MUST generate a visually distinct design for every website.** Never reuse the same layout pattern, color scheme, section arrangement, or animation style. Each website should feel like it was custom-designed by a different designer at a different agency.

### Step 1: Choose a Design Direction

Before writing ANY code, pick ONE from each category. State your choices at the top of your response so the user can see what direction you're going. **Never repeat the same combination.**

**Layout Personality** (pick one):
- **Bold & Editorial** - Oversized typography, asymmetric grids, overlapping elements, magazine-style layouts, dramatic scale contrast
- **Minimal & Spacious** - Extreme whitespace, thin fonts, subtle micro-interactions, one focal point per viewport, quiet elegance
- **Dark & Premium** - Dark backgrounds, light text, glowing accents, luxury feel, high contrast photography
- **Warm & Organic** - Rounded shapes, earth tones, soft shadows, friendly and approachable, natural textures
- **Sharp & Corporate** - Clean lines, structured grids, professional palette, business-focused, data-driven layouts
- **Creative & Playful** - Angled sections, bold accent colors, unusual grid layouts, diagonal cuts, overlapping layers
- **Rustic & Craft** - Textured feel, muted tones, handcrafted aesthetic, artisan style, vintage touches
- **Tech & Modern** - Monospace accents, card-heavy layouts, subtle borders, dark UI elements, code-inspired aesthetics
- **Scandinavian Clean** - Ultra-light backgrounds, black text, functional simplicity, photography-focused, airy
- **Brutalist** - Raw aesthetic, strong typography, unconventional spacing, high-contrast, anti-template
- **Japanese Minimal** - Precise spacing, delicate typography, asymmetric balance, zen-like calm, intentional emptiness
- **Art Deco Modern** - Geometric patterns, gold/brass accents, symmetrical layouts, ornamental dividers

### Step 2: Choose Section Layouts

Pick a DIFFERENT layout for each section. Never default to the same card grid every time:

**Hero Variations:**
- Full-screen centered text with background image
- Split hero: text left, image/visual right (or reversed)
- Hero with diagonal/angled bottom edge
- Minimal hero: large text only, no image, bold typography
- Hero with floating stats or trust badges overlaid
- Hero with image collage or mosaic background
- Hero with vertical text sidebar
- Full-screen video background hero
- Hero with animated SVG illustration
- Split hero with parallax scrolling image

**About Variations:**
- Text + image side by side (image left or right)
- Text overlapping a larger background image
- Timeline-based company story
- Stats-focused: giant numbers with descriptions
- Full-width image with text overlay
- Two-column with icon checklist
- About with team photo strip at bottom
- Letter-style: personal message from founder

**Services Variations:**
- Card grid (2, 3, or 4 columns with varying card styles)
- Alternating left-right rows (zigzag layout)
- Vertical list with large numbers (01, 02, 03...)
- Tabbed interface: click to reveal each service
- Accordion/expandable panels
- Horizontal scroll cards
- Bento grid (mixed card sizes)
- Services with full-width image per service
- Icon-focused minimal list
- Interactive cards with flip effect

**Portfolio/Gallery Variations:**
- Masonry grid (Pinterest-style)
- Carousel/slider with large images
- Full-width stacked project sections
- Filterable grid with category tabs
- Case study cards with extended hover info
- Before/after slider comparisons
- Numbered project list with side images
- Lightbox gallery with thumbnails

**Testimonials Variations:**
- Large single quote with avatar, cycled with JS
- Card grid (2-3 testimonials visible)
- Horizontal slider
- Full-width background image with quote overlay
- Minimal: just the quote text, small attribution
- Alternating left/right speech-bubble style

**Contact Variations:**
- Form + info cards side by side
- Split screen: dark info side + light form side
- Simple centered form
- Contact cards only (no form, just phone/email/address cards)
- Full-width map background with overlay form
- Floating form over hero-style background image
- Multi-step form with progress indicator

**Features/Why Us Variations:**
- Icon grid (2x3, 3x3)
- Numbered list with large step numbers
- Alternating image + text rows
- Comparison table
- Cards with illustrations or images
- Horizontal scrolling features bar
- Checklist-style with checkmark icons

### Step 3: Choose Typography

Pick ONE pairing. Use Google Fonts. **Never default to Inter + Inter every time.**

| Pair | Vibe |
|---|---|
| Playfair Display + Source Sans 3 | Elegant, editorial |
| Space Grotesk + DM Sans | Tech, modern |
| Outfit + Outfit | Geometric, friendly |
| Sora + Inter | Sharp, contemporary |
| Bitter + Inter | Warm, readable |
| Archivo + DM Sans | Strong, structured |
| Cormorant Garamond + Montserrat | Luxury, refined |
| Plus Jakarta Sans + Plus Jakarta Sans | Soft, rounded |
| Unbounded + Work Sans | Bold, creative |
| Crimson Pro + Karla | Classic, editorial |
| Manrope + Manrope | Clean, geometric |
| DM Serif Display + DM Sans | Modern serif + sans |
| Fraunces + Inter | Quirky, warm |
| Libre Baskerville + Raleway | Sophisticated |
| Bricolage Grotesque + Inter | Distinctive, fresh |
| Cabinet Grotesk + Satoshi | Premium, startup |
| General Sans + General Sans | Versatile, modern |

### Step 4: Choose Color Palette

Pick a specific palette - **NEVER default to blue+red or blue+green.** Generate exact hex values. **Colors MUST match the industry/business type.**

**Industry Color Guide (pick colors that feel right for the business):**

| Industry | Recommended Palettes | Avoid |
|---|---|---|
| Roofing / Construction / Trades | Slate, amber, deep red, charcoal, rust, earth browns | Pastels, pink, bright purple |
| Restaurant / Food | Warm reds, burnt orange, olive, cream, dark wood tones | Neon, cold blues |
| Medical / Health / Dental | Clean whites, soft blues, teal, sage green, light gray | Dark mode, loud colors |
| Law / Finance / Consulting | Navy, charcoal, gold/brass, dark green, ivory | Bright colors, playful tones |
| Beauty / Salon / Spa | Dusty rose, mauve, champagne, soft gold, cream, sage | Harsh reds, neon, dark |
| Tech / SaaS / Startup | Electric blue, purple, dark mode, cyan, minimal B&W | Earth tones, vintage |
| Real Estate | Navy + gold, forest green + cream, slate + warm white | Neon, bright playful |
| Fitness / Gym | Black + neon accent (lime, orange, red), dark + bold | Pastels, muted tones |
| Photography / Creative | B&W + one accent, dark + minimal, muted tones | Loud multi-color |
| Education / School | Warm blues, greens, friendly yellows, clean white | Dark mode, aggressive |
| Agriculture / Farm / Nature | Forest green, earth brown, warm cream, olive, sage | Cold corporate blues |
| Automotive / Garage | Charcoal, red, silver, dark steel, black + orange | Pastels, feminine tones |
| Wedding / Events | Champagne, blush, sage, ivory, gold, dusty blue | Harsh colors, neon |
| E-commerce / Retail | Depends on brand - clean whites, bold accent, modern | Overwhelming colors |
| Cleaning Services | Fresh blues, greens, white, light cyan, clean palette | Dark, muddy tones |
| Travel / Tourism | Ocean blues, sunset oranges, sandy beige, tropical | Corporate, dark mode |
| Pet Services | Friendly warm tones, greens, soft orange, cream | Aggressive, corporate |
| Bakery / Cafe | Warm browns, cream, dusty pink, soft orange, vanilla | Cold, dark, corporate |
| Architecture / Interior | Neutral grays, warm whites, black accents, natural | Bright neon, playful |

**Color Strategies:**
- **Monochromatic:** One hue in multiple shades (e.g., all forest greens, all deep navy, all terracotta)
- **Earth Tones:** Browns, tans, olive, forest green, warm cream
- **Bold Single Accent:** Neutral grays/whites + one strong color (coral, electric blue, emerald)
- **Dark Mode:** Near-black backgrounds + bright accent (amber, cyan, lime)
- **Warm Palette:** Terracotta, burnt orange, warm gray, cream
- **Cool Palette:** Steel blue, teal, slate, cool white
- **Muted Pastels:** Desaturated sage, dusty rose, stone, with dark text
- **Black & White + Accent:** Pure B&W with one pop color
- **Jewel Tones:** Deep emerald, sapphire, ruby, amethyst against dark/cream
- **Nordic:** Soft whites, light grays, muted blue, natural wood tones
- **Desert:** Sand, clay, burnt sienna, sage, warm white

### Step 5: Choose Animation Style

Pick ONE animation personality for the whole site. **Every section must animate, but the style must vary per website.**

**Animation Approaches** (pick one):
- **Fade & Rise:** Elements fade in and slide up with staggered delays. Smooth, universal.
- **Slide From Sides:** Alternating left/right entrances. Text slides from left, images from right.
- **Scale & Reveal:** Elements start small and scale up to full size with opacity change.
- **Clip Path Reveal:** Elements are masked and revealed with CSS clip-path animation (e.g., circle expanding, rectangle wiping).
- **Stagger Cascade:** Each child element animates one after another with noticeable delay. Like a waterfall of content.
- **Parallax Layers:** Background and foreground elements move at different scroll speeds. Depth effect.
- **Typewriter Headers:** Section headings type out letter by letter, body content fades in after.
- **Blur to Sharp:** Elements start blurred and gradually sharpen into focus.
- **Rotate In:** Cards and elements rotate slightly (2-5deg) as they enter and settle to 0.
- **Elastic Bounce:** Slight overshoot on entrance (elements bounce gently into place). Playful.
- **Split Text:** Headlines split and animate word-by-word or line-by-line with stagger.
- **Draw On:** SVG icons and borders animate their stroke as if being drawn. Pairs with clip reveals.

**Animation Technical Rules:**
- **NEVER nest animation classes on the same element** — an element should only have ONE animation class (e.g., `fade-up` OR `stagger-item`, never both). Nesting causes broken/conflicting animations.
- Use Intersection Observer for scroll-triggered animations
- Use CSS transitions and @keyframes (not JS-based animation loops)
- Animations should be 0.4s-0.8s duration, ease or cubic-bezier timing
- Stagger delays: 0.05s-0.15s between children
- Never animate the same way for all sections - vary the entrance direction, timing, or style per section
- Add subtle hover animations to interactive elements (cards, buttons, links)
- Navigation should have smooth transitions (background change on scroll, link hover effects)
- Consider adding a subtle page-load animation (logo reveal, hero content cascade)
- **Respect `prefers-reduced-motion`** - disable animations for users who have motion sensitivity enabled (see Browser Compatibility section)

**Cross-Browser Animation Compatibility:**

| Animation Property | Chrome | Firefox | Safari | Edge | iOS Safari | Notes |
|---|---|---|---|---|---|---|
| `transform` (translate, scale, rotate) | All | All | All | All | All | Fully safe everywhere |
| `opacity` | All | All | All | All | All | Fully safe everywhere |
| `transition` | All | All | All | All | All | Fully safe everywhere |
| `@keyframes` | All | All | All | All | All | Fully safe everywhere |
| `filter: blur()` | 53+ | 35+ | 9.1+ | 12+ | 9.3+ | Safe for modern browsers. Add `-webkit-filter` for older Safari |
| `clip-path` | 55+ | 54+ | 13.1+ | 79+ | 13.4+ | **Needs fallback.** Older Safari/iOS needs `-webkit-clip-path`. Add opacity fallback |
| `backdrop-filter` | 76+ | 103+ | 9+ | 79+ | 9+ | **Firefox was late.** Always add fallback background color |
| `scroll-behavior: smooth` | 61+ | 36+ | 15.4+ | 79+ | 15.4+ | Older Safari needs JS fallback (scrollIntoView) |
| `IntersectionObserver` | 58+ | 55+ | 12.1+ | 16+ | 12.2+ | Safe for all modern browsers |
| `aspect-ratio` | 88+ | 89+ | 15+ | 88+ | 15+ | Use padding-top hack as fallback for very old browsers |
| `gap` (flexbox) | 84+ | 63+ | 14.1+ | 84+ | 14.5+ | Safe for modern browsers |
| `CSS Grid` | 57+ | 52+ | 10.1+ | 16+ | 10.3+ | Fully safe |

**SAFE animations (use freely - work everywhere):**
- `opacity` + `transform` (translate, scale, rotate) - THE safest combo, hardware-accelerated
- `@keyframes` with `transform` and `opacity`
- `transition` on any property
- `box-shadow` transitions (for hover effects)
- `color` and `background-color` transitions
- `border-color` transitions
- `width`/`height` transitions (but less performant than transform)

**USE WITH FALLBACK (add vendor prefixes + fallback):**
- `clip-path` - always add `-webkit-clip-path` AND an `opacity` fallback
- `backdrop-filter` - always add `-webkit-backdrop-filter` AND a solid `background` fallback
- `filter: blur()` - add `-webkit-filter`

**Vendor Prefix & Fallback Rules:**
```css
/* clip-path - ALWAYS add webkit prefix + opacity fallback */
.reveal-circle {
  opacity: 0; /* fallback for browsers without clip-path */
  -webkit-clip-path: circle(0% at 50% 50%);
  clip-path: circle(0% at 50% 50%);
  transition: opacity 0.8s ease, -webkit-clip-path 0.8s ease, clip-path 0.8s ease;
}
.reveal-circle.visible {
  opacity: 1;
  -webkit-clip-path: circle(100% at 50% 50%);
  clip-path: circle(100% at 50% 50%);
}

/* backdrop-filter - ALWAYS add webkit prefix + solid background fallback */
.navbar.scrolled {
  background: rgba(255, 255, 255, 0.95); /* solid fallback if backdrop-filter fails */
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
}

/* filter blur - add webkit prefix */
.blur-in {
  opacity: 0;
  -webkit-filter: blur(10px);
  filter: blur(10px);
  transition: opacity 0.7s ease, -webkit-filter 0.7s ease, filter 0.7s ease;
}
.blur-in.visible {
  opacity: 1;
  -webkit-filter: blur(0);
  filter: blur(0);
}

/* Respect prefers-reduced-motion - REQUIRED */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }

  .slide-left, .slide-right, .fade-up, .scale-in,
  .blur-in, .rotate-in, .reveal-circle, .clip-rect {
    opacity: 1 !important;
    transform: none !important;
    -webkit-filter: none !important;
    filter: none !important;
    -webkit-clip-path: none !important;
    clip-path: none !important;
  }
}

/* Smooth scroll JS fallback for older Safari */
/* Use this instead of relying only on CSS scroll-behavior */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', (e) => {
    const target = document.querySelector(anchor.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
```

**Advanced Animation Techniques (all cross-browser safe):**
```css
/* Slide from side - SAFE everywhere */
.slide-left {
  opacity: 0;
  transform: translateX(-60px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.slide-left.visible {
  opacity: 1;
  transform: translateX(0);
}

.slide-right {
  opacity: 0;
  transform: translateX(60px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.slide-right.visible {
  opacity: 1;
  transform: translateX(0);
}

/* Fade up - SAFE everywhere */
.fade-up {
  opacity: 0;
  transform: translateY(40px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.fade-up.visible {
  opacity: 1;
  transform: translateY(0);
}

/* Scale up - SAFE everywhere */
.scale-in {
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 0.5s ease, transform 0.5s ease;
}
.scale-in.visible {
  opacity: 1;
  transform: scale(1);
}

/* Rotate settle - SAFE everywhere */
.rotate-in {
  opacity: 0;
  transform: rotate(-3deg) translateY(30px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.rotate-in.visible {
  opacity: 1;
  transform: rotate(0) translateY(0);
}

/* Clip-path reveal - NEEDS webkit prefix */
.clip-reveal {
  opacity: 0;
  -webkit-clip-path: circle(0% at 50% 50%);
  clip-path: circle(0% at 50% 50%);
  transition: opacity 0.8s ease, -webkit-clip-path 0.8s ease, clip-path 0.8s ease;
}
.clip-reveal.visible {
  opacity: 1;
  -webkit-clip-path: circle(100% at 50% 50%);
  clip-path: circle(100% at 50% 50%);
}

/* Clip rectangle wipe - NEEDS webkit prefix */
.clip-rect {
  opacity: 0;
  -webkit-clip-path: inset(0 100% 0 0);
  clip-path: inset(0 100% 0 0);
  transition: opacity 0.8s ease, -webkit-clip-path 0.8s ease, clip-path 0.8s ease;
}
.clip-rect.visible {
  opacity: 1;
  -webkit-clip-path: inset(0 0 0 0);
  clip-path: inset(0 0 0 0);
}

/* Blur to sharp - NEEDS webkit prefix */
.blur-in {
  opacity: 0;
  -webkit-filter: blur(10px);
  filter: blur(10px);
  transition: opacity 0.7s ease, -webkit-filter 0.7s ease, filter 0.7s ease;
}
.blur-in.visible {
  opacity: 1;
  -webkit-filter: blur(0);
  filter: blur(0);
}

/* Stagger children - SAFE everywhere */
.stagger-parent .stagger-item {
  opacity: 0;
  transform: translateY(25px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}
.stagger-parent.visible .stagger-item {
  opacity: 1;
  transform: translateY(0);
}
.stagger-parent.visible .stagger-item:nth-child(1) { transition-delay: 0.05s; }
.stagger-parent.visible .stagger-item:nth-child(2) { transition-delay: 0.1s; }
.stagger-parent.visible .stagger-item:nth-child(3) { transition-delay: 0.15s; }
.stagger-parent.visible .stagger-item:nth-child(4) { transition-delay: 0.2s; }
.stagger-parent.visible .stagger-item:nth-child(5) { transition-delay: 0.25s; }
.stagger-parent.visible .stagger-item:nth-child(6) { transition-delay: 0.3s; }

/* Elastic bounce - SAFE (uses keyframes) */
@keyframes bounceIn {
  0% { opacity: 0; transform: scale(0.8) translateY(20px); }
  60% { opacity: 1; transform: scale(1.03) translateY(-4px); }
  80% { transform: scale(0.98) translateY(2px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}
.bounce-in.visible {
  animation: bounceIn 0.7s cubic-bezier(0.36, 0.07, 0.19, 0.97) forwards;
}

/* Draw-on SVG stroke - SAFE everywhere */
.draw-on svg path,
.draw-on svg line,
.draw-on svg circle {
  stroke-dasharray: 1000;
  stroke-dashoffset: 1000;
  transition: stroke-dashoffset 1.5s ease;
}
.draw-on.visible svg path,
.draw-on.visible svg line,
.draw-on.visible svg circle {
  stroke-dashoffset: 0;
}

/* Counter animation for stats - SAFE (pure JS) */
function animateCounters() {
  document.querySelectorAll('[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    let current = 0;
    const duration = 2000;
    const stepTime = 16;
    const steps = duration / stepTime;
    const increment = target / steps;
    const timer = setInterval(() => {
      current += increment;
      if (current >= target) { current = target; clearInterval(timer); }
      el.textContent = Math.floor(current) + suffix;
    }, stepTime);
  });
}
```

**Performance Tips for Animations:**
- Only animate `transform` and `opacity` when possible - these are GPU-accelerated and won't cause layout reflow
- Use `will-change: transform` on elements that will animate (but remove after animation completes)
- Avoid animating `width`, `height`, `top`, `left`, `margin`, `padding` - these cause expensive reflows
- Use `transform: translateZ(0)` or `will-change: transform` to force GPU layer for smoother animations
- Limit simultaneous animations - don't animate 50 elements at once, stagger them

---

## ABSOLUTE RULES (NEVER BREAK THESE)

1. **NEVER use emojis anywhere** - not as icons, not as decorations, not in any context. Use inline SVG icons only.
2. **NEVER use gradient colors as decorative fills** - solid colors only. No linear-gradient or radial-gradient for buttons, backgrounds, or text. (Transparent overlays on images like hero/CTA darkening gradients are OK. Subtle radial-gradient for background textures with near-transparent values is OK.)
3. **ALL images must be HTTPS URLs, local files, or generated SVG/CSS visuals** - see Images section.
4. **Use lots of high-quality visuals** - hero backgrounds, section images, card images, galleries. The site should be image-rich.
5. **Professional, varied animations** - every section must animate in. Use the chosen animation style, not just basic fade-up every time.
6. **Each website MUST look different** - different layout, colors, typography, animations. State your design choices before coding.
7. **ALL text content MUST come from content.json** - absolutely nothing hardcoded in HTML. The HTML file is just a shell with containers.
8. **The website must be pixel-perfect** - spacing, alignment, typography, colors. It should look finished, not like a prototype.
9. **Section IDs MUST follow `{type}_{number}` pattern** - e.g. `hero_1`, `contact_1`, `services_grid_1`. The HTML `id` MUST match the content.json `id` exactly. This is required for dashboard section navigation.
10. **Contact form MUST have `id="contact-form"`** with inputs named exactly `name`, `email`, `phone`, `message`. This is required for the auto-injected contact handler.
11. **Navigation MUST use `<nav>` tag** with `id="nav_1"` and a proper `</nav>` closing tag. Dashboard scripts are injected after `</nav>`.
12. **NEVER manually include dashboard scripts** - `proposal-widget.js`, `contact-handler.js`, and `editor-helper.js` are auto-injected at deploy time. Do not add them to the HTML.
13. **Read `website-structure-rules.md`** for full dashboard integration requirements (data attributes, content.json schema, section types).

---

## TECH STACK

- **HTML5** + **CSS3** + **JavaScript**
- **Tailwind CSS via CDN** is allowed and encouraged: `<script src="https://cdn.tailwindcss.com"></script>`
- **External CDN libraries** are allowed and encouraged - pick the right ones for the design
- **No build tools** (webpack, vite, etc.) - everything runs directly in browser
- **No frameworks** (React, Vue, Angular) - vanilla JS only
- All content loaded dynamically from `content.json`

### CDN Library Toolkit

Pick libraries that match your design direction. You don't need all of them - choose 3-6 that make sense.

**CSS Framework:**
```html
<!-- Tailwind CSS (recommended) -->
<script src="https://cdn.tailwindcss.com"></script>
```

**Icons (pick one):**
```html
<!-- Lucide Icons - 1500+ clean icons (recommended) -->
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
<!-- Usage: <i data-lucide="home"></i> then lucide.createIcons() -->

<!-- Phosphor Icons - 7000+ icons, 6 weights -->
<script src="https://unpkg.com/@phosphor-icons/web"></script>
<!-- Usage: <i class="ph ph-house"></i> -->

<!-- Tabler Icons - 5000+ icons -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css">
<!-- Usage: <i class="ti ti-home"></i> -->

<!-- Heroicons (via SVG only - copy from heroicons.com) -->

<!-- Bootstrap Icons -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
<!-- Usage: <i class="bi bi-house"></i> -->
```

**Animation Libraries:**
```html
<!-- GSAP - Professional-grade animations (RECOMMENDED - best cross-browser support) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
<!--
  WHY GSAP:
  - Works identically on Chrome, Firefox, Safari, Edge, iOS Safari — zero vendor prefix headaches
  - Handles all transform, opacity, clip-path, filter animations with automatic prefixing
  - ScrollTrigger replaces IntersectionObserver with more control (pin, scrub, parallax)
  - Timeline sequencing for complex multi-step animations
  - Stagger built-in: gsap.from('.card', { y: 40, opacity: 0, stagger: 0.1 })
  - Free for commercial use (standard plugins)

  BASIC USAGE:
  gsap.registerPlugin(ScrollTrigger);
  gsap.from('.fade-up', { y: 50, opacity: 0, duration: 0.8, scrollTrigger: { trigger: '.fade-up', start: 'top 85%' }});
  gsap.from('.card', { y: 30, opacity: 0, stagger: 0.1, scrollTrigger: { trigger: '.cards-container', start: 'top 80%' }});
-->

<!-- AOS - Simple scroll animations (quick & easy) -->
<link rel="stylesheet" href="https://unpkg.com/aos@next/dist/aos.css">
<script src="https://unpkg.com/aos@next/dist/aos.js"></script>
<!-- Usage: <div data-aos="fade-up" data-aos-delay="100"> -->

<!-- Splitting.js - Text splitting for character/word animations -->
<link rel="stylesheet" href="https://unpkg.com/splitting/dist/splitting.css">
<script src="https://unpkg.com/splitting/dist/splitting.min.js"></script>
<!-- Usage: Splitting({ target: '.split-text', by: 'chars' }) -->

<!-- Typed.js - Typewriter effect -->
<script src="https://unpkg.com/typed.js@2.1.0/dist/typed.umd.js"></script>
<!-- Usage: new Typed('#element', { strings: ['Text 1', 'Text 2'], typeSpeed: 50 }) -->

<!-- CountUp.js - Animated number counters -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/countup.js/2.8.0/countUp.umd.min.js"></script>
<!-- Usage: new countUp.CountUp('elementId', 500).start() -->

<!-- Vanilla-tilt.js - 3D tilt effect on cards -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/vanilla-tilt/1.8.1/vanilla-tilt.min.js"></script>
<!-- Usage: VanillaTilt.init(document.querySelectorAll('.tilt-card'), { max: 8, speed: 400, glare: true }) -->
```

**Smooth Scrolling:**
```html
<!-- Lenis - Butter-smooth scrolling (premium feel) -->
<script src="https://unpkg.com/lenis@1.1.18/dist/lenis.min.js"></script>
<!-- Usage:
const lenis = new Lenis();
function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
requestAnimationFrame(raf);
-->
```

**Carousels & Sliders:**
```html
<!-- Swiper - Best carousel library -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css">
<script src="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js"></script>

<!-- Splide - Lightweight alternative -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@splidejs/splide@4.1.4/dist/css/splide.min.css">
<script src="https://cdn.jsdelivr.net/npm/@splidejs/splide@4.1.4/dist/js/splide.min.js"></script>
```

**Lightboxes & Image Viewers:**
```html
<!-- GLightbox - Modern lightbox -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/glightbox/dist/css/glightbox.min.css">
<script src="https://cdn.jsdelivr.net/npm/glightbox/dist/js/glightbox.min.js"></script>
<!-- Usage: const lightbox = GLightbox({ selector: '.glightbox' }) -->

<!-- LightGallery - Feature-rich gallery -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lightgallery@2.7.2/css/lightgallery-bundle.min.css">
<script src="https://cdn.jsdelivr.net/npm/lightgallery@2.7.2/lightgallery.umd.js"></script>
```

**Parallax & Scroll Effects:**
```html
<!-- Rellax.js - Lightweight parallax -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/rellax/1.12.1/rellax.min.js"></script>
<!-- Usage: <div class="rellax" data-rellax-speed="-2">Slow element</div> -->
<!-- new Rellax('.rellax') -->

<!-- Simple Parallax - Image parallax -->
<script src="https://cdn.jsdelivr.net/npm/simple-parallax-js@5.5.1/dist/simpleParallax.min.js"></script>
<!-- Usage: new simpleParallax(document.querySelectorAll('.parallax-img'), { scale: 1.3 }) -->
```

**Maps:**
```html
<!-- Leaflet.js - Interactive maps (free, no API key) -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<!-- Great for contact sections with a map -->
```

**Utility:**
```html
<!-- Masonry Layout (if CSS columns aren't enough) -->
<script src="https://unpkg.com/masonry-layout@4.2.2/dist/masonry.pkgd.min.js"></script>

<!-- imagesLoaded - Detect when images finish loading -->
<script src="https://unpkg.com/imagesloaded@5.0.0/imagesloaded.pkgd.min.js"></script>
```

### Recommended Combos by Design Style

| Design Direction | Recommended Libraries |
|---|---|
| Dark & Premium | Tailwind + Lucide + GSAP + ScrollTrigger + Lenis + Vanilla-tilt |
| Minimal & Spacious | Tailwind + Phosphor + GSAP + ScrollTrigger + Lenis |
| Bold & Editorial | Tailwind + Lucide + GSAP + ScrollTrigger + Splitting.js + Typed.js |
| Warm & Organic | Tailwind + Lucide + GSAP + ScrollTrigger + Swiper |
| Sharp & Corporate | Tailwind + Lucide + GSAP + ScrollTrigger |
| Creative & Playful | Tailwind + Phosphor + GSAP + ScrollTrigger + Splitting.js + Vanilla-tilt |
| Rustic & Craft | Tailwind + Tabler Icons + GSAP + ScrollTrigger + Simple Parallax |
| Tech & Modern | Tailwind + Lucide + GSAP + ScrollTrigger + CountUp + Lenis |
| Scandinavian Clean | Tailwind + Lucide + GSAP + ScrollTrigger + GLightbox |
| Portfolio/Gallery heavy | Tailwind + Lucide + GSAP + ScrollTrigger + Swiper + GLightbox |

**GSAP + ScrollTrigger is the default for ALL designs.** It handles cross-browser animation perfectly and eliminates the need for manual IntersectionObserver + CSS transition classes. Only skip GSAP if you have a strong reason.

### When to use Tailwind vs Custom CSS:
- Use **Tailwind** for layout, spacing, responsive, typography, flexbox/grid, colors
- Use **custom CSS** (in `<style>` or `style.css`) for animations, complex hover effects, decorative elements, things Tailwind can't do cleanly
- You can mix both. Customize Tailwind config inline:
```html
<script>
  tailwind.config = {
    theme: {
      extend: {
        colors: {
          primary: '#2d5a27',
          secondary: '#1a1a1a',
          accent: '#d4a843',
        },
        fontFamily: {
          heading: ['Playfair Display', 'serif'],
          body: ['Source Sans 3', 'sans-serif'],
        }
      }
    }
  }
</script>
```

---

## FILE STRUCTURE

### Single Page Website
```
project-folder/
  index.html        - Main page (loads Tailwind + libraries via CDN)
  content.json      - All editable content (REQUIRED - single source of truth)
  style.css         - Custom animations + styles Tailwind can't handle (optional if using Tailwind)
  script.js         - Content loader + animations + interactions
```

### Multi-Page Website
```
project-folder/
  index.html        - Home page
  content.json      - Shared content for all pages (REQUIRED)
  style.css         - Shared custom styles
  script.js         - Shared content loader + animations
  about.html        - Subpage
  services.html     - Subpage
  gallery.html      - Subpage
  contact.html      - Subpage
```

For multi-page: each HTML file loads the SAME `content.json` and `script.js`. Each page filters sections by the `page` field.

---

## CONTENT.JSON FORMAT (REQUIRED - NEVER SKIP)

This is the **single source of truth**. Every piece of visible text, every image URL, every link MUST come from this file. The HTML and JS are just renderers.

```json
{
  "site_name": "Business Name",
  "site_url": "https://example.com",
  "schema_version": "1.0",
  "theme": {
    "primary": "#2d5a27",
    "secondary": "#1a1a1a",
    "accent": "#d4a843",
    "dark": "#0a0a0a",
    "light": "#faf9f6",
    "text": "#333333",
    "text_light": "#888888"
  },
  "fonts": {
    "heading": "Playfair Display",
    "body": "Source Sans 3"
  },
  "sections": [
    {
      "type": "hero",
      "id": "hero_1",
      "label": "Hero Banner",
      "order": 1,
      "page": "home",
      "fields": {
        "headline": "Your Main Headline",
        "subheadline": "Supporting text goes here",
        "cta_text": "Get Started",
        "cta_url": "tel:+421900000000",
        "background_image": "https://images.unsplash.com/photo-xxxxx?w=1920&q=80"
      }
    }
  ]
}
```

### Content.json Rules

**Theme & Fonts in content.json:** Include `theme` and `fonts` objects so the dashboard can allow color/font changes. Your JS should read these and apply them (via CSS custom properties or Tailwind config).

**Section Structure:**
| Field | Required | Description |
|---|---|---|
| `type` | Yes | Section type identifier |
| `id` | Yes | Unique ID. Format: `type_number` (e.g., `hero_1`, `services_1`) |
| `label` | Yes | Human-readable name for dashboard (e.g., "Hero Banner") |
| `order` | Yes | Display order (1, 2, 3...) |
| `page` | Multi-page only | Which page this section belongs to |
| `fields` | Yes | Object containing ALL editable content |

**Repeater Items** - arrays inside `fields`. Every item MUST have a unique `id`:
```json
"items": [
  { "id": "svc_1", "title": "Service One", "description": "...", "icon": "wrench", "image": "https://..." },
  { "id": "svc_2", "title": "Service Two", "description": "...", "icon": "hammer", "image": "https://..." }
]
```

**What MUST be in content.json (not hardcoded):**
- Every headline, subheadline, paragraph of text
- Every button label and URL
- Every image URL or path
- Every navigation link label and URL
- Every list item (services, features, team members, etc.)
- Contact information (phone, email, address)
- Footer text, copyright, links
- Social media URLs
- Any text visible on the page

**What can stay in HTML/CSS/JS:**
- Structural HTML containers (empty, filled by JS)
- CSS styles, classes, animations
- JavaScript logic, event handlers
- SVG icon definitions
- Layout structure

---

## HTML STRUCTURE

Every editable element must have `data-section` and `data-field` attributes for dashboard integration:

```html
<section id="hero_1" data-section="hero_1">
  <h1 data-section="hero_1" data-field="headline"></h1>
  <p data-section="hero_1" data-field="subheadline"></p>
  <a data-section="hero_1" data-field="cta_text" href="#"></a>
</section>
```

For repeater items, add `data-item`:
```html
<div data-section="services_1" data-field="items" data-item="svc_1">
  <h3 data-field="title"></h3>
  <p data-field="description"></p>
</div>
```

**Important:** HTML elements should start EMPTY (or with placeholder text). The JS content loader fills them from content.json. This ensures content.json is truly the single source of truth.

---

## JAVASCRIPT - CONTENT LOADER

The script MUST:
1. Fetch `content.json` on DOMContentLoaded
2. Apply theme colors and fonts from the `theme` and `fonts` objects
3. Find section containers by ID
4. Populate ALL fields using `data-field` selectors
5. Dynamically create repeater items (cards, list items, etc.)
6. Set up all event listeners (mobile menu, accordions, tabs, etc.)
7. Initialize scroll animations
8. For multi-page: filter sections by `document.body.dataset.page`

```javascript
document.addEventListener('DOMContentLoaded', () => {
  fetch('content.json')
    .then(res => res.json())
    .then(data => {
      // Apply theme
      if (data.theme) applyTheme(data.theme);

      // Filter & sort sections
      const currentPage = document.body.dataset.page || 'home';
      const sections = data.sections
        .filter(s => !s.page || s.page === currentPage || s.type === 'navigation' || s.type === 'footer')
        .sort((a, b) => a.order - b.order);

      sections.forEach(section => renderSection(section));

      // Init icons
      if (window.lucide) lucide.createIcons();

      // Init GSAP animations (preferred) or fallback to IntersectionObserver
      if (window.gsap) {
        initGSAPAnimations();
      } else {
        initAnimations(); // fallback
      }

      initNavbar();
      initMobileMenu();
      initSmoothScroll();
      initScrollTopButton();
      initContactForm();

      // Remove loader
      const loader = document.getElementById('page-loader');
      if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => loader.remove(), 500);
      }
    });
});

function applyTheme(theme) {
  const root = document.documentElement;
  Object.entries(theme).forEach(([key, value]) => {
    root.style.setProperty(`--${key.replace(/_/g, '-')}`, value);
  });
}
```

### GSAP Animation Patterns (Recommended)

When using GSAP + ScrollTrigger, you don't need CSS animation classes (`fade-up`, `slide-right`, etc.) or IntersectionObserver. GSAP handles everything with better cross-browser support.

```javascript
function initGSAPAnimations() {
  gsap.registerPlugin(ScrollTrigger);

  // Fade up - sections, headings, paragraphs
  gsap.utils.toArray('.fade-up').forEach(el => {
    gsap.from(el, {
      y: 50, opacity: 0, duration: 0.8,
      ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 85%' }
    });
  });

  // Slide from right - images, side content
  gsap.utils.toArray('.slide-right').forEach(el => {
    gsap.from(el, {
      x: 60, opacity: 0, duration: 0.8,
      ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 85%' }
    });
  });

  // Stagger children - card grids, feature lists, gallery items
  gsap.utils.toArray('.stagger-parent').forEach(parent => {
    const items = parent.querySelectorAll('.stagger-item');
    if (!items.length) return;
    gsap.from(items, {
      y: 30, opacity: 0, duration: 0.5,
      stagger: 0.1,
      ease: 'power2.out',
      scrollTrigger: { trigger: parent, start: 'top 80%' }
    });
  });

  // Scale in - forms, CTA sections
  gsap.utils.toArray('.scale-in').forEach(el => {
    gsap.from(el, {
      scale: 0.95, opacity: 0, duration: 0.6,
      ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 85%' }
    });
  });

  // Counter animations
  gsap.utils.toArray('[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const obj = { val: 0 };
    gsap.to(obj, {
      val: target, duration: 2, ease: 'power1.out',
      scrollTrigger: { trigger: el, start: 'top 85%' },
      onUpdate: () => { el.textContent = Math.floor(obj.val) + suffix; }
    });
  });

  // Respect prefers-reduced-motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    ScrollTrigger.getAll().forEach(t => t.kill());
    gsap.globalTimeline.clear();
  }
}
```

**Key advantage:** GSAP auto-prefixes everything (`clip-path`, `filter`, `transform`) so you never worry about `-webkit-` prefixes. It also handles Safari quirks automatically.

**When using GSAP, your CSS animation classes become optional.** You can still define them for the initial hidden state (`opacity: 0; transform: translateY(50px)`) or let GSAP handle the initial state with `gsap.from()` which sets the start values automatically.

### Fallback (IntersectionObserver)

If not using GSAP, fall back to the CSS class + IntersectionObserver pattern:

```javascript
function initAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.fade-up, .slide-right, .slide-left, .scale-in, .stagger-parent')
    .forEach(el => observer.observe(el));
}
```

---

## IMAGES

You have THREE options for images. Use whichever fits best for each image:

### Option 1: URL Links (for photos and backgrounds)
Use high-quality stock photo URLs:
```json
"image": "https://images.unsplash.com/photo-xxxxx?w=1200&q=80"
```
Sources: Unsplash (`images.unsplash.com`), Pexels (`images.pexels.com`), Pixabay

**URL image rules:**
- Add size parameters: `?w=1920&q=80` for hero, `?w=800&q=80` for cards
- Use `loading="lazy"` on all images except the hero
- Choose images that actually match the business/industry
- Prefer images with consistent tone/mood that matches the chosen design direction

### Option 2: Local Files (when client provides images)
If client/user provides their own images or if images are saved locally:
```json
"image": "./images/project-1.jpg"
```
Or reference them directly:
```json
"image": "photos/team-photo.jpg"
```
This is fine when the client has their own photography.

### Option 3: AI-Generated / SVG / CSS Visuals
For decorative elements, patterns, illustrations, or when stock photos don't fit:
- Inline SVG illustrations
- CSS-generated patterns and shapes
- Abstract decorative backgrounds
- Geometric section dividers
- Animated SVG graphics

**General Image Rules:**
- Use LOTS of images - the site should be visually rich
- Hero must have a strong visual (image, pattern, or illustration)
- Service/feature cards look better with images
- Gallery sections need 6+ images minimum
- All `<img>` tags need `alt` attributes

---

## ICONS

**Option 1: Lucide Icons via CDN (recommended)**
```html
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
```
Use in HTML:
```html
<i data-lucide="wrench"></i>
```
Initialize in JS:
```javascript
lucide.createIcons();
```
This is the easiest and cleanest approach. Lucide has 1000+ icons.

**Option 2: Inline SVGs**
Map icon names to SVG strings in JavaScript. Good when you want full control.

**Never use emojis as icons. Ever.**

---

## DESIGN QUALITY CHECKLIST

These details separate a professional site from a template:

### Spacing & Rhythm
- Consistent vertical rhythm (same spacing multiples: 8px, 16px, 24px, 32px, 48px, 64px, 96px)
- Generous section padding (80px-120px vertical on desktop, 48px-64px on mobile)
- Cards should have consistent internal padding (24px-32px)
- Don't cram elements together - let them breathe

### Typography
- Clear hierarchy: hero h1 (48-72px) > section h2 (32-48px) > card h3 (20-28px) > body (16-18px) > small (14px)
- Line height: 1.1-1.2 for headings, 1.6-1.8 for body text
- Letter spacing: -0.5px to -1px for large headings (tighter), 0 for body, 1-3px for labels/badges (wider)
- Font weight contrast: bold headings (700-800) vs regular body (400)
- Limit line width to 60-70 characters for readability

### Visual Polish
- Hover effects on ALL interactive elements (buttons, cards, links, images)
- Subtle box-shadows on cards (not too strong): `0 4px 20px rgba(0,0,0,0.08)`
- **Keep button/CTA shadows very light** — use `shadow-sm` or `0 2px 8px rgba(accent,0.15)` max. Heavy button shadows look dated and cheap.
- Border-radius consistency: pick one radius and use it everywhere (8px, 12px, or 16px)
- Image aspect ratios should be consistent within a section
- Buttons should have padding of at least 14px 28px, never look too small
- Active/focus states for form inputs and buttons (accessibility)

### Color Usage
- Primary color: CTAs, active states, key highlights (used sparingly - 10-20% of the page)
- Secondary color: headings, navigation, footer backgrounds
- Accent: small highlights, badges, icon backgrounds
- Text color: body text, should have enough contrast (WCAG AA minimum)
- Light: page backgrounds, card backgrounds, alternate sections
- Use alternating section backgrounds (white/light/white/dark) to create visual rhythm

### Responsive Details
- Navigation collapses to hamburger menu at 768px
- Grid columns reduce: 4 cols > 2 cols > 1 col
- Font sizes scale down proportionally on mobile
- Images stack vertically on mobile
- Section padding reduces on mobile
- Touch-friendly tap targets (minimum 44px)
- No horizontal scroll on any screen size

### Micro-Interactions (pick 3-5 per site)
- Button hover: subtle lift (translateY -2px) + shadow increase
- Card hover: lift + shadow + subtle scale (1.02)
- Image hover: zoom inside container (overflow hidden + scale 1.05-1.1)
- Link hover: color change + underline animation (width from 0 to 100%)
- Navigation link: active indicator (dot, underline, or color change)
- Form input focus: border color change + subtle glow/shadow
- Icon hover: color change or subtle rotation
- Scroll-to-top button that appears after scrolling
- Navbar background change on scroll (transparent > solid)
- **Navbar text color switching** — when navbar is transparent over a dark hero image, nav links/logo should be white. On scroll (solid bg), they switch to dark. Use a MutationObserver to also catch dynamically rendered links.
- Smooth scroll for anchor links

---

## SECTION TYPES REFERENCE

Pick 7-12 sections that make sense for the business. **Vary which ones you use and their order.**

| Type | Description | Key Fields |
|---|---|---|
| `navigation` | Top nav bar | `logo_text` or `logo_image`, `links[]`, `cta_text`, `cta_url` |
| `hero` | Main banner | `headline`, `subheadline`, `cta_text`, `cta_url`, `background_image` |
| `about` | About section | `headline`, `text`, `image`, `stats[]` |
| `services_grid` | Service cards (bento/grid) | `headline`, `subheadline`, `items[]` with `title`, `description`, `icon`, `image`, `featured` |
| `services_list` | Services zigzag (alternating image+text rows) | `headline`, `items[]` with `number`, `title`, `description`, `image` |
| `gallery` | Image gallery | `headline`, `items[]` with `image`, `caption`, `category` |
| `testimonials` | Reviews/quotes | `headline`, `items[]` with `name`, `text`, `role`, `company`, `avatar`, `rating` |
| `faq` | FAQ accordion | `headline`, `items[]` with `question`, `answer` |
| `cta_banner` | Call-to-action | `headline`, `text`, `cta_text`, `cta_url`, `background_image` |
| `pricing` | Pricing plans | `headline`, `items[]` with `name`, `price`, `period`, `features[]`, `cta_text`, `featured` |
| `team` | Team members | `headline`, `items[]` with `name`, `role`, `image`, `bio` |
| `contact` | Contact info + form | `headline`, `address`, `phone`, `email`, `working_hours` |
| `footer` | Page footer | `copyright_text`, `description`, `links[]`, `social[]` |
| `stats` | Number counters | `headline`, `items[]` with `value`, `label`, `suffix` |
| `features` | Feature highlights | `headline`, `items[]` with `title`, `description`, `icon`, `image` |
| `timeline` | Process/history | `headline`, `items[]` with `title`, `description`, `year` or `step` |
| `portfolio` | Project showcase | `headline`, `items[]` with `title`, `description`, `image`, `category`, `url` |
| `logos` | Partner/client logos | `headline`, `items[]` with `name`, `image`, `url` |
| `video` | Video embed | `headline`, `description`, `video_url`, `thumbnail` |
| `text_block` | Rich text content | `headline`, `content` |
| `process` | How it works steps | `headline`, `items[]` with `step`, `title`, `description`, `icon` |
| `comparison` | Before/after | `headline`, `items[]` with `before_image`, `after_image`, `caption` |
| `map` | Service area | `headline`, `text`, `areas[]` with `name` |
| `blog_preview` | Blog/news cards | `headline`, `items[]` with `title`, `excerpt`, `image`, `date`, `url` |

---

## MULTI-PAGE SETUP

For websites with subpages, add `data-page` to each HTML file's body:

```html
<body data-page="home">
<body data-page="about">
<body data-page="services">
```

Navigation and footer sections should NOT have a `page` field - they appear on all pages.

---

## PAGE LOADING SCREEN (RECOMMENDED)

Add a brief loading screen that hides the page until content.json is loaded and rendered. This prevents the flash of empty containers.

```html
<!-- Add as first child of <body> -->
<div id="page-loader" style="position:fixed;inset:0;z-index:9999;background:#0a0a0a;display:flex;align-items:center;justify-content:center;transition:opacity 0.5s ease;">
  <div style="width:40px;height:40px;border:3px solid rgba(255,255,255,0.1);border-top-color:#d4a843;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
</div>
<style>@keyframes spin{to{transform:rotate(360deg)}}</style>
```

```javascript
// In your content loader, after all rendering is done:
const loader = document.getElementById('page-loader');
if (loader) {
  loader.style.opacity = '0';
  setTimeout(() => loader.remove(), 500);
}
```

Match the loader background color and spinner accent to the site's theme.

---

## SEO & META TAGS

Every page should have proper meta tags. Include these in the `<head>`:

```html
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="[Business name] - [what they do] in [location]. [Key service].">
<meta name="keywords" content="[service 1], [service 2], [location], [industry]">
<meta name="author" content="[Business name]">

<!-- Open Graph (Facebook, LinkedIn) -->
<meta property="og:title" content="[Business Name] | [Tagline]">
<meta property="og:description" content="[Short description of the business]">
<meta property="og:image" content="[URL to a hero or logo image]">
<meta property="og:type" content="website">

<!-- Favicon -->
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%23d4a843'/><text x='50' y='68' font-size='50' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'>KP</text></svg>">
```

**Tip:** You can generate inline SVG favicons using the technique above - no need for external favicon files. Just change the initials and color to match the business.

---

## ACCESSIBILITY BASICS

Don't skip these - they affect usability and SEO:

1. **Color contrast** - Text must be readable against its background (WCAG AA: 4.5:1 for normal text, 3:1 for large text)
2. **Alt text on all images** - Descriptive alt text, not just "image"
3. **Semantic HTML** - Use `<nav>`, `<main>`, `<section>`, `<article>`, `<footer>` properly
4. **Focus states** - All interactive elements must have visible focus outlines (don't use `outline: none` without a replacement)
5. **Aria labels** - Hamburger menu button needs `aria-label="Menu"`, scroll-to-top needs `aria-label="Scroll to top"`
6. **Skip to content** - Consider adding a skip link for keyboard users
7. **Form labels** - Every input must have a `<label>` element associated with it

---

## DECORATIVE DETAILS THAT ELEVATE THE DESIGN

These small touches make a site look custom-built rather than templated. Pick 3-5 per site:

### Section Dividers (instead of just flat color changes)
- **Diagonal cut:** `clip-path: polygon(0 0, 100% 0, 100% 85%, 0 100%)` on the section
- **Wave SVG:** Place an SVG wave between sections
- **Angled border:** Use a CSS `::before` pseudo-element with `transform: skewY(-3deg)`
- **Dot pattern:** Subtle repeating dot grid as a separator
- **Thin decorative line** with an accent color between sections

### Decorative Elements
- **Floating shapes:** Subtle CSS shapes (circles, squares) with very low opacity in backgrounds
- **Grid/dot background patterns:** Using CSS `background-image` with tiny repeating patterns
- **Accent lines:** Short horizontal lines above section headings (like a decorative rule)
- **Quote marks:** Large decorative quotation marks in testimonial sections using CSS `::before`
- **Number badges:** Large faded numbers behind content (like a watermark)
- **Border accents:** One side of a card or section with a colored left/top border

### Text Effects
- **Highlighted words:** Wrap key words in a `<span>` with the accent color
- **Underline decoration:** Custom underline on headings using CSS `::after` with accent color
- **Small caps labels:** Section labels in `text-transform: uppercase; letter-spacing: 3px; font-size: 0.75rem`
- **Dropcap:** First letter of an about paragraph enlarged and styled

### Background Treatments
- **Alternating backgrounds:** White > Off-white > White > Dark for visual rhythm
- **Subtle texture:** Very faint noise/grain overlay using CSS
- **Geometric patterns:** Light CSS-generated geometric shapes in section backgrounds
- **Photo overlays:** Semi-transparent color overlay on background images to match brand color

---

## WHATSAPP & SOCIAL FLOATING BUTTONS (OPTIONAL)

Many local businesses want a WhatsApp or phone floating button:

```html
<!-- WhatsApp floating button -->
<a href="https://wa.me/421900000000" target="_blank" rel="noopener"
   class="fixed bottom-6 right-6 z-50 w-14 h-14 bg-green-500 rounded-full flex items-center justify-center shadow-lg hover:bg-green-600 transition-all hover:scale-110"
   aria-label="WhatsApp">
  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="white">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492l4.634-1.215A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75c-2.115 0-4.109-.652-5.782-1.878l-.415-.296-2.75.721.735-2.686-.324-.432A9.71 9.71 0 012.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75z"/>
  </svg>
</a>
```

Add the WhatsApp number to `content.json` and render it from there. Position it bottom-right, above the scroll-to-top button if both exist.

---

## COMMON MISTAKES TO AVOID

1. **Hardcoding text in HTML** - ALL text must come from content.json via JS
2. **Using the same card grid for every section** - vary the layouts
3. **Forgetting mobile menu** - navigation MUST have a working hamburger menu
4. **Tiny buttons** - buttons should be large and easy to click
5. **Missing hover states** - every clickable element needs a hover effect
6. **Poor image choices** - images should match the business industry and tone
7. **Inconsistent spacing** - use a spacing system, don't eyeball it
8. **Missing alt text on images** - accessibility matters
9. **No scroll animations** - the site should feel alive, not static
10. **Same design every time** - ALWAYS make different design choices
11. **Forgetting loading="lazy"** - all images except hero need lazy loading
12. **No form validation** - contact forms should validate inputs
13. **Broken smooth scroll** - anchor links should scroll smoothly
14. **No nav scroll effect** - navbar should change appearance on scroll
15. **Too many colors** - stick to the chosen palette, don't introduce random colors
16. **Colors don't match industry** - a roofing company shouldn't look like a spa
17. **No loading screen** - page flashes with empty containers before JS loads
18. **Missing favicon** - use inline SVG favicon so it's always there
19. **No meta tags** - include description and OG tags for SEO and social sharing
20. **Ignoring accessibility** - missing focus states, no aria labels, poor contrast
21. **Missing vendor prefixes** - `clip-path` needs `-webkit-clip-path`, `backdrop-filter` needs `-webkit-backdrop-filter`, `filter` needs `-webkit-filter`
22. **No `prefers-reduced-motion`** - MUST include the media query to disable animations for motion-sensitive users
23. **Animating layout properties** - never animate `width`, `height`, `top`, `left` - use `transform` instead
24. **No backdrop-filter fallback** - always include a solid `background` color as fallback when using `backdrop-filter`
25. **Using CSS-only smooth scroll without JS fallback** - `scroll-behavior: smooth` doesn't work in older Safari, always add JS `scrollIntoView` too

---

## FINAL CHECKLIST

Before delivering, verify ALL of these:

**Content:**
- [ ] ALL text content loads from content.json (zero hardcoded text)
- [ ] Every editable element has `data-section` and `data-field` attributes
- [ ] content.json has `theme` and `fonts` objects
- [ ] Every section has `type`, `id`, `label`, `order`, and `fields`
- [ ] Every repeater item has a unique `id`
- [ ] Navigation links are correct and work

**Design:**
- [ ] Design direction stated and followed (layout, colors, typography, animations)
- [ ] Design looks DIFFERENT from any standard template
- [ ] Color palette is cohesive and consistent (no random colors)
- [ ] Typography hierarchy is clear (h1 > h2 > h3 > body)
- [ ] Spacing is consistent and generous
- [ ] Zero emojis anywhere in code or content
- [ ] Zero gradient color fills
- [ ] SVG icons or Lucide icons used (never emojis)

**Images & Media:**
- [ ] All images are HTTPS URLs, local files, or generated visuals (no broken paths)
- [ ] Images match the business industry
- [ ] `loading="lazy"` on all images except hero
- [ ] Images have `alt` attributes

**Interactions & Animations:**
- [ ] Every section has scroll-triggered entrance animations
- [ ] Animation style matches the chosen direction (not just basic fade-up)
- [ ] Hover effects on buttons, cards, links, images
- [ ] Navbar changes on scroll (transparent > solid)
- [ ] Mobile menu opens and closes
- [ ] Smooth scroll for anchor links
- [ ] Form has basic validation

**Responsive:**
- [ ] Works on mobile (375px), tablet (768px), desktop (1440px)
- [ ] No horizontal scrollbar on any screen size
- [ ] Navigation has working mobile hamburger menu
- [ ] Images and grids reflow properly
- [ ] Typography scales down on mobile
- [ ] Touch targets are minimum 44px

**Browser Compatibility:**
- [ ] All `clip-path` properties have `-webkit-clip-path` prefix
- [ ] All `backdrop-filter` properties have `-webkit-backdrop-filter` prefix AND solid background fallback
- [ ] All `filter` properties have `-webkit-filter` prefix
- [ ] `prefers-reduced-motion` media query included to disable animations for motion-sensitive users
- [ ] Smooth scroll uses JS `scrollIntoView` (not CSS-only `scroll-behavior`)
- [ ] Only `transform` and `opacity` used for animations (no animating `width`, `height`, `top`, `left`)
- [ ] Tested or designed to work on Chrome, Firefox, Safari, Edge, and iOS Safari

**Performance & SEO:**
- [ ] Google Fonts loaded with display=swap
- [ ] External libraries loaded from CDN
- [ ] No unnecessary large files
- [ ] Meta description tag present
- [ ] Open Graph tags present
- [ ] Favicon present (inline SVG is fine)
- [ ] Page loading screen hides empty container flash
- [ ] Semantic HTML used (`nav`, `main`, `section`, `footer`)

**Polish & Extras:**
- [ ] Colors match the business industry (see Industry Color Guide)
- [ ] Section dividers or visual separators used (not just flat color changes)
- [ ] At least 3 decorative details applied (accent lines, highlighted words, patterns, etc.)
- [ ] WhatsApp/phone floating button if relevant for local business
- [ ] Accessibility: focus states, aria labels, contrast, form labels

**Dashboard Integration (see website-structure-rules.md):**
- [ ] All section IDs follow `{type}_1` format in both HTML and content.json
- [ ] All `<section>` elements have matching `data-section` attribute
- [ ] All editable elements have `data-section` + `data-field` attributes
- [ ] All repeater items have `data-item` with unique IDs
- [ ] Contact form has `id="contact-form"` with `name/email/phone/message` inputs
- [ ] `<nav>` element has `id="nav_1"` and proper `</nav>` closing tag
- [ ] content.json has `theme` and `fonts` objects
- [ ] No dashboard scripts manually included (they are auto-injected)
- [ ] `script.js` is the last script before `</body>`

---

## WEBSITE DETAILS

Fill in whatever you have. Leave blank what you don't know — the AI will work with what's here:

**Business name:**

**Industry:**

**Location:**

**Services they offer:**

**Contact info:**
- Phone:
- Email:
- Address:
- Working hours:

**Images** (paste any URLs):

**Brands/materials they work with:**

**Extra notes:**

