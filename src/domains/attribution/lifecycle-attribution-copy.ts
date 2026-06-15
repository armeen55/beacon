/**
 * Phase 6A.6 (2026-04-28) — lifecycle-aware attribution copy resolver.
 *
 * Pure decision tree that maps a /changes row's full state — its
 * lifecycle truth (live_at, linked recommended_edit's
 * implementation_status), source class (imported_legacy /
 * scan_confirmed), stored attribution outcome, and the verdict-flag
 * state — onto an honest operator-facing label + tooltip.
 *
 * Pre-6A.6 the row showed a generic "No data" pill whenever no stored
 * `change-outcomes` row existed. The H2 verified-live positive control
 * displayed the same "No data" as a 2-year-old Profound CSV import,
 * which made the operator question whether Beacon's lifecycle
 * verification was even working. This helper replaces that with
 * specific copy for each real backend state.
 *
 * The helper is invoked per-row by /changes and once globally by the
 * `EvidenceFreshnessBanner` null branch; it owns no state and reads
 * no I/O. Decision rules are locked by tests so the operator-facing
 * vocabulary is reproducible.
 */

import type { ChangelogEntry } from "@/domains/changelog/types";
import type {
  ImplementationStatus,
  RecommendedEditRow,
} from "@/domains/recommendations/recommended-edits-persistence";
import type { LifecycleTabClass } from "./lifecycle-classification";

/** "Too early" branch fires for verified-live rows whose live_at is
 *  fewer than this many days in the past. Aligned with the engine's
 *  Phase-3.1 7-day promotion window so the language matches the
 *  internal model. */
export const ATTRIBUTION_BAKE_DAYS = 7;

/** Tone hint for the renderer — keeps the helper presentation-free
 *  while letting the call site map to the right palette. */
export type AttributionCopyTone =
  | "success"
  | "accent"
  | "warning"
  | "muted"
  | "info";

export type AttributionCopy = {
  /** Short operator-facing label (≤24 chars target). */
  label: string;
  /** Plain-English explainer for the hover tooltip. */
  tooltip: string;
  /** Style hint for the call site to pick a palette. */
  tone: AttributionCopyTone;
  /** Decision-tree branch id — used by tests + telemetry. */
  branch: AttributionCopyBranch;
};

export type AttributionCopyBranch =
  | "verified_live_too_early"
  | "verified_live_verdict_off"
  | "verified_live_baked"
  | "pending_implementation"
  | "not_implemented"
  | "imported_legacy"
  | "scan_confirmed_measuring"
  | "outcome_computed"
  | "outcome_weak_estimate"
  | "outcome_no_controls"
  | "outcome_unsupported_scope"
  | "outcome_insufficient_baseline"
  | "outcome_insufficient_post_data"
  | "outcome_other"
  | "verdict_pending";

/** Stored-outcome shape needed by the helper. Matches
 *  `StoredChangeOutcome.status` from the change-outcome-store. */
export type StoredOutcomeLike = {
  status: string;
};

export type ResolveAttributionCopyInput = {
  entry: Pick<ChangelogEntry, "live_at" | "source_system" | "import_batch_id">;
  edit?: Pick<RecommendedEditRow, "implementation_status" | "live_at"> | null;
  /** From the 6A.2 classifier; used as a fallback when no edit joins. */
  cls?: LifecycleTabClass | null;
  /** Stored attribution outcome (Z-score natural-controls engine). */
  outcome?: StoredOutcomeLike | null;
  /** Whether `BEACON_LIFECYCLE_VERDICT_ENABLED` is on (Phase 4 attribution). */
  verdictFlagEnabled: boolean;
  /** Reference time for the "less than 7 days ago" check. Defaults to now. */
  now?: Date;
};

const COPY_BY_BRANCH: Record<
  AttributionCopyBranch,
  Pick<AttributionCopy, "label" | "tooltip" | "tone">
> = {
  verified_live_too_early: {
    label: "Too early — verdict pending",
    tooltip:
      "Beacon verified this live. We need more post-change observations before attribution is meaningful.",
    tone: "accent",
  },
  verified_live_verdict_off: {
    label: "Verdict tracking off",
    tooltip:
      "Live verification is on, but date-aware attribution verdicts are paused at the admin level. Will resume once the post-change observation window is long enough.",
    tone: "muted",
  },
  verified_live_baked: {
    label: "Verdict pending",
    tooltip:
      "Live verification confirmed and the bake window has elapsed. Awaiting verdict computation on the next pass.",
    tone: "info",
  },
  pending_implementation: {
    label: "Waiting on implementation",
    tooltip:
      "You accepted this edit. Once it is added to the site, a scan can verify it live.",
    tone: "warning",
  },
  not_implemented: {
    label: "Not shipped",
    tooltip:
      "Beacon did not find this accepted edit on the page after the waiting period.",
    tone: "muted",
  },
  imported_legacy: {
    label: "Legacy — no eligible window",
    tooltip:
      "This is imported history from before the current lifecycle system. Native polling has not been folded into the citation evidence index yet, so per-row attribution can't be recomputed.",
    tone: "muted",
  },
  scan_confirmed_measuring: {
    label: "Scan-confirmed — measuring",
    tooltip:
      "This came from a confirmed scan diff. Beacon is waiting for enough data to measure impact.",
    tone: "info",
  },
  outcome_computed: {
    label: "Computed",
    tooltip: "Attribution verdict computed from the natural-controls engine.",
    tone: "success",
  },
  outcome_weak_estimate: {
    label: "Weak estimate",
    tooltip: "Outcome computed but with low confidence.",
    tone: "warning",
  },
  outcome_no_controls: {
    label: "No controls",
    tooltip: "No comparable control series was available for this URL.",
    tone: "warning",
  },
  outcome_unsupported_scope: {
    label: "Unsupported",
    tooltip: "Attribution is unsupported for this scope.",
    tone: "muted",
  },
  outcome_insufficient_baseline: {
    label: "Insufficient baseline",
    tooltip: "Fewer than the required baseline days are available.",
    tone: "muted",
  },
  outcome_insufficient_post_data: {
    label: "No post-window yet",
    tooltip: "We need more days after the change to compute a verdict.",
    tone: "muted",
  },
  outcome_other: {
    label: "Other",
    tooltip: "Outcome status outside the standard set.",
    tone: "muted",
  },
  verdict_pending: {
    label: "Verdict pending",
    tooltip: "No attribution verdict has been computed for this row yet.",
    tone: "muted",
  },
};

