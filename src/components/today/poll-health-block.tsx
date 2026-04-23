"use client";

import { cn } from "@/lib/utils";
import type { PollHealthSnapshot, PlatformPollHealth } from "@/domains/observations/poll-health";

/**
 * Renders yesterday's (or today's) per-platform native-poll health at the top
 * of /today. Operator opens /today and sees within a glance whether the daily
 * cron completed for each platform.
 *
 * Silent-failure context: on 2026-04-23, ChatGPT's 4 chunks all failed while
 * GitHub Actions reported the job green. This block makes that kind of
 * failure visible immediately.
 */

export type PollHealthBlockProps = {
  snapshot: PollHealthSnapshot;
  className?: string;
};

const PLATFORM_LABELS: Record<PlatformPollHealth["platform"], string> = {
  perplexity: "Perplexity",
  chatgpt: "ChatGPT",
};

export function PollHealthBlock({ snapshot, className }: PollHealthBlockProps) {
  const overall = overallStatus(snapshot);

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        overall === "ok" && "border-status-success/30 bg-status-success/[0.04]",
        overall === "partial" && "border-status-warning/35 bg-status-warning/[0.05]",
        overall === "failed" && "border-status-danger/40 bg-status-danger/[0.06]",
        overall === "pending" && "border-border/60 bg-surface-inset/30",
        className,
      )}
    >
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full shrink-0",
              overall === "ok" && "bg-status-success",
              overall === "partial" && "bg-status-warning animate-pulse",
              overall === "failed" && "bg-status-danger animate-pulse",
              overall === "pending" && "bg-muted-foreground/50",
            )}
          />
          <p
            className={cn(
              "text-[12px] font-bold",
              overall === "ok" && "text-status-success",
              overall === "partial" && "text-status-warning",
              overall === "failed" && "text-status-danger",
              overall === "pending" && "text-muted-foreground",
            )}
          >
            {headlineFor(overall, snapshot.date)}
          </p>
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-foreground">
          {snapshot.platforms.map((p) => (
            <li key={p.platform} className="flex items-center gap-1.5">
              <span className={cn("font-medium", statusTextClass(p.status))}>
                {PLATFORM_LABELS[p.platform]}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {platformSummary(p)}
              </span>
              <span className={statusGlyphClass(p.status)}>
                {statusGlyph(p.status)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {overall !== "ok" && (
        <p className="mt-2 text-[11px] text-muted-foreground/90 leading-relaxed">
          {subline(snapshot)}
        </p>
      )}
    </div>
  );
}

function overallStatus(snap: PollHealthSnapshot): PlatformPollHealth["status"] {
  const statuses = snap.platforms.map((p) => p.status);
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("partial")) return "partial";
  if (statuses.every((s) => s === "ok")) return "ok";
  return "pending";
}

function headlineFor(
  overall: PlatformPollHealth["status"],
  date: string,
): string {
  const formatted = formatDateShort(date);
  switch (overall) {
    case "ok":
      return `Poll (${formatted}): complete`;
    case "partial":
      return `Poll (${formatted}): partial — some chunks failed`;
    case "failed":
      return `Poll (${formatted}): failed — pipeline needs attention`;
    case "pending":
      return `Poll (${formatted}): not yet run`;
  }
}

function platformSummary(p: PlatformPollHealth): string {
  if (p.status === "pending") {
    return "no run yet";
  }
  const chunkBit = `${p.completedChunks}/${p.expectedChunks}`;
  const obsBit = `${p.observationsWritten} prompts`;
  return `${chunkBit} · ${obsBit}`;
}

function statusGlyph(status: PlatformPollHealth["status"]): string {
  switch (status) {
    case "ok":
      return "✓";
    case "partial":
      return "▲";
    case "failed":
      return "✗";
    case "pending":
      return "…";
  }
}

function statusGlyphClass(status: PlatformPollHealth["status"]): string {
  switch (status) {
    case "ok":
      return "text-status-success font-semibold";
    case "partial":
      return "text-status-warning font-semibold";
    case "failed":
      return "text-status-danger font-semibold";
    case "pending":
      return "text-muted-foreground/70";
  }
}

function statusTextClass(status: PlatformPollHealth["status"]): string {
  switch (status) {
    case "ok":
      return "text-foreground";
    case "partial":
      return "text-status-warning";
    case "failed":
      return "text-status-danger";
    case "pending":
      return "text-muted-foreground";
  }
}

function subline(snap: PollHealthSnapshot): string {
  const failing = snap.platforms.filter((p) => p.status === "failed");
  const partial = snap.platforms.filter((p) => p.status === "partial");
  const pending = snap.platforms.filter((p) => p.status === "pending");

  if (failing.length === 2) {
    return "Both platforms failed — check API keys and GitHub Actions logs.";
  }
  if (failing.length === 1) {
    return `${PLATFORM_LABELS[failing[0].platform]} failed all chunks — likely an API key or rate-limit issue.`;
  }
  if (partial.length > 0) {
    const names = partial
      .map((p) => PLATFORM_LABELS[p.platform])
      .join(" and ");
    return `${names} completed some chunks but not all — pipeline may need a manual retry.`;
  }
  if (pending.length === 2) {
    return "Cron has not run yet today. Next run fires at 10:00 UTC.";
  }
  if (pending.length === 1) {
    return `${PLATFORM_LABELS[pending[0].platform]} has no run yet today.`;
  }
  return "";
}

function formatDateShort(iso: string): string {
  // "2026-04-24" → "Apr 24"
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
