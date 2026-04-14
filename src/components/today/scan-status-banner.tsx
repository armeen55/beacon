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
  pendingChangesCount = 0,
}: {
  shouldTriggerScan: boolean;
  pendingChangesCount?: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<BannerState>(
    shouldTriggerScan ? "triggering" : "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [changesFound, setChangesFound] = useState(0);
  const triggered = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [manualPending, setManualPending] = useState(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const handleScanComplete = useCallback(
    (pagesScanned?: number, pagesChanged?: number) => {
      setState("complete");
      const changed = pagesChanged ?? 0;
      setChangesFound(changed);
      setMessage(
        pagesScanned != null
          ? `${pagesScanned} pages checked` +
            (changed > 0 ? ` · ${changed} changed` : " · no changes")
          : "Scan finished",
      );
      router.refresh();
    },
    [router],
  );

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
          const p = status.lastPayload;
          handleScanComplete(p?.pagesScanned, p?.pagesChanged);
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
  }, [stopPolling, handleScanComplete]);

  useEffect(() => {
    if (!shouldTriggerScan || triggered.current) return;
    triggered.current = true;

    setState("triggering");
    setMessage("Starting daily scan…");

    triggerScan().then((res) => {
      if (res.status === "ok") {
        const p = res.result?.payload;
        handleScanComplete(p?.pagesScanned, p?.pagesChanged);
      } else {
        setState("failed");
        setMessage(res.error ?? "Scan failed");
      }
    });

    setState("running");
    setMessage("Scanning your site…");
    startPolling();

    return stopPolling;
  }, [shouldTriggerScan, startPolling, stopPolling, handleScanComplete]);

  useEffect(() => stopPolling, [stopPolling]);

  const handleManualScan = useCallback(() => {
    if (state === "running" || state === "triggering" || manualPending) return;
    setManualPending(true);
    setState("triggering");
    setMessage("Starting scan…");

    triggerScan().then((res) => {
      setManualPending(false);
      if (res.status === "ok") {
        const p = res.result?.payload;
        handleScanComplete(p?.pagesScanned, p?.pagesChanged);
      } else {
        setState("failed");
        setMessage(res.error ?? "Scan failed");
      }
    });

    setState("running");
    setMessage("Scanning your site…");
    startPolling();
  }, [state, manualPending, startPolling, handleScanComplete]);

  // Show persistent "changes detected" banner if scan found changes OR pending changes exist
  const effectiveChanges = state === "complete" ? changesFound : 0;
  const showChangesBanner = effectiveChanges > 0 || (state === "idle" && pendingChangesCount > 0);
  const changesToReview = effectiveChanges > 0 ? effectiveChanges : pendingChangesCount;

  const showScanButton = state === "idle" || state === "complete" || state === "failed";

  if (state === "idle" && !showChangesBanner && !showScanButton) return null;

  const scrollToReview = () => {
    const el = document.getElementById("change-review-section");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-2">
      {/* Scan status banner */}
      {state !== "idle" && (
        <div className={bannerClasses(state)}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className={dotClasses(state)} />
              <div className="flex-1 min-w-0">
                <p className={headlineClasses(state)}>{headlineText(state)}</p>
                {message && (
                  <p className="text-[12px] text-foreground mt-0.5">{message}</p>
                )}
              </div>
            </div>
            {(state === "complete" || state === "failed") && (
              <button
                type="button"
                onClick={handleManualScan}
                className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md border border-border text-foreground hover:bg-muted transition-colors"
              >
                Scan again
              </button>
            )}
          </div>
        </div>
      )}

      {/* Manual scan button when idle (no auto-trigger) */}
      {state === "idle" && !showChangesBanner && (
        <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-foreground">Ready to scan</p>
              <p className="text-[12px] text-muted-foreground mt-0.5">Check your site for changes since the last scan</p>
            </div>
            <button
              type="button"
              onClick={handleManualScan}
              className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors"
            >
              Scan now
            </button>
          </div>
        </div>
      )}

      {/* Changes detected CTA */}
      {showChangesBanner && (
        <div className="rounded-lg border-2 border-accent-primary/40 bg-accent-primary/[0.06] px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full shrink-0 bg-accent-primary animate-pulse" />
              <div>
                <p className="text-[13px] font-bold text-accent-primary">
                  {changesToReview} change{changesToReview !== 1 ? "s" : ""} detected
                </p>
                <p className="text-[12px] text-foreground mt-0.5">
                  Review and confirm to start tracking their impact
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={scrollToReview}
              className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors"
            >
              Review changes
            </button>
          </div>
        </div>
      )}
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
