/**
 * /changes proof timeline - result-pill resolver.
 *
 * Bundle (2026-05-10) - second pass at /changes per the maximum-depth
 * UI audit: collapse the legacy table's three competing pills into ONE
 * customer-facing "result" pill per row. The v2 timeline card calls
 * this resolver once per row.
 *
 * Verdict-engine consolidation (2026-07-21, CORE 100K Lane F): the pill
 * used to read the parallel URL Z-score verdict engine. It now reads the
 * SAME proof-gsc measurement presentation Results renders (shipped-change
 * ledger -> buildMeasurementPresentation), so one change can never carry
 * two competing verdicts on one page. A row with no shipped-change proof
 * coverage gets an honest "not measured" line, never an invented verdict.
 *
 * Pure module - no I/O, no DOM, no React. Lives next to the rest of
 * the proof-timeline helpers so it's testable in Node and reusable
 * from any future surface (timeline rail, share view, etc.).
 *
 * Customer-vocabulary contract (forbidden-vocabulary guardrail):
 *   - Labels are plain English ("Helping", "Hurting", "Too early",
 *     "No signal yet", "Needs review", "Live", "Watching").
 *   - Blurbs are one-line sentences a non-engineer reads as truth.
 *   - Never reference maturity enums, calibration, lifecycle
 *     classification, or any other internal subsystem.
 */
/** Maturity + direction of a measurement, kept local (CORE 100K) so the pill has
 *  no dependency on a retired presentation module. Mapped from the kernel read. */
type MeasurementMaturity =
  | "scheduled"
  | "collecting"
  | "early_checkpoint"
  | "interim_checkpoint"
  | "mature_result"
  | "inconclusive"
  | "blocked_data"
  | "unresolved"
  | "attribution_limited";
type MeasurementDirection = "positive" | "negative" | "neutral" | "unknown";

import type { KernelRead } from "@/domains/measurement/proof-gsc/kernel";

/** The proof summary a timeline row / Today card needs, mapped from a kernel read. */
type KernelProofSummary = {
  maturity: MeasurementMaturity;
  direction: MeasurementDirection;
  verdict: "helped" | "no_lift" | "did_not_help" | null;
  headline: string;
  /** Soonest future proof checkpoint date (YYYY-MM-DD), or null. */
  nextCheckpoint: string | null;
};

/** Map a kernel read to the shared proof summary. PURE. */
export function kernelProofSummary(read: KernelRead): KernelProofSummary {
  const improving = read.verdict === "directional_improvement" || read.verdict === "stronger_improvement";
  const direction: MeasurementDirection = improving ? "positive" : read.verdict === "directional_decline" ? "negative" : "neutral";
  const verdict: KernelProofSummary["verdict"] = improving
    ? "helped"
    : read.verdict === "directional_decline"
      ? "did_not_help"
      : read.basisDay === 28 && read.verdict === "no_clear_movement"
        ? "no_lift"
        : null;
  const maturity: MeasurementMaturity =
    read.verdict === "confounded"
      ? "attribution_limited"
      : read.basisDay === 28
        ? read.verdict === "insufficient_evidence"
          ? "inconclusive"
          : "mature_result"
        : read.basisDay === 14
          ? "interim_checkpoint"
          : read.basisDay === 7
            ? "early_checkpoint"
            : read.windows.some((w) => w.state === "pending_data")
              ? "blocked_data"
              : "collecting";
  const nextCheckpoint = read.windows.find((w) => w.state !== "closed")?.closesOn ?? null;
  return { maturity, direction, verdict, headline: read.headline, nextCheckpoint };
}

type LifecycleTabClass =
  | "live_verified"
  | "pending_implementation"
  | "needs_review"
  | "imported_legacy"
  | "scan_confirmed"
  | "unclassified";
import type { ImplementationStatus } from "@/domains/decision/changes/recommended-edits-persistence";

export type ProofPillKind =
  | "helping"
  | "hurting"
  | "too_early"
  | "no_signal_yet"
  | "needs_review"
  | "live"
  | "watching";

export type ProofPillTone =
  | "success"
  | "danger"
  | "warning"
  | "info"
  | "muted";

export type ProofPill = {
  kind: ProofPillKind;
  /** Short user-visible label. */
  label: string;
  /** Color / weight signal for the consuming UI. */
  tone: ProofPillTone;
  /** One-line plain-English outcome shown under the card title. */
  blurb: string;
};

/**
 * The minimal slice of the proof-gsc MeasurementPresentation the pill
 * needs. Built by the caller from buildMeasurementPresentation over the
 * row's shipped-change ledger record (calibration-quarantined verdict in,
 * so an uncalibrated won/lost already reads as inconclusive here).
 */
export type ProofMeasurementSummary = {
  maturity: MeasurementMaturity;
  direction: MeasurementDirection;
  verdict: "helped" | "no_lift" | "did_not_help" | null;
};

type ResolveProofPillInput = {
  /** Google-measured presentation for this change's proof record. Null when
   *  the change has no shipped-change proof coverage (not being measured). */
  proof: ProofMeasurementSummary | null;
  /** Classifier output: which timeline bucket this row sits in. */
  lifecycleClass: LifecycleTabClass | null;
  /** Linked edit's implementation status, when one joins this row. */
  lifecycleStatus: ImplementationStatus | null;
};

