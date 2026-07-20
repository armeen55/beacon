"use client";

import { useEffect } from "react";

/**
 * Shell route error boundary (Move 3 hardening). NEVER renders the raw exception
 * message to the operator — that can leak stack fragments / internal codes. Shows
 * friendly recovery copy + a short digest they can quote for support, logs the
 * technical detail to the console, and offers Retry.
 */
export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Technical detail goes to the log, not the UI.
    console.error("[shell] route error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6" role="alert">
      <div className="w-full max-w-md rounded-lg border border-border/60 bg-surface-inset/30 p-6 text-center">
        <h1 className="text-base font-semibold text-foreground">This page hit a snag on my side.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your data is safe and nothing was published. Try again in a moment.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
        >
          Try again
        </button>
        {error.digest ? (
          <p className="mt-4 text-[11px] text-muted-foreground/60">
            If it keeps happening, mention code {error.digest} to support.
          </p>
        ) : null}
      </div>
    </div>
  );
}
