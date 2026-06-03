"use client";

/**
 * Root-level error boundary for the whole app. Next.js renders this
 * whenever an unhandled client-side exception escapes during render or
 * an interaction handler. Without it, Next.js falls back to a bland
 * white "Application error: a client-side exception has occurred"
 * screen — useless to the user AND useless for debugging because the
 * actual error is hidden behind the generic copy.
 *
 * What this page does instead:
 *   - Renders inside the app shell colour palette (no white flash)
 *   - Shows the actual `error.message` so the screenshot tells us
 *     what broke (Next.js strips it in dev overlay but error.message
 *     is still safe to render in production)
 *   - Logs the digest (Next.js correlation ID) to console so we can
 *     match against Vercel logs
 *   - "Try again" button calls reset() which retries the render
 *     without a full page reload — fixes transient hydration issues
 *   - "Home" link as a safety net for non-recoverable errors
 */
import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(
      "[app/error.tsx] caught:",
      error.message,
      error.digest ? `(digest: ${error.digest})` : "",
    );
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
      <div className="max-w-md w-full space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            Please try again. If the problem persists, contact support.
          </p>
        </div>

        {/* Actual error message — visible to the user but in muted styling
            so it reads as diagnostic info, not user-facing copy. Most users
            will ignore it; we (and the user when reporting) will screenshot
            it. */}
        <div className="rounded-md border bg-muted/40 px-3 py-2">
          <p className="text-xs font-mono text-muted-foreground break-words">
            {error.message || "Unknown error"}
          </p>
          {error.digest && (
            <p className="text-[10px] font-mono text-muted-foreground/70 mt-1">
              ID: {error.digest}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-medium px-3 py-2 hover:opacity-90 transition-opacity"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md border text-sm font-medium px-3 py-2 hover:bg-muted transition-colors"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
