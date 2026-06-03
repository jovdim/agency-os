"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  getSectionType,
  buildDynamicSectionDef,
  type RepeaterFieldDefinition,
} from "@/lib/section-registry";
import { cn } from "@/lib/utils";
import type { ContentSection, FieldChange, ContentItem } from "@/types/content";
import { Pencil, Plus, X, Upload, GripVertical, Trash2, Undo2 } from "lucide-react";

// Field types hidden from client editor — only tech admin can edit these
const CLIENT_HIDDEN_FIELD_TYPES = ["url", "icon", "color", "boolean"];

interface SectionEditorProps {
  section: ContentSection | null;
  onChange: (change: FieldChange) => void;
  highlightedField: {
    sectionId: string;
    fieldName: string;
    itemId?: string;
  } | null;
  originalSections?: ContentSection[];
  onRevert?: (sectionId: string, field: string, itemId?: string) => void;
  isClientEditor?: boolean;
}

export function SectionEditor({
  section,
  onChange,
  highlightedField,
  originalSections,
  onRevert,
  isClientEditor = false,
}: SectionEditorProps) {
  if (!section) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <Pencil className="w-8 h-8 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground/60">
            Select a section to edit
          </p>
        </div>
      </div>
    );
  }

  const sectionDef =
    getSectionType(section.type) ||
    buildDynamicSectionDef(section.type, section.fields);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Editor Fields */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-5 space-y-4">
          {/* Render standalone fields */}
          {sectionDef?.fields.filter((f) => !isClientEditor || !CLIENT_HIDDEN_FIELD_TYPES.includes(f.type)).map((fieldDef) => {
            const value = (section.fields[fieldDef.name] as string) || "";
            const isHighlighted =
              highlightedField?.sectionId === section.id &&
              highlightedField?.fieldName === fieldDef.name;

            // Compute original value for revert
            const origSection = originalSections?.find((s) => s.id === section.id);
            const origValue = origSection ? ((origSection.fields[fieldDef.name] as string) || "") : value;
            const isModified = value !== origValue;

            return (
              <FieldInput
                key={fieldDef.name}
                label={fieldDef.label}
                fieldName={fieldDef.name}
                type={fieldDef.type}
                value={value}
                required={fieldDef.required}
                isHighlighted={isHighlighted}
                isModified={isModified}
                originalValue={origValue}
                onRevert={isModified && onRevert ? () => onRevert(section.id, fieldDef.name) : undefined}
                onChange={(newValue) => {
                  onChange({
                    section_id: section.id,
                    field: fieldDef.name,
                    action:
                      fieldDef.type === "image" ? "replace_image" : "update_field",
                    old_value: value,
                    new_value: newValue,
                    field_label: fieldDef.label,
                  });
                }}
              />
            );
          })}

          {/* Render repeater fields */}
          {sectionDef?.repeaters.map((repeater) => {
            const items =
              (section.fields[repeater.name] as unknown as ContentItem[]) || [];

            return (
              <RepeaterSection
                key={repeater.name}
                sectionId={section.id}
                repeater={repeater}
                items={items}
                highlightedField={highlightedField}
                onChange={onChange}
                isClientEditor={isClientEditor}
                originalSections={originalSections}
                onRevert={onRevert}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────── Repeater Section with DnD ───────── */

interface RepeaterSectionProps {
  sectionId: string;
  repeater: RepeaterFieldDefinition;
  items: ContentItem[];
  highlightedField: SectionEditorProps["highlightedField"];
  onChange: (change: FieldChange) => void;
  isClientEditor?: boolean;
  originalSections?: ContentSection[];
  onRevert?: (sectionId: string, field: string, itemId?: string) => void;
}

function RepeaterSection({
  sectionId,
  repeater,
  items,
  highlightedField,
  onChange,
  isClientEditor,
  originalSections,
  onRevert,
}: RepeaterSectionProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Best human label for an item
  const getItemLabel = useCallback(
    (item: ContentItem): string => {
      return (
        (item.title as string) ||
        (item.label as string) ||
        (item.name as string) ||
        (item.plan as string) ||
        (item.question as string) ||
        (item.caption as string) ||
        (item.author as string) ||
        (item.platform as string) ||
        item.id
      );
    },
    []
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldOrder = items.map((item) => item.id);
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);
      const reordered = arrayMove(items, oldIndex, newIndex);

      const itemLabels: Record<string, string> = {};
      items.forEach((item) => {
        itemLabels[item.id] = getItemLabel(item);
      });

      onChange({
        section_id: sectionId,
        field: repeater.name,
        action: "reorder",
        new_order: reordered.map((item) => item.id),
        old_order: oldOrder,
        item_labels: itemLabels,
        repeater_key: repeater.name,
        repeater_label: repeater.label,
      });
    },
    [items, onChange, sectionId, repeater, getItemLabel]
  );

  return (
    <div>
      <Separator className="my-3" />
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-muted-foreground">
            {repeater.label}
          </Label>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => {
              onChange({
                section_id: sectionId,
                field: repeater.name,
                action: "add_item",
                items: [
                  {
                    id: `new_${Date.now()}`,
                    ...Object.fromEntries(
                      repeater.itemFields.map((f) => [f.name, ""])
                    ),
                  },
                ],
                repeater_key: repeater.name,
                repeater_label: repeater.label,
              });
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add {repeater.label.replace(/s$/, "")}
          </Button>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            {items.map((item, idx) => (
              <SortableRepeaterItem
                key={item.id || idx}
                item={item}
                index={idx}
                sectionId={sectionId}
                repeater={repeater}
                highlightedField={highlightedField}
                onChange={onChange}
                isClientEditor={isClientEditor}
                originalSections={originalSections}
                onRevert={onRevert}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

/* ───────── Sortable Repeater Item ───────── */

interface SortableRepeaterItemProps {
  item: ContentItem;
  index: number;
  sectionId: string;
  repeater: RepeaterFieldDefinition;
  highlightedField: SectionEditorProps["highlightedField"];
  onChange: (change: FieldChange) => void;
  isClientEditor?: boolean;
  originalSections?: ContentSection[];
  onRevert?: (sectionId: string, field: string, itemId?: string) => void;
}

function SortableRepeaterItem({
  item,
  index,
  sectionId,
  repeater,
  highlightedField,
  onChange,
  isClientEditor,
  originalSections,
  onRevert,
}: SortableRepeaterItemProps) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "border border-border/50 rounded-lg p-3 space-y-2.5 transition-shadow",
        isDragging && "shadow-lg ring-2 ring-primary/30 z-50 bg-card",
        confirmDelete && "ring-2 ring-destructive/50"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-foreground transition-colors"
          >
            <GripVertical className="w-4 h-4" />
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            #{index + 1}
          </span>
        </div>
        {confirmDelete ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-destructive font-medium">Delete?</span>
            <Button
              variant="destructive"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                setConfirmDelete(false);
                onChange({
                  section_id: sectionId,
                  field: repeater.name,
                  action: "remove_item",
                  item_id: item.id,
                  old_item: { ...item },
                  repeater_key: repeater.name,
                  repeater_label: repeater.label,
                });
              }}
            >
              Yes
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setConfirmDelete(false)}
            >
              No
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-destructive/40 hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {repeater.itemFields.filter((f) => !isClientEditor || !CLIENT_HIDDEN_FIELD_TYPES.includes(f.type)).map((itemField) => {
        const itemValue = (item[itemField.name] as string) || "";
        const isHighlighted =
          highlightedField?.sectionId === sectionId &&
          highlightedField?.fieldName === itemField.name &&
          highlightedField?.itemId === item.id;

        // Compute original value for revert
        const origSection = originalSections?.find((s) => s.id === sectionId);
        const origItems = origSection ? (origSection.fields[repeater.name] as unknown as ContentItem[]) || [] : [];
        const origItem = origItems.find((oi) => oi.id === item.id);
        const origValue = origItem ? ((origItem[itemField.name] as string) || "") : "";
        const isModified = itemValue !== origValue;

        return (
          <FieldInput
            key={itemField.name}
            label={itemField.label}
            fieldName={itemField.name}
            type={itemField.type}
            value={itemValue}
            required={itemField.required}
            isHighlighted={isHighlighted}
            isModified={isModified}
            originalValue={origValue}
            onRevert={isModified && onRevert ? () => onRevert(sectionId, itemField.name, item.id) : undefined}
            onChange={(newValue) => {
              onChange({
                section_id: sectionId,
                field: itemField.name,
                item_id: item.id,
                action:
                  itemField.type === "image"
                    ? "replace_image"
                    : "update_field",
                old_value: itemValue,
                new_value: newValue,
                repeater_key: repeater.name,
                repeater_label: repeater.label,
                field_label: itemField.label,
                item_index: index,
              });
            }}
          />
        );
      })}
    </div>
  );
}

/* ───────── Field Input Component ───────── */

interface FieldInputProps {
  label: string;
  fieldName: string;
  type: string;
  value: string;
  required: boolean;
  isHighlighted: boolean;
  isModified?: boolean;
  originalValue?: string;
  onRevert?: () => void;
  onChange: (value: string) => void;
}

function FieldInput({
  label,
  fieldName,
  type,
  value,
  required,
  isHighlighted,
  isModified,
  originalValue,
  onRevert,
  onChange,
}: FieldInputProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isHighlighted && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isHighlighted]);

  return (
    <div
      ref={ref}
      className={cn(
        "space-y-1.5 transition-all duration-300 rounded-lg p-2.5 -m-2",
        isHighlighted && "ring-2 ring-primary/50 bg-primary/5",
        isModified && !isHighlighted && "border-l-3 border-l-primary/60 bg-primary/5 pl-3"
      )}
    >
      <div className="flex items-center justify-between">
        <Label htmlFor={fieldName} className="text-[11px] font-medium text-muted-foreground/80">
          {label}
          {required && <span className="text-destructive/70 ml-0.5">*</span>}
        </Label>
        {onRevert && (
          <button
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onRevert(); }}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-primary hover:bg-primary/10 transition-colors px-2 py-1 rounded cursor-pointer select-none"
            title={originalValue && type !== "image" ? `Original: ${originalValue}` : "Revert to original"}
          >
            <Undo2 className="w-3 h-3" />
            Revert
          </button>
        )}
      </div>

      {type === "textarea" ? (
        <Textarea
          id={fieldName}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${label.toLowerCase()}`}
          rows={3}
          className="text-sm resize-none"
        />
      ) : type === "image" ? (
        <div className="space-y-2">
          {value && (
            <div className="relative w-full h-32 bg-secondary rounded-lg overflow-hidden border border-border group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={value}
                alt="Preview"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                  const parent = (e.target as HTMLImageElement).parentElement;
                  if (parent && !parent.querySelector(".fallback-text")) {
                    const span = document.createElement("span");
                    span.className =
                      "fallback-text text-xs text-muted-foreground p-2 block truncate";
                    span.textContent = value;
                    parent.appendChild(span);
                  }
                }}
              />
              {/* Delete image overlay button */}
              <button
                onClick={() => onChange("")}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded bg-destructive/80 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
                title="Remove image"
              >
                <Trash2 className="w-3 h-3 text-white" />
              </button>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 text-xs cursor-pointer"
            onClick={() => {
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
                onChange(previewUrl);
              };
              input.click();
            }}
          >
            <Upload className="w-3.5 h-3.5" />
            {value ? "Replace Image" : "Upload Image"}
          </Button>
          {value && (
            <p
              className="text-[10px] text-muted-foreground truncate"
              title={value}
            >
              {value}
            </p>
          )}
        </div>
      ) : type === "url" ? (
        <Input
          id={fieldName}
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://..."
          className="text-sm"
        />
      ) : type === "email" ? (
        <Input
          id={fieldName}
          type="email"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="email@example.com"
          className="text-sm"
        />
      ) : type === "phone" ? (
        <Input
          id={fieldName}
          type="tel"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="+421 ..."
          className="text-sm"
        />
      ) : type === "number" ? (
        <Input
          id={fieldName}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className="text-sm"
        />
      ) : type === "color" ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={value || "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-8 rounded border border-border cursor-pointer"
          />
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="#000000"
            className="text-sm flex-1"
          />
        </div>
      ) : (
        <Input
          id={fieldName}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${label.toLowerCase()}`}
          className="text-sm"
        />
      )}
    </div>
  );
}
