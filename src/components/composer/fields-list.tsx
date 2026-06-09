"use client";

import { useMemo, useState } from "react";
import { CaretDown as ChevronDown, CaretRight as ChevronRight } from "@phosphor-icons/react/ssr";
import {
  PlaceholderField,
  type FieldSchema,
  type FieldValue,
} from "./placeholder-field";
import { RepeaterField } from "./repeater-field";
import type { SiteBrand } from "@/lib/composer/brand";
import { withBrandContact } from "@/lib/templates/brand-contact";

/**
 * Render the right component for a field given its schema. Repeaters
 * are special-cased — they wrap nested PlaceholderFields per item, so
 * they need their own list editor rather than the flat input UI.
 */
/**
 * Build a flat map of peer string fields for the AI image button to
 * read. The image field uses peer titles/descriptions to generate
 * per-row visuals — without this, every image on the page would get
 * the same generic industry prompt. Image / repeater / link / map
 * fields are skipped (only string-typed peers carry useful prompt
 * context).
 */
function buildSiblingFields(
  rawKey: string,
  overrides: Record<string, FieldValue>,
  schema: Record<string, FieldSchema>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (k === rawKey) continue;
    const t = schema[k]?.type;
    // Only string-shaped fields are useful prompt context. Repeater
    // contents (arrays) and link objects don't translate to prompt
    // language, and image peers are noise (we already know it's a
    // section that has images).
    if (t === "image" || t === "repeater" || t === "link") continue;
    if (typeof v === "string" && v.trim().length > 0) {
      result[k] = v;
    }
  }
  // Also include schema defaults for fields that haven't been
  // overridden yet — most templates ship with placeholder text
  // that's still informative ("Our services", "About us") even before the
  // user has typed anything in.
  for (const [k, fs] of Object.entries(schema)) {
    if (k === rawKey) continue;
    if (k in result) continue;
    if (fs?.type !== "text" && fs?.type !== "longtext" && fs?.type !== "richtext")
      continue;
    if (typeof fs.default === "string" && fs.default.trim()) {
      result[k] = fs.default;
    }
  }
  return result;
}

