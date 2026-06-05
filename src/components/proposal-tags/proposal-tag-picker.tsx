"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Plus, Tag, X, CircleNotch as Loader2, Trash as Trash2 } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TAG_COLORS, tagPalette } from "./tag-palette";
import { ProposalTagChips } from "./proposal-tag-chips";
import type { ProposalTag, TagColor } from "@/types/database";

/**
 * Popover-based tag picker for the proposal detail page.
 *
 * UX:
 *   1. Compact "Tags" trigger button next to the proposal title.
 *   2. Click → popover opens with:
 *        - search input (filters existing tags + seeds the create flow)
 *        - list of all tags as toggleable rows (click to attach/detach)
 *        - if search has no matches → "+ Create '{search}'" appears
 *          inline with a 16-color swatch grid
 *   3. Each toggle is one round-trip (POST /api/proposals/[id]/tags or
 *      DELETE). Optimistic — chip flips immediately, rolls back on error.
 *
 * Why optimistic: a tag toggle is a tiny atomic op. Waiting on the server
 * for visual feedback would make the UI feel laggy on Slovakia → Vercel
 * round-trips. Errors revert and toast.
 *
 * State sync: the parent owns `attachedTags` (truth) and gets notified via
 * onChange so it can re-render chip displays elsewhere on the page.
 *
 * Available tags are fetched once on first open (kept in component state).
 * Newly-created tags are merged in locally so a follow-up open shows them.
 */

const DEFAULT_NEW_COLOR: TagColor = "blue";

