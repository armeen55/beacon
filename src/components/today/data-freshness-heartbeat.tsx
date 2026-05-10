/**
 * Data Freshness Heartbeat — /today persistent freshness pill.
 *
 * Why this exists (2026-05-10):
 *   The /today page has historically surfaced poll-health *only when
 *   something is wrong* — `PollHealthBlock` renders only on
 *   partial/failed/pending status, and `PollHealthCalmBanner` only
 *   in the pre-cron window. On a clean day, the page was silent
 *   about how recently AI-visibility data was refreshed, so the
 *   operator/customer could not tell at a glance whether they were
 *   looking at a 1-hour-old or 24-hour-old picture.
 *
 *   This component is the always-on heartbeat: a single calm row
 *   that says "Beacon last refreshed AI visibility {relative}" with
 *   a tone that maps to freshness-band (fresh/stale/needs-attention).
 *   When the poll is healthy and recent, this is the only surface
 *   needed. When it isn't, this complements the existing alarm
 *   blocks rather than replacing them.
 *
 * Honesty contract:
 *   - Never shows a fake "fresh" when no poll has ever landed.
 *   - Never raw exception text or UUIDs leak to the customer surface.
 *   - Per-platform pills use the operator-locked PLATFORM_LABELS map.
 *   - Tone bands are deterministic from a single relative-hours number.
 *
 * Pure presentational. No I/O, no module-level state, no client-only
 * APIs. Safe under SSR.
 */

import { cn } from "@/lib/utils";
import type {
  PollHealthSnapshot,
  PlatformPollHealth,
} from "@/domains/observations/poll-health";

// ── Public types ────────────────────────────────────────────────────────

export type FreshnessBand =
  | "fresh"
  | "pending"
  | "stale"
  | "needs_attention"
  | "no_data";

export type FreshnessVerdict = {
  band: FreshnessBand;
  /**
   * Hours since the most recent successful platform poll across the
   * snapshot. `null` when no successful run has ever landed.
   */
  hoursSinceLastSuccess: number | null;
  /**
   * The most recent `latestRun.completedAt` ISO across the platforms
   * in the snapshot, or `null` when no successful run is present.
   */
  lastSuccessAt: string | null;
};

/**
 * Site-scan freshness input. Reads cleanly from the existing
 * `latestWebsiteCrawlRun()` result that today-data already loads —
 * no new database read.
 *
 * `completedAt` is the ObservationRun.completed_at ISO; `status` is
 * the run's status enum. Either field can be null when no crawl run
 * has ever landed for the tenant.
 */
export type SiteScanFreshnessInput = {
  completedAt: string | null;
  status: "completed" | "partial" | "failed" | null;
};

export type DataFreshnessHeartbeatProps = {
  pollHealth: PollHealthSnapshot | null;
  /** Optional. When provided, renders a small "Site scan: …" line
   *  underneath the AI-poll headline. When null/undefined, only the
   *  poll heartbeat renders (back-compat with the prior bundle). */
  siteScan?: SiteScanFreshnessInput | null;
  /** Override "now" for tests + SSR determinism. Defaults to new Date(). */
  now?: Date;
  className?: string;
};

export type ScanFreshnessVerdict = {
  band: FreshnessBand;
  hoursSinceLastSuccess: number | null;
  lastSuccessAt: string | null;
};

const PLATFORM_LABELS: Record<PlatformPollHealth["platform"], string> = {
  perplexity: "Perplexity",
  chatgpt: "ChatGPT",
};

// ── Pure compute ────────────────────────────────────────────────────────

/**
 * Deterministically reduce a `PollHealthSnapshot` to a
 * `FreshnessVerdict`. Bands:
 *
 *   fresh           — last successful run < 24h ago AND any platform `ok`
 *   pending         — no run today yet AND prior success < 36h ago
 *   stale           — last successful run 24–48h ago
 *   needs_attention — last successful run > 48h ago, OR any platform
 *                     `failed` AND no fresh successful run on the day
 *   no_data         — no successful run has ever landed in the snapshot
 *
 * Pure. Same inputs → same outputs.
 */