function renderField(args: {
  fieldKey: string;
  schemaEntry: FieldSchema;
  value: FieldValue | undefined;
  siteId: string;
  onChange: (v: FieldValue) => void;
  /** Section-level peer string fields (other text/longtext values in
   *  the same section). Forwarded to PlaceholderField so the AI image
   *  prompt can reference the section's headline/subtext. */
  siblingFields?: Record<string, string>;
  /** Optional in-place patch hook for single-field edits inside a
   *  repeater item — composer uses it to avoid full iframe re-renders. */
  onItemFieldChange?: (
    repeaterKey: string,
    itemIndex: number,
    itemFieldKey: string,
    value: FieldValue,
  ) => void;
  /** Original (unmangled) repeater key — needed by onItemFieldChange to
   *  identify which repeater the patch targets. fieldKey above may have
   *  been prettified for display. */
  rawKey: string;
  /** Composer-level focus tracker — used to outline the matching iframe
   *  element while the field is being edited. */
  onFieldFocus?: (fieldKey: string | null) => void;
  /** Optimistic image-preview hook (raw-key flavour). */
  onPreviewImage?: (fieldKey: string, url: string) => void;
  /** Section category — forwarded to PlaceholderField + RepeaterField
   *  so the AI image button can build a smart prompt based on which
   *  section the field lives in. */
  sectionCategory?: string;
  /** Current font-size override for THIS field, in CSS pixels. Passed
   *  through to PlaceholderField; the +/− UI inside only renders for
   *  text-shaped fields. */
  fieldSize?: number;
  /** Fires when the user adjusts size. Pixel value to set, or null
   *  to clear back to template default. */
  onFieldSizeChange?: (nextPx: number | null) => void;
  /** Reads the live computed font-size for THIS field from the iframe.
   *  Pre-bound to the field's rawKey so SizeControls can call it
   *  without knowing which key it owns. */
  getMeasuredSize?: () => number | null;
  /** Current max-width override for THIS field, in CSS pixels. */
  fieldWidth?: number;
  /** Fires when the user adjusts width. Pixel value to set, or null
   *  to clear back to template default. */
  onFieldWidthChange?: (nextPx: number | null) => void;
  /** Reads the live painted width of THIS field's element from the
   *  iframe (via getBoundingClientRect). Pre-bound to rawKey. */
  getMeasuredWidth?: () => number | null;
  /** Whether THIS field has fill-section breakout currently active. */
  fieldFill?: boolean;
  /** Fires when the user toggles the fill icon. */
  onFieldFillChange?: (fill: boolean) => void;
  /** Whether THIS top-level field is currently hidden from render. */
  fieldHidden?: boolean;
  /** Fires when the user toggles the eye icon on a link field. */
  onFieldHiddenChange?: (hidden: boolean) => void;
  /** Full list of hidden composite keys (e.g. "services_items[2].service_cta")
   *  — passed through to RepeaterField so each item's CTA knows its
   *  current state. */
  hiddenItemFieldKeys?: string[];
  /** Toggle a single repeater-item field's visibility. The RepeaterField
   *  builds the composite key ("rawKey[i].subKey") and forwards it here. */
  onItemFieldHiddenChange?: (compositeKey: string, hidden: boolean) => void;
  /** Optional hard cap on item count, forwarded to RepeaterField.
   *  undefined = no extra cap (the template's schema.max wins). */
  maxItemsCap?: number;
  /** Alt-text override for an IMAGE field. Pulled from
   *  `effectiveOverrides[<rawKey>_alt]` by the caller. Only meaningful
   *  for image-type schema entries; PlaceholderField guards the input
   *  internally via the `onAltChange` truthiness check. */
  altValue?: string;
  /** Renderer-side fallback used when `altValue` is empty: typically
   *  the sibling repeater-item `title` field. Composer shows it as
   *  placeholder text so the user sees what the live site will use. */
  altFallback?: string;
  /** Fires when the user types in the alt input. Composer writes the
   *  value to `<rawKey>_alt` on the same overrides scope (item-local
   *  for repeater images, section-level for top-level images). */
  onAltChange?: (next: string) => void;
}) {
  if (args.schemaEntry?.type === "repeater") {
    return (
      <RepeaterField
        fieldKey={args.fieldKey}
        schema={args.schemaEntry}
        value={args.value}
        siteId={args.siteId}
        onChange={args.onChange}
        sectionCategory={args.sectionCategory}
        onItemFieldChange={
          args.onItemFieldChange
            ? (idx, fieldKey, v) =>
                args.onItemFieldChange!(args.rawKey, idx, fieldKey, v)
            : undefined
        }
        repeaterKey={args.rawKey}
        hiddenItemFieldKeys={args.hiddenItemFieldKeys}
        onItemFieldHiddenChange={args.onItemFieldHiddenChange}
        maxItemsCap={args.maxItemsCap}
      />
    );
  }
  return (
    <PlaceholderField
      fieldKey={args.fieldKey}
      schema={args.schemaEntry}
      value={args.value}
      siteId={args.siteId}
      onChange={args.onChange}
      sectionCategory={args.sectionCategory}
      siblingFields={args.siblingFields}
      fieldSize={args.fieldSize}
      onFieldSizeChange={args.onFieldSizeChange}
      getMeasuredSize={args.getMeasuredSize}
      fieldWidth={args.fieldWidth}
      onFieldWidthChange={args.onFieldWidthChange}
      getMeasuredWidth={args.getMeasuredWidth}
      fieldFill={args.fieldFill}
      onFieldFillChange={args.onFieldFillChange}
      fieldHidden={args.fieldHidden}
      onFieldHiddenChange={args.onFieldHiddenChange}
      // The fieldKey we pass to the focus handler must be the RAW key —
      // that's what data-field="..." on the rendered element uses, not
      // the prettified label shown in the right panel.
      onFocusField={
        args.onFieldFocus
          ? (focused) => args.onFieldFocus!(focused ? args.rawKey : null)
          : undefined
      }
      onOptimisticImage={
        args.onPreviewImage
          ? (url) => args.onPreviewImage!(args.rawKey, url)
          : undefined
      }
      altValue={args.altValue}
      altFallback={args.altFallback}
      onAltChange={args.onAltChange}
    />
  );
}

