"use client";

/**
 * Href input with auto-anchor mode + autocomplete.
 *
 * UX model (post-2026-05-13 revision 2):
 *   • The user never has to type the `#` themselves — typing plain text
 *     (no scheme, no `/`, no `.`) auto-prepends `#` on the first
 *     keystroke. They see the `#` appear immediately so it reads as a
 *     visual signal "this is an anchor link, not a URL."
 *   • Picking from the autocomplete dropdown writes `#kontakt` (with
 *     the `#`) into the input — same identification cue.
 *   • Display value EQUALS stored value. No strip-on-display: the `#`
 *     is shown in the input at all times when in anchor mode.
 *   • URLs (http://, https://), scheme links (tel:, mailto:), relative
 *     paths (starting with `/`), and bare-domain pastes (anything
 *     containing a `.`) stay verbatim, no `#` added.
 *
 * The autocomplete dropdown:
 *  - Opens on focus when the field is EMPTY (lists every available
 *    anchor for discovery) AND keeps opening as the user types.
 *  - Filters anchors by slugified query, so typing "Excavation work"
 *    matches `excavation-work`.
 *  - Portalled to document.body and positioned with `position: fixed`
 *    against the input's getBoundingClientRect, so it escapes the
 *    `overflow: hidden` on the FieldGroup wrapper that would otherwise
 *    clip an absolutely-positioned dropdown.
 *
 * We use a plain React portal (createPortal to document.body), NOT
 * Radix Popover. Radix's portal-mounted popover crashes with
 * `insertBefore` on the second open when the parent re-renders
 * frequently — see `feedback_radix_popover_rerender_trap`.
 *
 * Storage shape is unchanged: `value` in/out of this component is the
 * STORED href string (e.g. `#kontakt`, `https://...`, `tel:...`). The
 * only transform is display→stored on typing (auto-prepending `#` for
 * plain-text anchor mode); storage→display is identity.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Hash, FileText } from "@phosphor-icons/react/ssr";
import { Input } from "@/components/ui/input";
import { useAnchors } from "./anchors-context";
import { slugifyAnchorId } from "@/lib/templates/slugify";
import type { AnchorEntry } from "@/lib/composer/page-anchors";

interface Props {
  value: string;
  onChange: (next: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
}

interface DropdownRect {
  /** Top-left corner of the dropdown, in viewport coords (for `position: fixed`). */
  top: number;
  left: number;
  /** Width — pinned to the input's width for visual continuity, with a floor. */
  width: number;
}

