"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  /** Team label as returned by `roleToTeam` (e.g. "IT team", "Sales",
   *  "Client"). Drives the headline copy. */
  team: string;
  /** ISO timestamp of when the current holder claimed the lock. Used to
   *  show "Started editing N minutes ago" — gives the second user a
   *  rough sense of whether they're about to wait 30 seconds or 30
   *  minutes. */
  since: string;
  /** Page title / breadcrumb back-link target. The composer page uses
   *  this to send the user back to the proposals queue when they hit
   *  "Go back". Optional — defaults to /. */
  backHref?: string;
}

/**
 * Full-screen "this site is being edited" message rendered instead of
 * the composer when another user holds the edit lock. Page is a server
 * component so this renders before any composer JS loads — there's no
 * brief flash of the editor and no risk of accidental edits sneaking in.
 *
 * The "Try again" button does a soft refresh of the route, which re-runs
 * the server-side `acquireOrCheckLock` call. If the holder's tab has
 * since closed (or hit the 90s TTL), the second user gets in.
 */
export function SiteLockedScreen({ team, since, backHref = "/" }: Props) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const sinceLabel = formatRelative(since);

  function handleRetry() {
    setRefreshing(true);
    // router.refresh() re-runs the server component, which re-runs the
    // lock check. State here resets when the page re-renders — no need
    // to flip `refreshing` back to false ourselves.
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-6">
      <div className="dash-panel max-w-md w-full p-8 space-y-5 text-center">
        <div className="dash-chip mx-auto h-12 w-12 rounded-full flex items-center justify-center">
          <Lock className="h-5 w-5" />
        </div>

        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">Currently in use</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">{team}</span> is
            editing this site right now.
            {sinceLabel && (
              <>
                {" "}
                <span className="text-muted-foreground/80">
                  Started {sinceLabel}.
                </span>
              </>
            )}
          </p>
          <p className="text-xs text-muted-foreground pt-2 leading-relaxed">
            Only one person at a time can edit a site to avoid overwriting
            each other&rsquo;s changes. Please try again in a few minutes.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button onClick={handleRetry} disabled={refreshing} className="w-full">
            <RefreshCw
              className={`h-3.5 w-3.5 mr-2 ${
                refreshing ? "animate-spin" : ""
              }`}
            />
            Try again
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push(backHref)}
            className="w-full"
          >
            Go back
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * "5 minutes ago", "just now", "an hour ago" — coarse buckets that match
 * the lock-display use case. We're not after exact times; we just want
 * the second user to know whether they're about to wait 30 seconds vs
 * 30 minutes.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 30) return "just now";
  if (diffSec < 90) return "a minute ago";
  if (diffSec < 60 * 60) return `${Math.floor(diffSec / 60)} minutes ago`;
  if (diffSec < 60 * 90) return "an hour ago";
  return `${Math.floor(diffSec / 3600)} hours ago`;
}
