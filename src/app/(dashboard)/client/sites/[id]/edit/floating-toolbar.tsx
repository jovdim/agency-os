"use client";

import { X, RotateCcw, Check } from "lucide-react";

interface FloatingToolbarProps {
  section?: string | null;
  field?: string | null;
  elementTag: string;
  isImage: boolean;
  rect: { top: number; left: number; width: number; height: number; bottom: number };
  scale: number;
  iframeOffset: { top: number; left: number };
  canRevert: boolean;
  onRevert: () => void;
  onDismiss: () => void;
  onConfirm?: () => void;
}

export function FloatingToolbar({
  isImage,
  rect,
  scale,
  iframeOffset,
  canRevert,
  onRevert,
  onDismiss,
  onConfirm,
}: FloatingToolbarProps) {
  const bottom = iframeOffset.top + rect.bottom * scale;
  const left = iframeOffset.left + rect.left * scale;
  const width = rect.width * scale;

  const toolbarTop = bottom + 8;
  const toolbarLeft = Math.max(8, left + width / 2 - 120);

  return (
    <div
      className="absolute z-50 pointer-events-auto"
      style={{ top: `${toolbarTop}px`, left: `${toolbarLeft}px` }}
    >
      <div className="flex items-center gap-1 bg-zinc-900 dark:bg-zinc-800 rounded-lg shadow-xl px-1.5 py-1">
        {!isImage && (
          <button
            onClick={onConfirm}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-500 hover:bg-blue-600 text-white text-[11px] font-bold tracking-wide transition-colors"
          >
            <Check className="w-3 h-3" strokeWidth={3} />
            Confirm
          </button>
        )}

        <button
          onClick={onDismiss}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-white/10 text-zinc-400 hover:text-white text-[11px] font-semibold tracking-wide transition-colors"
        >
          <X className="w-3 h-3" strokeWidth={3} />
          Cancel
        </button>

        {canRevert && (
          <>
            <div className="w-px h-4 bg-zinc-700" />
            <button
              onClick={onRevert}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-white/10 text-amber-400 hover:text-amber-300 text-[11px] font-semibold tracking-wide transition-colors"
            >
              <RotateCcw className="w-3 h-3" strokeWidth={2.5} />
              Revert
            </button>
          </>
        )}
      </div>
    </div>
  );
}