function attributionCopy(branch: AttributionCopyBranch): AttributionCopy {
  return { ...COPY_BY_BRANCH[branch], branch };
}

function isVerifiedLiveStatus(status: ImplementationStatus | undefined | null): boolean {
  return status === "verified_live" || status === "verified_live_modified";
}

function daysSince(iso: string, now: Date): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - t) / 86_400_000;
}

/**
 * Resolve the full attribution copy for a /changes row.
 *
 * Decision tree (first match wins):
 *   1. Linked edit verified_live*           AND live_at < 7d → too_early
 *   2. Linked edit verified_live*           AND live_at ≥ 7d AND verdict flag OFF → verdict_off
 *   3. Linked edit verified_live*           AND live_at ≥ 7d AND verdict flag ON  → verdict_baked (awaiting compute)
 *   4. Linked edit accepted (no live_at)   → pending_implementation
 *   5. Linked edit not_found_after_7d      → not_implemented
 *   6. Stored outcome present               → outcome-specific label
 *   7. Imported legacy (source_system / import_batch_id) → legacy_no_window
 *   8. Scan-confirmed (source_system)       → scan_confirmed_measuring
 *   9. Fallback                            → verdict_pending
 *
 * Stored outcome (rule 6) is checked AFTER the lifecycle-truth rules
 * because verified-live rows in the bake window must read "Too early"
 * even if a stale Z-score outcome still exists from a prior pass.
 */
export function resolveAttributionCopy(
  input: ResolveAttributionCopyInput,
): AttributionCopy {
  const now = input.now ?? new Date();
  const editStatus = input.edit?.implementation_status;
  // Prefer the edit's live_at (canonical Phase 3 stamp) but fall back
  // to the changelog row's value — both are populated by the runner.
  const liveAtIso = input.edit?.live_at ?? input.entry.live_at ?? null;

  // Rule 1-3: verified-live branches.
  if (isVerifiedLiveStatus(editStatus) || (liveAtIso && !editStatus)) {
    if (liveAtIso) {
      const days = daysSince(liveAtIso, now);
      if (days < ATTRIBUTION_BAKE_DAYS) {
        return attributionCopy("verified_live_too_early");
      }
      if (!input.verdictFlagEnabled) {
        return attributionCopy("verified_live_verdict_off");
      }
      return attributionCopy("verified_live_baked");
    }
    // verified_live without a live_at is technically inconsistent —
    // treat as too_early (defensive: don't escalate to verdict_off).
    return attributionCopy("verified_live_too_early");
  }

  // Rule 4: pending implementation.
  if (editStatus === "accepted" && !liveAtIso) {
    return attributionCopy("pending_implementation");
  }

  // Rule 5: not implemented after 7d.
  if (editStatus === "not_found_after_7d") {
    return attributionCopy("not_implemented");
  }

  // Rule 6: stored outcome — keep existing labels but route through this
  // helper so the call site has a single resolver.
  if (input.outcome) {
    const s = input.outcome.status;
    if (s === "computed") return attributionCopy("outcome_computed");
    if (s === "weak_estimate") return attributionCopy("outcome_weak_estimate");
    if (s === "no_controls") return attributionCopy("outcome_no_controls");
    if (s === "unsupported_scope") return attributionCopy("outcome_unsupported_scope");
    if (s === "insufficient_baseline") return attributionCopy("outcome_insufficient_baseline");
    if (s === "insufficient_post_data") return attributionCopy("outcome_insufficient_post_data");
    return attributionCopy("outcome_other");
  }

  // Rule 7: imported legacy (no outcome).
  if (
    input.cls === "imported_legacy" ||
    input.entry.source_system === "pdf_changelog_rebuild" ||
    input.entry.source_system === "import" ||
    !!input.entry.import_batch_id
  ) {
    return attributionCopy("imported_legacy");
  }

  // Rule 8: scan-confirmed (no outcome).
  if (
    input.cls === "scan_confirmed" ||
    input.entry.source_system === "scan_detection" ||
    input.entry.source_system === "scan_promoted"
  ) {
    return attributionCopy("scan_confirmed_measuring");
  }

  // Rule 9: fallback.
  return attributionCopy("verdict_pending");
}

/**
 * Replacement copy for `EvidenceFreshnessBanner`'s null-`builtAt`
 * branch. Pre-6A.6 the banner read "no citation evidence has been
 * built yet — Run an import or wait for the first native-poll
 * integration", which gaslighted operators after the 2026-04-22 native
 * poll pivot (native polling DID launch). This copy stays honest about
 * the actual state: the index hasn't been rebuilt against native data
 * yet, but native polling is alive.
 */
export const EVIDENCE_FRESHNESS_NULL_COPY = {
  label: (surface: string) =>
    `${surface} use the citation-evidence index, which has not been rebuilt yet today.`,
  detail:
    "Per-row verdicts read the most recent index snapshot. Refresh your connected data to rebuild it with the latest Perplexity + ChatGPT readings.",
} as const;
