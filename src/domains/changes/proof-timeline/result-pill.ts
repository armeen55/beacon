/**
 * /changes proof timeline — result-pill resolver.
 *
 * Bundle (2026-05-10) — second pass at /changes per the maximum-depth
 * UI audit (~/.claude/plans/i-want-a-maximum-depth-curried-curry.md):
 * collapse the legacy table's three competing pills (Attribution
 * Status + Impact Direction + Verdict) into ONE customer-facing
 * "result" pill per row. The v2 timeline card calls this resolver
 * once per row.
 *
 * Pure module — no I/O, no DOM, no React. Lives next to the rest of
 * the proof-timeline helpers so it's testable in Node and reusable
 * from any future surface (timeline rail, share view, etc.).
 *
 * Customer-vocabulary contract (forbidden-vocabulary guardrail):
 *   • Labels are plain English ("Helping", "Hurting", "Too early",
 *     "No signal yet", "Needs review", "Live", "Watching").
 *   • Blurbs are one-line sentences a non-engineer reads as truth.
 *   • Never reference the Z-score engine, evidence tier, lifecycle
 *     classification, raw event enum names, or any other internal
 *     subsystem.
 */
import type { VerdictLabel } from "@/domains/attribution/url-verdict";
import type { LifecycleTabClass } from "@/domains/attribution/lifecycle-classification";
import type { ImplementationStatus } from "@/domains/recommendations/recommended-edits-persistence";

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

export type ResolveProofPillInput = {
  /** URL-level result, when one was computed for this change. */
  urlVerdict: { verdict: VerdictLabel } | null;
  /** Classifier output: which timeline bucket this row sits in. */
  lifecycleClass: LifecycleTabClass | null;
  /** Linked edit's implementation status, when one joins this row. */
  lifecycleStatus: ImplementationStatus | null;
};

/**
 * Resolve the single customer-facing pill + blurb for one /changes row.
 *
 * Decision order (first match wins):
 *   1. `needs_review` class → "Needs review".
 *   2. Pending implementation (accepted but not yet on the page) →
 *      "Watching".
 *   3. Linked edit is `not_implemented` → "Needs review" (the scan
 *      never found the proposed change after the bake window).
 *   4. URL verdict is `helping` → "Helping".
 *   5. URL verdict is `hurting` → "Hurting".
 *   6. URL verdict is one of the early/insufficient buckets
 *      → "Too early".
 *   7. URL verdict is `nothing_yet` → "No signal yet".
 *   8. URL verdict is `weak_signal` → "Watching" (directional only,
 *      never described as proof).
 *   9. URL verdict is `not_implemented` → "Needs review".
 *  10. Row is `live_verified` with no computable verdict → "Live".
 *  11. Otherwise → "Watching".
 */
export function resolveProofPill(input: ResolveProofPillInput): ProofPill {
  const { urlVerdict, lifecycleClass, lifecycleStatus } = input;

  // 1. Needs-review bucket.
  if (lifecycleClass === "needs_review") {
    return {
      kind: "needs_review",
      label: "Needs review",
      tone: "warning",
      blurb: "Beacon couldn't confirm this on the page yet.",
    };
  }

  // 2. Pending implementation — accepted but the scan hasn't seen it
  //    live on the site. Always "Watching" so the timeline reads as
  //    in-flight rather than measured.
  if (lifecycleClass === "pending_implementation") {
    return {
      kind: "watching",
      label: "Watching",
      tone: "info",
      blurb: "Accepted — Beacon is watching for it to land on the page.",
    };
  }

  // 3. Linked edit confirmed "not implemented" (bake window passed,
  //    scan never matched). Operator should look — surface as Needs
  //    review even if the row sits in a different bucket.
  if (lifecycleStatus === "not_found_after_7d") {
    return {
      kind: "needs_review",
      label: "Needs review",
      tone: "warning",
      blurb: "Bake window passed and Beacon couldn't find it on the page.",
    };
  }

  if (urlVerdict) {
    switch (urlVerdict.verdict) {
      case "helping":
        return {
          kind: "helping",
          label: "Helping",
          tone: "success",
          blurb: "AI visibility responded after this shipped.",
        };
      case "hurting":
        return {
          kind: "hurting",
          label: "Hurting",
          tone: "danger",
          blurb: "AI visibility slipped after this shipped.",
        };
      case "too_early":
      case "not_enough_data":
      case "not_enough_native_baseline":
        return {
          kind: "too_early",
          label: "Too early",
          tone: "muted",
          blurb: "Beacon is waiting for the post-change window to fill.",
        };
      case "nothing_yet":
        return {
          kind: "no_signal_yet",
          label: "No signal yet",
          tone: "muted",
          blurb: "No movement yet — Beacon keeps watching.",
        };
      case "weak_signal":
        return {
          kind: "watching",
          label: "Watching",
          tone: "info",
          blurb: "Early signs of movement — not yet a strong signal.",
        };
      case "not_implemented":
        return {
          kind: "needs_review",
          label: "Needs review",
          tone: "warning",
          blurb: "Bake window passed and Beacon couldn't find it on the page.",
        };
    }
  }

  // 10. Live and confirmed on the page, but no measurable verdict yet.
  if (lifecycleClass === "live_verified") {
    return {
      kind: "live",
      label: "Live",
      tone: "success",
      blurb: "Live on your site. Beacon is watching for AI to respond.",
    };
  }

  // 11. Calm default — Beacon knows about the row but doesn't have a
  //     stronger answer yet.
  return {
    kind: "watching",
    label: "Watching",
    tone: "info",
    blurb: "Beacon is tracking this change.",
  };
}
