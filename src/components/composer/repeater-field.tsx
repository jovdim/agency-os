"use client";

/**
 * Repeater field editor for the composer.
 *
 * Renders a variable-length list of items (e.g. nav links, services cards,
 * gallery images). Each item is a card that nests the per-item fields via
 * <PlaceholderField>. Add/remove + drag-to-reorder controls are gated by
 * the schema's min/max bounds.
 *
 * Two architectural choices worth knowing:
 *   1. Item identity is per-mount UUID stamped on first render. We can't
 *      use array index as a sortable id because reordering would shuffle
 *      ids and break drag tracking. We can't use a schema-derived id either
 *      because items are interchangeable. So we mint UUIDs at hydration
 *      and keep them in sync with the items array.
 *   2. Default initialization. If `value` is undefined we fall back to the
 *      schema's `default_items` so a brand-new site starts with the
 *      template's intended initial set, not an empty list. As soon as the
 *      user adds/removes/edits, we materialize the value into composition.
 */

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CaretDown as ChevronDown, CaretRight as ChevronRight, DotsSixVertical as GripVertical, Plus, Trash as Trash2 } from "@phosphor-icons/react/ssr";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  PlaceholderField,
  type FieldSchema,
  type FieldValue,
} from "./placeholder-field";
import { MediaGroupField } from "./media-group-field";
import { SectionIdChip } from "./section-id-chip";
import { slugifyAnchorId } from "@/lib/templates/slugify";

interface Props {
  fieldKey: string;
  schema: FieldSchema; // schema.type === "repeater"
  value: FieldValue | undefined;
  siteId: string;
  onChange: (value: FieldValue) => void;
  /**
   * Optional in-place patch hook. Fired ONLY for single-field edits
   * within an existing item (typing into a label, replacing one image,
   * etc.) — composer uses this to send SK_PATCH_REPEATER_ITEM and avoid
   * a full iframe re-render. Add/remove/reorder still go through
   * `onChange` and trigger a re-render.
   */
  onItemFieldChange?: (
    itemIndex: number,
    itemFieldKey: string,
    value: FieldValue,
  ) => void;
  /** Section category (e.g., "gallery", "services") — forwarded to the
   *  inner PlaceholderFields so per-item image fields' AI button can
   *  build a smart, context-aware default prompt. */
  sectionCategory?: string;
  /** When true AND items.length === 0, render NOTHING. Used for
   *  nested repeaters inside repeater items where only the
   *  template-default anchor (e.g. Sluzby's dropdown) is meant to
   *  carry sub-items — plain menu links should read as plain links
   *  with no dropdown affordance at all. Trade-off: emptying the
   *  anchor's items down to zero hides the editor; bringing it back
   *  requires the user to re-add via the menu-item's seed defaults
   *  or a future "convert to dropdown" action. */
  compactWhenEmpty?: boolean;
  /** This repeater's raw key in the section schema (e.g. "services_items").
   *  Used to build composite hidden-field keys for per-row CTAs:
   *  "services_items[2].service_cta". */
  repeaterKey?: string;
  /** Full set of currently-hidden composite field keys on the parent
   *  section. We filter to entries matching this repeater so each
   *  row's link sub-field can know its state. */
  hiddenItemFieldKeys?: string[];
  /** Toggle a single repeater-item sub-field's visibility. Called with
   *  the composite key ("repeaterKey[index].subKey") + the new state. */
  onItemFieldHiddenChange?: (compositeKey: string, hidden: boolean) => void;
  /** Hard cap on the items count, layered ON TOP of the template's
   *  schema.max. The effective max becomes min(schema.max, maxItemsCap).
   *  Today: section-card.tsx passes 40 when the composer is in client
   *  mode AND the section category is "gallery" — a safety net so
   *  clients can't accidentally upload 500 photos and tank the page.
   *  Tech-admin mode skips the cap (passes undefined) and stays at
   *  whatever the template's data-max says (now 999 for galleries =
   *  effectively unlimited). */
  maxItemsCap?: number;
}

