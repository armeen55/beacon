/**
 * pinned-read - A FINISHED READING NEVER MOVES AGAIN. PURE.
 *
 * The Results surface re-measures the whole ledger in the background every fifteen minutes, and a
 * re-measure is a fresh read of Google's data with a fresh comparison cohort. Google backfills days
 * INSIDE a window that closed weeks ago, and the set of comparable pages shifts every time another
 * change ships, so a change the operator was told moved a page by 1,040 clicks was quietly re-read at
 * 1,428 the same afternoon. Nothing was wrong with either number. The defect is that a finished number
 * was still being asked.
 *
 * So: once a read's window has CLOSED and Google has FINALIZED the days behind it, and no further
 * checkpoint is owed, the whole read tuple is frozen on the ledger row and every later rebuild serves
 * the frozen one. THE ONE EXCEPTION is a later change on the same page: the numbers still stand, but
 * the verdict may drop to confounded because the credit is now shared, and the row says so out loud.
 */

import { buildHeadline } from "./read-honesty";
import { day56Followup } from "./measure-lifecycle";
import type { KernelRead } from "./kernel";
import type { ShippedChangeRecord } from "./shipped-change-store";

/** The frozen reading. Seven numbers and words, and the day the freeze was taken. */
export type PinnedRead = {
  verdict: KernelRead["verdict"];
  metric: KernelRead["metric"];
  lift: number;
  impressionsLift: number;
  basisDay: number;
  confidence: KernelRead["confidence"];
  /** How many comparable pages the frozen reading was measured against. */
  controlsUsed: number;
  pinnedAt: string;
  /** The finalized-data watermark at freeze time: what "the days behind it are in" meant that day. */
  finalizedThrough: string;
};

/** A reading is finished at the 28-day window, or at the day-56 follow up an unsettled or dangerous
 *  change earns. Anything shorter is still on its way to one of those. */
const MATURE_DAYS: ReadonlySet<number> = new Set([28, 56]);

/** The ranking signal a frozen reading carries, so the verdict served and the signal fed to ranking can
 *  never disagree. Same shape the kernel applies live. */
const SIGNAL: Record<string, number> = { stronger_improvement: 1, directional_improvement: 0.6, directional_decline: -0.6 };
const SCALE: Record<string, number> = { high: 1, medium: 0.6, low: 0.3 };

/**
 * The tuple to freeze for this read, or null while it can still legitimately move. PURE.
 * Frozen only when the basis is a MATURE window, that window has closed, Google has finalized every day
 * behind it, and no fourth checkpoint is still owed.
 */
export function pinFor(
  record: ShippedChangeRecord,
  read: KernelRead,
  latestGscDate: string | null,
  now: Date = new Date(),
): PinnedRead | null {
  if (latestGscDate == null || read.basisDay == null || !MATURE_DAYS.has(read.basisDay)) return null;
  const basis = read.windows.find((w) => w.day === read.basisDay);
  if (!basis || basis.state !== "closed" || latestGscDate < basis.closesOn) return null;
  // A change still owed its fourth checkpoint has one more reading coming, and freezing now would
  // spend the rest of its life serving the reading it was meant to replace.
  if (day56Followup(record, latestGscDate, now).runs) return null;
  const window = (record.windows ?? []).find((w) => w.day === read.basisDay && w.ran === true);
  return {
    verdict: read.verdict,
    metric: read.metric,
    lift: read.lift,
    impressionsLift: read.impressionsLift,
    basisDay: read.basisDay,
    confidence: read.confidence,
    controlsUsed: window?.controlsUsed ?? 0,
    pinnedAt: now.toISOString(),
    finalizedThrough: latestGscDate,
  };
}

/**
 * Serve the frozen reading over the live one. PURE. The numbers, the window and the confidence are the
 * frozen ones and the headline is rebuilt from them, so the sentence and the figure can never disagree.
 * A later change on the same page still demotes the verdict to confounded: the credit is shared from
 * that day on, the numbers stay exactly as they were read, and the row copy says which is which.
 */
export function applyPinnedRead(read: KernelRead, pin: PinnedRead | null | undefined): KernelRead {
  if (!pin) return read;
  const shared = read.verdict === "confounded" && pin.verdict !== "confounded";
  const verdict = shared ? "confounded" : pin.verdict;
  const confidence = shared ? "low" : pin.confidence;
  const controls = `Read on the ${pin.basisDay}-day window against ${pin.controlsUsed} similar page${pin.controlsUsed === 1 ? "" : "s"}, and held at that reading because the window closed and Google finalized every day behind it.`;
  return {
    ...read,
    metric: pin.metric,
    basisDay: pin.basisDay as KernelRead["basisDay"],
    lift: pin.lift,
    impressionsLift: pin.impressionsLift,
    verdict,
    confidence,
    headline: buildHeadline({
      verdict, metric: pin.metric, lift: pin.lift, impressionsLift: pin.impressionsLift,
      basisDay: pin.basisDay, overlapCount: read.overlappingIds.length,
      overlapClosedOn: shared ? read.cleanUntil : null,
      ga4ExtraSessions: null, ga4Trustworthy: false,
    }),
    confidenceReasons: shared
      ? [controls, "That page was changed again afterwards, so this reading is no longer this change's alone."]
      : [controls],
    caveats: read.caveats,
    learning: { ...read.learning, outcomeDirection: shared ? "unclear"
      : verdict === "directional_improvement" || verdict === "stronger_improvement" ? "up"
        : verdict === "directional_decline" ? "down" : verdict === "no_clear_movement" ? "flat" : "unclear" },
    rankingSignal: shared ? 0
      : Math.round((SIGNAL[verdict] ?? 0) * (SCALE[confidence] ?? 0.3) * 100) / 100,
  };
}