interface Props {
  /** The template category (used to strip the prefix when grouping) */
  category: string;
  /** Schema for every field on this section */
  schema: Record<string, FieldSchema>;
  /** Field display order (preserved from template) */
  fieldOrder?: string[];
  /** Current overrides */
  overrides: Record<string, FieldValue>;
  siteId: string;
  onChange: (key: string, value: FieldValue) => void;
  /** In-place patch hook for single-field edits inside a repeater item
   *  (typing into a label, replacing one image). When provided, repeater
   *  edits send an iframe SK_PATCH_REPEATER_ITEM message via this hook
   *  AND fire the regular `onChange` so composition state stays in sync.
   *  The composer uses this combo to avoid flicker on each keystroke. */
  onItemFieldChange?: (
    repeaterKey: string,
    itemIndex: number,
    itemFieldKey: string,
    value: FieldValue,
  ) => void;
  /** Called with a field's raw key when its input gains focus, or null on
   *  blur. The composer turns this into a SK_HIGHLIGHT_FIELD postMessage
   *  so the iframe outlines the matching [data-field] element. */
  onFieldFocus?: (fieldKey: string | null) => void;
  /** Image fields use this to paint the iframe with a local blob: URL
   *  the moment a file is picked, while the actual upload happens in
   *  the background. fieldKey is the raw key (matches data-field on
   *  the rendered element). */
  onPreviewImage?: (fieldKey: string, url: string) => void;
  /** Per-field style overrides (CSS pixels). When omitted, all
   *  fields render at template default size and width. */
  fieldStyles?: Record<string, { size?: number; width?: number; fill?: boolean }>;
  /** Fires when a text-shaped field's size is adjusted. The composer
   *  updates section.field_styles[<rawKey>].size and sends a surgical
   *  SK_PATCH_FIELD_STYLE postMessage to the iframe (no full re-render,
   *  no blink). `nextPx === null` clears the override. */
  onFieldSizeChange?: (rawKey: string, nextPx: number | null) => void;
  /** Reads the live computed font-size (in px) of a field's element
   *  inside the preview iframe. Used by SizeControls so the FIRST
   *  +/− click starts at whatever the user actually sees. */
  measureFieldSize?: (rawKey: string) => number | null;
  /** Fires when a text-shaped field's max-width is adjusted. Same
   *  mechanism as size (writes section.field_styles[<rawKey>].width +
   *  posts SK_PATCH_FIELD_STYLE). `nextPx === null` clears the override. */
  onFieldWidthChange?: (rawKey: string, nextPx: number | null) => void;
  /** Reads the live painted width (in px) of a field's element inside
   *  the preview iframe (via getBoundingClientRect). Used by
   *  WidthControls so the FIRST +/− click starts from what the user sees. */
  measureFieldWidth?: (rawKey: string) => number | null;
  /** Toggles the per-field "fill section" breakout. true = on, false = off. */
  onFieldFillChange?: (rawKey: string, fill: boolean) => void;
  /** List of currently-hidden field composite keys (e.g.
   *  "hero_cta" or "services_items[2].service_cta"). Forwarded to
   *  PlaceholderField + RepeaterField so each link field knows whether
   *  to show "Hide" or "Show" in its row. */
  hiddenFields?: string[];
  /** Toggles a single field's visibility. rawKey accepts both top-level
   *  ("hero_cta") and composite repeater-item keys
   *  ("services_items[2].service_cta"). */
  onFieldHiddenChange?: (rawKey: string, hidden: boolean) => void;
  /** Optional hard cap on items count for repeater fields in this
   *  section (forwarded straight to RepeaterField). undefined = no
   *  extra cap. */
  maxItemsCap?: number;
  /** Site-wide brand record. When present, the brand-contact fall-back
   *  layer is applied to overrides BEFORE rendering — phone / email /
   *  address fields that the section hasn't filled in show the brand
   *  value as the displayed value, matching exactly what the renderer
   *  emits on publish. Fields stay fully editable: typing replaces
   *  the brand fallback with a per-section override; clearing the
   *  field falls back to brand again. */
  brand?: SiteBrand;
  /** Field keys to skip rendering. Used by the footer slot to hide
   *  `footer_logo` from the regular field list so the dedicated
   *  FooterLogoCard above the list owns that control — no duplicate
   *  editor for the same value. Filtered at the bucketing stage so
   *  excluded keys don't affect group counts. */
  excludeKeys?: string[];
}

/**
 * Renders a section's editable fields with auto-grouping. Fields are bucketed by
 * the FIRST segment of their key after the category prefix:
 *
 *   nav_logo_text   → "logo"     (singleton — no group, shown directly)
 *   nav_link_*      → "link"     (group with 5 items, collapsible)
 *   nav_service_*   → "service"  (group with 4 items, collapsible)
 *   nav_phone       → "phone"    (singleton — shown directly)
 *
 * Singletons appear at the top; groups follow as collapsible accordions.
 */
