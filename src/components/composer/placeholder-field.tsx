"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Eye, EyeSlash as EyeOff, Image as ImageIcon, CircleNotch as Loader2, Envelope as MailIcon, ArrowsOut as Maximize2, MapPin, ChatCircle as WhatsappIcon, ArrowsHorizontal as MoveHorizontal, Phone as PhoneIcon, ArrowCounterClockwise as RotateCcw, Sparkle as Sparkles, VideoCamera as VideoIcon, X, Link as LinkIcon } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sanitizeRichText } from "@/lib/templates/sanitize";
import { ComposerRichTextEditor } from "./composer-rich-text-editor";
import {
  deleteStagedImage,
  uploadImage,
  uploadVideo,
  useDisplayUrl,
} from "@/lib/composer/image-store";
import { useUploadTracker } from "@/lib/composer/upload-tracker";
import { useSiteAdminMode } from "./site-admin-mode";
import { buildImagePrompt } from "@/lib/ai/image-prompt-builder";
import { HrefAutocomplete } from "./href-autocomplete";

export type FieldType =
  | "text"
  | "longtext"
  | "image"
  /** Self-hosted video. Uploads land in the composer-video Supabase
   *  bucket (separate from images so size caps + lifecycle differ),
   *  and the live site streams the file straight from Supabase —
   *  publish.ts skips composer-video URLs. Template authors place the
   *  data-field on a `<video>` (or its nested `<source>`) element. */
  | "video"
  | "link"
  | "richtext"
  | "repeater"
  /** Google Maps location — stored as a string. Two input modes auto-
   *  selected from the value's format: a comma-separated lat,lng pair
   *  is treated as raw GPS coordinates, anything else is a free-text
   *  address. The renderer URL-encodes whichever string is stored into
   *  the Google Maps embed `q=` parameter — coordinates pin exactly,
   *  addresses get geocoded by Google. Backwards-compatible with
   *  pre-existing string values stored as plain `text`. */
  | "map"
  /** On/off toggle. Stored as the string "true" / "false" via the
   *  string-shaped FieldValue. Composer renders a switch. Currently
   *  used by the contact-form recipient toggle — see parser.ts FieldType
   *  for the full convention. */
  | "boolean";

export interface FieldSchema {
  type: FieldType;
  /** Visual grouping name. Repeater item editors render same-group
   *  fields inside a single card. Authoring: `data-group="media"` on
   *  the template element. Optional — fields without a group render
   *  individually. Kept in lockstep with parser.ts's FieldSchema. */
  group?: string;
  /** Default text content (text/longtext) or default link label */
  default?: string;
  /** Default image src */
  default_src?: string;
  /** Default link href */
  default_href?: string;
  /** 0-based display order (stamped at upload time). Used by FieldsList to
   *  sort fields reliably — Postgres JSONB doesn't preserve key insertion order. */
  order?: number;
  // ── Repeater-only ──
  min?: number;
  max?: number;
  item_schema?: Record<string, FieldSchema>;
  default_items?: Array<Record<string, FieldValue>>;
  /** Item-local field key whose value drives each item's auto-generated
   *  anchor id (slugified). Set at parse time from the template's
   *  `data-item-id-source="<fieldKey>"` attribute. Kept in lockstep with
   *  parser.ts's FieldSchema. */
  item_id_source?: string;
}

/**
 * Stored value for a field.
 * - text/longtext/image/richtext → string
 * - link → { label?, href? }
 * - repeater → Array<{ [itemFieldKey]: FieldValue }>
 */
export type FieldValue =
  | string
  | { label?: string; href?: string }
  | Array<Record<string, unknown>>;

interface Props {
  fieldKey: string;
  schema: FieldSchema;
  value: FieldValue | undefined;
  siteId: string;
  onChange: (value: FieldValue) => void;
  /** Fires `true` when any of this field's inputs gains focus, `false`
   *  when focus leaves. The composer turns these into SK_HIGHLIGHT_FIELD
   *  postMessages so the matching iframe element gets an outline. The
   *  fieldKey is supplied by the parent (FieldsList) so this component
   *  doesn't need to know which key belongs to the data-field selector. */
  onFocusField?: (focused: boolean) => void;
  /** Image fields call this with a local blob: URL the moment a file is
   *  picked, before the upload starts. The composer paints the iframe
   *  with that URL via SK_PATCH_FIELD without touching composition state,
   *  so the user sees the new image instantly while the actual upload
   *  to Supabase runs in the background. Once the upload finishes,
   *  `onChange` fires with the real Supabase URL and the iframe
   *  transitions blob → real silently. */
  onOptimisticImage?: (url: string) => void;
  /** Section category (e.g., "hero", "services", "gallery"). Forwarded
   *  by FieldsList so the AI image button can build a smart prompt
   *  based on the field's home section. Optional — when missing, the
   *  prompt builder still works but with less specific output. */
  sectionCategory?: string;
  /** Peer string fields the AI image button can reference when building
   *  a prompt. For a SECTION-level field (e.g., hero_image) this is
   *  the rest of the section's text fields (hero_headline, hero_subtext,
   *  ...). For a REPEATER-ITEM image (e.g., service[1].image) this is
   *  the rest of THAT item's fields (service.title, service.description).
   *  Lets the prompt builder generate per-row visuals — gutter image
   *  for the gutter service item, roof image for the roof item — instead
   *  of one generic industry prompt for every image on the site.
   *  Only string-typed peers are forwarded; image/repeater/link peers
   *  are noise for prompt construction. */
  siblingFields?: Record<string, string>;
  /** Current font-size override in CSS pixels. undefined = no override
   *  (template default wins). Only applies to text/longtext/richtext
   *  fields; the +/− UI is hidden for other types. */
  fieldSize?: number;
  /** Fires when the user adjusts size. Pass a pixel value to set the
   *  override, or `null` to clear it (back to template default). */
  onFieldSizeChange?: (nextPx: number | null) => void;
  /** Returns the field's CURRENT rendered font-size (in px) from the
   *  iframe. Called by SizeControls on the FIRST +/− click so the
   *  override starts from what the user actually sees — avoids
   *  shrinking a 48px hero to 18px the moment + is clicked. */
  getMeasuredSize?: () => number | null;
  /** Current max-width override in CSS pixels. Parallel to fieldSize —
   *  undefined = no override (template default wins). Same gating
   *  (text/longtext/richtext only). */
  fieldWidth?: number;
  /** Fires when the user adjusts width. null clears the override. */
  onFieldWidthChange?: (nextPx: number | null) => void;
  /** Returns the field's CURRENT painted width (in px) from the iframe
   *  via getBoundingClientRect. First +/− click starts from this value
   *  so adjusting a 720px-wide paragraph starts at 720 not 600. */
  getMeasuredWidth?: () => number | null;
  /** Whether fill-section breakout is currently ON for this field. */
  fieldFill?: boolean;
  /** Toggles the fill-section breakout. true = ON (data-fill="true"
   *  set on element, breakout CSS rule applies), false = OFF (cleared). */
  onFieldFillChange?: (fill: boolean) => void;
  /** Whether this field is currently hidden from render. Only meaningful
   *  for `link` type fields (buttons) — text/image/etc. ignore it. The
   *  composer-side toggle exists only on links because hiding text or
   *  images is what `clear the value` already does; buttons need a
   *  proper hide so the label/href data survives toggling off + on. */
  fieldHidden?: boolean;
  /** Fires when the user clicks the eye icon on a link field. Only
   *  wired when the field is a `link` type — other field types
   *  receive the prop but never call it. */
  onFieldHiddenChange?: (hidden: boolean) => void;
  /** Current alt-text override for an IMAGE field. Stored on
   *  composition under the derived key `<fieldKey>_alt` so the
   *  feature works on every existing image field without schema or
   *  template changes. undefined = no override (renderer falls back
   *  to the sibling title field's value via `altFallback` below, or
   *  to the template-default empty alt when there's no sibling). */
  altValue?: string;
  /** Renderer-side fallback used when `altValue` is empty: typically
   *  the sibling `title` field of a repeater item. Composer shows
   *  this as PLACEHOLDER text in the alt input so the user can see
   *  what the live site will use, and the renderer applies it as
   *  the actual `alt=""` value when no explicit override exists.
   *  Optional — top-level images without a natural sibling pass
   *  undefined and the alt input shows generic placeholder copy. */
  altFallback?: string;
  /** Fires when the user types in the alt-text input. Composer
   *  writes the value to the `<fieldKey>_alt` key on the same
   *  overrides scope (item-local for repeater images, section-level
   *  for top-level images). Pass an empty string to clear. */
  onAltChange?: (next: string) => void;
}

/** Step size for +/− buttons. 2px gives noticeable changes without
 *  feeling jumpy. */
const SIZE_STEP_PX = 2;
/** Sane bounds matched to renderer clamps in parser.ts +
 *  render-browser.ts. UI prevents typing outside this range. */
const SIZE_MIN_PX = 8;
const SIZE_MAX_PX = 200;
/** Where +/− starts from when the field has NO override yet. 18px is a
 *  reasonable middle that's slightly above body-text default — user
 *  sees something change on first click, then refines from there. */