export function computeFreshnessVerdict(
  pollHealth: PollHealthSnapshot | null,
  now: Date = new Date(),
): FreshnessVerdict {
  if (!pollHealth || pollHealth.platforms.length === 0) {
    return { band: "no_data", hoursSinceLastSuccess: null, lastSuccessAt: null };
  }

  // Find the most recent successful (status==="ok") run's completedAt.
  let lastSuccessMs: number | null = null;
  let lastSuccessAt: string | null = null;
  for (const p of pollHealth.platforms) {
    if (p.status !== "ok") continue;
    const ts = p.latestRun?.completedAt;
    if (!ts) continue;
    const ms = new Date(ts).getTime();
    if (!Number.isFinite(ms)) continue;
    if (lastSuccessMs === null || ms > lastSuccessMs) {
      lastSuccessMs = ms;
      lastSuccessAt = ts;
    }
  }

  const anyFailed = pollHealth.platforms.some((p) => p.status === "failed");

  if (lastSuccessMs === null) {
    if (anyFailed) {
      return { band: "needs_attention", hoursSinceLastSuccess: null, lastSuccessAt: null };
    }
    // All pending, no prior success — treated as no_data so the UI shows a
    // calm "no readings yet" rather than a numeric stale clock from 1970.
    return { band: "no_data", hoursSinceLastSuccess: null, lastSuccessAt: null };
  }

  const hours = Math.max(0, (now.getTime() - lastSuccessMs) / 3_600_000);

  if (anyFailed) {
    // Any failure beats clean clock — operator should see the alarm even
    // if the other platform was fresh.
    return { band: "needs_attention", hoursSinceLastSuccess: hours, lastSuccessAt };
  }
  if (hours >= 48) return { band: "needs_attention", hoursSinceLastSuccess: hours, lastSuccessAt };
  if (hours >= 24) return { band: "stale", hoursSinceLastSuccess: hours, lastSuccessAt };

  // < 24h. If any platform is still pending today AND we have a recent
  // successful run from a prior cycle, prefer "pending" framing —
  // the customer should know the next read hasn't landed yet without
  // the page acting like the prior reading is current.
  const anyPending = pollHealth.platforms.some((p) => p.status === "pending");
  if (anyPending && hours >= 12) {
    return { band: "pending", hoursSinceLastSuccess: hours, lastSuccessAt };
  }

  return { band: "fresh", hoursSinceLastSuccess: hours, lastSuccessAt };
}

/**
 * Reduce a `SiteScanFreshnessInput` to a freshness verdict. Same band
 * thresholds as the AI-poll heartbeat: fresh < 24h, stale 24–48h,
 * needs_attention > 48h or status="failed", pending if status="partial"
 * within 24h, no_data if no scan has ever landed.
 *
 * Pure. Same inputs → same outputs.
 */
export function computeScanFreshnessVerdict(
  input: SiteScanFreshnessInput | null | undefined,
  now: Date = new Date(),
): ScanFreshnessVerdict {
  if (!input || !input.completedAt) {
    if (input?.status === "failed") {
      return { band: "needs_attention", hoursSinceLastSuccess: null, lastSuccessAt: null };
    }
    return { band: "no_data", hoursSinceLastSuccess: null, lastSuccessAt: null };
  }
  const ms = new Date(input.completedAt).getTime();
  if (!Number.isFinite(ms)) {
    return { band: "no_data", hoursSinceLastSuccess: null, lastSuccessAt: null };
  }
  const hours = Math.max(0, (now.getTime() - ms) / 3_600_000);
  if (input.status === "failed") {
    return { band: "needs_attention", hoursSinceLastSuccess: hours, lastSuccessAt: input.completedAt };
  }
  if (hours >= 48) return { band: "needs_attention", hoursSinceLastSuccess: hours, lastSuccessAt: input.completedAt };
  if (hours >= 24) return { band: "stale", hoursSinceLastSuccess: hours, lastSuccessAt: input.completedAt };
  if (input.status === "partial") {
    return { band: "pending", hoursSinceLastSuccess: hours, lastSuccessAt: input.completedAt };
  }
  return { band: "fresh", hoursSinceLastSuccess: hours, lastSuccessAt: input.completedAt };
}

// ── Relative-time formatting ────────────────────────────────────────────

/**
 * Render an hours-ago number as customer-safe relative copy. Never
 * shows decimals, never uses provider jargon, always non-negative.
 */
