"use client";

import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Trash2,
  Replace,
} from "lucide-react";
import { type FieldSchema, type FieldValue } from "./placeholder-field";
import { FieldsList } from "./fields-list";
import { VariantPicker, type SectionTemplate } from "./variant-picker";
import { AiSectionButton } from "./ai-section-button";
import { SectionIdChip } from "./section-id-chip";
import type { CompositionSection } from "@/lib/templates/render";
import type { TemplateBody } from "@/lib/templates/render-browser";

interface Props {
  section: CompositionSection;
  template: SectionTemplate | undefined;
  allTemplates: SectionTemplate[];
  /** Pre-loaded template HTML/CSS bodies — forwarded to the VariantPicker
   *  so its thumbnails render the live iframe preview (same engine used by
   *  the SectionsRail). */
  templateBodies?: Record<string, TemplateBody>;
  /** Base stylesheet used by the live preview iframes inside the picker. */
  baseCss?: string;
  siteId: string;
  /** The anchor id this section will ACTUALLY render with, AFTER the
   *  page-wide dedup pass (two `id="sluzby"` sections → second one
   *  becomes `sluzby-2`). When this differs from the section's
   *  intended id (override or template default), the SectionIdChip
   *  shows a small "→ #sluzby-2" arrow so the user can see the
   *  auto-rename. Computed once by composer-client and passed here
   *  per section so this card doesn't need to know about its
   *  siblings. */
  renderedAnchorId?: string;
  selected?: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onChangeVariant: (newTemplateId: string) => void;
  onContentChange: (key: string, value: FieldValue) => void;
  /** In-place patch hook for repeater item fields — composer wires this
   *  to send SK_PATCH_REPEATER_ITEM messages so typing into a service
   *  title or gallery alt text doesn't bump publishVersion. */
  onItemFieldChange?: (
    repeaterKey: string,
    itemIndex: number,
    itemFieldKey: string,
    value: FieldValue,
  ) => void;
  /** Fires when an editable field gains focus. The composer routes this
   *  into a SK_HIGHLIGHT_FIELD postMessage so the matching iframe element
   *  gets an outline. Pass null on blur to clear. */
  onFieldFocus?: (fieldKey: string | null) => void;
  /** Optimistic image-preview hook. Image fields call this with a local
   *  blob: URL the moment a file is picked, so the iframe shows the new
   *  image instantly while the upload to Supabase runs in the background.
   *  The composer wires it to a sendIframePatch (no state change, no
   *  autosave). Once the upload finishes, the regular `onContentChange`
   *  fires with the real Supabase URL and the iframe transitions
   *  invisibly from blob to real. */
  onPreviewImage?: (fieldKey: string, url: string) => void;
  /** "client" hides the structural buttons (drag handle, variant swap,
   *  remove) so clients can edit content but not change the page layout.
   *  Field editing inside the expanded panel always works. */
  mode?: "tech" | "client";
  /**
   * AI re-generate callback. When provided, a small ✨ button shows
   * up in the card header next to variant-swap. Clicking opens a
   * popover with an optional custom prompt; the resulting overrides
   * are passed up via this callback for the composer to apply.
   * Tech-only — clients don't get bulk AI regen on individual
   * sections (kept consistent with the global Generate button).
   */
  onAiRegenerate?: (overrides: import("./ai-generate-modal").AiOverrides) => void;
  /** Fires when a field's font-size is adjusted. Pass a pixel value
   *  to set the override, or `null` to clear it back to template
   *  default. Composer writes to section.field_styles and sends a
   *  surgical SK_PATCH_FIELD_STYLE to the iframe (no re-render). Only
   *  text-shaped fields surface the control; pass undefined to disable
   *  the feature entirely for this card (e.g., shared nav/footer). */
  onFieldSizeChange?: (rawKey: string, nextPx: number | null) => void;
  /** Reads the live computed font-size (in px) of a specific [data-field]
   *  element from the iframe. Used by the SizeControls so the FIRST
   *  +/− click starts at whatever the user currently sees rendered,
   *  rather than jumping to a hard-coded fallback. */
  measureFieldSize?: (rawKey: string) => number | null;
  /** Fires when a field's max-width is adjusted. Parallel to
   *  onFieldSizeChange — composer writes section.field_styles[<rawKey>].width
   *  and sends the same SK_PATCH_FIELD_STYLE postMessage. */
  onFieldWidthChange?: (rawKey: string, nextPx: number | null) => void;
  /** Reads the live painted width (in px) of a specific [data-field]
   *  element from the iframe. */
  measureFieldWidth?: (rawKey: string) => number | null;
  /** Toggles the per-field "fill section" override. true = breakout
   *  active (data-fill="true" on element + breakout CSS rule applies),
   *  false = clear the override. Width slider is disabled in the UI
   *  while fill is on (fill wins at render). */
  onFieldFillChange?: (rawKey: string, fill: boolean) => void;
  /** Toggles per-field visibility. rawKey is either a top-level field
   *  key ("hero_cta") or a repeater item composite key
   *  ("services_items[2].service_cta"). hidden=true adds the key to
   *  section.hidden_fields; false removes it. Both renderers strip
   *  matching DOM elements out of the rendered page. */
  onFieldHiddenChange?: (rawKey: string, hidden: boolean) => void;
  /** Site brand record. Forwarded straight to FieldsList so the
   *  brand-locked field display kicks in for phone / email / address
   *  fields (the renderer's withBrandContact pass overrides those at
   *  publish, so the editor needs to show the same brand value to
   *  prevent the "field shows X but page shows Y" mismatch). */
  brand?: import("@/lib/composer/brand").SiteBrand;
}

