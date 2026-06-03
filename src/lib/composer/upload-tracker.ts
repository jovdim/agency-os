"use client";

import { createContext, useContext, useRef, useMemo } from "react";

/**
 * Shared tracker for in-flight composer image uploads.
 *
 * Why this exists:
 *   The composer's image fields each kick off an async upload to Supabase
 *   staging. Until the upload resolves, the composition state DOES NOT
 *   carry the new URL — only an optimistic blob preview in the iframe.
 *
 *   Two bad outcomes if we don't track them:
 *     (1) User clicks Publish while an upload is still running. Publish
 *         flushes the autosave timer (the local-state→DB write) but
 *         autosave can't carry what's not in state yet. The publish
 *         payload ships without the in-flight image, the deployed page
 *         renders broken, and the user has to re-upload.
 *     (2) User starts an upload and quickly clicks a different section
 *         in the rail. The right panel re-renders, the previous field's
 *         component unmounts. Anything tied to the field's lifecycle
 *         (a useEffect cleanup that aborts the fetch) silently kills
 *         the upload. The optimistic preview is forgotten, the URL is
 *         never committed, and publish ships nothing. Same broken
 *         result as (1) but the user didn't even press publish to
 *         trigger it.
 *
 * The tracker is composer-level state (lives on the composer-client),
 * not field-level. Fields wrap their upload with `trackUpload(promise)`
 * to register the work; the composer's publish handler calls
 * `awaitAllPendingUploads()` before posting the publish request. The
 * tracker is keyed by the promise itself, not a counter, so we can
 * surface "still N uploads in flight" affordances later if useful.
 *
 * Cleanup contract: every promise registered with trackUpload removes
 * itself from the in-flight set on settle (success or failure). The
 * tracker never holds promise references past completion.
 */

export interface UploadTracker {
  /** Register a promise so the composer knows there's pending work.
   *  Returns the same promise unchanged for chaining ergonomics. */
  trackUpload<T>(promise: Promise<T>): Promise<T>;
  /** Resolve when every currently-tracked promise has settled. If new
   *  uploads start while we're waiting, they're included — we loop
   *  until the set is genuinely empty. */
  awaitAllPendingUploads(): Promise<void>;
  /** Snapshot of how many uploads are currently in flight. Used by
   *  publish gating and future "in-flight badge" UI. */
  pendingCount(): number;
}

// Null-object fallback: every method is a safe no-op so consumers can
// always call the hook without an Error-Boundary safety net. Hits when
// a component using uploads is rendered outside the composer (e.g. in
// Storybook, a unit test, or a stray legacy mount point).
const NULL_TRACKER: UploadTracker = {
  trackUpload: (p) => p,
  awaitAllPendingUploads: async () => {},
  pendingCount: () => 0,
};

export const UploadTrackerContext = createContext<UploadTracker>(NULL_TRACKER);

/**
 * Mount inside the composer to get a stable tracker. The returned
 * object is referentially stable for the lifetime of the component, so
 * passing it to memoized children is safe.
 */
export function useCreateUploadTracker(): UploadTracker {
  // Set so insertions and deletions are O(1) and we can iterate to
  // build a Promise.allSettled() in the drain function.
  const pending = useRef<Set<Promise<unknown>>>(new Set());

  return useMemo<UploadTracker>(
    () => ({
      trackUpload<T>(promise: Promise<T>): Promise<T> {
        // Wrap with .finally so we always clean up, even on rejection.
        // Important: we register the WRAPPED promise (which keeps a
        // chain to the original) so the drain function awaits exactly
        // the promise it was handed in trackUpload.
        const wrapped = promise.finally(() => {
          pending.current.delete(wrapped);
        });
        pending.current.add(wrapped);
        return promise;
      },
      async awaitAllPendingUploads(): Promise<void> {
        // Loop so uploads kicked off WHILE draining (rare but possible
        // — e.g. an AI-image flow that fires off a second upload on
        // completion) are still awaited.
        while (pending.current.size > 0) {
          await Promise.allSettled([...pending.current]);
        }
      },
      pendingCount(): number {
        return pending.current.size;
      },
    }),
    [],
  );
}

/** Hook for upload sites to register their in-flight promises. */
export function useUploadTracker(): UploadTracker {
  return useContext(UploadTrackerContext);
}
