"use client";

import { useState } from "react";
import { X, ArrowCounterClockwise as RotateCcw, Trash as Trash2, PaperPlaneTilt as Send, Image, TextT as Type, ArrowRight, MagnifyingGlassPlus as ZoomIn, Plus, Minus } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface InlineChange {
  id: string;
  file_path: string;
  css_path: string;
  section?: string | null;
  field?: string | null;
  item_id?: string | null;
  action: "update_text" | "replace_image" | "add_gallery_image" | "remove_gallery_image";
  old_value: string;
  new_value: string;
  element_tag: string;
  element_preview: string;
  timestamp: number;
  // Gallery-only
  gallery_id?: string | null;
}

interface ChangesPanelProps {
  visible: boolean;
  changes: InlineChange[];
  onRevert: (changeId: string) => void;
  onDiscardAll: () => void;
  onSubmit: () => void;
  onHighlight: (change: InlineChange) => void;
  onClose: () => void;
  credits: number;
  isPaid: boolean;
  isSubmitting: boolean;
}

const TEXT_TRUNCATE = 80;

function TextDiff({ oldValue, newValue }: { oldValue: string; newValue: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand = oldValue.length > TEXT_TRUNCATE || newValue.length > TEXT_TRUNCATE;

  return (
    <div className="space-y-1 text-[11px] mt-1.5 rounded-md border border-border/60 bg-secondary/40 px-2 py-1.5">
      <div className="line-through text-muted-foreground wrap-break-word">
        {expanded || !needsExpand ? oldValue : oldValue.slice(0, TEXT_TRUNCATE) + "..."}
      </div>
      <div className="text-foreground wrap-break-word">
        {expanded || !needsExpand ? newValue : newValue.slice(0, TEXT_TRUNCATE) + "..."}
      </div>
      {needsExpand && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="text-[10px] dash-accent hover:underline font-medium"
        >
          {expanded ? "Hide" : "Show full text"}
        </button>
      )}
    </div>
  );
}

