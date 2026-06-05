"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ArrowsClockwise as RefreshCw, Lock } from "@phosphor-icons/react/ssr";

const MIN_DESKTOP_WIDTH = 1280;

interface SitePreviewProps {
  siteId: string;
  siteUrl?: string;
  /** Subpage path relative to site root, e.g. "pieskovanie-kovu.html" */
  pagePath?: string;
  /** Preview mode: inline-edit (client editor), review (tech admin), preview (default) */
  mode?: "preview" | "inline-edit" | "review";
  onFieldClick?: (
    sectionId: string,
    fieldName: string,
    itemId?: string
  ) => void;
  /** Ref to access the iframe element from parent */
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
  scrollToSection?: string | null;
  scrollKey?: number;
}

export function SitePreview({
  siteId,
  siteUrl,
  pagePath,
  mode = "preview",
  onFieldClick,
  iframeRef: externalIframeRef,
  scrollToSection,
  scrollKey,
}: SitePreviewProps) {
  const internalIframeRef = useRef<HTMLIFrameElement>(null);
  const iframeRef = externalIframeRef || internalIframeRef;
  const containerRef = useRef<HTMLDivElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "FIELD_CLICK") {
        onFieldClick?.(
          event.data.sectionId,
          event.data.fieldName,
          event.data.itemId
        );
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onFieldClick]);

  // Send scroll command to iframe when tile is clicked
  useEffect(() => {
    if (!scrollToSection || !scrollKey) return;
    const sendMessage = () => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          { type: "SCROLL_TO_SECTION", sectionId: scrollToSection },
          "*"
        );
      }
    };
    sendMessage();
    const timer = setTimeout(sendMessage, 150);
    return () => clearTimeout(timer);
  }, [scrollToSection, scrollKey, iframeRef]);

  const [iframeWidth, setIframeWidth] = useState(MIN_DESKTOP_WIDTH);

  // Scale iframe to fit container
  const updateScale = useCallback(() => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.offsetWidth;
      // Use container width if wider than min, so no gap on right
      const targetWidth = Math.max(MIN_DESKTOP_WIDTH, containerWidth);
      setIframeWidth(targetWidth);
      setScale(containerWidth / targetWidth);
    }
  }, []);

  useEffect(() => {
    updateScale();
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(updateScale);
    observer.observe(container);
    return () => observer.disconnect();
  }, [updateScale]);

  // Build preview URL — proxy through our API with mode
  const previewUrl = siteUrl
    ? `/api/proxy-preview?url=${encodeURIComponent(`${siteUrl.replace(/\/+$/, "")}/${pagePath || ""}`)}&mode=${mode}&t=${refreshKey}`
    : `/api/render/site/${siteId}?t=${refreshKey}`;

  const isMinimalChrome = mode === "inline-edit" || mode === "review";

  return (
    <div className="h-full flex flex-col">
      {/* Preview toolbar — minimal in inline-edit and review modes */}
      {!isMinimalChrome && (
        <div className="h-10 border-b border-border bg-card flex items-center px-4 gap-3 shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-400/50" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="bg-secondary rounded-md px-3 py-1 text-xs text-muted-foreground flex items-center gap-2 max-w-md w-full">
              <Lock className="w-3 h-3 shrink-0" />
              <span className="truncate">
                {siteUrl || "your-site.pages.dev"}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </Button>
        </div>
      )}

      {/* Preview content — always desktop width (1280px), scaled to fit */}
      <div ref={containerRef} className="flex-1 bg-background overflow-hidden relative">
        <iframe
          key={isMinimalChrome ? previewUrl : undefined}
          ref={iframeRef}
          src={previewUrl}
          className="border-0 origin-top-left"
          title="Live Site Preview"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          style={{
            width: `${iframeWidth}px`,
            height: `${scale > 0 ? 100 / scale : 200}%`,
            transform: `scale(${scale})`,
          }}
        />
      </div>
    </div>
  );
}
