/**
 * LocalBusiness structured data (JSON-LD) emitter.
 *
 * Builds the schema.org LocalBusiness block that gets injected into
 * every published page's <head>. Tells Google + other crawlers in a
 * machine-readable way: "this is a local business named X with phone
 * Y at address Z" — much more reliable than letting Google guess from
 * page text.
 *
 * Why: every client is a local SMB (plumber, electrician, garden
 * service, etc.) competing for local searches like "plumber [city]".
 * Without LocalBusiness JSON-LD, Google has to GUESS the business
 * type and location from prose. With it, Google knows directly and
 * is eligible to:
 *   - Show the business in the right-side knowledge panel ("info card")
 *   - Rank better in "near me" / city-name searches
 *   - Render rich results (hours, phone, address, click-to-call)
 *
 * All inputs come from `composition.brand` (already exists for the
 * brand-contact auto-fill feature) + the site URL + the OG image URL.
 * Zero new SEO-panel fields per Peter's "auto-only" decision
 * 2026-05-14 — UI surface stays at one indicator, no manual typing.
 *
 * Pure module — no DOM, no Node, no Supabase. Both renderers can
 * import freely.
 */

import type { SiteBrand } from "@/lib/composer/brand";

/* ─────────────────────────────────────────────────────────────
   Public entry point
   ───────────────────────────────────────────────────────────── */

export interface BuildLocalBusinessOptions {
  brand: SiteBrand | null | undefined;
  /** Absolute URL of the live site. Required — without it the block
   *  has no canonical `url` field and Google can't tie the schema to
   *  a domain. Caller skips this entire emitter when there's no URL
   *  (composer preview path). */
  siteUrl: string;
  /** Absolute OG image URL (already resolved to absolute by buildHeadMeta).
   *  Optional — when present, included as the business `image` so the
   *  knowledge panel has a real photo instead of a default mark. */
  ogImageUrl?: string;
  /** Resolved brand logo URL — auto-mode SVG data: URL or custom upload.
   *  Optional — included as `logo` for businesses that have an explicit
   *  brand mark. */
  logoUrl?: string;
}

/**
 * Build the `<script type="application/ld+json">` block, or `""` when
 * the brand has too little info to emit anything useful (Google
 * actively rejects sparse LocalBusiness records — better no schema
 * than a half-broken one). Decision rule: needs a name AND at least
 * ONE of phone/email/address. Otherwise we'd be telling Google "here's
 * a business, but I won't say where or how to reach it" which makes
 * the schema worse than absent.
 *
 * Optional enrichment fields (opening_hours, business_type,
 * social_*) are layered on when present — each independently. A
 * brand that has just name + phone still emits a valid (if minimal)
 * LocalBusiness; a brand with everything filled emits the rich
 * version Google's info card can fully populate.
 */