export function FieldsList({
  category,
  schema,
  fieldOrder,
  overrides,
  siteId,
  onChange,
  onItemFieldChange,
  onFieldFocus,
  onPreviewImage,
  fieldStyles,
  onFieldSizeChange,
  measureFieldSize,
  onFieldWidthChange,
  measureFieldWidth,
  onFieldFillChange,
  hiddenFields,
  onFieldHiddenChange,
  maxItemsCap,
  brand,
  excludeKeys,
}: Props) {
  // Sort by the explicit `order` stamped on each schema entry (the parser sets
  // it at upload time). Postgres JSONB key order isn't preserved, so we can't
  // rely on Object.keys(schema) reflecting authoring order.
  const orderedKeys =
    fieldOrder && fieldOrder.length > 0
      ? fieldOrder
      : Object.keys(schema).sort((a, b) => {
          const oa = schema[a]?.order ?? 9999;
          const ob = schema[b]?.order ?? 9999;
          return oa - ob;
        });

  // Drop any keys the caller wants hidden (e.g. footer_logo for the
  // footer slot — owned by the dedicated FooterLogoCard above the
  // list). Filtered BEFORE bucketing so excluded keys don't appear
  // in singletons OR group counts.
  const excludeSet = excludeKeys ? new Set(excludeKeys) : null;
  const keys = excludeSet
    ? orderedKeys.filter((k) => !excludeSet.has(k))
    : orderedKeys;

  const { singles, groups } = bucketFields(keys, category);

  // Apply the brand-contact fall-back layer so the displayed value of
  // any phone / email / address field matches what the renderer
  // emits on publish. Empty section fields show the brand value;
  // typed section values are preserved (fall-back semantics, not
  // overwrite). Memoized so brand changes / override changes
  // recompute, but unrelated re-renders don't.
  const effectiveOverrides = useMemo(() => {
    if (!brand) return overrides;
    return withBrandContact(
      overrides as Record<string, unknown>,
      schema as unknown as Parameters<typeof withBrandContact>[1],
      brand,
    ) as Record<string, FieldValue>;
  }, [overrides, schema, brand]);

  return (
    <div className="space-y-3">
      {singles.map((key) => {
        return (
        <div key={key}>
          {renderField({
            fieldKey: prettifyKey(key, category),
            rawKey: key,
            schemaEntry: schema[key],
            value: effectiveOverrides[key],
            siteId,
            onChange: (v) => onChange(key, v),
            onItemFieldChange,
            onFieldFocus,
            onPreviewImage,
            sectionCategory: category,
            siblingFields:
              schema[key]?.type === "image"
                ? buildSiblingFields(key, overrides, schema)
                : undefined,
            fieldSize: fieldStyles?.[key]?.size,
            onFieldSizeChange: onFieldSizeChange
              ? (next) => onFieldSizeChange(key, next)
              : undefined,
            getMeasuredSize: measureFieldSize
              ? () => measureFieldSize(key)
              : undefined,
            fieldWidth: fieldStyles?.[key]?.width,
            onFieldWidthChange: onFieldWidthChange
              ? (next) => onFieldWidthChange(key, next)
              : undefined,
            getMeasuredWidth: measureFieldWidth
              ? () => measureFieldWidth(key)
              : undefined,
            fieldFill: fieldStyles?.[key]?.fill === true,
            onFieldFillChange: onFieldFillChange
              ? (fill) => onFieldFillChange(key, fill)
              : undefined,
            fieldHidden: hiddenFields?.includes(key) ?? false,
            onFieldHiddenChange: onFieldHiddenChange
              ? (hidden) => onFieldHiddenChange(key, hidden)
              : undefined,
            hiddenItemFieldKeys: hiddenFields,
            onItemFieldHiddenChange: onFieldHiddenChange,
            maxItemsCap,
            // Alt-text wiring (top-level images only — repeater item
            // images route through RepeaterField → ItemFieldEditor).
            // Top-level fields have no natural sibling "title" to use
            // as a fallback (every section's "title" is the headline,
            // not a per-image label), so altFallback stays undefined
            // here. Users type their own alt for top-level images.
            ...(schema[key]?.type === "image"
              ? {
                  altValue:
                    typeof effectiveOverrides[`${key}_alt`] === "string"
                      ? (effectiveOverrides[`${key}_alt`] as string)
                      : undefined,
                  altFallback: undefined,
                  onAltChange: (next: string) => onChange(`${key}_alt`, next),
                }
              : {}),
          })}
        </div>
        );
      })}

      {groups.map((group) => (
        <FieldGroup key={group.bucketKey} title={group.label} count={group.keys.length}>
          {group.keys.map((key) => {
            return (
            <div key={key}>
              {renderField({
                fieldKey: prettifyKeyForGroup(key, category, group.bucketKey),
                rawKey: key,
                schemaEntry: schema[key],
                value: effectiveOverrides[key],
                siteId,
                onChange: (v) => onChange(key, v),
                onItemFieldChange,
                onFieldFocus,
                onPreviewImage,
                sectionCategory: category,
                siblingFields:
                  schema[key]?.type === "image"
                    ? buildSiblingFields(key, overrides, schema)
                    : undefined,
                fieldSize: fieldStyles?.[key]?.size,
                onFieldSizeChange: onFieldSizeChange
                  ? (next) => onFieldSizeChange(key, next)
                  : undefined,
                getMeasuredSize: measureFieldSize
                  ? () => measureFieldSize(key)
                  : undefined,
                fieldWidth: fieldStyles?.[key]?.width,
                onFieldWidthChange: onFieldWidthChange
                  ? (next) => onFieldWidthChange(key, next)
                  : undefined,
                getMeasuredWidth: measureFieldWidth
                  ? () => measureFieldWidth(key)
                  : undefined,
                fieldFill: fieldStyles?.[key]?.fill === true,
                onFieldFillChange: onFieldFillChange
                  ? (fill) => onFieldFillChange(key, fill)
                  : undefined,
                fieldHidden: hiddenFields?.includes(key) ?? false,
                onFieldHiddenChange: onFieldHiddenChange
                  ? (hidden) => onFieldHiddenChange(key, hidden)
                  : undefined,
                hiddenItemFieldKeys: hiddenFields,
                onItemFieldHiddenChange: onFieldHiddenChange,
                maxItemsCap,
              })}
            </div>
            );
          })}
        </FieldGroup>
      ))}
    </div>
  );
}

function FieldGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="dash-hairline dash-subhead overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="dash-row flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-sm font-medium tracking-tight">{title}</span>
        <span className="dash-chip ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
          {count}
        </span>
      </button>
      {open && (
        <div className="dash-hairline space-y-2.5 border-t bg-background px-3 py-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Grouping logic
// ─────────────────────────────────────────────────────────────────────────────

interface Bucket {
  bucketKey: string;
  label: string;
  keys: string[];
}

function bucketFields(
  keys: string[],
  category: string,
): { singles: string[]; groups: Bucket[] } {
  const buckets = new Map<string, string[]>();
  const order: string[] = [];

  for (const key of keys) {
    const stripped = stripCategoryPrefix(key, category);
    const segments = stripped.split("_");
    const bucketKey = segments[0] || stripped;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
      order.push(bucketKey);
    }
    buckets.get(bucketKey)!.push(key);
  }

  const singles: string[] = [];
  const groups: Bucket[] = [];
  for (const bucketKey of order) {
    const bucketKeys = buckets.get(bucketKey)!;
    if (bucketKeys.length === 1) {
      singles.push(bucketKeys[0]);
    } else {
      groups.push({
        bucketKey,
        label: humanizeBucketName(bucketKey, bucketKeys.length, category),
        keys: bucketKeys,
      });
    }
  }
  return { singles, groups };
}

function stripCategoryPrefix(key: string, category: string): string {
  const prefix = `${category}_`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

const BUCKET_LABEL_OVERRIDES: Record<string, string> = {
  link: "Menu links",
  service: "Services dropdown",
  cta: "Buttons",
  social: "Social links",
  feature: "Features",
  review: "Reviews",
  faq: "FAQs",
  question: "Questions",
};

/** Category → singular noun used when a numeric bucket means "one item of this category". */
const CATEGORY_SINGULAR: Record<string, string> = {
  services: "Service",
  reviews: "Review",
  faq: "FAQ",
  gallery: "Image",
  hero: "Hero",
  about: "About",
  cta: "CTA",
  contact: "Contact",
  map: "Map",
  nav: "Nav",
  footer: "Footer",
};

function humanizeBucketName(
  name: string,
  count: number,
  category: string,
): string {
  if (BUCKET_LABEL_OVERRIDES[name]) return BUCKET_LABEL_OVERRIDES[name];
  // Numeric bucket = a repeater item. Use category-aware singular noun + index.
  if (/^\d+$/.test(name)) {
    const noun = CATEGORY_SINGULAR[category] ?? "Item";
    return `${noun} ${name}`;
  }
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  return count > 1 && !cap.endsWith("s") ? cap + "s" : cap;
}

/** Display name for a top-level field — strip category, replace _ with space */
function prettifyKey(key: string, category: string): string {
  return stripCategoryPrefix(key, category).replace(/_/g, " ");
}

/** Display name for a field inside a group — also strip the bucket prefix */
function prettifyKeyForGroup(
  key: string,
  category: string,
  bucketKey: string,
): string {
  const stripped = stripCategoryPrefix(key, category);
  const inner = stripped.startsWith(`${bucketKey}_`)
    ? stripped.slice(bucketKey.length + 1)
    : stripped === bucketKey
    ? bucketKey
    : stripped;
  return inner.replace(/_/g, " ");
}