const SIZE_DEFAULT_START_PX = 18;

/** Width controls: 20px step (vs 2px for size). Width changes need to
 *  be visible per click, and a 2px width delta is imperceptible — 20px
 *  ≈ one or two characters of line-length difference. */
const WIDTH_STEP_PX = 20;
/** Same range as parser.ts FIELD_WIDTH_MIN/MAX_PX. */
const WIDTH_MIN_PX = 240;
const WIDTH_MAX_PX = 1400;
/** Fallback when iframe measurement isn't available and no override is
 *  set. 720px ≈ a comfortable reading column on a desktop layout (about
 *  65 chars of body text at 16px). */
const WIDTH_DEFAULT_START_PX = 720;

/**
 * Tiny inline +/− control for the per-field font size.
 *
 * Three behaviors stacked into one tight UI:
 *   1. − and + step the value by SIZE_STEP_PX (clamped to MIN/MAX).
 *   2. The current px value (or "Aa" when no override is set) is
 *      click-to-edit — clicking turns it into an input field where
 *      the user can type a custom value. Enter / blur commits; empty
 *      input + Enter clears the override entirely.
 *   3. − below MIN or + above MAX is disabled (greyed) — the value
 *      can't escape the supported range.
 *
 * When `size === undefined` (no override), the value column shows "Aa"
 * and the FIRST +/− click reads the field's currently-rendered font
 * size from the iframe via `getMeasuredSize()`. This way clicking + on
 * a 48px hero takes it to 50px (not 18px — which was the previous
 * confusing behavior). Falls back to SIZE_DEFAULT_START_PX when the
 * measurement isn't available yet (iframe still loading, etc.).
 *
 * The revert button (↺) only appears when an override IS set —
 * clicking it clears the override and the field returns to its
 * template-default size. Discoverable for users who set a size,
 * decided they don't like it, and want to undo without typing.
 */
function SizeControls({
  size,
  onChange,
  getMeasuredSize,
}: {
  size: number | undefined;
  onChange: (next: number | null) => void;
  getMeasuredSize?: () => number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function clamp(n: number): number {
    return Math.max(SIZE_MIN_PX, Math.min(SIZE_MAX_PX, n));
  }
  /**
   * Resolve the "starting value" for a +/− adjustment.
   *   1. Existing override wins (user is mid-adjustment).
   *   2. Iframe-measured size next (start from what user sees).
   *   3. Default fallback last (iframe not ready / element missing).
   */
  function startingValue(): number {
    if (typeof size === "number") return size;
    const measured = getMeasuredSize?.();
    if (typeof measured === "number" && measured > 0) return measured;
    return SIZE_DEFAULT_START_PX;
  }
  function shrink() {
    onChange(clamp(startingValue() - SIZE_STEP_PX));
  }
  function grow() {
    onChange(clamp(startingValue() + SIZE_STEP_PX));
  }
  function reset() {
    onChange(null);
  }
  function startEdit() {
    setDraft(typeof size === "number" ? String(size) : "");
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }
  function commitEdit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === "") {
      onChange(null);
      return;
    }
    const parsed = parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) return;
    onChange(clamp(parsed));
  }

  const canShrink = typeof size !== "number" || size > SIZE_MIN_PX;
  const canGrow = typeof size !== "number" || size < SIZE_MAX_PX;
  const hasOverride = typeof size === "number";

  return (
    <div
      className="flex items-center gap-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Revert button — positioned BEFORE the − so the visual order
          reads as "undo" → "shrink" → "value" → "grow". Its slot is
          ALWAYS reserved (h-5 w-5) and only the icon is hidden when no
          override is active. This means the − [Npx] + cluster keeps the
          same absolute position whether or not the revert icon is
          visible — no layout shift the moment the user makes their
          first edit. */}
      <button
        type="button"
        onClick={reset}
        disabled={!hasOverride}
        title="Reset to default"
        aria-label="Reset to default"
        // Use `invisible` (visibility: hidden) when there's no override
        // — preserves the layout slot, just hides the pixel ink. Don't
        // use `hidden` or conditional render because either would
        // collapse the slot and shift everything left/right.
        className={
          "h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground transition-colors " +
          (hasOverride
            ? "hover:text-foreground hover:bg-muted"
            : "invisible pointer-events-none")
        }
      >
        <RotateCcw className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={shrink}
        disabled={!canShrink}
        title="Smaller"
        aria-label="Smaller"
        className="h-5 w-5 inline-flex items-center justify-center rounded text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        −
      </button>
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          min={SIZE_MIN_PX}
          max={SIZE_MAX_PX}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          className="h-5 w-10 text-center text-[10px] font-semibold tabular-nums bg-background border border-input rounded px-0 outline-none focus:border-primary"
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          title="Click to enter custom size"
          aria-label="Edit size"
          className="h-5 min-w-8 px-1 text-[10px] font-semibold tabular-nums text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
        >
          {typeof size === "number" ? `${size}px` : "Aa"}
        </button>
      )}
      <button
        type="button"
        onClick={grow}
        disabled={!canGrow}
        title="Larger"
        aria-label="Larger"
        className="h-5 w-5 inline-flex items-center justify-center rounded text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        +
      </button>
    </div>
  );
}

/**
 * Twin of SizeControls for the per-field max-width override.
 *
 * Same UX (↺ − Npx +), different unit semantics: width changes need
 * larger steps (20px vs size's 2px) to be visibly different on each
 * click, and the px display is wider (e.g. "720px" vs "32px"). When no
 * override is set, the first click reads the field's actual painted
 * width via getMeasuredWidth() so adjusting from a 800px paragraph
 * starts at 800, not the 720 default fallback.
 *
 * Icon column shows ⟷ instead of Aa when no override is set — visual
 * signal that this cluster controls horizontal extent, not font size.
 */
function WidthControls({
  size,
  onChange,
  getMeasuredSize,
  disabled,
  disabledTitle,
}: {
  size: number | undefined;
  onChange: (next: number | null) => void;
  getMeasuredSize?: () => number | null;
  /** When true, the entire cluster greys out and stops responding to
   *  clicks. Used while "Fill section" is active — fill wins at render,
   *  so the width slider would be deceptive if left enabled. */
  disabled?: boolean;
  /** Tooltip shown on the disabled cluster explaining why it's off. */
  disabledTitle?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function clamp(n: number): number {
    return Math.max(WIDTH_MIN_PX, Math.min(WIDTH_MAX_PX, n));
  }
  function startingValue(): number {
    if (typeof size === "number") return size;
    const measured = getMeasuredSize?.();
    if (typeof measured === "number" && measured > 0) return measured;
    return WIDTH_DEFAULT_START_PX;
  }
  function shrink() {
    if (disabled) return;
    onChange(clamp(startingValue() - WIDTH_STEP_PX));
  }
  function grow() {
    if (disabled) return;
    onChange(clamp(startingValue() + WIDTH_STEP_PX));
  }
  function reset() {
    if (disabled) return;
    onChange(null);
  }
  function startEdit() {
    if (disabled) return;
    setDraft(typeof size === "number" ? String(size) : "");
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }
  function commitEdit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === "") {
      onChange(null);
      return;
    }
    const parsed = parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) return;
    onChange(clamp(parsed));
  }

  const canShrink = !disabled && (typeof size !== "number" || size > WIDTH_MIN_PX);
  const canGrow = !disabled && (typeof size !== "number" || size < WIDTH_MAX_PX);
  const hasOverride = typeof size === "number";

  return (
    <div
      className={
        "flex items-center gap-0.5 " +
        (disabled ? "opacity-40 pointer-events-none" : "")
      }
      title={disabled ? disabledTitle : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={reset}
        disabled={!hasOverride}
        title="Reset width to default"
        aria-label="Reset width to default"
        className={
          "h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground transition-colors " +
          (hasOverride
            ? "hover:text-foreground hover:bg-muted"
            : "invisible pointer-events-none")
        }
      >
        <RotateCcw className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={shrink}
        disabled={!canShrink}
        title="Narrower"
        aria-label="Narrower"
        className="h-5 w-5 inline-flex items-center justify-center rounded text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        −
      </button>
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          min={WIDTH_MIN_PX}
          max={WIDTH_MAX_PX}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          className="h-5 w-14 text-center text-[10px] font-semibold tabular-nums bg-background border border-input rounded px-0 outline-none focus:border-primary"
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          title="Click to enter custom width"
          aria-label="Edit width"
          className="h-5 min-w-12 px-1 text-[10px] font-semibold tabular-nums text-muted-foreground hover:text-foreground hover:bg-muted rounded inline-flex items-center justify-center gap-0.5 transition-colors"
        >
          {typeof size === "number" ? (
            `${size}px`
          ) : (
            <MoveHorizontal className="h-3 w-3" />
          )}
        </button>
      )}
      <button
        type="button"
        onClick={grow}
        disabled={!canGrow}
        title="Wider"
        aria-label="Wider"
        className="h-5 w-5 inline-flex items-center justify-center rounded text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        +
      </button>
    </div>
  );
}

