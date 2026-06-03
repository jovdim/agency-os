"use client";

/**
 * Root-level error boundary for crashes that happen ABOVE every route
 * segment — i.e. during the root layout render or in a server component
 * that fails before any error.tsx can catch it.
 *
 * Without this file, Next.js falls back to the bland white "Application
 * error: a client-side exception has occurred" screen — useless to the
 * user AND useless for debugging because the actual error message is
 * hidden. We render the same UX as src/app/error.tsx but with our own
 * <html>/<body> wrappers since global-error replaces the root layout.
 *
 * In production we surface error.message + digest on screen so a single
 * screenshot is enough to diagnose; in dev we also log the full stack.
 *
 * The DomErrorSilencer monkey-patch should prevent the known
 * removeChild/insertBefore races from ever reaching this boundary —
 * this file is the last resort if some other unhandled error slips
 * through.
 */
import { useEffect } from "react";

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
      "[app/global-error.tsx] caught:",
      error.message,
      error.digest ? `(digest: ${error.digest})` : "",
      error.stack,
    );
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          background: "#0a0a0a",
          color: "#fafafa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
        }}
      >
        <div
          style={{
            maxWidth: "28rem",
            width: "100%",
            background: "#171717",
            border: "1px solid #262626",
            borderRadius: "0.5rem",
            padding: "1.5rem",
            boxShadow: "0 1px 3px rgba(0,0,0,.4)",
          }}
        >
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: "0.875rem",
              color: "#a3a3a3",
              marginTop: "0.25rem",
              marginBottom: "1rem",
            }}
          >
            Please try again. If the problem persists, contact support.
          </p>

          <div
            style={{
              background: "#0a0a0a",
              border: "1px solid #262626",
              borderRadius: "0.375rem",
              padding: "0.75rem",
              marginBottom: "1rem",
            }}
          >
            <p
              style={{
                fontSize: "0.75rem",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                color: "#a3a3a3",
                wordBreak: "break-word",
                margin: 0,
              }}
            >
              {error.message || "Unknown error"}
            </p>
            {error.digest && (
              <p
                style={{
                  fontSize: "0.625rem",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  color: "#737373",
                  marginTop: "0.25rem",
                  margin: 0,
                }}
              >
                ID: {error.digest}
              </p>
            )}
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                fontSize: "0.875rem",
                fontWeight: 500,
                padding: "0.5rem 0.75rem",
                borderRadius: "0.375rem",
                background: "#fafafa",
                color: "#0a0a0a",
                border: "none",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                fontSize: "0.875rem",
                fontWeight: 500,
                padding: "0.5rem 0.75rem",
                borderRadius: "0.375rem",
                background: "transparent",
                color: "#fafafa",
                border: "1px solid #262626",
                textDecoration: "none",
              }}
            >
              Home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
