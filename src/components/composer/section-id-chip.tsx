"use client";

/**
 * Editable `#section-id` chip shown in the composer's left rail and
 * inside each section card's header. Renders the section's effective
 * anchor — either the user's `__section_id` override or the template's
 * default id — and lets the author rename it in place.
 *
 * UX:
 *   - Idle: tiny monospace chip "#hero" (read-only-looking).
 *   - Click / focus: expands into a text input. User types, Enter
 *     commits, Esc reverts.
 *   - On blur or Enter: normalize the value (lowercase, strip non
 *     [a-z0-9-] characters, no leading #) and fire onChange. Empty
 *     input → onChange(null) which the parent stores as "no override"
 *     so the template default takes over again.
 *
 * The chip does NOT render anything when the template has no default
 * id AND the user hasn't set one — pure widgets / utility sections
 * (whatsapp button, scroll-top, etc.) stay clean instead of showing
 * an empty chip.
 */

import { useEffect, useRef, useState } from "react";
import { slugifyAnchorId } from "@/lib/templates/slugify";

interface Props {
  /** Currently effective id (override-or-default). Drives the chip's
   *  display value. */
  value: string | null | undefined;
  /** Whether the current value comes from the user's override. Lets us
   *  style the chip differently (slight accent) when customized. */
  isOverridden?: boolean;
  /** Fired when the user commits a change. `null` means "clear my
   *  override; fall back to the template default". */
  onChange: (next: string | null) => void;
  /** Compact mode for the rail (smaller padding, shorter input). */
  compact?: boolean;
  /** If true, hide the chip entirely when value is empty. Used in the
   *  rail so widget rows without an id don't show a meaningless chip. */
  hideWhenEmpty?: boolean;
  /** The id that will actually appear in the rendered HTML, AFTER the
   *  page-wide dedup pass. When two sections share a default id, the
   *  second gets `-2` suffix. If `renderedId` differs from `value`,
   *  the chip shows a small arrow → followed by the rendered id so
   *  the user understands their `#sluzby` is being auto-renumbered to
   *  `#sluzby-2`. They can click to set a custom override and break
   *  the auto-rename. Omitted = no dedup hint shown. */
  renderedId?: string | null;
}

/** @deprecated Use slugifyAnchorId from @/lib/templates/slugify directly.
 *  Kept as a re-export so existing callers keep working without churn. */
export const normalizeSectionId = slugifyAnchorId;

export function SectionIdChip({
  value,
  isOverridden,
  onChange,
  compact = false,
  hideWhenEmpty = false,
  renderedId,
}: Props) {
  // Chip's primary display is the FINAL rendered id (what the
  // browser actually sees in the published HTML). Falls back to
  // `value` (override-or-default) when renderedId wasn't computed
  // by the parent — e.g., the rail's smaller card variant that
  // doesn't have the dedup map yet. This way the user sees what
  // their site actually emits, no separate "→ #sluzby-2" arrow.
  const display = (renderedId && renderedId.length > 0 ? renderedId : value) ?? "";
  const intended = value ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(display);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync draft with prop changes when not editing — handles the case
  // where another part of the composer (or another tab) updates the
  // id and we should reflect it immediately. Done via the React-
  // recommended "adjusting state during render" pattern (track the
  // last-seen `display` in state) rather than an effect, because the
  // effect form trips the react-hooks/set-state-in-effect rule and
  // makes cascading renders.
  const [lastDisplay, setLastDisplay] = useState(display);
  if (display !== lastDisplay) {
    setLastDisplay(display);
    if (!editing) setDraft(display);
  }

  // Autofocus + select-all when entering edit mode so the user can
  // start typing immediately.
  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [editing]);

  if (hideWhenEmpty && !display) return null;

  function commit() {
    const normalized = slugifyAnchorId(draft);
    setEditing(false);
    // Two no-op cases — both prevent a pointless autosave AND avoid
    // locking the user into a deduped id they never intended to set
    // explicitly:
    //
    //   1. Normalized matches the displayed (rendered) id. Means the
    //      user opened the chip, saw e.g. "sluzby-2", pressed Enter
    //      without typing. Don't store "sluzby-2" as an override —
    //      they didn't actually choose it, the dedup did. Leaving
    //      override empty preserves "fall back to template default,
    //      let dedup auto-rename" behavior so if they delete the
    //      first sister section later, this one cleanly takes over
    //      the canonical id.
    //
    //   2. Normalized matches the intended id (override-or-default).
    //      Same as the old guard — committing the unchanged intended
    //      value is also a no-op.
    if (normalized === display) return;
    if (normalized === intended) return;
    onChange(normalized || null);
  }

  function cancel() {
    setDraft(display);
    setEditing(false);
  }

  if (editing) {
    return (
      <span
        className={`inline-flex items-center font-mono ${compact ? "text-[10px]" : "text-xs"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-muted-foreground select-none">#</span>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className={`bg-background border rounded-sm px-1 outline-none focus:ring-1 focus:ring-primary ${
            compact ? "h-5 w-24" : "h-6 w-32"
          }`}
          placeholder="section-id"
          aria-label="Section anchor id"
        />
      </span>
    );
  }

  // When dedup auto-renamed this section (intended `sluzby` →
  // rendered `sluzby-2`), color the chip amber as a subtle hint so
  // the user understands the id wasn't their explicit choice. The
  // tooltip explains. Click to override.
  const isAutoDeduped = !!renderedId && renderedId !== intended && intended !== "";
  const colorClass = isOverridden
    ? "text-primary"
    : isAutoDeduped
      ? "text-amber-500/90"
      : "text-muted-foreground";
  const titleText = isAutoDeduped
    ? `Auto-renamed to #${display} because #${intended} is already used by another section. Click to set a custom id.`
    : display
      ? `Anchor: #${display} — click to rename`
      : "Set a section anchor";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      className={`inline-flex items-center font-mono rounded-sm px-1 hover:bg-muted/60 transition-colors ${
        compact ? "text-[10px] py-px" : "text-xs py-0.5"
      } ${colorClass}`}
      title={titleText}
    >
      #{display || "(none)"}
    </button>
  );
}
