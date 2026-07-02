"use client";

/**
 * Publishing mode card (2026-06-16) — the operator arms/disarms one-click
 * live publishing for the current site.
 *
 * DEFAULT is review-gated (two-click: Accept stages → Approve & Push). Arming
 * is an explicit, informed opt-in: the card shows exactly what one-click
 * publishing will do + a readiness checklist, and the Arm button is disabled
 * until every precondition is met AND the operator confirms the safety rails.
 * Disarming is always one click back to the safe default.
 *
 * Loads its own readiness on mount (the dry-run probe shouldn't block the
 * connectors page render).
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  loadPublishingModeReadiness,
  armPublishing,
  disarmPublishing,
  type PublishingModeReadiness,
} from "./publishing-mode-actions";
import {
  loadPublishCanarySummary,
  type PublishCanarySummary,
} from "@/domains/push/publish-canary-actions";

/** "1:51 AM" style clock, in the operator's browser timezone. */
function formatClockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Compact, self-hiding canary line: only renders once a check has landed.
 * `showReady` gates the "all clear" line to the armed state (a not-yet-armed
 * site already shows the readiness checklist above, so repeating "ready"
 * there would be redundant) - a fix hint always renders, since a dead
 * connection matters before the operator ever turns publishing on too.
 */
function PublishCanaryStatus({
  summary,
  showReady,
}: {
  summary: PublishCanarySummary | null;
  showReady: boolean;
}) {
  const row = summary?.row;
  if (row == null) return null; // no check yet (or it aged out) - stay silent, never guess
  if (row.fixHint) {
    return (
      <p className="mt-3 text-[12px] leading-relaxed text-status-danger" data-publish-canary="fix">
        {row.fixHint}
      </p>
    );
  }
  if (showReady && row.tokenOk && row.dryRunOk) {
    const time = formatClockTime(row.whenIso);
    return (
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground" data-publish-canary="ok">
        Publishing is ready. I checked your site connection{time ? ` at ${time}` : ""} and a practice run passed.
      </p>
    );
  }
  return null; // an unclear state (no token check occurred) - stay silent rather than half-report
}

export function PublishingModeCard() {
  const router = useRouter();
  const [readiness, setReadiness] = useState<PublishingModeReadiness | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [canary, setCanary] = useState<PublishCanarySummary | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const r = await loadPublishingModeReadiness();
      setReadiness(r);
      setLoadError(null);
    } catch {
      setLoadError("Couldn't load publishing status. Refresh to try again.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Best-effort, non-blocking: the nightly canary read never gates the
    // arm/disarm flow above, and a failure here stays silent (the block
    // self-hides on null, same fail-soft posture as the store read itself).
    loadPublishCanarySummary()
      .then(setCanary)
      .catch(() => setCanary(null));
  }, []);

  const onArm = useCallback(() => {
    setActionError(null);
    startTransition(async () => {
      const res = await armPublishing({ safetyRailsConfirmed: confirmed });
      if (res.ok) {
        await refresh();
        router.refresh();
      } else {
        setActionError(res.reason);
        if (res.evaluation) {
          setReadiness((prev) => (prev ? { ...prev, evaluation: res.evaluation! } : prev));
        }
      }
    });
  }, [confirmed, refresh, router]);

  const onDisarm = useCallback(() => {
    setActionError(null);
    startTransition(async () => {
      const res = await disarmPublishing();
      if (res.ok) {
        await refresh();
        router.refresh();
      } else {
        setActionError(res.reason);
      }
    });
  }, [refresh, router]);

  const armed = readiness?.state.mode === "armed";
  const canPublish = readiness?.canPublish ?? false;

  return (
    <section
      className="rounded-lg border border-border/60 bg-surface p-5"
      data-publishing-mode-card="true"
      data-publishing-mode={readiness?.state.mode ?? "loading"}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-foreground">
            One-click publishing
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {armed
              ? "On. When you approve a safe, simple edit, Beacon publishes it to your site in one click."
              : "Off. When you approve an edit, Beacon gets it ready and you publish with a second click. Turn this on to publish safe edits in one click."}
          </p>
        </div>
        <span
          className={
            armed
              ? "shrink-0 rounded-full bg-status-success/15 px-2.5 py-1 text-[11px] font-semibold text-status-success"
              : "shrink-0 rounded-full bg-surface-inset px-2.5 py-1 text-[11px] font-semibold text-muted-foreground"
          }
          data-publishing-mode-badge={armed ? "armed" : "off"}
        >
          {armed ? "On" : "Off"}
        </span>
      </div>

      {loadError && (
        <p className="mt-4 text-[13px] text-status-danger">{loadError}</p>
      )}

      {!canPublish && readiness != null && (
        <p className="mt-4 text-[13px] text-muted-foreground">
          You don&apos;t have permission to change publishing for this site.
        </p>
      )}

      {readiness != null && canPublish && !armed && (
        <div className="mt-4 space-y-4">
          {/* Readiness checklist */}
          <ul className="space-y-1.5" data-publishing-mode-checklist="true">
            {readiness.evaluation.items.map((item) => (
              <li
                key={item.key}
                className="flex items-center gap-2 text-[13px]"
                data-precondition={item.key}
                data-precondition-met={item.met ? "true" : "false"}
              >
                <span
                  aria-hidden="true"
                  className={item.met ? "text-status-success" : "text-muted-foreground/50"}
                >
                  {item.met ? "✓" : "○"}
                </span>
                <span className={item.met ? "text-foreground" : "text-muted-foreground"}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>

          {/* Safety rails — what one-click publishing will and won't do */}
          <div className="rounded-md border border-status-warning/30 bg-status-warning/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground">Before you turn this on:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>Only small text edits we&apos;re sure about will publish in one click.</li>
              <li>Rejected, weak, or unmapped recommendations never auto-publish.</li>
              <li>Page URLs, links, and structure are never changed; every edit is reversible.</li>
              <li>We save a backup before each change so it can be undone, and there&apos;s a daily limit.</li>
            </ul>
          </div>

          <label className="flex items-start gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
              data-publishing-mode-confirm="true"
            />
            <span>
              I understand: accepting a safe edit will publish it to my live site in one click.
            </span>
          </label>

          <button
            type="button"
            onClick={onArm}
            disabled={pending || !confirmed || !readiness.evaluation.canArm}
            className="rounded-md bg-accent-primary px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-accent-primary/90 disabled:opacity-50"
            data-publishing-mode-action="arm"
          >
            {pending ? "Turning on…" : "Turn on one-click publishing"}
          </button>
          {!readiness.evaluation.canArm && (
            <p className="text-[12px] text-muted-foreground">
              Finish the steps above to turn on one-click publishing.
            </p>
          )}
        </div>
      )}

      {readiness != null && canPublish && armed && (
        <div className="mt-4 space-y-3">
          <button
            type="button"
            onClick={onDisarm}
            disabled={pending}
            className="rounded-md border border-border/60 px-3.5 py-2 text-[13px] font-semibold text-foreground hover:bg-surface-inset/40 disabled:opacity-50"
            data-publishing-mode-action="disarm"
          >
            {pending ? "Turning off…" : "Turn off one-click publishing"}
          </button>
          <p className="text-[12px] text-muted-foreground">
            Accepting still snapshots, caps daily pushes, and never changes URLs or links.
          </p>
          <PublishCanaryStatus summary={canary} showReady={true} />
        </div>
      )}

      {actionError && (
        <p className="mt-3 text-[13px] text-status-danger" data-publishing-mode-error="true">
          {actionError}
        </p>
      )}
    </section>
  );
}