const TOO_EARLY_PILL: ProofPill = {
  kind: "too_early",
  label: "Too early",
  tone: "muted",
  blurb: "Too soon to tell. I need more days of Google data after this change.",
};

/**
 * Resolve the single customer-facing pill + blurb for one /changes row.
 *
 * Decision order (first match wins):
 *   1. `needs_review` class -> "Needs review".
 *   2. Pending implementation (accepted but not yet on the page) ->
 *      "Watching".
 *   3. Linked edit is `not_found_after_7d` -> "Needs review" (the scan
 *      never found the proposed change after the bake window).
 *   4. A proof-gsc measurement exists for the row:
 *      - mature helped -> "Helping"; mature did_not_help -> "Hurting";
 *        mature without lift, or inconclusive -> "No signal yet";
 *      - an early or interim read -> "Watching" (directional only,
 *        never described as proof);
 *      - unresolved (Google's data never arrived) -> "No signal yet";
 *      - still collecting / blocked -> "Too early".
 *   5. No proof coverage + row is `live_verified` -> "Live", saying
 *      plainly the change is not being measured.
 *   6. Otherwise -> "Watching", with the same honest not-measured line.
 */
export function resolveProofPill(input: ResolveProofPillInput): ProofPill {
  const { proof, lifecycleClass, lifecycleStatus } = input;

  // 1. Needs-review bucket.
  if (lifecycleClass === "needs_review") {
    return {
      kind: "needs_review",
      label: "Needs review",
      tone: "warning",
      blurb: "We couldn't confirm this change is live on the page yet. Worth a look.",
    };
  }

  // 2. Pending implementation - accepted but the scan hasn't seen it
  //    live on the site. Always "Watching" so the timeline reads as
  //    in-flight rather than measured.
  if (lifecycleClass === "pending_implementation") {
    return {
      kind: "watching",
      label: "Watching",
      tone: "info",
      blurb: "We are waiting for this change to go live on your page.",
    };
  }

  // 3. Linked edit confirmed "not implemented" (bake window passed,
  //    scan never matched). Operator should look - surface as Needs
  //    review even if the row sits in a different bucket.
  if (lifecycleStatus === "not_found_after_7d") {
    return {
      kind: "needs_review",
      label: "Needs review",
      tone: "warning",
      blurb: "We waited, but couldn't find this change on the page. Worth a look.",
    };
  }

  // 4. The row joins a shipped-change proof record: read the SAME
  //    maturity-gated presentation Results renders. An early read is
  //    never surfaced as a verdict.
  if (proof) {
    if (proof.maturity === "mature_result") {
      if (proof.verdict === "helped") {
        return {
          kind: "helping",
          label: "Helping",
          tone: "success",
          blurb: "More people found this page from Google since this change.",
        };
      }
      if (proof.verdict === "did_not_help") {
        return {
          kind: "hurting",
          label: "Hurting",
          tone: "danger",
          blurb: "Fewer people found this page from Google since this change.",
        };
      }
      return {
        kind: "no_signal_yet",
        label: "No signal yet",
        tone: "muted",
        blurb: "The full 28 days passed without a clear move in your Google numbers.",
      };
    }
    if (proof.maturity === "inconclusive") {
      return {
        kind: "no_signal_yet",
        label: "No signal yet",
        tone: "muted",
        blurb: "I watched the full 28 days but the data was too thin for a clear answer.",
      };
    }
    if (
      proof.maturity === "early_checkpoint" ||
      proof.maturity === "interim_checkpoint" ||
      proof.maturity === "attribution_limited"
    ) {
      if (proof.direction === "positive") {
        return {
          kind: "watching",
          label: "Watching",
          tone: "info",
          blurb: "Early signs of a lift in your Google numbers. I will call it after the full 28 days.",
        };
      }
      if (proof.direction === "negative") {
        return {
          kind: "watching",
          label: "Watching",
          tone: "info",
          blurb: "The early Google read looks soft so far. I will call it after the full 28 days.",
        };
      }
      return TOO_EARLY_PILL;
    }
    if (proof.maturity === "unresolved") {
      return {
        kind: "no_signal_yet",
        label: "No signal yet",
        tone: "muted",
        blurb: "Google never sent enough data to measure this one, so I stopped waiting on it.",
      };
    }
    // scheduled / collecting / blocked_data - nothing readable yet.
    return TOO_EARLY_PILL;
  }

  // 5. Live and confirmed on the page, but not on the measured ledger:
  //    say so plainly instead of inventing a verdict.
  if (lifecycleClass === "live_verified") {
    return {
      kind: "live",
      label: "Live",
      tone: "success",
      blurb: "Live on your site. I am not measuring this one against your Google data yet.",
    };
  }

  // 6. Calm default - Beacon knows about the row but is not measuring it.
  return {
    kind: "watching",
    label: "Watching",
    tone: "info",
    blurb: "I logged this change but I am not measuring it against your Google data yet.",
  };
}
