import { cn } from "@/lib/utils";

/**
 * Single source of truth for the product's brand mark + wordmark.
 *
 * White-label by design: the logo assets live in /public and are referenced
 * here in ONE place. Swap the files (or these paths) and every surface updates.
 *
 * Assets:
 *  - /GoWebify.svg — full horizontal logo lockup (G mark + "GoWebify" wordmark).
 *    The wordmark is white, so it's intended for DARK surfaces (the app chrome,
 *    login, and landing are dark by default).
 *  - /GoWebify.png — the square "G" mark on its own (also used as the favicon).
 */
export const BRAND_NAME = "GoWebify";

/** The square "G" mark on its own — works on light or dark. */
export function BrandMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/GoWebify.png"
      alt=""
      aria-hidden
      draggable={false}
      className={cn("inline-block select-none object-contain", className)}
    />
  );
}

interface BrandProps {
  /** Show only the mark (e.g. a collapsed sidebar). */
  markOnly?: boolean;
  className?: string;
  /** Sizing/utility classes for the mark (markOnly). */
  markClassName?: string;
  /** Sizing/utility classes for the full logo image. */
  wordmarkClassName?: string;
}

export function Brand({
  markOnly = false,
  className,
  markClassName,
  wordmarkClassName,
}: BrandProps) {
  if (markOnly) {
    return (
      <span className={cn("inline-flex items-center", className)}>
        <BrandMark className={cn("size-7", markClassName)} />
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/GoWebify.svg"
        alt={BRAND_NAME}
        draggable={false}
        className={cn("h-9 w-auto select-none", wordmarkClassName)}
      />
    </span>
  );
}
