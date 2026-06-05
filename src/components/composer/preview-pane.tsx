"use client";

/**
 * Composer preview canvas — Framer / Webflow-style.
 *
 * KEY IDEA: the iframe is always rendered at the *device's* width (1440 for
 * desktop, 375 for mobile). The actual fit-to-pane sizing is done by a CSS
 * `transform: scale(N)` on a wrapping div. That way, the CSS *inside* the
 * iframe always sees its real device width — desktop media queries fire on
 * "desktop" mode regardless of how big the user's laptop screen is.
 *
 * Without this, the iframe would just use `width: 100%` and trigger the
 * site's mobile breakpoint when the composer was open on a narrow laptop.
 *
 * State persists per-user in localStorage so reopening the composer keeps
 * the device + zoom you were working at.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Smartphone,
  Monitor,
  Minus,
  Plus,
  Maximize2,
  ChevronDown,
} from "lucide-react";

interface Props {
  /** Full HTML document to render in the iframe. Updated synchronously by the composer. */
  srcDoc: string;
  /** Optional ref forwarder so the composer can postMessage selection updates into the iframe. */
  iframeRef?: RefObject<HTMLIFrameElement | null>;
}

type Viewport = "desktop" | "mobile";

interface DeviceConfig {
  /** Virtual CSS width the iframe is rendered at — drives media queries inside. */
  width: number;
  /** Virtual CSS height — internal page content scrolls within this. */
  height: number;
}

const DEVICES: Record<Viewport, DeviceConfig> = {
  desktop: { width: 1440, height: 1024 },
  mobile: { width: 375, height: 812 }, // iPhone X+ proportions
};

/** Discrete zoom levels — −/+ buttons cycle through these. */
const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const MIN_ZOOM = ZOOM_LEVELS[0];
const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

/**
 * Replace every `Nvh` length unit in the HTML with the equivalent pixel
 * value based on the chosen device's viewport height.
 *
 * WHY: we resize the iframe to its content's scrollHeight so users can see
 * the whole page when zoomed out. But that creates a feedback loop with
 * `vh` units — a hero with `min-height: 100vh` grows as the iframe grows,
 * which grows the body's scrollHeight, which grows the iframe again, etc.
 *
 * Pinning `vh` to a fixed pixel value based on the *intended* device
 * viewport (1024px desktop, 812px mobile) breaks the loop while keeping
 * the visual proportions correct — the hero takes exactly one device
 * viewport, just like it would on a real screen.
 *
 * Composer preview only — the published site and the "Test" button keep
 * real `vh` so visitors see proper viewport behavior.
 */
function pinVhUnits(html: string, deviceHeight: number): string {
  return html.replace(
    /(\d+(?:\.\d+)?)vh\b/g,
    (_match, num) =>
      `${((Number(num) * deviceHeight) / 100).toFixed(2)}px`,
  );
}

const LS_VIEWPORT = "sk_composer_viewport";
const LS_ZOOM = "sk_composer_zoom";

type ZoomState = "fit" | number;

