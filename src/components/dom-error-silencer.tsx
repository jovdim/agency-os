"use client";

import { useEffect } from "react";

/**
 * Prevents the "removeChild on a node that isn't a child" / "insertBefore
 * with a bad reference" crashes that take down the whole app via React's
 * reconciliation error boundary.
 *
 * ── Why a simple window.onerror listener doesn't work ──────────────────
 * React's reconciler calls Node.removeChild() synchronously during a
 * commit. When the DOM has been mutated underneath React (by sonner
 * portal animations, Radix Tooltip/Popover, Google Translate, Grammarly),
 * removeChild throws. React catches it INSIDE its commit phase, marks
 * the root as crashed, and renders the error boundary. The error never
 * reaches window.onerror — it's already been handled (badly) by React.
 *
 * ── Fix: patch the DOM API itself ──────────────────────────────────────
 * We intercept Node.prototype.removeChild and Node.prototype.insertBefore.
 * If the call is invalid (target isn't actually our child, or the
 * insert-reference isn't), we return a safe no-op result instead of
 * throwing. The original DOM operation effectively "succeeds" from
 * React's perspective; the app keeps working. The original methods are
 * preserved and used for all valid calls.
 *
 * Same pattern Sentry/Discord/Linear use. Trade-off: a real bug where
 * code tries to remove a non-child would silently no-op instead of
 * throwing. In practice this is exactly what we want — the alternative
 * is the entire app crashing on a transient animation race.
 *
 * Also keeps the window.onerror listener as a belt-and-braces safety net
 * for any non-reconciliation throws of the same signature.
 *
 * Mount once at the root layout. No props, no state.
 */
export function DomErrorSilencer() {
  useEffect(() => {
    // ── DOM-level patch (the real fix) ────────────────────────────────
    const originalRemoveChild = Node.prototype.removeChild;
    const originalInsertBefore = Node.prototype.insertBefore;

    Node.prototype.removeChild = function <T extends Node>(
      this: Node,
      child: T,
    ): T {
      if (child.parentNode !== this) {
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn(
            "[DomErrorSilencer] removeChild called on non-child — silencing.",
          );
        }
        return child;
      }
      return originalRemoveChild.call(this, child) as T;
    } as typeof Node.prototype.removeChild;

    Node.prototype.insertBefore = function <T extends Node>(
      this: Node,
      newNode: T,
      refNode: Node | null,
    ): T {
      if (refNode && refNode.parentNode !== this) {
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn(
            "[DomErrorSilencer] insertBefore with bad ref — falling back to appendChild.",
          );
        }
        return this.appendChild(newNode) as T;
      }
      return originalInsertBefore.call(this, newNode, refNode) as T;
    } as typeof Node.prototype.insertBefore;

    // ── Window-level listener (belt-and-braces) ───────────────────────
    function shouldSilence(msg: string): boolean {
      return (
        (msg.includes("removeChild") || msg.includes("insertBefore")) &&
        msg.includes("not a child of this node")
      );
    }

    function onError(e: ErrorEvent) {
      if (e.error?.message && shouldSilence(e.error.message)) {
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn(
            "[DomErrorSilencer] window.onerror caught:",
            e.error.message,
          );
        }
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }

    function onUnhandled(e: PromiseRejectionEvent) {
      const msg =
        e.reason instanceof Error ? e.reason.message : String(e.reason ?? "");
      if (shouldSilence(msg)) {
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn("[DomErrorSilencer] unhandled rejection:", msg);
        }
        e.preventDefault();
      }
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);

    return () => {
      // Restore originals on unmount (mostly for HMR / dev cleanliness;
      // in production this effect mounts once and lives forever).
      Node.prototype.removeChild = originalRemoveChild;
      Node.prototype.insertBefore = originalInsertBefore;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);

  return null;
}
