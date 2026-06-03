"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";
import { tagPalette } from "@/components/proposal-tags";
import { cn } from "@/lib/utils";
import type { ProposalTag } from "@/types/database";

/**
 * Tag filter bar for the super admin proposals oversight view.
 *
 * URL-driven: each click toggles the tag's slug in the `?tag=` search
 * parameter (multi-value, OR semantics). Server-side filtering happens
 * in page.tsx — this component is just the UI for editing the URL.
 *
 * Why URL-driven (vs. local component state): the super admin view is a
 * server component for everything else (snappy SSR, status group counts).
 * If we made filtering client-side we'd have to either refactor the whole
 * page to client + add a fetch round-trip, or duplicate the filter logic.
 * URL state means a single search-param change re-renders the server
 * component with the new filtered set.
 */
export function TagFilterBar({
  tags,
  selectedSlugs,
  tagCounts,
}: {
  tags: ProposalTag[];
  selectedSlugs: Set<string>;
  /** slug → count of matching proposals across the whole table. */
  tagCounts: Record<string, number>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  if (tags.length === 0) return null;

  function setTags(nextSlugs: string[]) {
    const sp = new URLSearchParams(params?.toString() || "");
    sp.delete("tag");
    for (const slug of nextSlugs) sp.append("tag", slug);
    const qs = sp.toString();
    startTransition(() => {
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    });
  }

  function toggle(slug: string) {
    const next = new Set(selectedSlugs);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setTags([...next]);
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        isPending && "opacity-60",
      )}
    >
      <span className="text-xs text-muted-foreground mr-1">Filter by tag:</span>
      {tags.map((tag) => {
        const palette = tagPalette(tag.color);
        const active = selectedSlugs.has(tag.slug);
        return (
          <button
            key={tag.id}
            type="button"
            onClick={() => toggle(tag.slug)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-all",
              active ? palette.filled : palette.chip,
              "hover:opacity-90",
            )}
          >
            <span>{tag.name}</span>
            <span
              className={cn(
                "rounded-full px-1 text-[10px] tabular-nums",
                active ? "bg-white/20" : "bg-foreground/10",
              )}
            >
              {tagCounts[tag.slug] || 0}
            </span>
          </button>
        );
      })}
      {selectedSlugs.size > 0 && (
        <button
          type="button"
          onClick={() => setTags([])}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground ml-1"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      )}
    </div>
  );
}
