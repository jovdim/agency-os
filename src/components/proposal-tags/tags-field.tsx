"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Plus, Tag, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TAG_COLORS, tagPalette } from "./tag-palette";
import type { ProposalTag, TagColor } from "@/types/database";

/**
 * Local-state multi-select tag picker for forms that don't have a
 * proposalId yet (e.g. the Create-Proposal dialog).
 *
 * Differs from `ProposalTagPicker`:
 *  - This one does NOT call `/api/proposals/[id]/tags` — it just maintains
 *    a local list of selected tag ids and bubbles them up via `onChange`.
 *    The caller is responsible for sending them when the proposal is
 *    created (the POST /api/proposals body now accepts `tag_ids`).
 *  - Creating a custom tag still hits `/api/proposal-tags` (no proposal
 *    needed for that), then the new tag is added to the local library
 *    and selected.
 *
 * Visual: row of soft chips for the seeded "tier" tags (urgent / priority
 * / basic / premium) shown first as quick toggles, then any custom tags,
 * then a "+ Custom tag" trigger that opens a search/create popover.
 */

const DEFAULT_NEW_COLOR: TagColor = "blue";
// Slugs of the seeded tier tags — they always lead the chip row, in this
// order, regardless of how the API returns them.
const TIER_ORDER = ["urgent", "priority", "basic", "premium"] as const;