/**
 * Toggle button for the per-field "fill section" breakout.
 *
 * Single icon (Maximize2 / ⛶) that flips an attribute on the field.
 * When ON: button is highlighted (primary background, white icon),
 * tooltip reads "Fill section (click to disable)", and the WidthControls
 * cluster next to it greys out via its `disabled` prop because fill
 * overrides any max-width value at render time.
 *
 * When OFF: button is muted-foreground hover-style, tooltip reads "Fill
 * section edge-to-edge".
 *
 * Click toggles the value. No state internal — controlled by parent.
 */
function FillToggle({
  active,
  onChange,
}: {
  active: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange(!active);
      }}
      title={
        active
          ? "Fill section is ON — click to disable"
          : "Fill section (edge-to-edge breakout)"
      }
      aria-label="Toggle fill section"
      aria-pressed={active}
      className={
        "h-5 w-5 inline-flex items-center justify-center rounded transition-colors " +
        (active
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "text-muted-foreground hover:text-foreground hover:bg-muted")
      }
    >
      <Maximize2 className="h-3 w-3" />
    </button>
  );
}

/**
 * Hide toggle — small eye / eye-off icon. Shown only for `link` fields
 * (CTAs, buttons). Clicking it flips section.hidden_fields[] in the
 * composition; the renderer strips the matching [data-field] element
 * from the rendered page. Data stays in content_overrides so toggling
 * back restores label + href intact (non-destructive hide).
 *
 * Visual cue when hidden: switches to Eye icon ("click to show") with
 * an amber tint so a hidden button is visible at a glance scrolling
 * the field list. When visible: muted EyeOff that hover-reveals the
 * action.
 */
function HideToggle({
  hidden,
  onChange,
}: {
  hidden: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange(!hidden);
      }}
      title={
        hidden
          ? "Hidden — click to show this button on the page"
          : "Hide this button from the page (data stays saved)"
      }
      aria-label="Toggle button visibility"
      aria-pressed={hidden}
      className={
        "h-5 w-5 inline-flex items-center justify-center rounded transition-colors " +
        (hidden
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25"
          : "text-muted-foreground hover:text-foreground hover:bg-muted")
      }
    >
      {hidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
    </button>
  );
}

/**
 * Inline alt-text input shown beneath the image picker.
 *
 * Goals
 *   1. Make the DEFAULT visible. When the user hasn't typed an alt,
 *      we render the sibling-title fallback AS the input value (not
 *      placeholder) so they see exactly what the live site will use.
 *   2. Keep typing fast. On focus, the contents are auto-selected so
 *      the first keystroke replaces the default — no manual clear.
 *   3. Keep storage clean. If the user happens to type the fallback
 *      verbatim (or clears the input), we store empty string so the
 *      renderer's auto-fallback path keeps working. This means a
 *      changed sibling title automatically updates the alt text on
 *      both surfaces without the user having to re-touch the field.
 *
 * Edge cases
 *   - No fallback + no value → input is blank with a generic prompt
 *     as placeholder. User types or leaves blank.
 *   - Explicit value matches fallback → user typed the fallback or
 *     accepted the default; we store empty so the auto-fallback
 *     stays active. Costless from the user's POV (live site renders
 *     identically) but cleaner in JSON / DB.
 */
function AltTextInput({
  value,
  fallback,
  onChange,
  onInputFocus,
  onInputBlur,
}: {
  value: string | undefined;
  fallback: string | undefined;
  onChange: (next: string) => void;
  onInputFocus?: () => void;
  onInputBlur?: () => void;
}) {
  // What the input displays. Explicit value wins; otherwise show the
  // fallback so the user can SEE the default rather than guess from a
  // placeholder. Empty when neither is present.
  const displayValue =
    typeof value === "string" && value.length > 0 ? value : fallback ?? "";
  // True when the input is currently showing the auto-fallback (i.e.
  // the user has no explicit override). Used to flag the auxiliary
  // hint below the input and to drive the select-on-focus behavior.
  const isShowingFallback =
    (value === undefined || value === "") &&
    typeof fallback === "string" &&
    fallback.length > 0;

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    // Treat "matches fallback" the same as "blank" — both mean
    // "let the auto-fallback handle it". Keeps composition JSON
    // free of redundant per-image alt entries that just echo the
    // sibling title.
    if (
      typeof fallback === "string" &&
      fallback.length > 0 &&
      next === fallback
    ) {
      onChange("");
      return;
    }
    onChange(next);
  }

  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    onInputFocus?.();
    // Select the whole default so the user's next keystroke replaces
    // it instantly. Skipped when there's nothing to select OR when the
    // user already has an explicit value (we don't want to clobber
    // their text just because they tabbed back into the field).
    if (isShowingFallback) {
      // setTimeout 0 because focus + select in the same tick can race
      // with the browser's own selection logic in some engines.
      const el = e.currentTarget;
      setTimeout(() => el.select(), 0);
    }
  }

  return (
    <div className="space-y-1">
      <label className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        Alt text
        <span
          className="text-muted-foreground/60"
          title="Image description for screen readers and image SEO. Falls back to the item title automatically."
        >
          ⓘ
        </span>
        {isShowingFallback && (
          <span className="text-[10px] text-muted-foreground/70 italic">
            (auto from title)
          </span>
        )}
      </label>
      <Input
        type="text"
        value={displayValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={onInputBlur}
        placeholder="Describe what's in the image"
        className={
          "text-xs h-8 " +
          (isShowingFallback ? "italic text-muted-foreground" : "")
        }
        maxLength={140}
      />
    </div>
  );
}