export function SectionCard({
  section,
  template,
  allTemplates,
  templateBodies,
  baseCss,
  siteId,
  renderedAnchorId,
  selected,
  onSelect,
  onRemove,
  onChangeVariant,
  onContentChange,
  onItemFieldChange,
  onFieldFocus,
  onPreviewImage,
  mode = "tech",
  onAiRegenerate,
  onFieldSizeChange,
  measureFieldSize,
  onFieldWidthChange,
  measureFieldWidth,
  onFieldFillChange,
  onFieldHiddenChange,
  brand,
}: Props) {
  // Client mode hides the variant-swap button + picker AND the Remove
  // button (Peter 2026-05-08: clients can't add a section back once
  // removed because the SectionsRail is hidden too — so Remove would be
  // a one-way trap). Clients keep drag-reorder + content editing only.
  // Tech retains everything.
  const isClientMode = mode === "client";
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [variantPickerOpen, setVariantPickerOpen] = useState(false);
  // Expansion is driven by selection — only one card open at a time.
  const expanded = !!selected;

  // ── dnd-kit sortable wiring ──
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  // Combine dnd-kit's setNodeRef with our own scroll-into-view ref.
  const setRefs = (el: HTMLDivElement | null) => {
    cardRef.current = el;
    setNodeRef(el);
  };

  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    // While dragging, lift above neighbors so the shadow looks right.
    zIndex: isDragging ? 20 : undefined,
  };

  useEffect(() => {
    // Don't scroll while a drag is in progress — fights with dnd-kit's transform.
    if (selected && !isDragging) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selected, isDragging]);

  if (!template) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
        <p className="text-sm font-medium text-destructive">Template missing</p>
        <p className="text-xs text-muted-foreground mt-1">
          Template id <code>{section.template_id}</code> was deleted.
        </p>
        <Button variant="outline" size="sm" className="mt-2" onClick={onRemove}>
          Remove this section
        </Button>
      </div>
    );
  }

  const schema = template.placeholder_schema as Record<string, FieldSchema>;
  const fieldKeys = Object.keys(schema);

  return (
    <div
      ref={setRefs}
      style={dragStyle}
      className={`rounded-lg border bg-card overflow-hidden ${
        isDragging ? "shadow-lg" : "transition-colors"
      } ${
        selected
          ? "border-primary ring-2 ring-primary/30 shadow-md"
          : "hover:border-primary/40"
      }`}
    >
      {/* Header — click anywhere here toggles open/closed via selection.
          The hover state used to be just `cursor: pointer` with no visual
          change, which made it easy to miss that the whole bar is
          clickable (people defaulted to the chevron on the right). Added
          a hover background tint per state so the affordance reads at a
          glance, plus a title tooltip naming the action. */}
      <div
        onClick={onSelect}
        title={selected ? "Click to collapse" : "Click to expand"}
        className={`flex items-center gap-2 px-3 py-2 border-b transition-colors cursor-pointer ${
          selected
            ? "bg-primary/10 hover:bg-primary/20"
            : "bg-muted/30 hover:bg-muted/60"
        }`}
      >
        {/* Drag handle — pointer-down on the grip starts the drag.
            stopPropagation on click so a plain (non-drag) click on the grip
            doesn't toggle selection. */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="touch-none p-0.5 -m-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          title="Drag to reorder"
          aria-label="Drag to reorder section"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="text-[10px] uppercase tracking-wide rounded bg-muted px-1.5 py-0.5 font-medium">
          {template.category}
        </span>
        {/* Title block — template name on top, section-id chip tucked
            directly underneath in a smaller, accent-tinted font so it
            reads as the section's anchor reference rather than a
            sibling control. Both share the same min-w-0 container so
            long template names truncate gracefully. */}
        <div className="flex flex-col min-w-0 leading-tight">
          <span className="text-xs font-normal text-muted-foreground truncate">
            {template.name}
          </span>
          {(() => {
            const overrideId =
              (section.content_overrides?.__section_id as
                | string
                | undefined) ?? null;
            const defaultId =
              templateBodies?.[section.template_id]?.defaultSectionId ?? null;
            const effective = overrideId ?? defaultId;
            if (!effective) return null;
            return (
              <SectionIdChip
                value={effective}
                isOverridden={!!overrideId}
                renderedId={renderedAnchorId}
                compact
                onChange={(next) => {
                  // Empty string is the "no override" signal — renderer
                  // Pass 4 treats it as falsy and the template default
                  // takes over again.
                  onContentChange(
                    "__section_id",
                    (next ?? "") as FieldValue,
                  );
                }}
              />
            );
          })()}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          {/* AI re-generate button — tech-only, opens a popover with
              optional custom instructions, then re-rolls all text in
              this section. Lives left of variant-swap so the order
              reads "edit content (✨), change layout (Replace),
              remove (Trash)". */}
          {!isClientMode && onAiRegenerate && (
            <AiSectionButton
              siteId={siteId}
              sectionId={section.id}
              onApply={onAiRegenerate}
            />
          )}
          {/* Variant-swap button — hidden in client mode (Peter 2026-05-08).
              Clients edit content of an existing section, but can't pick
              a different template variant. Tech retains full swap power. */}
          {!isClientMode && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                setVariantPickerOpen(true);
              }}
              title="Change variant"
              aria-label="Change variant"
            >
              <Replace className="h-3.5 w-3.5" />
            </Button>
          )}
          {/* Remove — also hidden in client mode. Without the SectionsRail
              (also hidden), removal would be irreversible from the client
              side: they couldn't pick the same template back. Tech keeps
              the button. */}
          {!isClientMode && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              title="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Fields — grouped. Stop propagation so typing/clicking inside
          doesn't re-trigger onSelect.

          ── Panel animation ──
          Uses the `grid-template-rows: 0fr → 1fr` trick to animate
          auto-height content with pure CSS. The outer grid container
          provides the animation; the inner `overflow-hidden` clips
          content while collapsing. The panel stays mounted at all
          times (no conditional `{expanded &&` wrap) so the transition
          fires both ways — unmounting would skip the collapse.

          Easing: expand uses an overshoot bezier (≈ ease-out-back) so
          the panel "settles in" with a subtle bounce. Collapse uses a
          standard ease-out so it tucks away cleanly without overshoot
          (overshoot collapsing reads as glitchy). Opacity layered on
          top so content fades rather than appearing through the slot.

          NOTE: chevron icon NOT animated — Peter wants the panel
          animation alone, not a chevron spin. The two-icon swap above
          stays as-is. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ${
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
        style={{
          // Inline because Tailwind's arbitrary-value parser can mangle
          // cubic-bezier in JIT mode; inline is bulletproof.
          transitionTimingFunction: expanded
            ? "cubic-bezier(0.34, 1.56, 0.64, 1)"
            : "cubic-bezier(0.4, 0, 0.2, 1)",
        }}
        aria-hidden={!expanded}
      >
        <div className="overflow-hidden">
          <div className="px-3 py-3">
            {fieldKeys.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">
                This template has no editable fields.
              </p>
            ) : (
              <FieldsList
                category={template.category}
                schema={schema}
                overrides={
                  (section.content_overrides ?? {}) as Record<string, FieldValue>
                }
                siteId={siteId}
                onChange={onContentChange}
                onItemFieldChange={onItemFieldChange}
                onFieldFocus={onFieldFocus}
                onPreviewImage={onPreviewImage}
                fieldStyles={section.field_styles}
                onFieldSizeChange={onFieldSizeChange}
                measureFieldSize={measureFieldSize}
                onFieldWidthChange={onFieldWidthChange}
                measureFieldWidth={measureFieldWidth}
                onFieldFillChange={onFieldFillChange}
                hiddenFields={section.hidden_fields ?? []}
                onFieldHiddenChange={onFieldHiddenChange}
                /* Role-aware items cap. Tech-admin/super-admin composer
                   gets no extra cap (template's data-max wins, which is
                   999 = effectively unlimited for galleries). Client
                   composer gets a 40-photo safety net on galleries —
                   covers any reasonable small-business gallery and
                   prevents accidental 500-photo dumps that would tank
                   the page weight + publish time. If a client legitimately
                   needs more, tech admin can bump it on request. */
                maxItemsCap={
                  isClientMode && template.category === "gallery"
                    ? 40
                    : undefined
                }
                brand={brand}
              />
            )}
          </div>
        </div>
      </div>

      {/* VariantPicker overlay — never mounted in client mode so even a
          stray ref to setVariantPickerOpen can't surface it (the trigger
          button above is also gated, so this is belt-and-suspenders). */}
      {!isClientMode && (
        <VariantPicker
          open={variantPickerOpen}
          onOpenChange={setVariantPickerOpen}
          category={template.category}
          templates={allTemplates}
          templateBodies={templateBodies}
          baseCss={baseCss}
          currentTemplateId={template.id}
          onPick={(newId) => {
            onChangeVariant(newId);
            setVariantPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
