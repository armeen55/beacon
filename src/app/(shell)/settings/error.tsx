"use client";

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[50vh] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-border/60 bg-surface-inset/30 p-6 text-center">
        <h1 className="text-base font-semibold text-foreground">We couldn&apos;t load this page</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your data is safe. Try again, and if it keeps happening, come back in a few minutes.</p>
        {error.message ? (
          <details className="mt-3 text-left">
            <summary className="cursor-pointer text-xs text-muted-foreground/70">Technical details</summary>
            <p className="mt-1.5 text-xs text-muted-foreground/70 line-clamp-4">{error.message}</p>
          </details>
        ) : null}
        <button
          type="button"
          onClick={() => reset()}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
