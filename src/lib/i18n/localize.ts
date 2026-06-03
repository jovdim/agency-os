/**
 * Multi-language overlay — produce a per-locale composition.
 *
 * The site's base composition holds the DEFAULT-language content. For any
 * other locale we keep a translation snapshot (same shape
 * `buildExportSnapshot` emits: sectionId → fieldKey → value, plus the
 * virtual `__seo` / `__nav` / `__footer` sections). `localizeComposition`
 * deep-clones the base and overlays a locale's snapshot onto it, returning
 * a composition the existing renderer can consume unchanged.
 *
 * Pure module: no React, no DOM, no Supabase, no template schema. The merge
 * is driven entirely by the runtime SHAPE of each snapshot value:
 *   · string                       → text/longtext/richtext → replace
 *   · { label }                    → link → translate label, keep base href
 *   · Array<itemObject>            → repeater → merge per index, per sub-field
 * Because it's schema-free + side-effect-free it's trivially unit-testable
 * from every angle, which is the whole point — this is the load-bearing
 * core of the i18n feature.
 *
 * No-fallback rule: a non-default locale renders ONLY from its snapshot
 * overlaid on the base. Non-text content (images, phone, email, map) is
 * shared across languages by design — it's not "fallback," it's
 * language-independent data that simply isn't in the snapshot. Text
 * completeness is enforced upstream at publish time (a locale can't go
 * live until its snapshot is imported); see `hasTranslation`.
 */

import type { SiteComposition } from "@/lib/templates/render";
import type {
  SiteI18n,
  SiteLocale,
  LocaleTranslationSnapshot,
  LocaleValue,
} from "@/lib/i18n/locales";
import type { FieldValue } from "@/lib/templates/parser";

/** Virtual section ids in a snapshot — mirror json-roundtrip.ts. */
const SEO_KEY = "__seo";
const NAV_KEY = "__nav";
const FOOTER_KEY = "__footer";

/* ─────────────────────────────────────────────────────────────
   Locale config helpers
   ───────────────────────────────────────────────────────────── */

/** Site's default locale, or undefined for a single-language site. */
export function getDefaultLocale(comp: SiteComposition): SiteLocale | undefined {
  return comp.i18n?.default_locale;
}

/** True when the site serves more than one locale. */
export function isMultiLocale(comp: SiteComposition): boolean {
  const locales = comp.i18n?.enabled_locales;
  return Array.isArray(locales) && locales.length > 1;
}

/** Does this locale have an imported translation snapshot? The default
 *  locale always returns true (its content is the base composition). */
export function hasTranslation(
  comp: SiteComposition,
  locale: SiteLocale,
): boolean {
  if (!comp.i18n) return false;
  if (locale === comp.i18n.default_locale) return true;
  const snap = comp.i18n.translations?.[locale];
  return !!snap && Object.keys(snap).length > 0;
}

/** URL path prefix for a locale: "" for the default (root), "de/" otherwise.
 *  Always trailing-slash terminated (or empty) so callers can do
 *  `${prefix}${page.path}`. */
export function localePrefix(
  comp: SiteComposition,
  locale: SiteLocale,
): string {
  if (!comp.i18n || locale === comp.i18n.default_locale) return "";
  return `${locale}/`;
}

export interface LocaleRenderTarget {
  /** null for a single-language site (no i18n block). */
  locale: SiteLocale | null;
  /** "" for default / single-language, "de/" etc. for others. */
  prefix: string;
  isDefault: boolean;
}

/**
 * The set of locales the renderer should emit. For a single-language site
 * (no i18n or only one locale) this is a single root-prefixed target,
 * exactly reproducing the historical one-render behaviour. For a
 * multi-locale site it's one target per enabled locale.
 *
 * `onlyPublishable: true` filters out enabled-but-untranslated locales —
 * use it at publish time so the no-fallback rule holds (no `/de/` pages
 * shipped until German is imported). Leave it false for preview, where
 * showing an enabled-but-empty locale can be useful.
 */
export function getLocaleRenderTargets(
  comp: SiteComposition,
  opts: { onlyPublishable?: boolean } = {},
): LocaleRenderTarget[] {
  const i18n = comp.i18n;
  if (!i18n || !Array.isArray(i18n.enabled_locales) || i18n.enabled_locales.length <= 1) {
    return [{ locale: i18n?.default_locale ?? null, prefix: "", isDefault: true }];
  }
  const def = i18n.default_locale;
  let locales = i18n.enabled_locales;
  if (opts.onlyPublishable) {
    locales = locales.filter((loc) => hasTranslation(comp, loc));
  }
  // Guarantee the default is always present even if somehow filtered.
  if (!locales.includes(def)) locales = [def, ...locales];
  return locales.map((loc) => ({
    locale: loc,
    prefix: loc === def ? "" : `${loc}/`,
    isDefault: loc === def,
  }));
}

/* ─────────────────────────────────────────────────────────────
   The overlay
   ───────────────────────────────────────────────────────────── */

/**
 * Produce the composition for one locale.
 *
 * Returns the base composition UNCHANGED (same reference) when the locale
 * is the default, when there's no i18n block, or when no snapshot exists
 * for the locale — the caller renders default content in those cases.
 *
 * Otherwise returns a DEEP CLONE of the base with the locale's snapshot
 * overlaid. The base is never mutated.
 */