export function ChangesPanel({
  visible,
  changes,
  onRevert,
  onDiscardAll,
  onSubmit,
  onHighlight,
  onClose,
  credits,
  isPaid,
  isSubmitting,
}: ChangesPanelProps) {
  const [previewImg, setPreviewImg] = useState<string | null>(null);

  // Group changes by file
  const grouped = changes.reduce<Record<string, InlineChange[]>>((acc, c) => {
    const key = c.file_path;
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {});

  const fileNames = Object.keys(grouped);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 z-30 cursor-pointer transition-all duration-300 ease-out ${
          visible ? "bg-black/20 opacity-100" : "bg-black/0 opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div className={`absolute top-0 right-0 bottom-0 w-80 bg-card border-l border-border shadow-[0_8px_40px_-12px_rgba(0,0,0,0.25)] z-40 flex flex-col transition-transform duration-300 ease-out ${
        visible ? "translate-x-0" : "translate-x-full"
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border dash-subhead shrink-0">
          <h3 className="text-sm font-semibold tracking-tight tabular-nums">
            {changes.length} {changes.length === 1 ? "change" : "changes"}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Submit button */}
        <div className="px-4 py-2 border-b border-border shrink-0">
          {changes.length > 0 ? (
            <Button
              size="sm"
              className="w-full gap-1.5"
              onClick={onSubmit}
              disabled={changes.length === 0 || isSubmitting}
            >
              <Send className="w-3.5 h-3.5" />
              {isSubmitting ? "Sending..." : "Submit changes"}
            </Button>
          ) : (
            <div className="text-xs text-muted-foreground text-center py-1">
              No changes
            </div>
          )}
        </div>

        {/* Changes list */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-3 space-y-3">
            {fileNames.map((file) => (
              <div key={file}>
                {fileNames.length > 1 && (
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
                    {file === "index.html" ? "Home" : file.replace(".html", "")}
                  </div>
                )}
                <div className="space-y-1.5">
                  {grouped[file].map((change) => (
                    <div
                      key={change.id}
                      className="rounded-xl border border-border bg-card p-2.5 hover:border-[color-mix(in_oklab,var(--dash-accent)_32%,var(--dash-border))] hover:shadow-[0_2px_12px_-6px_rgba(0,0,0,0.15)] transition-all cursor-pointer overflow-hidden"
                      onClick={() => onHighlight(change)}
                    >
                      {/* Header row: icon + label + revert */}
                      <div className="flex items-center gap-2 mb-1">
                        {change.action === "replace_image" ? (
                          <span className="dash-chip flex items-center justify-center w-6 h-6 rounded-md shrink-0">
                            <Image className="w-3.5 h-3.5" />
                          </span>
                        ) : change.action === "add_gallery_image" ? (
                          <span className="dash-chip-pink flex items-center justify-center w-6 h-6 rounded-md shrink-0">
                            <Plus className="w-3.5 h-3.5" />
                          </span>
                        ) : change.action === "remove_gallery_image" ? (
                          <span className="dash-chip flex items-center justify-center w-6 h-6 rounded-md shrink-0 text-muted-foreground">
                            <Minus className="w-3.5 h-3.5" />
                          </span>
                        ) : (
                          <span className="dash-chip flex items-center justify-center w-6 h-6 rounded-md shrink-0">
                            <Type className="w-3.5 h-3.5" />
                          </span>
                        )}
                        <span className="text-xs font-medium truncate flex-1 min-w-0">
                          {change.action === "add_gallery_image" ? "Photo added"
                            : change.action === "remove_gallery_image" ? "Photo removed"
                            : change.element_preview}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRevert(change.id);
                          }}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 hover:bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px] font-medium transition-colors shrink-0"
                          title="Revert"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          Revert
                        </button>
                      </div>

                      {/* Text diff */}
                      {change.action === "update_text" && (
                        <TextDiff oldValue={change.old_value} newValue={change.new_value} />
                      )}

                      {/* Gallery: added — show just the new photo */}
                      {change.action === "add_gallery_image" && change.new_value && (
                        <div className="flex items-center gap-2 mt-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); setPreviewImg(change.new_value); }}
                            className="relative w-14 h-14 rounded-md border border-green-300/50 dark:border-green-700/50 overflow-hidden shrink-0 bg-secondary hover:ring-2 hover:ring-green-400 transition-all"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={change.new_value} alt="New" className="w-full h-full object-cover" />
                          </button>
                        </div>
                      )}

                      {/* Gallery: removed — show old photo crossed out */}
                      {change.action === "remove_gallery_image" && change.old_value && (
                        <div className="flex items-center gap-2 mt-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); setPreviewImg(change.old_value); }}
                            className="relative w-14 h-14 rounded-md border border-red-300/50 dark:border-red-700/50 overflow-hidden shrink-0 bg-secondary hover:ring-2 hover:ring-red-400 transition-all opacity-60"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={change.old_value} alt="Removed" className="w-full h-full object-cover" />
                          </button>
                        </div>
                      )}

                      {/* Image diff */}
                      {change.action === "replace_image" && (
                        <div className="flex items-center gap-2 mt-1">
                          {change.old_value && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setPreviewImg(change.old_value); }}
                              className="relative w-14 h-14 rounded-md border border-red-300/50 dark:border-red-700/50 overflow-hidden shrink-0 bg-secondary hover:ring-2 hover:ring-red-400 transition-all group"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={change.old_value} alt="Original" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors">
                                <ZoomIn className="w-3 h-3 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </button>
                          )}
                          <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                          {change.new_value && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setPreviewImg(change.new_value); }}
                              className="relative w-14 h-14 rounded-md border border-green-300/50 dark:border-green-700/50 overflow-hidden shrink-0 bg-secondary hover:ring-2 hover:ring-green-400 transition-all group"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={change.new_value} alt="New" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors">
                                <ZoomIn className="w-3 h-3 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {changes.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-8">
                No changes
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Discard all */}
        {changes.length > 0 && (
          <div className="px-4 py-3 border-t border-border dash-subhead shrink-0">
            <button
              onClick={onDiscardAll}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors w-full justify-center"
            >
              <Trash2 className="w-3 h-3" />
              Discard all changes
            </button>
          </div>
        )}
      </div>

      {/* Image preview lightbox */}
      {previewImg && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center cursor-pointer animate-in fade-in duration-150"
          onClick={() => setPreviewImg(null)}
        >
          <div className="relative max-w-[80vw] max-h-[80vh] animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setPreviewImg(null)}
              className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-card border border-border flex items-center justify-center hover:bg-secondary transition-colors z-10"
            >
              <X className="w-4 h-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImg}
              alt="Preview"
              className="max-w-full max-h-[80vh] rounded-xl shadow-[0_8px_60px_-12px_rgba(0,0,0,0.5)] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </>
  );
}
