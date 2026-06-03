"use client";

/**
 * Anchor-list context for the composer.
 *
 * The composer rebuilds the anchor list whenever the composition changes
 * (sections re-ordered, title edited, item added/removed) and publishes it
 * here. PlaceholderField subscribes via `useAnchors()` so the link-href
 * autocomplete can suggest current targets without prop-drilling through
 * SectionCard → FieldsList → RepeaterField → PlaceholderField (four
 * layers, two of which already accept ten+ props).
 *
 * The provider lives at the top of composer-client's render tree so both
 * the section cards and the nav/footer SharedSlot cards see the same
 * list — useful when a nav dropdown row wants to link to a section
 * anchor lower on the page.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { AnchorEntry } from "@/lib/composer/page-anchors";

const AnchorsContext = createContext<AnchorEntry[]>([]);

export function AnchorsProvider({
  value,
  children,
}: {
  value: AnchorEntry[];
  children: ReactNode;
}) {
  return (
    <AnchorsContext.Provider value={value}>{children}</AnchorsContext.Provider>
  );
}

/** Read the current anchor list. Returns [] outside a provider — fields
 *  rendered outside the composer (none today, but stay defensive) just
 *  get no autocomplete suggestions rather than crashing. */
export function useAnchors(): AnchorEntry[] {
  return useContext(AnchorsContext);
}