export function PlaceholderField({
  fieldKey,
  schema,
  value,
  siteId,
  onChange,
  onFocusField,
  onOptimisticImage,
  sectionCategory,
  siblingFields,
  fieldSize,
  onFieldSizeChange,
  getMeasuredSize,
  fieldWidth,
  onFieldWidthChange,
  getMeasuredWidth,
  fieldFill,
  onFieldFillChange,
  fieldHidden,
  onFieldHiddenChange,
  altValue,
  altFallback,
  onAltChange,
}: Props) {
  // Single shared handler — every input variant below wires the same pair
  // so the composer sees a consistent focus signal regardless of the
  // field's render shape (Input, Textarea, link's two-up, image button).
  const handleFocus = onFocusField ? () => onFocusField(true) : undefined;
  const handleBlur = onFocusField ? () => onFocusField(false) : undefined;
  const [uploading, setUploading] = useState(false);
  // While an upload is in flight, this overrides `value` for the
  // right-panel thumbnail so the user sees the new image instantly
  // here too — not just in the iframe preview. Cleared back to null
  // once onChange fires with the real URL (then `value` takes over).
  const [optimisticUrl, setOptimisticUrl] = useState<string | null>(null);
  // AI image generation state. Kept inline (not factored into a child
  // component) because the popover needs the same onChange handler the
  // upload path uses — extracting it would just route the same prop
  // through one more level of indirection.
  const [aiOpen, setAiOpen] = useState(false);
  const siteAdminMode = useSiteAdminMode();
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  // Tracks whether we've already pre-filled the prompt textarea this
  // session — without this guard, every popover open would clobber
  // whatever the user just typed. Reset never (per-mount) so the user
  // can clear the field and reopen if they want a fresh smart default.
  const aiPrefillDoneRef = useRef(false);

  /**
   * Fetch business context (industry/town/services) for the linked
   * proposal and pre-fill the prompt textarea using the smart-prompt
   * builder. Bailed early if the user has already typed something —
   * we never overwrite their input. Failures are silent (network down,
   * no proposal attached) — the user just sees an empty textarea and
   * writes their own prompt, same as before.
   */
  async function maybePrefillAiPrompt() {
    if (aiPrefillDoneRef.current) return;
    if (aiPrompt.trim().length > 0) return;
    aiPrefillDoneRef.current = true;
    try {
      const res = await fetch(
        `/api/composer/ai-inputs?site_id=${encodeURIComponent(siteId)}`,
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        inputs?: {
          companyName?: string;
          industry?: string;
          town?: string;
          services?: Array<{ title: string; description?: string }>;
        };
      };
      const ctx = json.inputs;
      if (!ctx) return;
      // Build the smart default. The user might tweak it before hitting
      // Generate — that's fine, this is a starting point not a lock-in.
      const draft = buildImagePrompt({
        fieldKey,
        sectionCategory,
        siblingFields,
        context: {
          companyName: ctx.companyName ?? "",
          industry: ctx.industry ?? "",
          town: ctx.town ?? "",
          services: ctx.services ?? [],
        },
      });
      // Last-second guard: the user might have started typing while
      // the fetch was in flight. Don't trample.
      setAiPrompt((current) => (current.trim().length > 0 ? current : draft));
    } catch {
      // Silent fail — empty textarea is still usable.
    }
  }
  // Tracks the AbortController of the most recent upload so picking a
  // new file cancels the in-flight upload from the previous pick. Stops
  // the obvious race ("user uploads A, immediately picks B" → A's
  // late-arriving response would otherwise overwrite B in composition)
  // and prevents Supabase from receiving a file the user already moved
  // on from (less staging garbage to clean up later).
  const uploadAbortRef = useRef<AbortController | null>(null);
  const uploadTracker = useUploadTracker();
  // DO NOT abort the in-flight upload on unmount. The composer
  // unmounts a section's fields every time the user clicks a different
  // section in the left rail — that's the common case, not "user left
  // the page". onChange remains a valid callback (it closes over the
  // section id at the parent level), so a late-arriving upload that
  // fires onChange correctly patches composition for the right section
  // regardless of which section is currently selected in the UI. The
  // upload tracker (`useUploadTracker`) holds the promise alive so
  // publish can await it.
  //
  // The intra-field race ("user picks a new file in the SAME field
  // before the previous upload finished") is still aborted inside
  // handleImageUpload below.

  // For non-link types, value is a string
  const stringValue =
    typeof value === "string"
      ? value
      : value === undefined
      ? schema.default ?? schema.default_src ?? ""
      : "";

  async function handleImageUpload(file: File) {
    // Cancel any in-flight upload from a previous pick — its result
    // (which would land later than this one) MUST NOT overwrite the
    // composition with a stale URL.
    uploadAbortRef.current?.abort();
    const abort = new AbortController();
    uploadAbortRef.current = abort;

    setUploading(true);
    // Optimistic paint — generate a local blob: URL for the file and
    // shove it into the iframe immediately. Composition state stays
    // untouched (we deliberately do NOT fire onChange yet) because a
    // blob: URL is meaningless to other devices/users; if autosave
    // captured it, the field would look broken on every other client.
    // The user sees their image right away while the upload runs in
    // the background. On success the real onChange fires and the
    // iframe quietly swaps from blob → Supabase URL with no flicker.
    const blobUrl =
      typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : null;
    if (blobUrl) {
      // Right-panel thumbnail uses optimisticUrl when set, so it
      // reflects the new image immediately without waiting for upload.
      setOptimisticUrl(blobUrl);
      if (onOptimisticImage) onOptimisticImage(blobUrl);
    }
    // Capture the URL we're about to replace BEFORE awaiting — when
    // the upload completes, we'll fire-and-forget delete this old file
    // from staging. Skips the delete for non-staged values (data URLs,
    // /_uploads/ paths from prior publishes, empty strings, etc).
    const previousUrl = typeof value === "string" ? value : "";
    try {
      // Register the upload with the composer-level tracker so publish
      // can await it. Without this the user can click Publish before
      // the upload settles, autosave has nothing to flush (state isn't
      // updated yet), and the deploy ships without this image.
      const url = await uploadTracker.trackUpload(
        uploadImage(file, siteId, abort.signal),
      );
      // Guard: the abort signal might have fired between the await
      // resolving and this line. The user moved on — the file we just
      // uploaded is already orphaned in staging, so delete it instead
      // of overwriting composition with a URL the user discarded.
      if (abort.signal.aborted) {
        void deleteStagedImage(url);
        return;
      }
      // Preload the Supabase URL into the browser cache BEFORE telling
      // the iframe to swap to it. Without this, the iframe's img.src
      // change kicks off a fresh network fetch, briefly leaving the
      // image in a half-loaded state — the user sees a visible flash
      // between the optimistic blob and the final Supabase image. With
      // the preload, the swap is instant (cache hit) and indistinguishable
      // from continuing to show the blob.
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve(); // proceed anyway on error
        img.src = url;
      });
      if (abort.signal.aborted) {
        void deleteStagedImage(url);
        return;
      }
      onChange(url); // composition gets the real URL, autosave fires
      // Only delete the previous file AFTER the new URL has landed in
      // composition — otherwise a failed onChange (state update threw)
      // would leave the field referencing a deleted file.
      if (previousUrl && previousUrl !== url) {
        void deleteStagedImage(previousUrl);
      }
    } catch (err) {
      // AbortError = a newer pick replaced this upload. Silently no-op:
      // the new pick already painted its own optimistic preview and
      // started its own upload.
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Same check for fetch errors that wrap an abort cause:
      if ((err as { name?: string })?.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
      // Best-effort rollback: snap the iframe back to whatever value
      // composition currently has (the previous image, or empty). The
      // value prop closure is stable across this async boundary.
      if (onOptimisticImage) {
        onOptimisticImage(typeof value === "string" ? value : "");
      }
    } finally {
      // Only flip uploading=false if THIS upload owns the spinner; a
      // newer pick already toggled it back on for itself.
      if (uploadAbortRef.current === abort) {
        uploadAbortRef.current = null;
        setUploading(false);
        setOptimisticUrl(null); // real `value` takes over the thumbnail
      }
      // Free the blob: URL — the iframe is now showing the Supabase URL
      // (or the rolled-back original), so the temporary handle isn't
      // referenced anywhere anymore. Skipping this leaks memory until
      // the tab closes.
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
  }

  /**
   * Video upload — sibling of handleImageUpload, routed at the API
   * level to the composer-video bucket via `kind: "video"`. The shape
   * matches the image handler so we share the abort + tracker + toast
   * plumbing, with a few deliberate omissions:
   *
   *   - No AI panel (no model in the stack generates raw video yet).
   *   - No optimistic <img> preview path; videos play in a <video>
   *     element rendered by the schema.type === "video" branch below.
   *   - No delete-on-replace today: replacing a video orphans the old
   *     file in composer-video until the future cleanup task sweeps.
   *     Acceptable for an MVP — the alternative (server DELETE API
   *     update + a deleteStagedVideo client helper) is queued as a
   *     follow-up. Trade-off is a small storage bloat per replacement.
   */
  async function handleVideoUpload(file: File) {
    uploadAbortRef.current?.abort();
    const abort = new AbortController();
    uploadAbortRef.current = abort;
    setUploading(true);

    // Optimistic preview — blob URL so the user sees the picked file
    // before the upload settles. Mirrors the image handler.
    const blobUrl =
      typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : null;
    if (blobUrl) {
      setOptimisticUrl(blobUrl);
      if (onOptimisticImage) onOptimisticImage(blobUrl);
    }

    try {
      const url = await uploadTracker.trackUpload(
        uploadVideo(file, siteId, abort.signal),
      );
      if (abort.signal.aborted) return;
      // Skip the image preload trick — `<video preload>` semantics
      // are different and not worth the wait here. The iframe swap
      // from blob → real URL is acceptable as a brief poster flash.
      onChange(url);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if ((err as { name?: string })?.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
      if (onOptimisticImage) {
        onOptimisticImage(typeof value === "string" ? value : "");
      }
    } finally {
      if (uploadAbortRef.current === abort) {
        uploadAbortRef.current = null;
        setUploading(false);
        setOptimisticUrl(null);
      }
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
  }

  /**
   * AI image generation. Same end state as a manual upload (composition
   * gets the new URL).
   *
   * Sequencing matters here. The order that finally worked across
   * back-to-back generations on different fields:
   *   1. onChange — parent re-renders, iframe srcDoc swaps, browser
   *      starts loading the new image. Panel still mounted, no race.
   *   2. yield two animation frames — gives React's commit queue +
   *      browser layout pass time to settle.
   *   3. close the panel — parent is stable, the conditional unmount
   *      doesn't collide with anything else.
   *
   * The reverse order (close first, defer onChange) consistently
   * crashed with "Failed to execute 'insertBefore' on 'Node'" because
   * the iframe's srcDoc swap fired into a half-mounted parent tree.
   * History fix: the original Popover wrapper was also part of the
   * problem (portals make the race worse) — moved to inline panel.
   */
  async function handleAiGenerate() {
    if (aiGenerating) return;
    const prompt = aiPrompt.trim();
    if (prompt.length < 3) {
      toast.error("Prompt is too short");
      return;
    }
    setAiGenerating(true);
    const previousUrl = typeof value === "string" ? value : "";
    try {
      const res = await fetch("/api/composer/ai-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: siteId, prompt }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        throw new Error(data.error || `Generation failed (${res.status})`);
      }
      // Preload the bytes into browser cache before we mutate the
      // composition — same anti-flicker trick the manual upload uses.
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = data.url!;
      });
      // STEP 1: composition update — panel STAYS open and stable while
      // the parent re-renders + iframe loads the new image.
      onChange(data.url);
      if (previousUrl && previousUrl !== data.url) {
        void deleteStagedImage(previousUrl);
      }
      toast.success("Image generated");
      // STEP 2: yield two animation frames so the parent's render
      // commit + iframe srcDoc update + browser layout pass all
      // complete before we touch the panel's mount state.
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
      // STEP 3: now close the inline panel — parent is stable, no
      // concurrent mutations, the unmount doesn't race with anything.
      setAiOpen(false);
      setAiPrompt("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed";
      toast.error(msg);
    } finally {
      setAiGenerating(false);
    }
  }

  if (schema.type === "image") {
    return (
      <div
        className="space-y-1.5"
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        <label className="text-xs text-muted-foreground capitalize">
          {humanize(fieldKey)}
        </label>
        <div className="flex items-stretch gap-2">
          {/* During an upload we override `value` with the local blob:
              URL so the thumbnail reflects the new image instantly.
              Without this, the user types in a file picker, sees no
              change here for ~1-2s, and assumes nothing happened. */}
          <ImageThumb src={optimisticUrl ?? stringValue} />
          {/* Internal helper component below the file */}
          <div className="flex-1 min-w-0 flex items-center gap-1">
            <label className="flex-1">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImageUpload(f);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={uploading}
                className="w-full h-9 text-xs cursor-pointer pointer-events-none"
                asChild
              >
                <span>
                  {uploading ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      Uploading...
                    </>
                  ) : stringValue ? (
                    "Replace"
                  ) : (
                    "Upload image"
                  )}
                </span>
              </Button>
            </label>
            {/* AI generate — toggles an INLINE panel below this row.
                We deliberately don't use a Popover here: Radix portals
                interleave with ComposerClient's iframe re-render in a
                way that crashes on the second generation in a session.
                Inline = no portal = no race. */}
            {!siteAdminMode && (
            <Button
              variant={aiOpen ? "secondary" : "ghost"}
              size="icon"
              className="h-9 w-9 shrink-0"
              title="Generate image with AI"
              type="button"
              disabled={uploading || aiGenerating}
              onClick={() => {
                const next = !aiOpen;
                setAiOpen(next);
                if (next) void maybePrefillAiPrompt();
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
            </Button>
            )}
            {value !== undefined && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => onChange("")}
                title="Reset to default"
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        {/* Alt text input — accessibility + SEO. Always rendered for
            image fields so every image in the catalog gets it for
            free; no schema or template changes required. Stored under
            the derived key `<fieldKey>_alt` in content_overrides;
            renderer writes it to `<img alt="">`. Self-contained
            component below so the visible-default + select-on-focus
            UX lives in one place. */}
        {onAltChange && (
          <AltTextInput
            value={altValue}
            fallback={altFallback}
            onChange={onAltChange}
            onInputFocus={handleFocus}
            onInputBlur={handleBlur}
          />
        )}
        {/* Inline AI panel — slides in/out when the Sparkles button is
            toggled. No portal, no async unmount: just a conditionally
            rendered child. The composer's render cascade can mutate
            this panel's parent freely without DOM-tree reconciliation
            crashes because there's nothing portaled. */}
        {aiOpen && (
          <div className="rounded-md border border-border/60 bg-muted/40 p-2.5 space-y-2">
            <Textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={3}
              autoFocus
              placeholder="e.g. Professional photo of a roofer working on a roof, daylight, sharp detail"
              className="text-xs bg-background"
              disabled={aiGenerating}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter submits — common pattern in prompt
                // textareas, matches the AI-generate modal.
                if (
                  (e.metaKey || e.ctrlKey) &&
                  e.key === "Enter" &&
                  !aiGenerating
                ) {
                  e.preventDefault();
                  void handleAiGenerate();
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">
                ~3s · FLUX.1 schnell
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className="h-7 text-xs"
                  onClick={() => setAiOpen(false)}
                  disabled={aiGenerating}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  type="button"
                  className="h-7 text-xs"
                  onClick={() => void handleAiGenerate()}
                  disabled={aiGenerating || aiPrompt.trim().length < 3}
                >
                  {aiGenerating ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3 w-3 mr-1" />
                      Generate
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (schema.type === "video") {
    // Video field — same skeleton as image but with a <video> preview
    // and a video-MIME file picker. No AI generation button. The preview
    // src follows the same optimistic-blob → final-URL swap so the user
    // sees the picked file before the upload completes. `muted` lets
    // browsers autoplay-pause on the inline preview without bugging the
    // user with permission prompts; the live site author can override
    // attributes on the actual <video> element in the template.
    const previewSrc = optimisticUrl ?? stringValue;
    return (
      <div
        className="space-y-1.5"
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        <label className="text-xs text-muted-foreground capitalize">
          {humanize(fieldKey)}
        </label>
        <div className="flex items-stretch gap-2">
          <div className="h-14 w-20 shrink-0 rounded-md border border-border/60 bg-muted/40 overflow-hidden flex items-center justify-center">
            {previewSrc ? (
              <video
                src={previewSrc}
                muted
                playsInline
                controls={false}
                className="h-full w-full object-cover"
              />
            ) : (
              <VideoIcon className="h-5 w-5 text-muted-foreground/40" />
            )}
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-1">
            <label className="flex-1">
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleVideoUpload(f);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={uploading}
                className="w-full h-9 text-xs cursor-pointer pointer-events-none"
                asChild
              >
                <span>
                  {uploading ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      Uploading...
                    </>
                  ) : stringValue ? (
                    "Replace"
                  ) : (
                    "Upload video"
                  )}
                </span>
              </Button>
            </label>
            {value !== undefined && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => onChange("")}
                title="Reset to default"
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (schema.type === "longtext") {
    return (
      <div
        className="space-y-1.5"
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground capitalize">
            {humanize(fieldKey)}
          </label>
          {(onFieldSizeChange || onFieldWidthChange || onFieldFillChange) && (
            <div className="flex items-center gap-2">
              {onFieldSizeChange && (
                <SizeControls
                  size={fieldSize}
                  onChange={onFieldSizeChange}
                  getMeasuredSize={getMeasuredSize}
                />
              )}
              {onFieldWidthChange && (
                <WidthControls
                  size={fieldWidth}
                  onChange={onFieldWidthChange}
                  getMeasuredSize={getMeasuredWidth}
                  disabled={fieldFill === true}
                  disabledTitle="Fill section is active — disable it to adjust width"
                />
              )}
              {onFieldFillChange && (
                <FillToggle
                  active={fieldFill === true}
                  onChange={onFieldFillChange}
                />
              )}
            </div>
          )}
        </div>
        {/* longtext now uses the same rich editor as richtext so authors
            get consistent formatting controls (bold/italic/underline/
            lists/link) on any multi-paragraph field. Stored as sanitized
            HTML — the renderer's `longtext` case writes via $el.html().
            `unwrap` strips TipTap's outer <p> at save time so the stored
            value is clean inline HTML; downstream consumers (slugify,
            validators, attribute stampers) read it without an HTML-strip
            pass. Multi-line input collapses to <br>-joined runs. */}
        <ComposerRichTextEditor
          value={stringValue}
          fallback={schema.default ?? ""}
          onChange={(html) => onChange(sanitizeRichText(html))}
          unwrap
        />
      </div>
    );
  }

  if (schema.type === "link") {
    // value is { label?, href? } — fall back to schema defaults for display.
    // Arrays satisfy `typeof === "object"` too, so we must explicitly
    // exclude them or TS keeps the wider Record<string, unknown>[] arm
    // and `.label`/`.href` reads fail to type-check.
    const linkValue: { label?: string; href?: string } =
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as { label?: string; href?: string })
        : {};
    const labelDisplay = linkValue.label ?? schema.default ?? "";
    // Effective href = exactly what the RENDERER will emit, so the
    // editor and the live site never disagree. parser.ts only writes an
    // href when the override carries one — a link with NO href override
    // keeps the template's original href. So:
    //
    //   - href key ABSENT (never configured) → show the template's
    //     `default_href`. That's what renders live, so the editor must
    //     show the same. (Otherwise a never-touched service link reads
    //     as empty here while pointing at `#sluzba` on the live site —
    //     the "it's not the same / not registering" bug, Peter 2026-05-28.)
    //
    //   - href PRESENT, including a deliberate "" → show it verbatim.
    //     This is what lets a cleared link STAY cleared: the first time
    //     you delete the value, href becomes "" (now defined), we stop
    //     substituting the default, and the renderer writes href="" too.
    //
    // Replaces the old "treat '' or '#' as placeholder → default_href"
    // rule, which couldn't tell "never set" from "user cleared it" and
    // so both blocked clearing AND hid the real rendered value.
    const hrefDisplay =
      linkValue.href === undefined ? schema.default_href ?? "" : linkValue.href;

    // Phone / email shortcuts: link fields whose template href is `tel:...`
    // or `mailto:...` collapse to a single input. User types the value once;
    // we mirror it into the label and derive the protocol-prefixed href
    // automatically. Storage shape stays `{ label, href }` so the parser,
    // renderer, and existing saved values are unaffected. Generic links
    // (CTAs, external URLs) still get the two-input UI below.
    // Phone-shortcut detection — FIELD KEY ONLY (Peter 2026-05-15).
    // A `tel:` href prefix alone isn't enough: a primary CTA button
    // can link to a phone number while structurally being a CTA
    // (hero-05's "Call us" button is the canonical case). Templates
    // that want the phone single-input shortcut name their field
    // with `phone` / `tel` in the key (e.g. nav_phone, footer_phone,
    // contact_phone). CTA buttons that happen to dial a number keep
    // a neutral key like `hero_cta_primary` and render via the
    // normal label + href link UI, so sales can edit the button
    // word AND the dial number independently.
    const isPhoneLink = /phone|tel/i.test(fieldKey);
    const isWhatsappLink = /whatsapp/i.test(fieldKey);
    const defaultHrefLc = schema.default_href?.toLowerCase() ?? "";
    const isEmailLink =
      defaultHrefLc.startsWith("mailto:") || /email|mail/i.test(fieldKey);
    // Social platform shortcut — field keys like `nav_facebook`,
    // `footer_instagram`, `twitter`, etc. The rendered <a> wraps an
    // <svg> icon, no visible text label. Showing a label input would
    // be misleading (typing anything would overwrite the SVG via the
    // renderer's textContent assignment), so collapse to a single URL
    // input. Storage `label` stays empty.
    // WhatsApp gets its OWN dedicated branch below (number-input UX),
    // so exclude it from the URL-input social shortcut.
    const isSocialLink =
      !isWhatsappLink &&
      /facebook|instagram|twitter|linkedin|youtube|tiktok|social/i.test(fieldKey);

    if (isSocialLink) {
      // Detect which platform for the icon + placeholder URL hint.
      const platform = /facebook/i.test(fieldKey)
        ? "facebook"
        : /instagram/i.test(fieldKey)
          ? "instagram"
          : /twitter/i.test(fieldKey)
            ? "twitter"
            : /linkedin/i.test(fieldKey)
              ? "linkedin"
              : /youtube/i.test(fieldKey)
                ? "youtube"
                : /tiktok/i.test(fieldKey)
                  ? "tiktok"
                  : "social";
      const platformLabel: Record<string, string> = {
        facebook: "Facebook",
        instagram: "Instagram",
        twitter: "Twitter / X",
        linkedin: "LinkedIn",
        youtube: "YouTube",
        tiktok: "TikTok",
        social: "Social",
      };
      const placeholderUrl: Record<string, string> = {
        facebook: "https://facebook.com/yourpage",
        instagram: "https://instagram.com/youraccount",
        twitter: "https://x.com/youraccount",
        linkedin: "https://linkedin.com/company/you",
        youtube: "https://youtube.com/@you",
        tiktok: "https://tiktok.com/@you",
        social: "https://...",
      };

      return (
        <div className={"space-y-1.5" + (fieldHidden ? " opacity-60" : "")}>
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground capitalize flex items-center gap-1.5">
              <LinkIcon className="h-3 w-3" />
              {platformLabel[platform]}
              {fieldHidden && (
                <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  · hidden
                </span>
              )}
            </label>
            {onFieldHiddenChange && (
              <HideToggle hidden={fieldHidden ?? false} onChange={onFieldHiddenChange} />
            )}
          </div>
          <Input
            type="url"
            inputMode="url"
            value={hrefDisplay}
            onChange={(e) => {
              // Keep label empty — the icon IS the visible content,
              // not text. Storage shape stays `{ label, href }` so
              // existing parser/renderer code paths are untouched.
              onChange({ label: "", href: e.target.value });
            }}
            onFocus={handleFocus}
            onBlur={handleBlur}
            className="text-sm font-mono"
            placeholder={placeholderUrl[platform]}
          />
        </div>
      );
    }

    if (isEmailLink) {
      const emailDisplay = labelDisplay;
      const placeholder =
        schema.default ||
        schema.default_href?.replace(/^mailto:/i, "") ||
        "info@example.com";

      return (
        <div className={"space-y-1.5" + (fieldHidden ? " opacity-60" : "")}>
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground capitalize flex items-center gap-1.5">
              <MailIcon className="h-3 w-3" />
              {humanize(fieldKey)}
              {fieldHidden && (
                <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  · hidden
                </span>
              )}
            </label>
            {onFieldHiddenChange && (
              <HideToggle hidden={fieldHidden ?? false} onChange={onFieldHiddenChange} />
            )}
          </div>
          <div className="relative">
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={emailDisplay}
              onChange={(e) => {
                const typed = e.target.value;
                const trimmed = typed.trim();
                onChange({
                  label: typed,
                  href: trimmed ? `mailto:${trimmed}` : "",
                });
              }}
              onFocus={handleFocus}
              onBlur={handleBlur}
              className="text-sm"
              placeholder={placeholder}
            />
          </div>
          {hrefDisplay && (
            <p className="text-[10px] text-muted-foreground font-mono">
              {hrefDisplay}
            </p>
          )}
        </div>
      );
    }

    if (isWhatsappLink) {
      // Same number-input UX as the phone shortcut, but routes to
      // a WhatsApp wa.me URL on output. The renderer's
      // `buildWhatsappHref` reads the stored bare number and emits
      // `https://wa.me/421...` — sales just types the phone, no
      // need to know the wa.me format. If a saved value happens to
      // already be a full wa.me URL (legacy default in older
      // templates), strip the protocol + ?text param so the input
      // shows just the digits ready to edit. Country code is left
      // alone — user may have typed it intentionally.
      const waMatch = hrefDisplay.match(/^https?:\/\/wa\.me\/([^?]+)/i);
      const digitsFromHref = waMatch ? waMatch[1] : hrefDisplay;
      const numberPlaceholder = "0900000000";

      return (
        <div className={"space-y-1.5" + (fieldHidden ? " opacity-60" : "")}>
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground capitalize flex items-center gap-1.5">
              <WhatsappIcon className="h-3 w-3" />
              {humanize(fieldKey)}
              {fieldHidden && (
                <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  · hidden
                </span>
              )}
            </label>
            {onFieldHiddenChange && (
              <HideToggle hidden={fieldHidden ?? false} onChange={onFieldHiddenChange} />
            )}
          </div>
          <Input
            type="tel"
            inputMode="tel"
            value={digitsFromHref}
            onChange={(e) => {
              const typed = e.target.value;
              // Store the bare number — renderer builds the wa.me
              // URL on output. Label stays empty (the widget's <a>
              // wraps an SVG icon, no visible text).
              onChange({ label: "", href: typed });
            }}
            onFocus={handleFocus}
            onBlur={handleBlur}
            className="text-sm font-mono"
            placeholder={numberPlaceholder}
          />
        </div>
      );
    }

    if (isPhoneLink) {
      // Single input — user types the dial number once; we sync it
      // into BOTH `label` and `href` because phone-keyed fields are
      // by convention the "button shows the number" pattern (nav,
      // footer, contact). CTA buttons that just happen to link to a
      // phone number use a neutral field key (e.g. hero_cta_primary)
      // and don't hit this branch — they get the regular labeled
      // link UI further down.
      //
      // The renderer auto-prepends `tel:` + normalizes to `+421…`
      // at output time based on the same field key pattern, so the
      // saved value stays as the clean dial-ready string.
      const phoneFromHref = hrefDisplay.replace(/^tel:/i, "");
      const numberPlaceholder =
        schema.default_href?.replace(/^tel:/i, "") || "0900000000";

      return (
        <div className={"space-y-1.5" + (fieldHidden ? " opacity-60" : "")}>
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground capitalize flex items-center gap-1.5">
              <PhoneIcon className="h-3 w-3" />
              {humanize(fieldKey)}
              {fieldHidden && (
                <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  · hidden
                </span>
              )}
            </label>
            {onFieldHiddenChange && (
              <HideToggle hidden={fieldHidden ?? false} onChange={onFieldHiddenChange} />
            )}
          </div>
          <Input
            type="tel"
            inputMode="tel"
            value={phoneFromHref}
            onChange={(e) => {
              const typed = e.target.value.replace(/^tel:/i, "");
              onChange({ label: typed, href: typed });
            }}
            onFocus={handleFocus}
            onBlur={handleBlur}
            className="text-sm font-mono"
            placeholder={numberPlaceholder}
          />
        </div>
      );
    }

    return (
      <div
        className={
          "rounded-md border border-border/60 bg-background p-2 space-y-1.5" +
          (fieldHidden ? " opacity-60" : "")
        }
      >
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <LinkIcon className="h-3 w-3" />
            <span className="font-medium capitalize">{humanize(fieldKey)}</span>
            {fieldHidden && (
              <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                · hidden
              </span>
            )}
          </div>
          {onFieldHiddenChange && (
            <HideToggle hidden={fieldHidden ?? false} onChange={onFieldHiddenChange} />
          )}
        </div>
        <div className="grid grid-cols-[1fr_1fr] gap-1.5">
          <Input
            value={labelDisplay}
            onChange={(e) =>
              onChange({ ...linkValue, label: e.target.value })
            }
            onFocus={handleFocus}
            onBlur={handleBlur}
            className="text-sm"
            placeholder={schema.default ?? "Label"}
          />
          <HrefAutocomplete
            // hrefDisplay = the renderer-accurate effective href (see its
            // definition above): the template default when the link was
            // never configured, the stored value (incl. a deliberate "")
            // otherwise. Editor and live site stay in sync, and clearing
            // sticks because once you delete the value href becomes ""
            // (defined) and we stop substituting the default.
            value={hrefDisplay}
            onChange={(next) => onChange({ ...linkValue, href: next })}
            onFocus={handleFocus}
            onBlur={handleBlur}
            className="text-sm font-mono"
            placeholder={schema.default_href ?? "https:// or #anchor"}
          />
        </div>
        <div className="text-[10px] text-muted-foreground">
          What people see · Where it goes · Section name or full URL
        </div>
      </div>
    );
  }

  if (schema.type === "richtext") {
    return (
      <div
        className="space-y-1.5"
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground capitalize">
            {humanize(fieldKey)}
          </label>
          {(onFieldSizeChange || onFieldWidthChange || onFieldFillChange) && (
            <div className="flex items-center gap-2">
              {onFieldSizeChange && (
                <SizeControls
                  size={fieldSize}
                  onChange={onFieldSizeChange}
                  getMeasuredSize={getMeasuredSize}
                />
              )}
              {onFieldWidthChange && (
                <WidthControls
                  size={fieldWidth}
                  onChange={onFieldWidthChange}
                  getMeasuredSize={getMeasuredWidth}
                  disabled={fieldFill === true}
                  disabledTitle="Fill section is active — disable it to adjust width"
                />
              )}
              {onFieldFillChange && (
                <FillToggle
                  active={fieldFill === true}
                  onChange={onFieldFillChange}
                />
              )}
            </div>
          )}
        </div>
        <ComposerRichTextEditor
          value={stringValue}
          fallback={schema.default ?? ""}
          onChange={(html) => onChange(sanitizeRichText(html))}
        />
      </div>
    );
  }

  if (schema.type === "map") {
    return (
      <div onFocus={handleFocus} onBlur={handleBlur}>
        <MapField
          fieldKey={fieldKey}
          value={stringValue}
          defaultValue={schema.default ?? ""}
          onChange={(v) => onChange(v)}
        />
      </div>
    );
  }

  if (schema.type === "boolean") {
    // Booleans store the literal strings "true" / "false" so they ride
    // the existing string-shaped FieldValue (no new variant needed).
    // Treat anything but a case-insensitive "true" as off — covers
    // legacy data, partial typos, or the schema default of "false".
    const isOn = stringValue.trim().toLowerCase() === "true";
    return (
      <ToggleField
        fieldKey={fieldKey}
        on={isOn}
        onChange={(next) => onChange(next ? "true" : "false")}
        onFocusField={onFocusField}
      />
    );
  }

  // text (default fallthrough) — same rich editor as longtext/richtext.
  // Peter's directive 2026-05-16: every content field that isn't a link/
  // image/etc. uses the rich editor so the formatting affordance is
  // consistent across the composer. Storage shape is now HTML for
  // text/longtext/richtext alike; the renderer's text-case writes via
  // $el.html() (with sanitization) so existing plain-text defaults still
  // render fine — they just pass through innerHTML unmodified.
  return (
    <div
      className="space-y-1.5"
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground capitalize">
          {humanize(fieldKey)}
        </label>
        {(onFieldSizeChange || onFieldWidthChange || onFieldFillChange) && (
          <div className="flex items-center gap-2">
            {onFieldSizeChange && (
              <SizeControls
                size={fieldSize}
                onChange={onFieldSizeChange}
                getMeasuredSize={getMeasuredSize}
              />
            )}
            {onFieldWidthChange && (
              <WidthControls
                size={fieldWidth}
                onChange={onFieldWidthChange}
                getMeasuredSize={getMeasuredWidth}
                disabled={fieldFill === true}
                disabledTitle="Fill section is active — disable it to adjust width"
              />
            )}
            {onFieldFillChange && (
              <FillToggle
                active={fieldFill === true}
                onChange={onFieldFillChange}
              />
            )}
          </div>
        )}
      </div>
      <ComposerRichTextEditor
        value={stringValue}
        fallback={schema.default ?? ""}
        onChange={(html) => onChange(sanitizeRichText(html))}
        unwrap
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  Map field — Address ↔ Coordinates dual-mode input.
//
//  Both modes write to the same underlying string. Address mode stores a
//  free-text location ("123 Main Street, City") that Google Maps geocodes;
//  Coordinates mode stores a `lat,lng` pair that pins the marker
//  exactly. The renderer (parser.ts + render-browser.ts) URL-encodes
//  whichever string is stored into Google Maps' q= parameter, so both
//  modes converge on the same embed URL — only the precision differs.
//
//  Mode is auto-selected on mount from the current value's format:
//    - matches /^-?d+,...$/ → Coordinates tab
//    - anything else        → Address tab
//
//  Backwards-compatible: pre-existing string values from the days when
//  this field was just `type: "text"` show up unchanged in whichever tab
//  matches their format.
// ────────────────────────────────────────────────────────────────────────────

/** Loose-but-strict coordinate regex. Matches "48.1486,17.1077",
 *  " 48.1486 , 17.1077 ", "-12.5,170", etc. Rejects "New York" and
 *  partial / single-axis input. Used to auto-detect mode from a stored
 *  value — manual mode switches aren't gated on this. */
const COORD_REGEX = /^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/;

function looksLikeCoordinates(v: string): boolean {
  return COORD_REGEX.test(v);
}

/** Detect a full URL — used to auto-route stored values into the Embed
 *  tab. Both http and https accepted; the renderer trims whitespace
 *  before checking, so leading/trailing space in the stored value is
 *  fine. */
function looksLikeEmbedUrl(v: string): boolean {
  return /^https?:\/\//i.test(v.trim());
}

/** Split a coordinate string into trimmed (lat, lng). Tolerant — if the
 *  string isn't a clean pair, returns ("", "") so the inputs stay empty
 *  and the user can type their own. */
function splitCoords(v: string): { lat: string; lng: string } {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v);
  if (!m) return { lat: "", lng: "" };
  return { lat: m[1]!, lng: m[2]! };
}

/** Pull the src URL out of a pasted Google Maps `<iframe>` snippet. If
 *  the input is already a bare URL, return it unchanged. Empty string on
 *  no match — caller decides whether to swallow that as "still typing"
 *  or surface as an error. */
function extractEmbedUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  // Bare URL — most concise paste form. Accept it as-is.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Iframe HTML — common form from Google Maps "Embed a map" share
  // dialog. Single regex match avoids dragging DOMParser in for one
  // attribute extract.
  const m = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(trimmed);
  return m?.[1]?.trim() ?? "";
}

type MapMode = "address" | "coordinates" | "embed";

/** Pick the right tab for an existing stored value. Embed wins because a
 *  full URL is the most specific — coords would also "look like" two
 *  numbers in a longer string. Coordinates beats address because the
 *  regex is strict enough to never match free-text. */
function detectMode(v: string): MapMode {
  if (looksLikeEmbedUrl(v)) return "embed";
  if (looksLikeCoordinates(v)) return "coordinates";
  return "address";
}

function MapField({
  fieldKey,
  value,
  defaultValue,
  onChange,
}: {
  fieldKey: string;
  value: string;
  defaultValue: string;
  onChange: (v: string) => void;
}) {
  // The effective value — what's currently rendered into the map iframe.
  // Falls back to defaultValue (parsed from the template's example src)
  // when the user hasn't entered anything yet.
  const effective = value || defaultValue;

  // Mode initialization. Read the effective value once on mount; from
  // then on, the user controls the tab manually. Auto-flipping during
  // typing would be jumpy — partial coord input would yank the user
  // out of Address mid-keystroke.
  const [mode, setMode] = useState<MapMode>(() => detectMode(effective));

  // Coordinates mode keeps lat / lng split locally so partial typing
  // (e.g. user typed lat but not lng yet) doesn't immediately flush a
  // half-formed string to the underlying value. We sync to the parent
  // only when both halves are present + numeric.
  const initialSplit = splitCoords(effective);
  const [lat, setLat] = useState(initialSplit.lat);
  const [lng, setLng] = useState(initialSplit.lng);

  // Embed mode keeps the raw paste locally so the textarea doesn't lose
  // the "<iframe …>" formatting on every keystroke (the parent only
  // ever sees the extracted src URL). Initialised from the current
  // value so re-opening a section that already has an embed shows the
  // URL — re-mount only, never re-syncs from prop afterwards (would
  // re-populate the textarea after the user cleared it).
  const [embedRaw, setEmbedRaw] = useState(
    looksLikeEmbedUrl(effective) ? effective : "",
  );
  // Tracks paste-validation status so the textarea can show a tiny
  // "✓ extracted" or "✗ couldn't find an embed URL" hint. Computed
  // from local `embedRaw` so the indicator is accurate even before
  // the URL is committed upstream.
  const embedExtracted = looksLikeEmbedUrl(extractEmbedUrl(embedRaw));

  function commitCoords(nextLat: string, nextLng: string) {
    setLat(nextLat);
    setLng(nextLng);
    // Only push to parent when both axes look like numbers — otherwise
    // we'd flush "48.14," to the iframe and Google would render an
    // unhelpful default. When either is empty the iframe keeps its
    // last-known location until the second axis arrives.
    const a = nextLat.trim();
    const b = nextLng.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(a) && /^-?\d+(?:\.\d+)?$/.test(b)) {
      onChange(`${a},${b}`);
    }
  }

  function commitEmbed(raw: string) {
    setEmbedRaw(raw);
    // Three branches:
    //   - Clean extraction → commit URL upstream (iframe updates).
    //   - Cleared input    → commit "" so the stored value resets too;
    //                        otherwise the iframe would keep showing
    //                        the previously-extracted URL.
    //   - Incomplete paste → don't commit (the amber hint tells the
    //                        user we haven't found a usable URL yet).
    const url = extractEmbedUrl(raw);
    if (url) onChange(url);
    else if (raw.trim() === "") onChange("");
  }

  function switchMode(next: MapMode) {
    if (next === mode) return;
    // Pre-seed the newly-selected mode's local state from whatever's
    // currently stored — so switching tabs feels continuous instead of
    // wiping the user's existing pin.
    if (next === "coordinates") {
      const split = splitCoords(value || defaultValue);
      setLat(split.lat);
      setLng(split.lng);
    } else if (next === "embed") {
      const v = value || defaultValue;
      setEmbedRaw(looksLikeEmbedUrl(v) ? v : "");
    }
    setMode(next);
  }

  return (
    <div className="rounded-md border border-border/60 bg-background p-2 space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin className="h-3 w-3" />
        <span className="font-medium capitalize">{humanize(fieldKey)}</span>
      </div>

      {/* Mode toggle — segmented control. Three tabs because the three
          input formats are genuinely different UX (text vs two numbers
          vs HTML paste); a single input box trying to handle all three
          would have too many "is this an address or…" judgment calls. */}
      <div className="grid grid-cols-3 gap-1 rounded-md border border-border/60 bg-muted/40 p-0.5">
        {(
          [
            { id: "address", label: "Address" },
            { id: "coordinates", label: "Coordinates" },
            { id: "embed", label: "Embed" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => switchMode(t.id)}
            className={`text-xs py-1 rounded-md transition-colors ${
              mode === t.id
                ? "bg-background shadow-sm font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mode === "address" && (
        <Input
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className="text-sm"
          placeholder={defaultValue || "123 Main Street, City"}
        />
      )}

      {mode === "coordinates" && (
        <div className="grid grid-cols-2 gap-1.5">
          <Input
            value={lat}
            onChange={(e) => commitCoords(e.target.value, lng)}
            className="text-sm font-mono"
            placeholder="48.1486"
            aria-label="Latitude"
            inputMode="decimal"
          />
          <Input
            value={lng}
            onChange={(e) => commitCoords(lat, e.target.value)}
            className="text-sm font-mono"
            placeholder="17.1077"
            aria-label="Longitude"
            inputMode="decimal"
          />
        </div>
      )}

      {mode === "embed" && (
        <div className="space-y-1">
          <Textarea
            value={embedRaw}
            onChange={(e) => commitEmbed(e.target.value)}
            rows={4}
            className="text-xs font-mono"
            placeholder='<iframe src="https://www.google.com/maps/embed?pb=…" …></iframe>'
          />
          {embedRaw && (
            <p className={`text-[10px] ${embedExtracted ? "text-(--dash-accent-2)" : "text-amber-600 dark:text-amber-400"}`}>
              {embedExtracted
                ? "✓ Embed URL detected — preview will use it."
                : "Paste a Google Maps <iframe> snippet or its src URL."}
            </p>
          )}
        </div>
      )}

      {/* Helper hint — per-mode recipe so users know what to do without
          leaving the panel. Most non-technical users don't know how to
          find lat/lng or where the "Embed a map" share button lives. */}
      <p className="text-[10px] text-muted-foreground leading-snug">
        {mode === "address" && (
          <>Type a street address, city, or place name. Google geocodes it.</>
        )}
        {mode === "coordinates" && (
          <>
            On{" "}
            <a
              href="https://maps.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Google Maps
            </a>
            , right-click the spot → click the lat,lng numbers to copy → paste here.
          </>
        )}
        {mode === "embed" && (
          <>
            On{" "}
            <a
              href="https://maps.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Google Maps
            </a>
            , find the place → Share → <strong>Embed a map</strong> → Copy HTML →
            paste above. Lets you keep custom zoom, satellite view, and the
            Google place card with reviews.
          </>
        )}
      </p>
    </div>
  );
}

function humanize(key: string): string {
  return key.replace(/_/g, " ");
}

// ────────────────────────────────────────────────────────────────────────────
//  Toggle field — minimalist switch + confirmation dialog, used by the
//  `boolean` field type.
//
//  Visual: a single bare iOS-style switch (no surrounding pill, no border
//  on the row) with a tiny text label to its right showing the current
//  state. Matches the composer's neutral, low-chrome aesthetic — the
//  toggle reads as configuration, not a hero call-to-action.
//
//  Confirmation: clicking the switch opens a shadcn Dialog asking the
//  user to confirm the change, with copy explaining what'll happen on
//  the live site. Specifically for the contact-form recipient toggle
//  this is "messages will start / stop being sent to the address" —
//  matters because a misclick silently turns off form delivery, which
//  is invisible until a customer complains nobody replied.
//
//  The label reads the field key humanized; for `form_enabled` it shows
//  "form enabled". Template authors can rename to anything that reads
//  naturally in context (e.g. `form_active`, `form_send_emails`).
// ────────────────────────────────────────────────────────────────────────────
function ToggleField({
  fieldKey,
  on,
  onChange,
  onFocusField,
}: {
  fieldKey: string;
  on: boolean;
  onChange: (next: boolean) => void;
  onFocusField?: (focused: boolean) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  // What state are we proposing to flip TO? Captured at click time so
  // the dialog copy stays consistent even if `on` changes from
  // elsewhere while the dialog is open.
  const pendingNext = !on;

  function requestToggle() {
    setConfirmOpen(true);
  }
  function confirmToggle() {
    onChange(pendingNext);
    setConfirmOpen(false);
  }
  function cancelToggle() {
    setConfirmOpen(false);
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-muted-foreground capitalize">
        {humanize(fieldKey)}
      </label>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={on ? "Turn off" : "Turn on"}
          onClick={requestToggle}
          onFocus={() => onFocusField?.(true)}
          onBlur={() => onFocusField?.(false)}
          // Bare iOS-style switch. Track is a thin rounded pill that
          // shifts color between off (foreground/15 — barely-there) and
          // on (foreground/85 — solid neutral) — using the theme's
          // neutral foreground instead of a green keeps the chrome
          // minimal. Knob is a small white circle that slides between
          // the two ends. The Tailwind v4 `/N` opacity modifier compiles
          // through the project's oklch color tokens correctly without
          // needing a hand-written hsl() fallback.
          className={
            "relative inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background " +
            (on ? "bg-foreground/85" : "bg-foreground/15 hover:bg-foreground/25")
          }
        >
          <span
            aria-hidden
            className={
              "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform " +
              (on ? "translate-x-[14px]" : "translate-x-0.5")
            }
          />
        </button>
        <span
          className={
            "text-xs tabular-nums " +
            (on ? "text-foreground" : "text-muted-foreground")
          }
        >
          {on ? "On" : "Off"}
        </span>
      </div>

      {/* Confirmation dialog — explains what flipping the toggle will
          actually do on the live site. Composer is tech-admin only, so
          copy is in English (per the Tech/admin = EN, Sales/client = SK
          rule). Phrased for the contact-form recipient case because
          that's the only place this fires today — silent disable = lost
          leads. */}
      <Dialog open={confirmOpen} onOpenChange={(open) => !open && cancelToggle()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingNext
                ? "Turn form submissions on?"
                : "Turn form submissions off?"}
            </DialogTitle>
            <DialogDescription>
              {pendingNext ? (
                <>
                  After save + publish, this form will start sending
                  visitor messages to the recipient email. Visitors see
                  the same form as before — Submit just starts working.
                </>
              ) : (
                <>
                  After save + publish, this form will stop sending
                  messages. The form still renders normally on the live
                  site, but Submit does nothing — no emails reach the
                  inbox until this is turned back on.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={cancelToggle}
              className="min-w-24"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmToggle}
              className="min-w-24"
              variant={pendingNext ? "default" : "destructive"}
            >
              {pendingNext ? "Turn on" : "Turn off"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Rich-text editor implementation lives in composer-rich-text-editor.tsx
// (TipTap-based). The old contenteditable+execCommand version was removed
// 2026-05-16 because it leaked paste styles into dark mode and had broken
// Enter-key spacing — see that file's docstring for the full reasoning.

// Image thumbnail that resolves `pending:` URLs to blob URLs from IDB.
// Pure-display, no side effects beyond the useDisplayUrl hook.
function ImageThumb({ src }: { src: string }) {
  const display = useDisplayUrl(src);
  return (
    <div className="w-16 h-12 bg-muted rounded-md border border-border/60 overflow-hidden shrink-0">
      {display ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={display} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
        </div>
      )}
    </div>
  );
}
