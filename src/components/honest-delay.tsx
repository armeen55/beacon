"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const RETRY_DELAY_MS = 1_500;
export const HONEST_DELAY_RETRY_COOLDOWN_MS = 30_000;

export function shouldScheduleHonestDelayRetry(args: {
  lastRetryAtMs: number | null;
  nowMs: number;
  cooldownMs?: number;
}): boolean {
  if (args.lastRetryAtMs === null || !Number.isFinite(args.lastRetryAtMs)) return true;
  return args.nowMs - args.lastRetryAtMs >= (args.cooldownMs ?? HONEST_DELAY_RETRY_COOLDOWN_MS);
}

/**
 * A deadline miss must not become work for the user. Schedule one bounded
 * router refresh per page and cooldown window while the abandoned server load
 * warms the durable cache. Session storage prevents a slow dependency from
 * turning this into a refresh loop.
 */
export function HonestDelay({
  message = "This section is taking longer than it should. Beacon is retrying automatically.",
}: {
  message?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const key = `beacon:delay-retry:${pathname}`;
    const nowMs = Date.now();
    let lastRetryAtMs: number | null = null;
    try {
      const stored = window.sessionStorage.getItem(key);
      lastRetryAtMs = stored === null ? null : Number(stored);
      if (!shouldScheduleHonestDelayRetry({ lastRetryAtMs, nowMs })) return;
      window.sessionStorage.setItem(key, String(nowMs));
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
      className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-3 text-[13px] text-gray-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
    >
      {message}
    </p>
  );
}
