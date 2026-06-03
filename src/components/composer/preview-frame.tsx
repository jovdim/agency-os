"use client";

/**
 * Tiny scaled-down iframe used for live thumbnails in the sections rail and
 * variant picker. Renders the section at a virtual width (1280px by default)
 * and uses a `transform: scale()` to fit its parent container — so the preview
 * looks pixel-perfect, not stretched or letterboxed like a screenshot.
 *
 * Performance notes:
 *  - Iframe uses `sandbox="allow-same-origin"` and srcDoc; cheap to mount.
 *  - We render full-fidelity preview HTML; if you have many of these on screen,
 *    only mount them when the parent category is open (see sections-rail).
 *  - `pointer-events: none` keeps the iframe transparent to clicks; the
 *    surrounding card stays clickable.
 */

import { useEffect, useRef, useState } from "react";

const VIRTUAL_WIDTH = 1280;

interface Props {
  /** Full HTML document string for the iframe srcDoc */
  srcDoc: string;
  /**
   * Render height (in virtual pixels) of the iframe content. Different
   * categories have wildly different natural heights — a nav is ~100px, a
   * hero is ~720px. The container is sized to match, so we only show the
   * relevant portion of the section without distortion.
   */
  virtualHeight?: number;
  className?: string;
}

export function PreviewFrame({
  srcDoc,
  virtualHeight = 720,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Default to a sensible scale so the very first paint isn't a giant unscaled iframe.
  // Will be overwritten on the next frame by ResizeObserver with the real width.
  const [scale, setScale] = useState(0.18);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setScale(w / VIRTUAL_WIDTH);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={
        className ??
        "relative w-full overflow-hidden bg-muted/40"
      }
      // Aspect ratio: 1280 wide × virtualHeight tall, scaled together.
      style={{ aspectRatio: `${VIRTUAL_WIDTH} / ${virtualHeight}` }}
    >
      <iframe
        srcDoc={srcDoc}
        sandbox="allow-same-origin"
        scrolling="no"
        title="Section preview"
        loading="lazy"
        aria-hidden
        className="absolute top-0 left-0 border-0 pointer-events-none"
        style={{
          width: VIRTUAL_WIDTH,
          height: virtualHeight,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      />
    </div>
  );
}
