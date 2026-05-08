/**
 * Poll Health Calm Banner — UX.6.1 Fix 2 (2026-05-07).
 *
 * Replaces the alarming PollHealthBlock when the only thing "wrong"
 * with poll health is that the day's scheduled cron hasn't fired
 * yet. Pre-fix, the operator opening /today between midnight UTC
 * and 7am UTC saw "AI tracking has not run yet today" with warning
 * styling — alarming for what is normal scheduling.
 *
 * Render gate (computed in today-client.tsx via `isPreCronPending()`):
 *   - All platforms have status === "pending" (no chunk completed yet)
 *   - Current UTC time < 08:00 UTC of the snapshot's date (cron is
 *     scheduled at 07:00 UTC; 1h grace post-schedule)
 *
 * Outside that window (post-cron + still pending = late, OR
 * partial/failed regardless of time), the existing PollHealthBlock
 * fires with its warning styling.
 *
 * Pure presentation. No mutations, no client interactivity.
 */

import { cn } from "@/lib/utils";

export function PollHealthCalmBanner({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-surface-inset/30 px-4 py-3",
        className,
      )}
      role="status"
      data-today-section="poll-health-calm"
    >
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40 shrink-0" />
        <p className="text-[12px] font-medium text-muted-foreground">
          Next reading scheduled
        </p>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground/80 leading-relaxed">
        Beacon will run today&apos;s AI reading at 07:00 UTC. The
        dashboard is showing the latest complete reading.
      </p>
    </div>
  );
}

/**
 * Pure helper — returns true when poll-health is in the
 * "pre-cron pending" state. Exported for tests.
 *
 * Conditions:
 *   - Snapshot has at least one platform.
 *   - ALL platforms have status === "pending".
 *   - Current time is before 08:00 UTC of the snapshot's date.
 *
 * The 08:00 UTC cutoff = 07:00 UTC scheduled cron + 1h grace for
 * the cron job to complete. After that, pending = late = warning.
 */
export function isPreCronPending(args: {
  platforms: ReadonlyArray<{ status: string }>;
  date: string;
  now?: Date;
}): boolean {
  if (!args.platforms || args.platforms.length === 0) return false;
  const allPending = args.platforms.every((p) => p.status === "pending");
  if (!allPending) return false;

  // Anchor to start-of-day UTC for the snapshot's date.
  const startOfDayUtc = new Date(`${args.date}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(startOfDayUtc)) return false;

  const now = args.now ?? new Date();
  const cutoff = startOfDayUtc + 8 * 60 * 60 * 1000; // 08:00 UTC
  return now.getTime() < cutoff;
}