export function PreviewPane({ srcDoc, iframeRef }: Props) {
  // ── Persisted state ──
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [zoom, setZoom] = useState<ZoomState>("fit");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(LS_VIEWPORT);
      if (v === "desktop" || v === "mobile") setViewport(v);
      const z = localStorage.getItem(LS_ZOOM);
      if (z === "fit") {
        setZoom("fit");
      } else if (z) {
        const n = Number(z);
        if (!Number.isNaN(n) && n >= MIN_ZOOM && n <= MAX_ZOOM) setZoom(n);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS_VIEWPORT, viewport);
    } catch {
      /* ignore */
    }
  }, [viewport, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS_ZOOM, zoom === "fit" ? "fit" : String(zoom));
    } catch {
      /* ignore */
    }
  }, [zoom, hydrated]);

  // ── Track canvas size to compute fit-scale ──
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);

  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    setCanvasWidth(el.clientWidth);
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCanvasWidth(entry.contentRect.width);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Track the iframe's *content* height so the device frame grows to fit
  //    the entire page — otherwise zooming out only shows the top 1024px and
  //    you can't see the full site at low zoom levels. Sandbox is
  //    `allow-same-origin allow-scripts` so we can read contentDocument
  //    directly; no postMessage handshake needed.
  const [contentHeight, setContentHeight] = useState(DEVICES.desktop.height);

  useEffect(() => {
    const iframe = iframeRef?.current;
    if (!iframe) return;

    let observer: ResizeObserver | null = null;
    let firstFrame: ReturnType<typeof setTimeout> | null = null;
    let secondFrame: ReturnType<typeof setTimeout> | null = null;
    // rAF throttle handle — coalesces a burst of ResizeObserver fires (lazy
    // images, font swaps, hover transitions inside the iframe) into ONE
    // measure per animation frame. Without this, each individual layout
    // shift triggers a setContentHeight → React re-render → DOM update on
    // the main thread, and scrolling feels like it's freezing in chunks.
    let rafId: number | null = null;

    function measure() {
      rafId = null;
      const doc = iframe?.contentDocument;
      const body = doc?.body;
      if (!body) return;
      // Compute the bottom edge of the last visible body child rather than
      // relying on `body.scrollHeight` / `documentElement.scrollHeight` —
      // the <html> element fills the iframe viewport, so its scrollHeight
      // is always at least the iframe's current height. That makes the
      // measurement self-perpetuate and the iframe can never shrink.
      let lastBottom = 0;
      for (const child of Array.from(body.children) as HTMLElement[]) {
        if (child.offsetHeight === 0) continue;
        const bottom = child.offsetTop + child.offsetHeight;
        if (bottom > lastBottom) lastBottom = bottom;
      }
      if (lastBottom <= 0) lastBottom = body.scrollHeight;
      setContentHeight(Math.max(lastBottom, DEVICES.mobile.height));
    }

    function scheduleMeasure() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(measure);
    }

    function onLoad() {
      observer?.disconnect();
      if (firstFrame) clearTimeout(firstFrame);
      if (secondFrame) clearTimeout(secondFrame);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      const doc = iframe?.contentDocument;
      if (!doc) return;
      // Initial measurement (sync — we want the first paint to be right).
      measure();
      // Re-measure once fonts/images settle in (crude but reliable).
      firstFrame = setTimeout(measure, 100);
      secondFrame = setTimeout(measure, 500);
      // Subsequent layout shifts go through rAF so they batch.
      if (doc.body && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(scheduleMeasure);
        observer.observe(doc.body);
      }
    }

    iframe.addEventListener("load", onLoad);
    if (iframe.contentDocument?.readyState === "complete") onLoad();

    return () => {
      iframe.removeEventListener("load", onLoad);
      observer?.disconnect();
      if (firstFrame) clearTimeout(firstFrame);
      if (secondFrame) clearTimeout(secondFrame);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [iframeRef, srcDoc]);

  // ── Compute the actual scale to apply ──
  const device = DEVICES[viewport];
  const fitScale = useMemo(() => {
    if (canvasWidth <= 0) return 1;
    // Use the full canvas width — no extra padding eating into the fit. The
    // canvas itself owns its outer padding via Tailwind classes; we don't
    // want to subtract more on top of that.
    const s = canvasWidth / device.width;
    // Don't auto-scale ABOVE 100% — fit means "fit if too big," 1:1 otherwise.
    return Math.min(s, 1);
  }, [canvasWidth, device.width]);

  const actualScale = zoom === "fit" ? fitScale : zoom;

  // ── Zoom handlers ──
  const zoomOut = useCallback(() => {
    setZoom((prev) => {
      const current = prev === "fit" ? fitScale : prev;
      // Find next level strictly below current.
      const next = [...ZOOM_LEVELS].reverse().find((l) => l < current - 0.001);
      return next ?? MIN_ZOOM;
    });
  }, [fitScale]);

  const zoomIn = useCallback(() => {
    setZoom((prev) => {
      const current = prev === "fit" ? fitScale : prev;
      const next = ZOOM_LEVELS.find((l) => l > current + 0.001);
      return next ?? MAX_ZOOM;
    });
  }, [fitScale]);

  const fitToWidth = useCallback(() => setZoom("fit"), []);

  // Display label: "Fit (62%)" when in fit mode, "100%" when manual.
  const zoomLabel =
    zoom === "fit"
      ? `Fit · ${Math.round(actualScale * 100)}%`
      : `${Math.round(actualScale * 100)}%`;

  // Switch viewport — also reset zoom to Fit so the new device shows in full.
  function switchViewport(next: Viewport) {
    setViewport(next);
    setZoom("fit");
  }

  // ── Scaled wrapper sizing ──
  // Outer wrapper takes the *visual* space (device-width × content-height ×
  // scale). Inner iframe renders at full virtual size, then scales.
  // Using contentHeight (not device.height) means the device frame grows to
  // fit the WHOLE page — so zooming out actually shows you the entire site,
  // not just the top viewport's worth of content.
  const scaledW = device.width * actualScale;
  const scaledH = contentHeight * actualScale;

  // ── Ctrl/Cmd + mouse wheel = SMOOTH continuous zoom. Multiplicative
  // factor (Math.exp) gives proportional steps that feel natural at any
  // scale — the same gesture moves you "the same amount" whether you're at
  // 30% or 150%. This is how Framer / Figma / Webflow handle wheel zoom.
  //
  // The −/+ buttons remain discrete (cycle through ZOOM_LEVELS) because
  // for click-based input, snapping to round numbers is what users expect.
  //
  // Native non-passive listener is required because React's onWheel is
  // passive — preventDefault() inside it doesn't stop browser page-zoom.
  const ZOOM_SENSITIVITY = 0.003;

  // Stash fitScale in a ref so the wheel handler can be a stable reference
  // — otherwise we'd re-attach the iframe wheel listener on every resize.
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  const handleWheelZoom = useCallback((e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY);
    setZoom((prev) => {
      const current = prev === "fit" ? fitScaleRef.current : prev;
      const next = current * factor;
      return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    });
  }, []);

  // Conditional wheel-listener attachment.
  //
  // The naive approach — register a non-passive `wheel` listener and early-
  // return when no modifier is held — was causing scroll-jank: every wheel
  // event still has to wait for the listener to indicate whether it called
  // preventDefault, even when our handler does nothing. Combined with any
  // momentary main-thread work, scrolling felt like it was freezing in
  // chunks until you moved the mouse.
  //
  // Fix: only attach the non-passive wheel listeners WHILE the user is
  // actively holding Ctrl or Cmd. Track modifier state via passive keydown/
  // keyup listeners on both the parent window and the iframe's window
  // (focus could be in either). Detach the moment the modifier is released
  // so 99% of scrolling has zero listener overhead.
  //
  // Trade-off: trackpad pinch-to-zoom over the iframe falls back to browser
  // zoom (Chrome fires synthetic ctrlKey=true wheels without a real keydown,
  // and we can't predict those). Pinch over the canvas margins still works
  // because the canvas listener attaches the moment we see ctrlKey on a
  // wheel event — see the inline pinch-detection below.
  useEffect(() => {
    const iframe = iframeRef?.current;
    const canvas = canvasRef.current;
    let attached = false;

    function attach() {
      if (attached) return;
      canvas?.addEventListener("wheel", handleWheelZoom, { passive: false });
      iframe?.contentWindow?.addEventListener(
        "wheel",
        handleWheelZoom,
        { passive: false },
      );
      attached = true;
    }
    function detach() {
      if (!attached) return;
      canvas?.removeEventListener("wheel", handleWheelZoom);
      iframe?.contentWindow?.removeEventListener("wheel", handleWheelZoom);
      attached = false;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey) attach();
    }
    function onKeyUp(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) detach();
    }
    // Pinch-to-zoom safety: trackpad pinch fires a wheel with ctrlKey=true
    // but no preceding keydown. This passive listener catches the FIRST
    // such event and attaches the non-passive zoom listener for the gesture.
    // Subsequent wheels in the same pinch will then go through it.
    function onPassiveWheel(e: WheelEvent) {
      if ((e.ctrlKey || e.metaKey) && !attached) attach();
    }

    // Parent window
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas?.addEventListener("wheel", onPassiveWheel, { passive: true });

    // Inside iframe (focus may be there). Re-attach on iframe reload.
    function attachIframeListeners() {
      const win = iframe?.contentWindow;
      if (!win) return;
      win.addEventListener("keydown", onKeyDown);
      win.addEventListener("keyup", onKeyUp);
      win.addEventListener("wheel", onPassiveWheel, { passive: true });
    }
    function detachIframeListeners() {
      const win = iframe?.contentWindow;
      if (!win) return;
      win.removeEventListener("keydown", onKeyDown);
      win.removeEventListener("keyup", onKeyUp);
      win.removeEventListener("wheel", onPassiveWheel);
    }

    iframe?.addEventListener("load", attachIframeListeners);
    if (iframe?.contentDocument?.readyState === "complete") {
      attachIframeListeners();
    }

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas?.removeEventListener("wheel", onPassiveWheel);
      iframe?.removeEventListener("load", attachIframeListeners);
      detachIframeListeners();
      detach();
    };
  }, [iframeRef, srcDoc, handleWheelZoom]);

  return (
    <div className="flex flex-col h-full bg-muted/20">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-card/80 backdrop-blur-sm shrink-0 gap-3">
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/40 border border-border/50">
          <Button
            variant={viewport === "desktop" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 text-xs rounded-md"
            onClick={() => switchViewport("desktop")}
          >
            <Monitor className="h-3.5 w-3.5" />
            Desktop
          </Button>
          <Button
            variant={viewport === "mobile" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 text-xs rounded-md"
            onClick={() => switchViewport("mobile")}
          >
            <Smartphone className="h-3.5 w-3.5" />
            Mobile
          </Button>
        </div>

        {/* Zoom — collapsed into a single popover trigger so the toolbar
            stays uncluttered. The primary zoom interaction is Ctrl/Cmd+scroll
            anyway; the popover is a secondary "I want fine control" entry. */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="Zoom (Ctrl/Cmd + scroll to zoom)"
              aria-label="Zoom controls"
              className="h-7 inline-flex items-center gap-1 px-2.5 rounded-md border border-border/50 bg-muted/30 text-xs tabular-nums text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {zoomLabel}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-2 rounded-xl">
            {/* Stepper row */}
            <div className="flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={zoomOut}
                disabled={actualScale <= MIN_ZOOM + 0.001}
                title="Zoom out"
                aria-label="Zoom out"
                className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs tabular-nums font-medium flex-1 text-center">
                {zoomLabel}
              </span>
              <button
                type="button"
                onClick={zoomIn}
                disabled={actualScale >= MAX_ZOOM - 0.001}
                title="Zoom in"
                aria-label="Zoom in"
                className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* Presets */}
            <div className="mt-2 grid grid-cols-3 gap-1">
              {[0.5, 1, 2].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setZoom(p)}
                  className={`h-7 rounded-md text-[11px] tabular-nums font-medium transition-colors ${
                    zoom !== "fit" && Math.abs((zoom as number) - p) < 0.001
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {Math.round(p * 100)}%
                </button>
              ))}
            </div>
            {/* Fit toggle */}
            <button
              type="button"
              onClick={fitToWidth}
              className={`mt-2 w-full h-7 rounded-md text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                zoom === "fit"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Maximize2 className="h-3 w-3" />
              Fit to width
            </button>
            <p className="mt-2 text-[10px] text-muted-foreground/80 text-center">
              Hold Ctrl / ⌘ + scroll to zoom
            </p>
          </PopoverContent>
        </Popover>
      </div>

      {/* Canvas — pannable when zoom > fit. Minimal padding (just a few px
          top/bottom for breathing room from the toolbar) so the device frame
          can use the FULL available width when in Fit mode. */}
      <div
        ref={canvasRef}
        className="flex-1 overflow-auto py-2 flex items-start justify-center"
      >
        <div
          // The shrink: 0 keeps the device its true visual size — flexbox
          // would otherwise compress it when the canvas got narrow.
          style={{
            width: scaledW,
            height: scaledH,
            flexShrink: 0,
            position: "relative",
          }}
          className="bg-white shadow-[0_8px_40px_-12px_rgba(0,0,0,0.18)] rounded-lg overflow-hidden ring-1 ring-border/60"
        >
          <iframe
            ref={iframeRef}
            // Defer the real srcDoc to AFTER hydration. Why:
            //   - During SSR, the iframe's srcDoc is computed server-side
            //     and shipped in the HTML.
            //   - On the client, React hydrates the same iframe element.
            //     The client-side srcDoc is computed slightly differently
            //     (resolveBrand SVG generation, theme inlining, etc.) so
            //     the strings differ. React logs "won't be patched up"
            //     and keeps the SSR value — but in the process, image
            //     fetches that started during the SSR render get
            //     interrupted by hydration's reconciliation pass and
            //     never recover.
            //   - End-user symptom: open page → bg images blank →
            //     drag-drop reorder a section → srcDoc changes for real
            //     this time → iframe re-renders → images load cleanly.
            // Gating srcDoc behind `hydrated` (which flips true in the
            // useEffect that reads localStorage) means the iframe ships
            // EMPTY in SSR, then gets the real content once the client
            // is ready. One iframe load, no hydration race, images
            // succeed on first try.
            srcDoc={hydrated ? pinVhUnits(srcDoc, device.height) : ""}
            title="Live preview"
            sandbox="allow-same-origin allow-scripts"
            style={{
              width: device.width,
              height: contentHeight,
              border: 0,
              position: "absolute",
              top: 0,
              left: 0,
              transform: `scale(${actualScale})`,
              transformOrigin: "top left",
              // `transform: scale(N<1)` makes the browser bilinearly
              // downsample the iframe's painted bitmap — visible as
              // soft images and slightly fuzzy text whenever zoom is
              // below 100% (typical for "Fit"). image-rendering on
              // the iframe element itself opts into the browser's
              // higher-quality sampler for that composite step.
              // Combined with the matching rule inside the iframe
              // (template-base.css), images get the better sampler
              // both on the in-iframe scale and the iframe-wrapper
              // scale.
              // `high-quality` is valid CSS but missing from the
               //  React/lib.dom ImageRendering union (only auto /
               //  crisp-edges / pixelated are typed). Cast to bypass.
              imageRendering: "high-quality" as React.CSSProperties["imageRendering"],
            }}
          />
        </div>
      </div>
    </div>
  );
}