export function localizeComposition(
  base: SiteComposition,
  locale: SiteLocale,
): SiteComposition {
  const i18n: SiteI18n | undefined = base.i18n;
  if (!i18n || locale === i18n.default_locale) return base;
  const snapshot = i18n.translations?.[locale];
  if (!snapshot || Object.keys(snapshot).length === 0) return base;

  const clone = deepClone(base);

  // ── Page sections, keyed by section id across ALL pages ──
  // (Subpages must translate too — keying by id means we don't care which
  //  page a section lives on.)
  for (const page of clone.pages) {
    for (const section of page.sections) {
      const fields = snapshot[section.id];
      if (!fields) continue;
      section.content_overrides = mergeFieldMap(
        section.content_overrides ?? {},
        fields,
      );
    }
  }

  // ── Site-level SEO (__seo) → composition.seo ──
  const seoFields = snapshot[SEO_KEY];
  if (seoFields) {
    clone.seo = { ...(clone.seo ?? {}) };
    if (typeof seoFields.title === "string") clone.seo.title = seoFields.title;
    if (typeof seoFields.description === "string") {
      clone.seo.description = seoFields.description;
    }
  }

  // ── Shared nav (__nav) ──
  const navFields = snapshot[NAV_KEY];
  if (navFields && clone.shared) {
    clone.shared.nav_overrides = mergeFieldMap(
      clone.shared.nav_overrides ?? {},
      navFields,
    );
  }

  // ── Shared footer (__footer) ──
  const footerFields = snapshot[FOOTER_KEY];
  if (footerFields && clone.shared) {
    clone.shared.footer_overrides = mergeFieldMap(
      clone.shared.footer_overrides ?? {},
      footerFields,
    );
  }

  return clone;
}

/* ─────────────────────────────────────────────────────────────
   Merge internals — shape-driven, schema-free
   ───────────────────────────────────────────────────────────── */

/**
 * Overlay one snapshot field map onto a copy of the base overrides.
 * Returns a NEW object (base map not mutated). Snapshot keys win; base-only
 * keys (e.g. image URLs, phone numbers, fields the snapshot doesn't carry)
 * are preserved untouched.
 */
function mergeFieldMap(
  baseOverrides: Record<string, FieldValue>,
  snapshotFields: Record<string, LocaleValue>,
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = { ...baseOverrides };
  for (const [key, value] of Object.entries(snapshotFields)) {
    // Reserved anchor markers never appear in a real snapshot, but guard
    // anyway so a malformed paste can't rewrite section/item ids.
    if (key.startsWith("__")) continue;
    const merged = mergeLeaf(value, baseOverrides[key]);
    if (merged !== undefined) out[key] = merged;
  }
  return out;
}

/** Merge one snapshot value against the base value at the same key. */
function mergeLeaf(
  value: LocaleValue,
  baseValue: FieldValue | undefined,
): FieldValue | undefined {
  // text / longtext / richtext
  if (typeof value === "string") return value;

  // repeater
  if (Array.isArray(value)) return mergeRepeater(value, baseValue);

  // link { label } — translate the label, keep the base href so a custom
  // link target survives translation. No base href → emit label only and
  // let the renderer fall back to the template's default href.
  if (value && typeof value === "object") {
    const label = typeof value.label === "string" ? value.label : undefined;
    if (label === undefined) return undefined;
    const baseHref = readHref(baseValue);
    return baseHref !== undefined ? { label, href: baseHref } : { label };
  }
  return undefined;
}

/**
 * Merge a translated repeater array. The translation drives the row count
 * (the import validator already guarantees it matches the base count). For
 * each row we START from the base item — preserving non-text data (image
 * URLs, link hrefs) — then overlay the translated text/labels on top.
 */
function mergeRepeater(
  snapshotItems: Array<Record<string, string | { label?: string }>>,
  baseValue: FieldValue | undefined,
): Array<Record<string, FieldValue>> {
  const baseItems: Array<Record<string, FieldValue>> = Array.isArray(baseValue)
    ? (baseValue as Array<Record<string, FieldValue>>)
    : [];
  return snapshotItems.map((snapItem, i) => {
    const baseItem =
      baseItems[i] && typeof baseItems[i] === "object" && !Array.isArray(baseItems[i])
        ? baseItems[i]
        : {};
    const mergedItem: Record<string, FieldValue> = { ...baseItem };
    for (const [subKey, subVal] of Object.entries(snapItem)) {
      if (subKey.startsWith("__")) continue;
      if (typeof subVal === "string") {
        mergedItem[subKey] = subVal;
      } else if (subVal && typeof subVal === "object" && !Array.isArray(subVal)) {
        const label = typeof subVal.label === "string" ? subVal.label : undefined;
        if (label === undefined) continue;
        const baseHref = readHref(baseItem[subKey]);
        mergedItem[subKey] = baseHref !== undefined ? { label, href: baseHref } : { label };
      }
    }
    return mergedItem;
  });
}

/** Pull the href off a link-shaped value, else undefined. */
function readHref(value: FieldValue | undefined): string | undefined {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { href?: unknown }).href === "string"
  ) {
    return (value as { href: string }).href;
  }
  return undefined;
}

/** JSON deep clone — composition is pure JSON (stored as JSONB), so this is
 *  safe, deterministic, and dependency-free. */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
