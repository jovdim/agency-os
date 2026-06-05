"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ContentItem, FieldChange } from "@/types/content";
import { Image as ImageIcon, Plus, X, CircleNotch as Loader2, ArrowsClockwise as RefreshCw, Trash as Trash2 } from "@phosphor-icons/react/ssr";

interface GalleryEditorProps {
  sectionId: string;
  headline: string;
  items: ContentItem[];
  onChange: (change: FieldChange) => void;
}

export function GalleryEditor({
  sectionId,
  headline,
  items,
  onChange,
}: GalleryEditorProps) {
  const [localItems, setLocalItems] = useState<ContentItem[]>(items);
  const [uploading, setUploading] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldOrder = localItems.map((item) => item.id);
      const oldIndex = localItems.findIndex((item) => item.id === active.id);
      const newIndex = localItems.findIndex((item) => item.id === over.id);
      const newItems = arrayMove(localItems, oldIndex, newIndex);
      setLocalItems(newItems);

      // Build human-readable labels for each item
      const itemLabels: Record<string, string> = {};
      localItems.forEach((item) => {
        itemLabels[item.id] =
          (item.caption as string) || (item.title as string) || (item.label as string) || item.id;
      });

      onChange({
        section_id: sectionId,
        field: "items",
        action: "reorder",
        new_order: newItems.map((item) => item.id),
        old_order: oldOrder,
        item_labels: itemLabels,
        repeater_key: "items",
        repeater_label: "Images",
      });
    },
    [localItems, onChange, sectionId]
  );

  const handleAddImage = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      setUploading(true);
      const newItems: ContentItem[] = [];

      for (const file of Array.from(files)) {
        const previewUrl = URL.createObjectURL(file);
        const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        const item: ContentItem = {
          id,
          image: previewUrl,
          caption: "",
          _pendingFile: file,
        };
        newItems.push(item);
      }

      setLocalItems((prev) => [...prev, ...newItems]);

      onChange({
        section_id: sectionId,
        field: "items",
        action: "add_item",
        items: newItems.map((item) => ({
          id: item.id,
          image: item.image as string,
          caption: item.caption as string,
          _pendingFile: item._pendingFile,
        })),
        repeater_key: "items",
        repeater_label: "Images",
      });

      setUploading(false);
    };
    input.click();
  }, [onChange, sectionId]);

  const handleRemoveItem = useCallback(
    (itemId: string) => {
      const removedItem = localItems.find((item) => item.id === itemId);
      setLocalItems((prev) => prev.filter((item) => item.id !== itemId));
      onChange({
        section_id: sectionId,
        field: "items",
        action: "remove_item",
        item_id: itemId,
        old_item: removedItem ? { ...removedItem } : undefined,
        item_title: removedItem
          ? (removedItem.caption as string) || (removedItem.title as string) || itemId
          : itemId,
        repeater_key: "items",
        repeater_label: "Images",
      });
    },
    [localItems, onChange, sectionId]
  );

  const handleReplaceImage = useCallback(
    (itemId: string) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const previewUrl = URL.createObjectURL(file);
        const fileKey = `_pendingFile_${Date.now()}`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        w[fileKey] = file;
        if (!w._pendingFileMap) w._pendingFileMap = {};
        w._pendingFileMap[previewUrl] = fileKey;

        const oldItem = localItems.find((item) => item.id === itemId);
        setLocalItems((prev) =>
          prev.map((item) =>
            item.id === itemId ? { ...item, image: previewUrl } : item
          )
        );
        onChange({
          section_id: sectionId,
          field: "image",
          item_id: itemId,
          action: "replace_image",
          old_value: (oldItem?.image as string) || "",
          new_value: previewUrl,
          field_label: "Image",
          repeater_key: "items",
          repeater_label: "Images",
        });
      };
      input.click();
    },
    [localItems, onChange, sectionId]
  );

  const handleCaptionChange = useCallback(
    (itemId: string, caption: string) => {
      setLocalItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, caption } : item
        )
      );
      onChange({
        section_id: sectionId,
        field: "caption",
        item_id: itemId,
        action: "update_field",
        new_value: caption,
        field_label: "Caption",
        repeater_key: "items",
        repeater_label: "Images",
      });
    },
    [onChange, sectionId]
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">Edit: Gallery</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Drag to reorder. Click X to remove. Add new images below.
        </p>
      </div>

      {/* Headline field */}
      <div className="p-4 border-b border-border space-y-1.5">
        <Label className="text-xs font-medium">Headline</Label>
        <Input
          value={headline}
          onChange={(e) =>
            onChange({
              section_id: sectionId,
              field: "headline",
              action: "update_field",
              old_value: headline,
              new_value: e.target.value,
              field_label: "Headline",
            })
          }
          className="text-sm"
        />
      </div>

      {/* Gallery grid */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={localItems.map((item) => item.id)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-2 gap-3">
                {localItems.map((item) => (
                  <SortableGalleryItem
                    key={item.id}
                    item={item}
                    onRemove={handleRemoveItem}
                    onReplace={handleReplaceImage}
                    onCaptionChange={handleCaptionChange}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Add button */}
          <Button
            variant="outline"
            className="w-full mt-4 gap-2 border-dashed"
            onClick={handleAddImage}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Add Images
              </>
            )}
          </Button>

          <p className="text-xs text-muted-foreground text-center mt-3">
            {localItems.length} image{localItems.length !== 1 ? "s" : ""} in
            gallery
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}

/* ───────── Sortable Gallery Item ───────── */

interface SortableGalleryItemProps {
  item: ContentItem;
  onRemove: (id: string) => void;
  onReplace: (id: string) => void;
  onCaptionChange: (id: string, caption: string) => void;
}

function SortableGalleryItem({
  item,
  onRemove,
  onReplace,
  onCaptionChange,
}: SortableGalleryItemProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const imageUrl = item.image as string;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "group border border-border rounded-lg overflow-hidden bg-card transition-shadow cursor-grab active:cursor-grabbing touch-none",
        isDragging && "shadow-lg ring-2 ring-primary/30 z-50",
        confirmDelete && "ring-2 ring-destructive/50"
      )}
    >
      {/* Image area */}
      <div className="relative aspect-square bg-secondary flex items-center justify-center">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={(item.caption as string) || "Gallery image"}
            className="w-full h-full object-cover pointer-events-none"
          />
        ) : (
          <div className="text-center pointer-events-none">
            <ImageIcon className="w-8 h-8 text-muted-foreground/30 mx-auto" />
            <p className="text-[10px] text-muted-foreground/40 mt-1">
              No image
            </p>
          </div>
        )}

        {/* Top-right actions */}
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
          {/* Replace image */}
          <button
            onClick={() => onReplace(item.id)}
            className="w-6 h-6 rounded bg-background/80 backdrop-blur flex items-center justify-center hover:bg-background"
            title="Replace image"
          >
            <RefreshCw className="w-3 h-3 text-muted-foreground" />
          </button>
          {/* Delete */}
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-6 h-6 rounded bg-destructive/80 backdrop-blur flex items-center justify-center hover:bg-destructive"
            title="Delete image"
          >
            <X className="w-3 h-3 text-white" />
          </button>
        </div>

        {/* Delete confirmation overlay */}
        {confirmDelete && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-30 gap-2">
            <Trash2 className="w-6 h-6 text-white/80" />
            <p className="text-xs text-white font-medium">Delete this image?</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setConfirmDelete(false);
                  onRemove(item.id);
                }}
                className="px-3 py-1 rounded bg-destructive text-white text-xs font-medium hover:bg-destructive/90"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1 rounded bg-white/20 text-white text-xs font-medium hover:bg-white/30"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Caption */}
      <div className="p-2">
        <Input
          value={(item.caption as string) || ""}
          onChange={(e) => onCaptionChange(item.id, e.target.value)}
          placeholder="Caption..."
          className="h-7 text-xs"
        />
      </div>
    </div>
  );
}