// ── Mode detection ──────────────────────────────────────────────────────
// Decide whether the user is typing a section anchor or something else.
// "Anchor mode" = the input represents a `#section-name` link, even if
// the user hasn't typed the `#` themselves. Anything else (URL with
// scheme, relative path, bare domain via dot-detection) is stored
// verbatim with no anchor prefix.
function isAnchorMode(display: string): boolean {
  if (display === "") return false;
  // Already prefixed — definitely anchor mode.
  if (display.startsWith("#")) return true;
  // Scheme URLs.
  if (/^https?:\/\//i.test(display)) return false;
  if (/^(tel:|mailto:|ftp:|sms:|file:)/i.test(display)) return false;
  // Relative / absolute paths.
  if (display.startsWith("/")) return false;
  // Bare-domain mitigation — any dot in plain text reads as a URL
  // (foo.sk, mojweb.com). Legitimate anchor ids never contain dots:
  // slugifyAnchorId strips them by replacing non-[a-z0-9-] runs with
  // a single `-`, so an in-page section id is always safe.
  if (display.includes(".")) return false;
  // Phone-shape mitigation (Peter 2026-05-15) — values composed only
  // of digits + phone punctuation read as a bare phone number, not
  // an anchor name. The renderer auto-prefixes `tel:` on output, so
  // we leave the value stored as plain digits.
  if (/^[\s+\-()\d]+$/.test(display) && display.replace(/\D/g, "").length >= 7)
    return false;
  return true;
}

/**
 * Compute what to STORE given what the user typed into the input.
 * Identity for everything except plain-text anchor mode, where `#` is
 * auto-prepended. Used on every keystroke so the prefix appears as
 * soon as the user types the first character.
 */
function displayToStored(display: string): string {
  if (display === "") return "";
  // Re-evaluate on the BARE text (leading # stripped) on EVERY keystroke
  // so the auto-# is reversible. The old `if (startsWith("#")) return
  // display` short-circuit made the # stick forever: once added, typing
  // ".html" onto "#o-nas" produced "#o-nas.html" and you could never
  // type a real subpage path. Now the moment the text looks like a path
  // / URL / scheme / phone (e.g. you type the "." in "o-nas.html") the #
  // is dropped and the value is stored verbatim. Plain id text still
  // gets the # for the in-page-anchor cue.
  const bare = display.startsWith("#") ? display.slice(1) : display;
  if (bare === "") return "";
  return isAnchorMode(bare) ? `#${bare}` : bare;
}

export function HrefAutocomplete({
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder,
  className,
}: Props) {
  const anchors = useAnchors();
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [rect, setRect] = useState<DropdownRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Display state ──
  // Local state needed so handleTyped can override what the user typed
  // with the auto-prefixed version. Example: user types `k`; the
  // onChange event arrives with `k`, but we want the input to display
  // `#k` (anchor mode auto-prepend). Without local state, the input
  // would briefly flash the raw typed character before the controlled
  // value catches up.
  //
  // The pattern below is the React-recommended "adjusting state during
  // render" technique — track the last-seen `value` in state and
  // compare on every render. Refs would be simpler but tripped the
  // react-hooks/refs lint rule (refs are forbidden during render).
  // See https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [localDisplay, setLocalDisplay] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setLocalDisplay(value);
  }

  // SSR-safe portal target — `document` is undefined during the first
  // server render of a "use client" component. Checked at render time
  // (not via useEffect+setState) to avoid the cascading-render lint.
  const portalTarget = typeof document !== "undefined" ? document.body : null;

  // Build the autocomplete match list from the user's current display
  // text. The `#` prefix is stripped for filtering so `#kontakt` and
  // `kontakt` produce the same set.
  const isEmpty = localDisplay === "";
  const queryText = localDisplay.startsWith("#")
    ? localDisplay.slice(1)
    : localDisplay;
  const slugQuery = slugifyAnchorId(queryText);
  const inAnchorMode = isAnchorMode(localDisplay);

  const matches: AnchorEntry[] = useMemo(() => {
    // Pages and in-page anchors are filtered against the typed text
    // with DIFFERENT rules:
    //
    //   - PAGES match by case-insensitive substring on the path or
    //     label. They show even when the input is in "URL mode" (has
    //     a `.`) — that's exactly when a user is typing a page
    //     filename like "o-nas.html" and most needs the suggestion.
    //
    //   - ANCHORS (sections/items) match by slugified query — the
    //     existing behavior. They're suppressed in URL mode because
    //     "#foo.bar" isn't a valid section anchor.
    //
    // Pages always come first in the dropdown — page navigation is
    // a higher-level intent than in-page jumps, so it's the more
    // common pick when the operator is editing a nav-link href.
    const pages = anchors.filter((a) => a.kind === "page");
    const pageInline = anchors.filter((a) => a.kind !== "page");

    const pageMatches = (() => {
      if (isEmpty) return pages;
      // Strip a leading # before matching. While the user types a page
      // name the input is in transient anchor mode ("#o-nas"), but they
      // want the "o-nas.html" PAGE — matching on the bare text lets the
      // page surface so they can pick it instead of being hidden behind
      // the auto-#.
      const q = localDisplay.replace(/^#/, "").trim().toLowerCase();
      if (!q) return pages;
      return pages.filter(
        (p) =>
          p.id.toLowerCase().includes(q) ||
          p.label.toLowerCase().includes(q),
      );
    })();

    const anchorMatches = (() => {
      if (isEmpty) return pageInline;
      if (!inAnchorMode) return [];
      if (!slugQuery) return pageInline;
      return pageInline.filter(
        (a) =>
          a.id.includes(slugQuery) ||
          slugifyAnchorId(a.label).includes(slugQuery) ||
          // Cross-page anchors carry a pageLabel ("About us") — let the
          // operator find them by typing the page name too.
          (a.pageLabel ? slugifyAnchorId(a.pageLabel).includes(slugQuery) : false),
      );
    })();

    return [...pageMatches, ...anchorMatches];
  }, [anchors, inAnchorMode, slugQuery, isEmpty, localDisplay]);

  // Open rule: focused + at least one match. We no longer gate on
  // anchor-mode-OR-empty — page entries are relevant in URL mode
  // too (user typing a filename should see page suggestions), and
  // when there are no matches in any mode the dropdown stays closed
  // either way, so dropping the mode gate is safe.
  const open = focused && matches.length > 0;
  const safeIdx = activeIdx >= matches.length ? 0 : activeIdx;

  // Position recompute. Runs on open AND on scroll/resize so the
  // dropdown tracks if the user scrolls the right panel after focusing.
  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;

    function compute() {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Pin width to the input but give it a minimum readable size —
      // the href input lives in a half-column grid (~140px) which is
      // too tight for "MAP-01 / SECTION NAME" labels. Anchor LEFT
      // edge against the input's RIGHT edge (so the dropdown grows
      // leftward beyond the narrow column when min-width kicks in).
      const minWidth = 320;
      const width = Math.max(r.width, minWidth);
      const left = r.right - width;
      setRect({ top: r.bottom + 4, left, width });
    }

    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [open]);

  // Keep the active row scrolled into view inside the list container.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-row-idx="${safeIdx}"]`);
    if (row) {
      const listRect = list.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      if (rowRect.top < listRect.top) {
        list.scrollTop -= listRect.top - rowRect.top;
      } else if (rowRect.bottom > listRect.bottom) {
        list.scrollTop += rowRect.bottom - listRect.bottom;
      }
    }
  }, [safeIdx, open]);

  function commit(entry: AnchorEntry) {
    // entry.href already encodes the right write strategy (computed in
    // page-anchors.ts relative to the page being edited):
    //   - "page"            → the path verbatim ("o-nas.html")
    //   - same-page anchor  → "#kontakt"
    //   - other-page anchor → "o-nas.html#kontakt"
    // Store it verbatim — no per-kind branching here anymore.
    onChange(entry.href);
    inputRef.current?.blur();
  }

  function handleTyped(typed: string) {
    // Auto-prepend `#` for anchor-mode plain text. The input's value
    // becomes the STORED form (with `#` if applicable) — this is what
    // makes the `#` appear immediately on the first keystroke.
    const stored = displayToStored(typed);
    setLocalDisplay(stored);
    if (stored !== value) {
      // Pre-seed prevValue so the upcoming render doesn't think the
      // value came from outside and re-sync localDisplay redundantly.
      setPrevValue(stored);
      onChange(stored);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((safeIdx + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((safeIdx - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = matches[safeIdx];
      if (pick) commit(pick);
    } else if (e.key === "Escape") {
      e.preventDefault();
      inputRef.current?.blur();
    }
  }

  return (
    <>
      <Input
        ref={inputRef}
        value={localDisplay}
        onChange={(e) => handleTyped(e.target.value)}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        // Microtask delay on blur so a click-on-row registers BEFORE
        // the list unmounts. onMouseDown inside the row also calls
        // e.preventDefault() as a belt-and-braces guard, but the delay
        // covers browsers where preventDefault doesn't suppress the
        // focus shift cleanly.
        onBlur={() => {
          setTimeout(() => {
            setFocused(false);
            onBlur?.();
          }, 120);
        }}
        onKeyDown={handleKeyDown}
        className={className}
        placeholder={placeholder}
      />

      {open && portalTarget && rect &&
        createPortal(
          <div
            ref={listRef}
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              width: rect.width,
            }}
            className="z-1000 max-h-64 overflow-y-auto rounded-xl border dash-hairline bg-popover/95 backdrop-blur-sm shadow-[0_12px_32px_-12px_rgba(0,0,0,0.18)] text-popover-foreground p-1"
          >
            {matches.map((entry, idx) => {
              const active = idx === safeIdx;
              const isPage = entry.kind === "page";
              const Icon = isPage ? FileText : Hash;
              // Show the exact value that gets stored — page path,
              // "#kontakt", or "o-nas.html#kontakt" for a cross-page
              // anchor — so the operator sees the rendered link at a
              // glance.
              const renderedId = entry.href;
              return (
                <button
                  key={`${entry.kind}-${entry.id}-${idx}`}
                  type="button"
                  data-row-idx={idx}
                  // Mouse selection: use mousedown so the click registers
                  // before the input's blur handler closes the list.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(entry);
                  }}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                    active ? "bg-accent text-accent-foreground" : "hover:bg-muted/60"
                  }`}
                >
                  <Icon className={`h-3 w-3 shrink-0 ${active ? "dash-accent" : "opacity-50"}`} />
                  <span className="font-mono tabular-nums shrink-0">{renderedId}</span>
                  <span className="text-muted-foreground truncate flex-1 min-w-0">
                    {entry.label !== entry.id ? entry.label : ""}
                  </span>
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground shrink-0">
                    {entry.pageLabel
                      ? `${entry.sectionLabel} · ${entry.pageLabel}`
                      : entry.sectionLabel}
                  </span>
                </button>
              );
            })}
          </div>,
          portalTarget,
        )}
    </>
  );
}