type ItemMap = Record<string, FieldValue>;

export function RepeaterField({
  fieldKey,
  schema,
  value,
  siteId,
  onChange,
  onItemFieldChange,
  sectionCategory,
  compactWhenEmpty = false,
  repeaterKey,
  hiddenItemFieldKeys,
  onItemFieldHiddenChange,
  maxItemsCap,
}: Props) {
  const min = schema.min ?? 1;
  // Effective max = template's data-max, lowered by the optional
  // role-aware cap from the parent. Undefined cap is a no-op.
  const templateMax = schema.max ?? 10;
  const max =
    typeof maxItemsCap === "number" && maxItemsCap > 0
      ? Math.min(templateMax, maxItemsCap)
      : templateMax;
  const itemSchema = schema.item_schema ?? {};
  const defaultItems = schema.default_items ?? [];

  // Materialize the working list. If composition has no override yet, we
  // show the template's defaults so the user is never staring at "0 items"
  // for a freshly-loaded section.
  const items: ItemMap[] = useMemo(() => {
    if (Array.isArray(value)) return value as ItemMap[];
    return defaultItems as ItemMap[];
  }, [value, defaultItems]);

  // Stable per-item UUIDs. Drag-and-drop libraries need stable ids that
  // travel with the item across reorders — array index doesn't work.
  // We pre-allocate ids on each items-length change and keep the same
  // ids when items are reordered/edited (only mint new ones on Add).
  const idRef = useRef<string[]>([]);
  if (idRef.current.length !== items.length) {
    // Resync ids to match the current item count without losing existing
    // mappings when items just got reordered/edited.
    if (idRef.current.length < items.length) {
      while (idRef.current.length < items.length) {
        idRef.current.push(genId());
      }
    } else {
      idRef.current = idRef.current.slice(0, items.length);
    }
  }
  const ids = idRef.current;

  // Order item-field keys by their stamped `order` (mirrors FieldsList).
  const itemFieldKeys = useMemo(() => {
    return Object.keys(itemSchema).sort((a, b) => {
      const oa = itemSchema[a]?.order ?? 9999;
      const ob = itemSchema[b]?.order ?? 9999;
      return oa - ob;
    });
  }, [itemSchema]);

  function patch(next: ItemMap[]) {
    onChange(next as unknown as FieldValue);
  }

  function updateItem(idx: number, key: string, v: FieldValue) {
    // Nested-repeater changes (e.g. editing the dropdown_items list
    // inside a menu item) can't ride the granular patch channel —
    // SK_PATCH_REPEATER_ITEM applies a single leaf-field write and
    // doesn't know how to swap a whole repeater value. Fall back to
    // the bulk path for these so the iframe re-renders correctly.
    // Nav edits are infrequent enough that the publishVersion bump
    // (visible flicker) is acceptable here.
    const fieldType = itemSchema[key]?.type;
    if (onItemFieldChange && fieldType !== "repeater") {
      // Granular path — composer owns composition state for this branch
      // and sends SK_PATCH_REPEATER_ITEM to the iframe. No publishVersion
      // bump, so typing into a label doesn't flicker the preview.
      onItemFieldChange(idx, key, v);
      return;
    }
    // Bulk replace via the full-array onChange. Triggers a
    // publishVersion bump on the composer side. Used for the legacy
    // "no in-place handler" path AND nested-repeater value changes.
    const next = items.slice();
    next[idx] = { ...next[idx], [key]: v };
    patch(next);
  }

  function addItem() {
    if (items.length >= max) return;
    // Seed strategy: clone the LAST CURRENT item so the new row inherits
    // realistic placeholder content (button labels, hrefs, descriptions,
    // styling). Only the image URL gets bumped for numbered patterns
    // like "Image+1" → "Image+5" so a gallery's new tile shows the new
    // index. Nested repeaters explicitly reset to empty.
    //
    // Why clone the last item (not template defaults): when a user has
    // a 4-item services list and adds a 5th, they expect the new row to
    // look like an existing one — same CTA label ("Learn more"), same
    // CTA href (#kontakt), same paragraph shape. Empty fields used to
    // bury the structure (where does this CTA link to? what's the field
    // for?) and force re-typing every defaults the template already
    // carries. Falls back to the last DEFAULT item when the live items
    // array is empty (rare — most repeaters have min ≥ 1).
    const seedSource: ItemMap =
      (items[items.length - 1] as ItemMap | undefined) ??
      (defaultItems[defaultItems.length - 1] as ItemMap | undefined) ??
      {};
    const seed: ItemMap = {};
    const nextIdx = items.length + 1;
    for (const [key, fieldSchema] of Object.entries(itemSchema)) {
      const sourceValue = seedSource[key];
      switch (fieldSchema.type) {
        case "image": {
          // Numbered placeholders (e.g. "...?text=Image+1&...") bump to
          // the new index. Real uploaded URLs pass through unchanged so
          // adding a row after a real photo carries that photo over —
          // user replaces if needed.
          const lastUrl =
            (sourceValue as string | undefined) ??
            fieldSchema.default_src ??
            "";
          seed[key] = bumpNumberedPlaceholder(lastUrl, nextIdx);
          break;
        }
        case "link": {
          // Clone the last link's label + href so the CTA button shows
          // a populated name + destination instead of two empty inputs.
          const lastLink = sourceValue as
            | { label?: string; href?: string }
            | undefined;
          seed[key] = {
            label: lastLink?.label ?? fieldSchema.default ?? "",
            href: lastLink?.href ?? fieldSchema.default_href ?? "",
          };
          break;
        }
        case "text":
        case "longtext":
        case "richtext": {
          const lastText = sourceValue as string | undefined;
          seed[key] = lastText ?? fieldSchema.default ?? "";
          break;
        }
        case "repeater":
          // Nested repeater (e.g. dropdown_items on a nav menu item)
          // starts EMPTY so a freshly-added menu link doesn't inherit
          // the template's nested defaults (which exist only as the
          // pattern for the dropdown anchor item). The user opts in to
          // a dropdown by adding items inside this nested editor.
          seed[key] = [];
          break;
        default:
          seed[key] = (sourceValue as FieldValue) ?? "";
      }
    }
    idRef.current = [...idRef.current, genId()];
    patch([...items, seed]);
  }

  function removeItem(idx: number) {
    if (items.length <= min) return;
    const next = items.slice();
    next.splice(idx, 1);
    idRef.current = idRef.current.slice();
    idRef.current.splice(idx, 1);
    patch(next);
  }

  // ── DnD wiring ──
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Small activation distance so a click on the trash/inputs doesn't
      // start a drag accidentally.
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    idRef.current = arrayMove(ids, from, to);
    patch(arrayMove(items, from, to));
  }

  const atMin = items.length <= min;
  const atMax = items.length >= max;

  // Collapsible by default — repeaters can hold many items each with their
  // own nested fields, so the right panel would otherwise become a wall of
  // inputs. Mirrors FieldGroup's UX for fixed-field buckets.
  const [open, setOpen] = useState(false);

  // Compact opt-in for empty nested repeaters. Plain menu links
  // shouldn't carry a full collapsed-chip dropdown editor — that
  // wastes vertical space across N nav rows. Instead we render a
  // single tiny "+ Add <name>" link. Clicking it seeds the first
  // sub-item, which both grows the items array AND flips this
  // component into its normal collapsible-editor mode on the next
  // render (because items.length > 0 then). Lets users opt any row
  // into a dropdown without permanent UI noise on rows that stay
  // plain links.
  if (compactWhenEmpty && items.length === 0) {
    if (atMax) return null;
    return (
      <button
        type="button"
        onClick={addItem}
        className="text-[11px] text-muted-foreground hover:text-(--dash-accent) transition-colors flex items-center gap-1 px-1.5 py-1 -mx-1 rounded-md"
      >
        <Plus className="h-3 w-3" />
        Add {humanize(fieldKey).toLowerCase()}
      </button>
    );
  }

  return (
    <div className="rounded-lg border dash-hairline bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 dash-row text-left"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-sm font-medium capitalize">{humanize(fieldKey)}</span>
        <span className="dash-chip text-[10px] tabular-nums rounded-full px-2 py-0.5">
          {items.length} / {max}
        </span>
      </button>

      {open && (
        <div className="px-3 py-3 space-y-2 bg-background border-t dash-hairline">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {(() => {
                  // Pre-compute effective per-item ids in the SAME order
                  // they'll render, mirroring the renderer's pass: slug
                  // from `__item_id` override if set, else from the
                  // item-id-source field's value, else `item-N`. Track
                  // a usedIds set so duplicates get -2 / -3 suffixes
                  // exactly like the renderer does. Authors see the
                  // resulting id in the chip even before they edit, and
                  // any rename they make matches what the iframe paints.
                  const idSourceKey = schema.item_id_source;
                  const usedItemIds = new Set<string>();
                  const effectiveIds: Array<{
                    id: string;
                    overridden: boolean;
                  } | null> = items.map((it, idx) => {
                    if (!idSourceKey) return null;
                    const explicit =
                      typeof it.__item_id === "string"
                        ? (it.__item_id as string).trim()
                        : "";
                    let id: string;
                    if (explicit) {
                      id = slugifyAnchorId(explicit);
                    } else {
                      const raw = it[idSourceKey];
                      const sourceText =
                        typeof raw === "string"
                          ? raw
                          : raw &&
                              typeof raw === "object" &&
                              !Array.isArray(raw) &&
                              typeof (raw as { label?: unknown }).label ===
                                "string"
                            ? ((raw as { label: string }).label)
                            : "";
                      id = slugifyAnchorId(sourceText);
                    }
                    // Slovak fallback — see parser.ts for rationale.
                    if (!id) id = `polozka-${idx + 1}`;
                    let final = id;
                    let n = 2;
                    while (usedItemIds.has(final)) {
                      final = `${id}-${n}`;
                      n++;
                    }
                    usedItemIds.add(final);
                    return { id: final, overridden: !!explicit };
                  });
                  return items.map((item, idx) => (
                    <SortableRepeaterItem
                      key={ids[idx]}
                      id={ids[idx]}
                      index={idx}
                      item={item}
                      itemSchema={itemSchema}
                      itemFieldKeys={itemFieldKeys}
                      siteId={siteId}
                      sectionCategory={sectionCategory}
                      onUpdateField={(key, v) => updateItem(idx, key, v)}
                      onRemove={() => removeItem(idx)}
                      atMin={atMin}
                      min={min}
                      itemAnchorId={effectiveIds[idx]?.id ?? null}
                      itemAnchorOverridden={
                        effectiveIds[idx]?.overridden ?? false
                      }
                      repeaterKey={repeaterKey}
                      hiddenItemFieldKeys={hiddenItemFieldKeys}
                      onItemFieldHiddenChange={onItemFieldHiddenChange}
                    />
                  ));
                })()}
              </div>
            </SortableContext>
          </DndContext>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            onClick={addItem}
            disabled={atMax}
            title={atMax ? `At maximum (${max})` : "Add a new item"}
          >
            <Plus className="h-3.5 w-3.5" />
            Add item
          </Button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sortable item card — wraps the per-item fields with a drag handle.
// ─────────────────────────────────────────────────────────────────────────────

function SortableRepeaterItem({
  id,
  index,
  item,
  itemSchema,
  itemFieldKeys,
  siteId,
  sectionCategory,
  onUpdateField,
  onRemove,
  atMin,
  min,
  itemAnchorId,
  itemAnchorOverridden,
  repeaterKey,
  hiddenItemFieldKeys,
  onItemFieldHiddenChange,
}: {
  id: string;
  index: number;
  item: ItemMap;
  itemSchema: Record<string, FieldSchema>;
  itemFieldKeys: string[];
  siteId: string;
  sectionCategory?: string;
  onUpdateField: (key: string, v: FieldValue) => void;
  onRemove: () => void;
  atMin: boolean;
  min: number;
  /** Computed effective anchor id for this item, or null if the
   *  parent repeater's template didn't opt in via data-item-id-source.
   *  Null hides the chip entirely. */
  itemAnchorId?: string | null;
  /** Whether the current id comes from the user's `__item_id` override
   *  (vs. auto-derived from the source field). Drives accent styling
   *  in the chip. */
  itemAnchorOverridden?: boolean;
  /** Parent repeater's raw key in the section schema — combined with
   *  this item's index to build composite hidden-field keys for inner
   *  link-type sub-fields. Undefined → hide toggles disabled for this
   *  item. */
  repeaterKey?: string;
  /** Full set of currently-hidden composite keys on the parent section,
   *  filtered down to this item's sub-fields by composite-key prefix
   *  inside the renderOne path below. */
  hiddenItemFieldKeys?: string[];
  /** Toggle a sub-field's visibility. Called with the composite key
   *  + new state. */
  onItemFieldHiddenChange?: (compositeKey: string, hidden: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border dash-hairline bg-card overflow-hidden"
    >
      {/* Per-item header: drag handle + index + (optional) anchor chip + delete */}
      <div className="flex items-center gap-1 px-2 py-1.5 dash-subhead border-b dash-hairline">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="p-1 rounded-md hover:bg-muted cursor-grab active:cursor-grabbing transition-colors"
          title="Drag to reorder"
          aria-label="Drag handle"
        >
          <GripVertical className="h-3 w-3 text-muted-foreground" />
        </button>
        <span className="text-[10px] font-semibold tabular-nums text-muted-foreground w-5 text-center">
          {index + 1}
        </span>
        {/* Anchor-id chip — only when the parent repeater's template
            declared data-item-id-source. Click to override per item;
            empty input reverts to auto-derived from the title field. */}
        {itemAnchorId && (
          <SectionIdChip
            value={itemAnchorId}
            isOverridden={itemAnchorOverridden}
            compact
            onChange={(next) => {
              onUpdateField("__item_id", (next ?? "") as FieldValue);
            }}
          />
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onRemove}
          disabled={atMin}
          className="p-1 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title={atMin ? `At minimum (${min})` : "Remove item"}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Item fields.
          Layout order:
            1. Singletons (fields with no `group`) — rendered as before.
            2. Groups (>=2 fields sharing the same `group` value) —
               each group wrapped in a labeled card so related fields
               read as one unit. Example: gallery-04 marks its `image`
               + `video_url` fields with data-group="media" so the
               composer panel shows ONE "Media" card with both
               uploaders inside, instead of two flat rows that read as
               unrelated. The grouping is schema-driven so any future
               template can opt in by adding data-group attributes.
          Inside a group, fields keep their original UI — we only add
          a visual wrapper; functional behavior (upload, optimistic
          preview, replace, reset) is unchanged. */}
      <div className="px-2.5 py-2 space-y-2 bg-background">
        {(() => {
          // Bucket the item's keys into rendering groups in display
          // order: singletons emit one node per key, grouped keys
          // collapse into one card per group. The walk uses the order
          // of itemFieldKeys (schema-driven), so the first appearance
          // of a group key fixes its visual position in the panel.
          const renderedGroups = new Set<string>();
          const blocks: React.ReactNode[] = [];

          function siblingsFor(k: string) {
            // Per-item AI-prompt context — only computed for image
            // fields. Unchanged from the pre-grouping logic.
            if (itemSchema[k]?.type !== "image") return undefined;
            const out: Record<string, string> = {};
            for (const peerKey of itemFieldKeys) {
              if (peerKey === k) continue;
              const peerSchema = itemSchema[peerKey];
              const t = peerSchema?.type;
              if (t === "image" || t === "video" || t === "repeater" || t === "link") continue;
              const peerVal = item[peerKey];
              if (typeof peerVal === "string" && peerVal.trim()) {
                out[peerKey] = peerVal;
                continue;
              }
              if (
                (t === "text" || t === "longtext" || t === "richtext") &&
                typeof peerSchema?.default === "string" &&
                peerSchema.default.trim()
              ) {
                out[peerKey] = peerSchema.default;
              }
            }
            return out;
          }

          function renderOne(k: string) {
            // Nested repeater: render an inner <RepeaterField> instead
            // of a placeholder input. The inner editor handles its own
            // add/remove/drag and pipes value changes back up via
            // onUpdateField, which the outer parent routes to the bulk
            // path (see updateItem in the parent component — repeater
            // values can't ride the granular SK_PATCH_REPEATER_ITEM
            // channel because the iframe patcher only knows leaf field
            // types). The recursion is bounded by template authoring
            // (we only need one level of nesting today, for the nav
            // menu's optional dropdown items per menu item).
            if (itemSchema[k]?.type === "repeater") {
              return (
                <RepeaterField
                  key={k}
                  fieldKey={k}
                  schema={itemSchema[k]}
                  value={item[k] as FieldValue | undefined}
                  siteId={siteId}
                  onChange={(v) => onUpdateField(k, v)}
                  sectionCategory={sectionCategory}
                  // compactWhenEmpty kept on (2026-05-13). When the nested
                  // repeater is empty, instead of rendering the full
                  // collapsed chip (noisy on plain links), the component
                  // shows a tiny "+ Add <name>" affordance — click it and
                  // the first sub-item appears, after which the full
                  // editor takes over. Lets the user opt every nav row
                  // into a dropdown without polluting the UI for rows
                  // that should stay plain links.
                  compactWhenEmpty
                />
              );
            }
            // Composite key used by the section's hidden_fields list.
            // Only meaningful for `link` sub-fields, but built unconditionally
            // — PlaceholderField only renders the hide toggle for links.
            const compositeKey = repeaterKey
              ? `${repeaterKey}[${index}].${k}`
              : null;
            const subFieldHidden = !!(
              compositeKey && hiddenItemFieldKeys?.includes(compositeKey)
            );
            // Alt-text wiring for image sub-fields. Stored as the
            // derived item-local key `<k>_alt`. Fallback for the
            // composer's placeholder + the renderer's empty-alt
            // fallback is the item's `title` field (catalog convention
            // — every repeater item that has both an image and text
            // pairs them by item, so the title IS the most natural
            // description of the image).
            const isImageField = itemSchema[k]?.type === "image";
            const altRaw = isImageField ? item[`${k}_alt`] : undefined;
            const altValue =
              typeof altRaw === "string" ? altRaw : undefined;
            const titleRaw = isImageField ? item.title : undefined;
            const altFallback =
              typeof titleRaw === "string" && titleRaw.trim()
                ? titleRaw.trim()
                : undefined;
            return (
              <PlaceholderField
                key={k}
                fieldKey={k}
                schema={itemSchema[k]}
                value={item[k] as FieldValue | undefined}
                siteId={siteId}
                onChange={(v) => onUpdateField(k, v)}
                sectionCategory={sectionCategory}
                siblingFields={siblingsFor(k)}
                fieldHidden={subFieldHidden}
                onFieldHiddenChange={
                  compositeKey && onItemFieldHiddenChange
                    ? (hidden) => onItemFieldHiddenChange(compositeKey, hidden)
                    : undefined
                }
                altValue={altValue}
                altFallback={altFallback}
                onAltChange={
                  isImageField
                    ? (next) => onUpdateField(`${k}_alt`, next)
                    : undefined
                }
              />
            );
          }

          for (const k of itemFieldKeys) {
            const group = itemSchema[k]?.group;
            if (!group) {
              blocks.push(renderOne(k));
              continue;
            }
            if (renderedGroups.has(group)) continue;
            renderedGroups.add(group);
            const groupKeys = itemFieldKeys.filter(
              (gk) => itemSchema[gk]?.group === group,
            );

            // Special case: "media" group with exactly one image-type
            // field and one video-type field renders as a single
            // unified MediaGroupField (one preview, one Upload/Replace
            // button, mutual exclusion between image and video). Any
            // other shape — extra fields, wrong types, or a different
            // group name — falls through to the generic visual-card
            // grouping that just stacks the standalone uploaders.
            const imageKey = groupKeys.find(
              (gk) => itemSchema[gk]?.type === "image",
            );
            const videoKey = groupKeys.find(
              (gk) => itemSchema[gk]?.type === "video",
            );
            if (
              group === "media" &&
              groupKeys.length === 2 &&
              imageKey &&
              videoKey
            ) {
              const imageVal = item[imageKey];
              const videoVal = item[videoKey];
              // Alt-text wiring for the image half. Same derived-key
              // convention as plain image fields: stored under
              // `<imageKey>_alt` on the item. Fallback is the item's
              // `title` field if present (catalog convention) so
              // galleries with both image+video and bare-image
              // patterns get the same auto-from-title default.
              const altRaw = item[`${imageKey}_alt`];
              const altValue =
                typeof altRaw === "string" ? altRaw : undefined;
              const titleRaw = item.title;
              const altFallback =
                typeof titleRaw === "string" && titleRaw.trim()
                  ? titleRaw.trim()
                  : undefined;
              blocks.push(
                <div key={`group:${group}`} className="space-y-1.5">
                  <div className="text-xs text-muted-foreground capitalize">
                    {humanizeGroup(group)}
                  </div>
                  <MediaGroupField
                    imageValue={
                      typeof imageVal === "string" ? imageVal : ""
                    }
                    videoValue={
                      typeof videoVal === "string" ? videoVal : ""
                    }
                    siteId={siteId}
                    onImageChange={(v) => onUpdateField(imageKey, v)}
                    onVideoChange={(v) => onUpdateField(videoKey, v)}
                    altValue={altValue}
                    altFallback={altFallback}
                    onAltChange={(next) =>
                      onUpdateField(`${imageKey}_alt`, next)
                    }
                  />
                </div>,
              );
              continue;
            }

            // Generic group fallback — render the bunch inside a
            // labeled card so they read as related without a custom
            // combined component.
            blocks.push(
              <div
                key={`group:${group}`}
                className="rounded-lg border dash-hairline bg-muted/20 px-2.5 py-2 space-y-2"
              >
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {humanizeGroup(group)}
                </div>
                {groupKeys.map((gk) => renderOne(gk))}
              </div>,
            );
          }
          return blocks;
        })()}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function genId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `r_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function humanize(key: string): string {
  return key
    .split(/[_-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

/** Pretty label for a field group. Known groups map to a Slovak label
 *  (the composer is the sales-facing surface — see the language rule
 *  feedback memory); unknown groups fall back to a humanized version
 *  of the raw key. Adding a new group? Drop a label here. */
const GROUP_LABELS: Record<string, string> = {
  // "Media" reads the same in English and Slovak, so the label works
  // across both audiences (composer is shared sales/tech/client).
  media: "Media",
};
function humanizeGroup(group: string): string {
  return GROUP_LABELS[group] ?? humanize(group);
}

/**
 * Increment the integer in a placeholder URL like
 * `https://placehold.co/.../?text=Image+5&...` to `text=Image+10`.
 * Returns the URL unchanged if it doesn't match the pattern, so unknown
 * URL shapes don't get garbled.
 */
function bumpNumberedPlaceholder(url: string, n: number): string {
  if (!url) return "";
  return url.replace(/(\btext=[A-Za-z]+(?:%20|\+))\d+/, `$1${n}`);
}
