import type { RefreshRunRow, RefreshSource } from "./refresh-runs-store";
import type { WarmRunReceipt } from "./warm-receipt-store";
import { STALE_RUNNING_MS, CUT_SHORT_COPY } from "./autonomous-research-status";

export type AutonomousHealthState = "ok" | "working" | "issues" | "none";

export type AutonomousHealth = {
  state: AutonomousHealthState;
  headline: string;
};

type Input = {
  receipt: WarmRunReceipt | null;
  latestBySource: Partial<Record<RefreshSource, RefreshRunRow>>;
  connectedSources: readonly RefreshSource[];
  now?: Date;
};

const PACIFIC = "America/Los_Angeles";

function pacificDate(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: PACIFIC });
}

function displayTime(iso: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: PACIFIC,
  });
}

function hasRunningNote(receipt: WarmRunReceipt | null, now: Date): boolean {
  if (!receipt || receipt.ok || receipt.date !== pacificDate(now)) return false;
  return receipt.steps.some((step) => /running after this response/i.test(step.note ?? ""));
}

/** Still genuinely running: the "running" receipt is fresh enough that its
 * lambda could still be alive. */
function isRunning(receipt: WarmRunReceipt | null, now: Date): boolean {
  if (!hasRunningNote(receipt, now)) return false;
  const ranAt = Date.parse(receipt!.ran_at);
  if (Number.isFinite(ranAt) && now.getTime() - ranAt >= STALE_RUNNING_MS) return false;
  return true;
}

/** A "running" receipt older than STALE_RUNNING_MS whose terminal receipt never
 * arrived: the scheduling lambda was killed (e.g. a page maxDuration under the
 * cycle's 210s deadline). We tell the truth instead of "working in background"
 * forever. */
function isStalledRunning(receipt: WarmRunReceipt | null, now: Date): boolean {
  if (!hasRunningNote(receipt, now)) return false;
  const ranAt = Date.parse(receipt!.ran_at);
  return Number.isFinite(ranAt) && now.getTime() - ranAt >= STALE_RUNNING_MS;
}

/**
 * Compose one truthful customer-facing state for the on-use lifecycle. The
 * source ledger proves connector pulls; the warm receipt proves the broader
 * research/ranking cycle. No schedule or cron receipt is inferred.
 */
export function buildAutonomousHealth(input: Input): AutonomousHealth {
  const now = input.now ?? new Date();
  const sourceRows = input.connectedSources
    .map((source) => input.latestBySource[source])
    .filter((row): row is RefreshRunRow => row != null);

  if (isStalledRunning(input.receipt, now)) {
    // The background pass was cut short and never wrote its terminal receipt.
    // Honest, self-healing copy: it resumes on the next visit.
    return { state: "issues", headline: CUT_SHORT_COPY };
  }
  if (isRunning(input.receipt, now)) {
    return { state: "working", headline: "working now in the background." };
  }

  const issues = sourceRows.filter((row) => row.result !== "ok");
  const timestamps = [
    ...sourceRows.map((row) => row.finished_at),
    ...(input.receipt ? [input.receipt.ran_at] : []),
  ]
    .map((iso) => ({ iso, ms: Date.parse(iso) }))
    .filter((entry) => Number.isFinite(entry.ms))
    .sort((a, b) => b.ms - a.ms);
  const lastFinished = timestamps[0] ? displayTime(timestamps[0].iso) : null;

  if (issues.length > 0) {
    const noun = issues.length === 1 ? "source needs" : "sources need";
    return {
      state: "issues",
      headline: `${lastFinished ? `last ran ${lastFinished}; ` : ""}${issues.length} connected ${noun} attention.`,
    };
  }

  if (lastFinished) {
    return { state: "ok", headline: `last finished ${lastFinished}.` };
  }

  return { state: "none", headline: "starts when you use Beacon." };
}
