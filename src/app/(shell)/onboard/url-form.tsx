"use client";

/**
 * url-form - the URL-first signup field (2026-07-03, BEACON_500 R12 / T0e).
 *
 * One input, one button. Mirrors business-form's action-calling pattern:
 * validation errors render inline, the success path is a server-side
 * redirect (NEXT_REDIRECT re-thrown). The pending copy is honest about the
 * ~half-minute first read instead of a silent spinner.
 */

import { useState, useTransition } from "react";
import { startFromUrl } from "./actions";

/**
 * Minimal client-side domain preview: strip scheme/www/path so the hint can
 * echo the bare host. Returns null when it can't be a website address. (The
 * server action re-validates with normalizeSiteUrl before any write.)
 */
function previewDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < 4) return null;
  const host = trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]!;
  if (!host.includes(".") || /\s/.test(host)) return null;
  return host;
}

export function UrlFirstForm({ initialUrl }: { initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmed = url.trim();
  const normalized = trimmed ? previewDomain(trimmed) : null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const r = await startFromUrl({ url });
        if (!r.ok) setError(r.error);
        // Success: the action redirects to /onboard/done (throws).
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "digest" in err &&
          typeof (err as { digest?: unknown }).digest === "string" &&
          (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
        ) {
          throw err;
        }
        setError("Something went wrong reading your site. Try again.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <label htmlFor="site-url" className="block text-[13px] font-medium">
          Your website
        </label>
        <input
          id="site-url"
          name="url"
          type="text"
          autoComplete="url"
          inputMode="url"
          required
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="acme.com"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "site-url-error" : "site-url-hint"}
          className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-[14px] outline-none focus:border-foreground/40"
        />
        {error ? (
          <p id="site-url-error" className="text-[12px] text-rose-600" role="alert">
            {error}
          </p>
        ) : normalized ? (
          <p id="site-url-hint" className="text-[12px] text-muted-foreground">
            I will read{" "}
            <span className="font-mono text-foreground">https://{normalized}</span>{" "}
            page by page, politely, and score what I find.
          </p>
        ) : trimmed ? (
          <p id="site-url-hint" className="text-[12px] text-amber-600">
            That does not look like a website address yet. Enter it like{" "}
            <span className="font-mono">acme.com</span>.
          </p>
        ) : (
          <p id="site-url-hint" className="text-[12px] text-muted-foreground">
            Just the address is enough. I work out the rest from your site.
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-foreground text-background px-4 py-2 text-[14px] font-medium disabled:opacity-60"
      >
        {isPending ? "Reading your site. This takes about half a minute." : "Read my site"}
      </button>
    </form>
  );
}
