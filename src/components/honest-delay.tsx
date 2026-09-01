"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const RETRY_DELAY_MS = 1_500;
const HONEST_DELAY_RETRY_COOLDOWN_MS = 30_000;

/** After this many silent retries for one path in a session, stop implying the
 *  load is about to succeed. We keep retrying in the background, but the copy
 *  becomes honest about the failure being on our side. */
const HONEST_DELAY_MAX_VISIBLE_RETRIES = 4;

/** The escalated copy shown once a path has burned through the visible retry
 *  budget. Kept as a constant so the render and the test agree on it. */
const HONEST_DELAY_ESCALATED_MESSAGE =
  "This section could not load. The problem is on Beacon's side, not yours. Retrying runs in the background, and your data is safe.";

function shouldScheduleHonestDelayRetry(args: {
  lastRetryAtMs: number | null;
  nowMs: number;
  cooldownMs?: number;
}): boolean {
  if (args.lastRetryAtMs === null || !Number.isFinite(args.lastRetryAtMs)) return true;
  return args.nowMs - args.lastRetryAtMs >= (args.cooldownMs ?? HONEST_DELAY_RETRY_COOLDOWN_MS);
}

/** Pure: has this path exhausted its visible-retry budget? Testable without a DOM. */
function honestDelayHasEscalated(retryCount: number): boolean {
  return Number.isFinite(retryCount) && retryCount >= HONEST_DELAY_MAX_VISIBLE_RETRIES;
}

/**
 * A deadline miss must not become work for the user. Schedule one bounded
 * router refresh per page and cooldown window while the abandoned server load
 * warms the durable cache. Session storage prevents a slow dependency from
 * turning this into a refresh loop.
 */
/** A SUCCESSFUL RENDER FORGIVES THE PAST (operator, 2026-09-01). The retry counter lives per path for the whole
 *  session and never reset, so one bad minute escalated the copy to "could not load" for every later hiccup on
 *  that path, however many good renders came between. The section that succeeds renders this marker, the keys
 *  clear, and the next delay starts from the calm sentence again. */
export function HonestDelayReset() {
  const pathname = usePathname();
  useEffect(() => {
    try { window.sessionStorage.removeItem(`beacon:delay-retry:${pathname}`); window.sessionStorage.removeItem(`beacon:delay-retry-count:${pathname}`); } catch { /* hardened modes keep the calm default */ }
  }, [pathname]);
  return <span hidden data-delay-reset="true" />;
}

export function HonestDelay({
  message = "This section is taking longer than it should. Beacon is retrying automatically.",
}: {
  message?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Once a path has retried past its visible budget, we stop promising success.
  const [escalated, setEscalated] = useState(false);

  useEffect(() => {
    const key = `beacon:delay-retry:${pathname}`;
    const countKey = `beacon:delay-retry-count:${pathname}`;
    const nowMs = Date.now();
    let lastRetryAtMs: number | null = null;
    try {
      const stored = window.sessionStorage.getItem(key);
      lastRetryAtMs = stored === null ? null : Number(stored);
      const priorCount = Number(window.sessionStorage.getItem(countKey) ?? "0") || 0;
      // Reflect what we already know before deciding whether to schedule again.
      if (honestDelayHasEscalated(priorCount)) setEscalated(true);
      if (!shouldScheduleHonestDelayRetry({ lastRetryAtMs, nowMs })) return;
      window.sessionStorage.setItem(key, String(nowMs));
      const nextCount = priorCount + 1;
      window.sessionStorage.setItem(countKey, String(nextCount));
      // Keep retrying silently, but escalate the COPY the moment the budget runs out.
      if (honestDelayHasEscalated(nextCount)) setEscalated(true);
    } catch {
      // Storage can be unavailable in hardened browser modes. In that case,
      // preserve the calm fallback and avoid an unbounded retry.
      return;
    }

    const timer = window.setTimeout(() => router.refresh(), RETRY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pathname, router]);

  return (
    <p
      role="status"
      className="rounded-2xl border border-dashed border-border bg-surface-raised px-4 py-3 text-[13px] text-muted-foreground"
    >
      {escalated ? HONEST_DELAY_ESCALATED_MESSAGE : message}
    </p>
  );
}