export function formatRelativeHours(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "—";
  const h = Math.floor(Math.max(0, hours));
  if (h === 0) return "just now";
  if (h === 1) return "1h ago";
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// ── Headline copy ───────────────────────────────────────────────────────

function headlineFor(verdict: FreshnessVerdict): string {
  const rel = formatRelativeHours(verdict.hoursSinceLastSuccess);
  switch (verdict.band) {
    case "fresh":
      return `Beacon refreshed AI visibility ${rel}.`;
    case "pending":
      return `Beacon refreshed AI visibility ${rel}. Waiting for today's scheduled poll.`;
    case "stale":
      return `AI visibility data is stale — last refresh ${rel}.`;
    case "needs_attention":
      if (verdict.hoursSinceLastSuccess === null) {
        return `AI visibility needs attention — no successful poll landed.`;
      }
      return `AI visibility needs attention — last refresh ${rel}.`;
    case "no_data":
      return `Beacon has not refreshed AI visibility yet.`;
  }
}

function scanLineFor(verdict: ScanFreshnessVerdict): string {
  const rel = formatRelativeHours(verdict.hoursSinceLastSuccess);
  switch (verdict.band) {
    case "fresh":
      return `Site scan: fresh ${rel}.`;
    case "pending":
      return `Site scan: partial — ${rel}, waiting for the next cycle.`;
    case "stale":
      return `Site scan: stale — last scan ${rel}.`;
    case "needs_attention":
      if (verdict.hoursSinceLastSuccess === null) {
        return "Site scan: needs attention — no recent scan.";
      }
      return `Site scan: needs attention — last scan ${rel}.`;
    case "no_data":
      return "Site scan: waiting for the first scheduled scan.";
  }
}

function sublineFor(verdict: FreshnessVerdict): string {
  switch (verdict.band) {
    case "fresh":
      return "Latest readings are current.";
    case "pending":
      // 2026-05-10 — reflects the redundant-schedule reliability fix
      // (.github/workflows/daily-native-poll.yml): the workflow now has
      // 3 daily attempts (primary + 2 backups) so a GH scheduler skip
      // on the 07:00 UTC fire no longer blocks the day. Copy mentions
      // all three so the customer/operator knows another attempt is
      // coming, without using GH-specific jargon.
      return "Scheduled poll attempts run at 07:00, 08:30, and 10:00 UTC.";
    case "stale":
      return "Today's scheduled poll has not landed yet. Beacon will retry on the next cycle.";
    case "needs_attention":
      return "Recent polls have not completed. Check poll health.";
    case "no_data":
      return "Beacon will surface a reading after the first scheduled poll.";
  }
}

// ── Tone classes ────────────────────────────────────────────────────────

function bandClasses(band: FreshnessBand): {
  border: string;
  bg: string;
  dot: string;
  headline: string;
} {
  switch (band) {
    case "fresh":
      return {
        border: "border-status-success/30",
        bg: "bg-status-success/[0.04]",
        dot: "bg-status-success",
        headline: "text-status-success",
      };
    case "pending":
      return {
        border: "border-border/60",
        bg: "bg-surface-inset/30",
        dot: "bg-muted-foreground/50",
        headline: "text-muted-foreground",
      };
    case "stale":
      return {
        border: "border-status-warning/35",
        bg: "bg-status-warning/[0.05]",
        dot: "bg-status-warning",
        headline: "text-status-warning",
      };
    case "needs_attention":
      return {
        border: "border-status-danger/40",
        bg: "bg-status-danger/[0.06]",
        dot: "bg-status-danger animate-pulse",
        headline: "text-status-danger",
      };
    case "no_data":
      return {
        border: "border-border/60",
        bg: "bg-surface-inset/30",
        dot: "bg-muted-foreground/40",
        headline: "text-muted-foreground",
      };
  }
}

// ── Component ───────────────────────────────────────────────────────────

export function DataFreshnessHeartbeat({
  pollHealth,
  siteScan,
  now,
  className,
}: DataFreshnessHeartbeatProps) {
  const verdict = computeFreshnessVerdict(pollHealth, now);
  const cls = bandClasses(verdict.band);
  const scanVerdict = siteScan === undefined ? null : computeScanFreshnessVerdict(siteScan, now);
  const scanCls = scanVerdict ? bandClasses(scanVerdict.band) : null;

  return (
    <div
      data-today-section="data-freshness-heartbeat"
      data-freshness-band={verdict.band}
      className={cn(
        "rounded-lg border px-4 py-3",
        cls.border,
        cls.bg,
        className,
      )}
      role="status"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", cls.dot)} />
        <p className={cn("text-[12px] font-semibold", cls.headline)}>
          {headlineFor(verdict)}
        </p>
        {pollHealth && pollHealth.platforms.length > 0 && (
          <ul className="ml-auto flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-foreground">
            {pollHealth.platforms.map((p) => (
              <li
                key={p.platform}
                className="flex items-center gap-1.5"
                data-freshness-platform={p.platform}
                data-freshness-platform-status={p.status}
              >
                <span className="font-medium">
                  {PLATFORM_LABELS[p.platform]}
                </span>
                <span
                  className={cn(
                    "tabular-nums text-[10px]",
                    p.status === "ok" && "text-status-success",
                    p.status === "partial" && "text-status-warning",
                    p.status === "failed" && "text-status-danger",
                    p.status === "pending" && "text-muted-foreground/80",
                  )}
                >
                  {labelForPlatformStatus(p.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground/85 leading-relaxed">
        {sublineFor(verdict)}
      </p>
      {scanVerdict && scanCls && (
        <div
          className="mt-2 pt-2 border-t border-border/40 flex items-center gap-2"
          data-today-section="data-freshness-heartbeat-scan"
          data-scan-freshness-band={scanVerdict.band}
        >
          <span className={cn("h-2 w-2 rounded-full shrink-0", scanCls.dot)} />
          <p className={cn("text-[11px] font-medium", scanCls.headline)}>
            {scanLineFor(scanVerdict)}
          </p>
        </div>
      )}
    </div>
  );
}

function labelForPlatformStatus(s: PlatformPollHealth["status"]): string {
  switch (s) {
    case "ok":
      return "fresh";
    case "partial":
      return "partial";
    case "failed":
      return "needs attention";
    case "pending":
      return "pending";
  }
}