export function TagsField({
  value,
  onChange,
  defaultSlug = "basic",
}: {
  /** Selected tag ids (controlled). */
  value: string[];
  /** Called whenever the selection changes. */
  onChange: (next: string[]) => void;
  /** Slug of the tag auto-selected on first mount when `value` is empty.
   *  Keeps the IT-side priority-tier signal even if Erik doesn't pick
   *  anything. Defaults to "basic". Pass null to disable. */
  defaultSlug?: string | null;
}) {
  const [allTags, setAllTags] = useState<ProposalTag[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newColor, setNewColor] = useState<TagColor>(DEFAULT_NEW_COLOR);
  const seededDefault = useRef(false);

  // Load the tag library once on mount. `cache: 'no-store'` forces the
  // browser to skip its disk/memory cache — otherwise a previous fetch
  // (pre-can_delete) can stick around and the delete affordance never
  // shows up even after a hot-reload.
  useEffect(() => {
    fetch("/api/proposal-tags", { cache: "no-store" })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.tags)) setAllTags(data.tags as ProposalTag[]);
        else setAllTags([]);
      })
      .catch(() => {
        toast.error("Failed to load tags");
        setAllTags([]);
      })
      .finally(() => setLoading(false));
  }, []);

  // Once tags are loaded, if value is empty and a defaultSlug is configured,
  // pre-select that tag. Runs only once so the user's later clears stick.
  useEffect(() => {
    if (seededDefault.current) return;
    if (!allTags || !defaultSlug) return;
    if (value.length > 0) {
      seededDefault.current = true;
      return;
    }
    const seed = allTags.find(t => t.slug === defaultSlug);
    if (seed) {
      seededDefault.current = true;
      onChange([seed.id]);
    }
  }, [allTags, defaultSlug, value.length, onChange, value]);

  const valueSet = useMemo(() => new Set(value), [value]);

  // Sort: tier tags first in fixed order, then everything else alphabetical.
  const orderedTags = useMemo(() => {
    if (!allTags) return [];
    const tierIndex = (slug: string) => {
      const idx = (TIER_ORDER as readonly string[]).indexOf(slug);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };
    return [...allTags].sort((a, b) => {
      const ai = tierIndex(a.slug);
      const bi = tierIndex(b.slug);
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name);
    });
  }, [allTags]);

  // The tier tags are always rendered as visible chips in the form row.
  const tierTags = useMemo(() => {
    if (!allTags) return [];
    return (TIER_ORDER as readonly string[])
      .map(slug => allTags.find(t => t.slug === slug))
      .filter((t): t is ProposalTag => !!t);
  }, [allTags]);

  // Selected non-tier (custom) tags rendered after the tier row.
  const selectedCustom = useMemo(() => {
    if (!allTags) return [];
    const tierSlugSet = new Set(TIER_ORDER as readonly string[]);
    return allTags.filter(t => valueSet.has(t.id) && !tierSlugSet.has(t.slug));
  }, [allTags, valueSet]);

  function toggle(id: string) {
    if (valueSet.has(id)) {
      onChange(value.filter(v => v !== id));
    } else {
      onChange([...value, id]);
    }
  }

  // Permanently delete a custom tag from the shared library. The trash
  // affordance is only rendered when the server marked the tag as
  // `can_delete` (creator or super_admin, never a tier slug), but we
  // still re-check in the API. Confirms before firing so a misclick
  // can't nuke a tag that's attached to many proposals.
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
      // Drop from the local library + from the current selection so the
      // chip disappears from the form row immediately.
      setAllTags(prev => (prev ? prev.filter(t => t.id !== tag.id) : prev));
      if (valueSet.has(tag.id)) {
        onChange(value.filter(v => v !== tag.id));
      }
      toast.success(`Tag "${tag.name}" deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const trimmedSearch = search.trim();
  const filtered = useMemo(() => {
    if (!orderedTags) return [];
    if (!trimmedSearch) return orderedTags;
    const q = trimmedSearch.toLowerCase();
    return orderedTags.filter(t => t.name.toLowerCase().includes(q));
  }, [orderedTags, trimmedSearch]);

  const exactMatch = useMemo(() => {
    if (!allTags || !trimmedSearch) return null;
    return allTags.find(t => t.name.toLowerCase() === trimmedSearch.toLowerCase());
  }, [allTags, trimmedSearch]);
  const canCreate = trimmedSearch.length > 0 && !exactMatch;

  async function createAndSelect() {
    if (!trimmedSearch || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/proposal-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedSearch, color: newColor }),
      });
      const data = await res.json();
      if (!res.ok || !data.tag) throw new Error(data.error || "Failed to create tag");
      const created = data.tag as ProposalTag;
      setAllTags(prev => {
        if (!prev) return [created];
        if (prev.some(t => t.id === created.id)) return prev;
        return [...prev, created];
      });
      if (!valueSet.has(created.id)) onChange([...value, created.id]);
      setSearch("");
      setNewColor(DEFAULT_NEW_COLOR);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create tag");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading tags...
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Tier chips — always visible, click to toggle */}
      {tierTags.map(tag => {
        const selected = valueSet.has(tag.id);
        const palette = tagPalette(tag.color);
        return (
          <button
            key={tag.id}
            type="button"
            onClick={() => toggle(tag.id)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-all",
              selected ? palette.chip : "border-dashed border-border/50 text-muted-foreground/60 hover:border-foreground/30 hover:text-foreground/80",
            )}
          >
            {selected && <Check className="h-2.5 w-2.5" />}
            {tag.name}
          </button>
        );
      })}

      {/* Selected custom tags (rendered as solid chips, click to detach).
          When the user owns the tag (or is super_admin) we also surface
          a small trash next to the chip so they can wipe it from the
          shared library without hunting through the popover. The chip
          itself still acts as "remove from this proposal" — the trash
          is the destructive escape hatch with its own confirm. */}
      {selectedCustom.map(tag => {
        const palette = tagPalette(tag.color);
        return (
          <span key={tag.id} className="inline-flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => toggle(tag.id)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-all hover:opacity-80",
                palette.chip,
              )}
              title="Click to remove from this proposal"
            >
              <Check className="h-2.5 w-2.5" />
              {tag.name}
            </button>
            {tag.can_delete && (
              <button
                type="button"
                onClick={() => deleteTagFromLibrary(tag)}
                className="p-0.5 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                title={`Delete "${tag.name}" from the library`}
                aria-label={`Delete tag ${tag.name} from the library`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </span>
        );
      })}

      {/* + Add custom tag — opens popover */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1 h-6 px-2 text-[11px] font-medium">
            <Tag className="h-3 w-3" />
            Custom tag
          </Button>
        </PopoverTrigger>
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
                  createAndSelect();
                }
              }}
            />
          </div>

          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 && !canCreate && (
              <div className="px-2 py-3 text-xs text-muted-foreground">No tags</div>
            )}
            {filtered.map(tag => {
              const selected = valueSet.has(tag.id);
              const palette = tagPalette(tag.color);
              return (
                <div
                  key={tag.id}
                  className="group flex items-center rounded hover:bg-muted/60"
                >
                  <button
                    type="button"
                    onClick={() => toggle(tag.id)}
                    className="flex-1 flex items-center gap-2 px-2 py-1.5 text-left text-sm"
                  >
                    <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", palette.swatch)} />
                    <span className="flex-1 truncate">{tag.name}</span>
                    {selected && <Check className="h-3.5 w-3.5 text-foreground" />}
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

          {canCreate && (
            <div className="border-t p-2 space-y-2 bg-muted/30">
              <p className="text-[11px] text-muted-foreground">Create a new tag</p>
              <div className="flex flex-wrap gap-1">
                {TAG_COLORS.map(color => {
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
                onClick={createAndSelect}
                disabled={creating}
              >
                {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Create "{trimmedSearch}"
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