export function buildLocalBusinessJsonLd(
  options: BuildLocalBusinessOptions,
): string {
  const brand = options.brand;
  if (!brand) return "";
  const name = (brand.company_text ?? "").trim();
  const phone = (brand.phone ?? "").trim();
  const email = (brand.email ?? "").trim();
  const address = (brand.address ?? "").trim();
  // Eligibility gate — see fn comment.
  if (!name) return "";
  if (!phone && !email && !address) return "";

  // Resolve schema.org @type from the user's business_type choice.
  // Unknown / empty / "Custom" → falls back to the generic LocalBusiness
  // so the schema remains valid; specific subtype unlocks better Google
  // categorization (e.g. "Plumber" → plumber-related searches). When
  // the user picked the "Custom" sentinel, their free-form description
  // lands in the schema's `description` field below — schema.org's
  // documented place for "short text describing the business".
  const businessType = (brand.business_type ?? "").trim();
  const businessTypeCustom = (brand.business_type_custom ?? "").trim();
  const schemaType = resolveSchemaType(businessType);

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": schemaType,
    name,
    url: options.siteUrl,
  };

  if (phone) data.telephone = phone;
  if (email) data.email = email;
  if (options.ogImageUrl) data.image = options.ogImageUrl;
  if (options.logoUrl) data.logo = options.logoUrl;

  if (address) {
    const parsed = parseSlovakAddress(address);
    // PostalAddress object — Google prefers structured over free-form
    // even if the structure is partial. addressCountry is a placeholder
    // default ("US"); change it to the appropriate ISO 3166-1 country
    // code for your market, or wire it to a brand field if you ship
    // cross-border clients.
    const postal: Record<string, string> = {
      "@type": "PostalAddress",
      addressCountry: "US",
    };
    if (parsed.streetAddress) postal.streetAddress = parsed.streetAddress;
    if (parsed.postalCode) postal.postalCode = parsed.postalCode;
    if (parsed.addressLocality) postal.addressLocality = parsed.addressLocality;
    data.address = postal;
  }

  // Opening hours — schema.org accepts both standardized
  // "Mo-Fr 08:00-17:00" and free-form strings. We pass through what
  // the user typed (e.g. "Mon-Fri 8:00-17:00"). Google's parser is
  // lenient and handles common formats; trying to perfectly
  // translate localized day abbreviations would be brittle and the
  // worst-case (Google ignores the value) is no worse than not
  // setting it at all.
  const hours = (brand.opening_hours ?? "").trim();
  if (hours) data.openingHours = hours;

  // Custom business-type description — only emitted when the user
  // picked the "Custom" sentinel from the dropdown AND typed
  // something. Schema.org `description` is short text (typically
  // 1-2 sentences) describing what the business does — Google
  // uses it in some snippets and falls back to it when categorizing.
  // Capped at 300 chars defensively so a paragraph-length value
  // doesn't bloat the JSON-LD.
  if (businessType === "Custom" && businessTypeCustom) {
    data.description = businessTypeCustom.slice(0, 300);
  }

  // Social / "also known at" URLs — `sameAs` is schema.org's standard
  // way of saying "this entity is also represented at these other URLs".
  // Helps Google's knowledge graph link the website to social pages
  // and reduces the chance of duplicate/competing listings. Filter out
  // empties + reject obviously-broken values (no http(s) prefix) so
  // half-typed URLs don't pollute the schema. Only Facebook + Instagram
  // for now — LinkedIn dropped because local SMB clients almost never
  // have a company page there.
  const sameAs: string[] = [];
  for (const url of [brand.social_facebook, brand.social_instagram]) {
    const u = (url ?? "").trim();
    if (u && /^https?:\/\//i.test(u)) sameAs.push(u);
  }
  if (sameAs.length > 0) data.sameAs = sameAs;

  // JSON.stringify and then escape `<` → `<` to prevent any
  // address / company-name value with an embedded `</script>` from
  // breaking out of the script tag. Standard JSON-LD safety drill.
  // We don't escape `>` or `&` because they're not script-context
  // dangerous inside JSON.
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${payload}</script>`;
}

/* ─────────────────────────────────────────────────────────────
   Business-type → schema.org subtype mapping
   ───────────────────────────────────────────────────────────── */

/**
 * Whitelist of schema.org LocalBusiness subtypes the SEO panel's
 * dropdown offers. Keys here MUST match the dropdown's option
 * `value` exactly. Anything not in the list (or empty) falls back
 * to the generic "LocalBusiness" schema type — still valid, just
 * less specific.
 *
 * Centralized here so the renderer + the dropdown both agree on
 * what's a known type — adding a new entry to BUSINESS_TYPES.tsx
 * also requires adding it here for the JSON-LD to honor it.
 */
const KNOWN_SCHEMA_TYPES = new Set<string>([
  "LocalBusiness",
  // Trades + construction
  "Plumber",
  "Electrician",
  "HousePainter",
  "Locksmith",
  "HVACBusiness",
  "RoofingContractor",
  "GeneralContractor",
  "HomeAndConstructionBusiness",
  "MovingCompany",
  // Auto
  "AutoRepair",
  "AutoBodyShop",
  "AutoDealer",
  // Beauty + health
  "BeautySalon",
  "HairSalon",
  "HealthClub",
  "Dentist",
  "MedicalBusiness",
  "VeterinaryCare",
  "Optician",
  // Food
  "Restaurant",
  "CafeOrCoffeeShop",
  "Bakery",
  "FoodEstablishment",
  // Services
  "LegalService",
  "Notary",
  "AccountingService",
  "RealEstateAgent",
  "DryCleaningOrLaundry",
  "ProfessionalService",
  // Other
  "Florist",
  "ChildCare",
  "Store",
]);

function resolveSchemaType(input: string): string {
  if (!input) return "LocalBusiness";
  return KNOWN_SCHEMA_TYPES.has(input) ? input : "LocalBusiness";
}

/* ─────────────────────────────────────────────────────────────
   Address parser — "Main St 12, 811 01 City" shape
   ───────────────────────────────────────────────────────────── */

interface ParsedAddress {
  streetAddress?: string;
  postalCode?: string;
  addressLocality?: string;
}

/**
 * Loose parser for the free-form address string a tech-admin types
 * into the Brand panel. Best-effort — never throws, always returns a
 * reasonable structure even on weird input.
 *
 * Common conventions handled:
 *   "Main St 12, 811 01 City" → street + zip + city
 *   "Main St 12, City"        → street + city (no zip)
 *   "Main St 12"              → street only
 *   "City"                    → city only (no street)
 *   ""                        → all empty
 *
 * Two-block ZIP detection: matches `XXX XX` (with or without space)
 * at the start of the last comma-separated segment, leaving the rest
 * as the city. ZIP-less inputs fall through to street/city split.
 * NOTE: the `XXX XX` pattern is a placeholder for a common postal-code
 * shape; adjust the regex below for your locale's format if needed.
 */
export function parseSlovakAddress(input: string): ParsedAddress {
  const trimmed = input.trim();
  if (!trimmed) return {};

  const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return {};

  // Single-part: try to detect "street WITH number" vs "city alone"
  // by checking for digits — addresses without a street number are
  // typically city names ("City"); with a number they're
  // streets ("Main St 12").
  if (parts.length === 1) {
    const onlyPart = parts[0];
    if (/\d/.test(onlyPart)) {
      return { streetAddress: onlyPart };
    }
    return { addressLocality: onlyPart };
  }

  // Multi-part: last segment may carry "ZIP city" or just "city".
  const last = parts[parts.length - 1];
  const zipCityMatch = last.match(/^(\d{3}\s?\d{2})\s+(.+)$/);

  if (zipCityMatch) {
    return {
      streetAddress: parts.slice(0, -1).join(", "),
      postalCode: zipCityMatch[1].trim(),
      addressLocality: zipCityMatch[2].trim(),
    };
  }

  // No ZIP detected — last segment is just the city
  return {
    streetAddress: parts.slice(0, -1).join(", "),
    addressLocality: last,
  };
}
