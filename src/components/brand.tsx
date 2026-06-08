import { cn } from "@/lib/utils";

/**
 * Single source of truth for the product's brand mark + wordmark.
 *
 * White-label by design: this codebase is sold on to agencies, so the name and
 * mark live in ONE place. Change BRAND_NAME (and/or swap BrandMark's contents
 * for an <img src="/logo.svg" />) and every surface updates at once.
 * Deliberately country/locale-agnostic (no "SK"/Slovakia) and intentionally
 * NOT a gradient/sparkle "AI template" mark — a solid, confident lettermark.
 */
export const BRAND_NAME = "GoWebify";

/** Solid brand-color tile with the wordmark's initial. Placeholder until a
 *  real logo asset lands. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-brand font-semibold leading-none text-white",
        className,
      )}
    >
      {BRAND_NAME.charAt(0)}
    </span>
  );
}

interface BrandProps {
  /** Show only the mark (e.g. a collapsed sidebar). */
  markOnly?: boolean;
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
}

export function Brand({
  markOnly = false,
  className,
  markClassName,
  wordmarkClassName,
}: BrandProps) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <BrandMark className={cn("size-7 text-sm", markClassName)} />
      {!markOnly && (
        <span
          className={cn(
            "text-base font-semibold tracking-tight text-foreground",
            wordmarkClassName,
          )}
        >
          {BRAND_NAME}
        </span>
      )}
    </span>
  );
}
