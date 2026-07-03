"use client";

/**
 * connect-gsc-card (2026-07-03, BEACON_500 R12 / T0e) - the skippable GSC
 * offer on the first-audit scorecard.
 *
 * Reuses the EXISTING Google OAuth start (the same getGoogleAuthUrl server
 * action the Connections page uses); after the callback lands, the sync
 * path auto-detects the right Search Console property for the domain via
 * pickGscPropertyForDomain (www-insensitive), so the www trap cannot eat
 * the connection. Never blocking: the whole card is an offer, and the
 * scorecard works without it.
 */

import { useState, useTransition } from "react";
import { getGoogleAuthUrl } from "@/app/(shell)/settings/connectors/actions";

export function ConnectGscCard({ domain }: { domain: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConnect() {
    setError(null);
    startTransition(async () => {
      const result = await getGoogleAuthUrl("gsc");
      if (result.url) {
        window.location.href = result.url;
      } else {
        setError(
          "Google sign-in is not configured on this server yet. You can skip this; I keep working from the site read alone.",
        );
      }
    });
  }

  return (
    <div className="rounded-md border border-foreground/15 p-4 space-y-3">
      <p className="text-[13px] font-medium">See your real Google clicks</p>
      <p className="text-[13px] text-muted-foreground">
        Connect Google Search Console and I score every page with real search
        numbers instead of estimates. I auto-detect the right property for{" "}
        <span className="font-mono text-foreground">{domain}</span>, with or
        without www. Takes under a minute, and you can skip it. I keep working
        from the site read alone.
      </p>
      {error ? (
        <p className="text-[12px] text-amber-600" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={handleConnect}
        disabled={isPending}
        className="rounded-md bg-foreground text-background px-4 py-2 text-[13px] font-medium disabled:opacity-60"
      >
        {isPending ? "Opening Google sign-in" : "Connect Search Console"}
      </button>
    </div>
  );
}
