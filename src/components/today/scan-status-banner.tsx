"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getScanStatus } from "@/app/(shell)/scan-status-action";
import { triggerScan } from "@/app/(shell)/trigger-scan-action";
import type { ScanPhase } from "@/domains/scanning/scan-state";

type BannerState = "idle" | "triggering" | "running" | "complete" | "failed";

const POLL_INTERVAL_MS = 5_000;

export function ScanStatusBanner({
  shouldTriggerScan,
}: {
  shouldTriggerScan: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<BannerState>(
    shouldTriggerScan ? "triggering" : "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const triggered = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const status = await getScanStatus();
        if (!status) return;

        const phase: ScanPhase = status.phase;

        if (phase === "running") {
          setState("running");
          setMessage(status.message ?? "Scanning your site…");
          return;
        }

        if (phase === "success" || phase === "partial") {
          stopPolling();
          setState("complete");
          const p = status.lastPayload;
          setMessage(
            p
              ? `${p.pagesScanned} pages checked` +
                (p.pagesChanged > 0 ? ` · ${p.pagesChanged} changed` : " · no changes")
              : "Scan finished",
          );
          router.refresh();
          return;
        }

        if (phase === "failed") {
          stopPolling();
          setState("failed");
          setMessage(status.message ?? "Scan encountered an error");
          return;
        }
      } catch {
        // network hiccup — keep polling
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling, router]);

  useEffect(() => {
    if (!shouldTriggerScan || triggered.current) return;
    triggered.current = true;

    setState("triggering");
    setMessage("Starting daily scan…");

    triggerScan().then((res) => {
      if (res.status === "ok") {
        setState("complete");
        const p = res.result?.payload;
        setMessage(
          p
            ? `${p.pagesScanned} pages checked` +
              (p.pagesChanged > 0 ? ` · ${p.pagesChanged} changed` : " · no changes")
            : "Scan finished",
        );
        router.refresh();
      } else {
        setState("failed");
        setMessage(res.error ?? "Scan failed");
      }
    });

    setState("running");
    setMessage("Scanning your site…");
    startPolling();

    return stopPolling;
  }, [shouldTriggerScan, startPolling, stopPolling, router]);

  useEffect(() => stopPolling, [stopPolling]);

  if (state === "idle") return null;

  return (
    <div className={bannerClasses(state)}>
      <div className="flex items-center gap-3">
        <span className={dotClasses(state)} />
        <div className="flex-1 min-w-0">
          <p className={headlineClasses(state)}>{headlineText(state)}</p>
          {message && (
            <p className="text-[12px] text-foreground mt-0.5">{message}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function bannerClasses(s: BannerState): string {
  const base = "rounded-lg border-2 px-4 py-3.5";
  switch (s) {
    case "triggering":
    case "running":
      return `${base} border-accent-primary/30 bg-accent-primary/[0.04]`;
    case "complete":
      return `${base} border-status-success/40 bg-status-success/[0.06]`;
    case "failed":
      return `${base} border-status-danger/40 bg-status-danger/[0.06]`;
    default:
      return base;
  }
}

function dotClasses(s: BannerState): string {
  const base = "h-3 w-3 rounded-full shrink-0";
  switch (s) {
    case "triggering":
    case "running":
      return `${base} bg-accent-primary animate-pulse`;
    case "complete":
      return `${base} bg-status-success`;
    case "failed":
      return `${base} bg-status-danger`;
    default:
      return `${base} bg-muted`;
  }
}

function headlineClasses(s: BannerState): string {
  const base = "text-[13px] font-bold";
  switch (s) {
    case "triggering":
    case "running":
      return `${base} text-accent-primary`;
    case "complete":
      return `${base} text-status-success`;
    case "failed":
      return `${base} text-status-danger`;
    default:
      return `${base} text-foreground`;
  }
}

function headlineText(s: BannerState): string {
  switch (s) {
    case "triggering":
      return "Starting scan…";
    case "running":
      return "Scanning your site…";
    case "complete":
      return "Scan complete";
    case "failed":
      return "Scan failed";
    default:
      return "";
  }
}