export function ProposalTagPicker({
  proposalId,
  attachedTags,
  onChange,
  trigger,
  chipSize = "sm",
}: {
  proposalId: string;
  /** Currently attached tags (truth). Driven by the parent. */
  attachedTags: ProposalTag[];
  /** Called whenever the attached set changes (after successful API ops). */
  onChange: (next: ProposalTag[]) => void;
  /** Optional custom trigger; defaults to a "+ Tag" button. */
  trigger?: React.ReactNode;
  /** Size used for the inline chip display next to the trigger. Pages
   *  that want quiet metadata-style chips pass "minimal"; the proposal
   *  detail header uses the default "sm" pills. */
  chipSize?: "minimal" | "xs" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [allTags, setAllTags] = useState<ProposalTag[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newColor, setNewColor] = useState<TagColor>(DEFAULT_NEW_COLOR);
  // Track per-tag toggle in flight so we don't fire the same click twice.
  const inFlight = useRef<Set<string>>(new Set());

  // Lazy-load the tag library on first open. Cheap (one indexed query) and
  // keeps the SSR'd page fast. `cache: 'no-store'` forces a fresh hit so a
  // stale browser cache doesn't strip the `can_delete` flag and hide the
  // delete affordance.
  useEffect(() => {
    if (!open || allTags !== null) return;
    setLoading(true);
    fetch("/api/proposal-tags", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.tags)) setAllTags(data.tags as ProposalTag[]);
        else setAllTags([]);
      })
      .catch(() => {
        toast.error("Failed to load tags");
        setAllTags([]);
      })
      .finally(() => setLoading(false));
  }, [open, allTags]);

  const attachedIds = useMemo(
    () => new Set(attachedTags.map((t) => t.id)),
    [attachedTags],
  );

  const trimmedSearch = search.trim();
  const filtered = useMemo(() => {
    if (!allTags) return [];
    if (!trimmedSearch) return allTags;
    const q = trimmedSearch.toLowerCase();
    return allTags.filter((t) => t.name.toLowerCase().includes(q));
  }, [allTags, trimmedSearch]);

  // Show the "+ Create" affordance only if there's no exact name match for
  // the search string — avoids confusion ("why is there a Create button
  // when 'Urgent' already exists?").
  const exactMatch = useMemo(() => {
    if (!allTags || !trimmedSearch) return null;
    return allTags.find(
      (t) => t.name.toLowerCase() === trimmedSearch.toLowerCase(),
    );
  }, [allTags, trimmedSearch]);
  const canCreate = trimmedSearch.length > 0 && !exactMatch;

  async function toggleTag(tag: ProposalTag) {
    if (inFlight.current.has(tag.id)) return;
    inFlight.current.add(tag.id);

    const wasAttached = attachedIds.has(tag.id);
    // Optimistic update — the parent will re-render the chip display
    // immediately with the new state, no spinner needed for the chip itself.
    const optimistic = wasAttached
      ? attachedTags.filter((t) => t.id !== tag.id)
      : [...attachedTags, tag];
    onChange(optimistic);

    try {
      const res = await fetch(`/api/proposals/${proposalId}/tags`, {
        method: wasAttached ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_id: tag.id }),
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      }
    } catch (err) {
      // Revert + tell the user. We use the original attachedTags (closure
      // value at toggle start) — that's the pre-optimistic snapshot.
      onChange(attachedTags);
      toast.error(err instanceof Error ? err.message : "Failed to update tag");
    } finally {
      inFlight.current.delete(tag.id);
    }
  }

  // Permanently delete a custom tag from the shared library. Mirrors
  // tags-field.tsx — the trash icon only appears when the server-side
  // `can_delete` flag is true (creator or super_admin, never a tier
  // slug). The DELETE API re-checks; we don't trust the flag alone.
  async function deleteTagFromLibrary(tag: ProposalTag) {
    if (!tag.can_delete) return;
    const ok = window.confirm(
      `Really delete the tag "${tag.name}"? It will be removed from every proposal it's assigned to.`,
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/proposal-tags/${tag.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Delete failed");
      }
      // Drop from the library + detach locally so the chip in the
      // attached row disappears immediately. Parent gets onChange'd so
      // any sibling chip display re-renders too.
      setAllTags(prev => (prev ? prev.filter(t => t.id !== tag.id) : prev));
      if (attachedIds.has(tag.id)) {
        onChange(attachedTags.filter(t => t.id !== tag.id));
      }
      toast.success(`Tag "${tag.name}" deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function createAndAttach() {
    if (!trimmedSearch || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/proposal-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedSearch, color: newColor }),
      });
      const data = await res.json();
      if (!res.ok || !data.tag) {
        throw new Error(data.error || "Failed to create tag");
      }
      const created = data.tag as ProposalTag;
      // Merge into the local library so subsequent opens see it without
      // a refetch.
      setAllTags((prev) => {
        if (!prev) return [created];
        if (prev.some((t) => t.id === created.id)) return prev;
        return [...prev, created];
      });
      // Auto-attach the freshly-created tag — that's the natural intent
      // of clicking "+ Create 'Foo'" inside a per-proposal picker.
      // Skip the auto-attach if the tag already existed and is already
      // attached (idempotent-create path).
      if (!attachedIds.has(created.id)) {
        await toggleTag(created);
      }
      setSearch("");
      setNewColor(DEFAULT_NEW_COLOR);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create tag");
    } finally {
      setCreating(false);
    }
  }

  const defaultTrigger = (
    <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs">
      <Tag className="h-3 w-3" />
      {attachedTags.length === 0 ? "Add tag" : "Manage tags"}
    </Button>
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ProposalTagChips
        tags={attachedTags}
        size={chipSize}
        // Clicking an attached chip removes it (Linear/Notion pattern).
        onTagClick={(tag) => toggleTag(tag)}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger ?? defaultTrigger}</PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <div className="p-2 border-b">
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search or create a tag..."
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) {
                  e.preventDefault();
                  createAndAttach();
                }
              }}
            />
          </div>

          <div className="max-h-72 overflow-y-auto p-1">
            {loading && (
              <div className="px-2 py-3 text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading tags...
              </div>
            )}
            {!loading && filtered.length === 0 && !canCreate && (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                No tags
              </div>
            )}
            {!loading &&
              filtered.map((tag) => {
                const isAttached = attachedIds.has(tag.id);
                const palette = tagPalette(tag.color);
                return (
                  <div
                    key={tag.id}
                    className="group flex items-center rounded hover:bg-muted/60"
                  >
                    <button
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className="flex-1 flex items-center gap-2 px-2 py-1.5 text-left text-sm"
                    >
                      <span
                        className={cn(
                          "h-2.5 w-2.5 rounded-full shrink-0",
                          palette.swatch,
                        )}
                      />
                      <span className="flex-1 truncate">{tag.name}</span>
                      {isAttached && (
                        <Check className="h-3.5 w-3.5 text-foreground" />
                      )}
                    </button>
                    {tag.can_delete && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTagFromLibrary(tag);
                        }}
                        className="shrink-0 mr-1 p-1 rounded hover:bg-destructive/10 text-muted-foreground/60 hover:text-destructive transition-colors"
                        title={`Delete "${tag.name}" from the library`}
                        aria-label={`Delete tag ${tag.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
          </div>

          {canCreate && !loading && (
            <div className="border-t p-2 space-y-2 bg-muted/30">
              <p className="text-[11px] text-muted-foreground">
                Create a new tag
              </p>
              <div className="flex flex-wrap gap-1">
                {TAG_COLORS.map((color) => {
                  const palette = tagPalette(color);
                  const selected = newColor === color;
                  return (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewColor(color)}
                      className={cn(
                        "h-5 w-5 rounded-full transition-transform",
                        palette.swatch,
                        selected
                          ? "ring-2 ring-offset-2 ring-offset-background ring-foreground scale-110"
                          : "hover:scale-110",
                      )}
                      aria-label={palette.label}
                    />
                  );
                })}
              </div>
              <Button
                size="sm"
                className="w-full gap-1.5 h-7 text-xs"
                onClick={createAndAttach}
                disabled={creating}
              >
                {creating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                Create "{trimmedSearch}"
              </Button>
            </div>
          )}

          {attachedTags.length > 0 && (
            <div className="border-t p-2">
              <button
                type="button"
                onClick={() => {
                  // Detach everything — confirm via toast undo? For now
                  // we keep it simple: one click clears, user can re-add.
                  attachedTags.forEach((t) => toggleTag(t));
                }}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" />
                Remove all tags
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
