/**
 * Today route — "Live changes" data builder.
 *
 * Audit Correction #1 follow-up (2026-05-08): the lifecycle loop runs;
 * verified_live transitions DO happen (1 on Ritz so far, dated
 * 2026-04-28). The original audit pointed at "the proof is invisible"
 * as the highest-leverage move. This module is the smallest patch
 * that closes that gap — it joins three already-fetched data sources
 * (recommended_edits + changelog + url_change_outcomes) into a
 * customer-readable list of currently-live changes with a *dynamic*
 * state sentence per change.
 *
 * Important framing rule (operator-locked, 2026-05-08):
 *   The state sentence is NEVER a static "verdict expected on date X"
 *   countdown. The lifecycle is dynamic — confidence updates as new
 *   readings land. Per-verdict sentences below describe the CURRENT
 *   state and what Beacon is watching for next, never a fixed "wait
 *   N days" promise.
 *
 *   Forbidden phrasing (test-enforced): "verdict expected", "wait
 *   until", "confirmed", "validated", "proven", "win", "won",
 *   "winning", "guaranteed".
 *
 * Pure. No I/O. Deterministic. Same inputs → same output.
 */

import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type {
  UrlChangeOutcome,
} from "@/domains/attribution/url-change-outcome";
import type { VerdictLabel } from "@/domains/attribution/url-verdict";
import { normalizeUrl } from "@/lib/url/normalize";

/**
 * One live-change row surfaced to /today. Carries denormalized fields
 * the UI needs so the renderer stays pure and the component can be
 * tested with plain JSON fixtures.
 */
export type TodayLiveChange = {
  /** rec_edit row id (used as React key + for /changes/[id] link). */
  recEditId: string;
  /** Parent rec stable key. */
  recId: string;
  /** Edit's action_type — "add_h2_section" / "add_faq" / etc. */
  actionType: string;
  /** Target URL on the operator's own site. */
  targetUrl: string;
  /** Display label from rec_edit ("H2: Architect-led design-build advantage"). */
  displayLabel: string;
  /** Source rec's topic if present (from changelog topic_targeted). */
  topicTargeted: string | null;
  /** ISO timestamp of the verified_live transition. */
  liveAt: string;
  /** Whole-day count between liveAt and `now`. ≥0; 0 = same day. */
  daysSinceLive: number;
  /** Match kind from the lifecycle update — "exact" / "modified" / etc. */
  liveMatchKind: string | null;
  /** Match confidence at the time of the verified_live stamp. */
  liveMatchConfidence: "high" | "medium" | "low" | null;
  /** Current url_change_outcomes verdict for this change_id, if the
   *  materializer has emitted one yet. Null when no outcome row exists
   *  (engine still inside the post-change observation collection). */
  currentVerdict: VerdictLabel | null;
  /** Customer-safe one-sentence dynamic state line. NEVER a countdown. */
  stateLine: string;
  /** Customer-safe one-sentence "what Beacon is watching for next" line. */
  nextEvidenceLine: string;
  /** Stable change_id from the matching changelog row, if found. Used
   *  to deep-link to /changes/[id]. Null when no source_rec_id-stamped
   *  changelog row matches (rare but possible for legacy edits). */
  changelogId: string | null;
};

export type BuildLiveChangesArgs = {
  recommendedEdits: ReadonlyArray<RecommendedEditRow>;
  changelogEntries: ReadonlyArray<ChangelogEntry>;
  urlChangeOutcomes: ReadonlyArray<UrlChangeOutcome>;
  now: Date;
  /** Optional max — defaults to 3 to keep /today scannable. */
  maxRows?: number;
};

const DEFAULT_MAX_ROWS = 3;

/**
 * Customer-safe verdict-state sentences. Operator-locked phrasing —
 * see the forbidden-word list in the module doc comment.
 *
 * Each entry is a (stateLine, nextEvidenceLine) pair so the UI can
 * render two short, distinct sentences side-by-side.
 */
const VERDICT_COPY: Record<
  Exclude<VerdictLabel, "too_early" | "not_enough_data" | "not_enough_native_baseline">,
  { stateLine: string; nextEvidenceLine: string }
> = {
  helping: {
    stateLine: "Sustained lift detected across post-change readings.",
    nextEvidenceLine: "Confidence may shift as more daily observations land.",
  },
  hurting: {
    stateLine: "Sustained decline detected on this URL.",
    nextEvidenceLine: "Worth reviewing the change — revert, iterate, or treat as platform noise.",
  },
  weak_signal: {
    stateLine: "Early signs of lift — directional, not yet a strong signal.",
    nextEvidenceLine: "Confidence updates as more daily readings accumulate.",
  },
  nothing_yet: {
    stateLine: "No movement detected so far.",
    nextEvidenceLine: "Beacon keeps watching as new readings land.",
  },
  not_implemented: {
    stateLine: "Beacon never detected this change live on the page.",
    nextEvidenceLine: "Operator: confirm the change shipped, or iterate.",
  },
};

/**
 * Sentences for the case where no `url_change_outcomes` row exists
 * for this change_id yet. The engine emits `too_early` /
 * `not_enough_data` / `not_enough_native_baseline` here; T6.7 keeps
 * those out of fresh inserts because they carry no signal worth
 * persisting. The customer gets a calm, dynamic "still collecting"
 * sentence pair instead.
 */
const PRE_VERDICT_COPY: { stateLine: string; nextEvidenceLine: string } = {
  stateLine: "Live change detected — Beacon is collecting post-change readings.",
  nextEvidenceLine: "Confidence updates as new daily observations accumulate.",
};

/**
 * Variant for very-recent changes (< 3 days). Same dynamic posture as
 * PRE_VERDICT_COPY but explicitly names the early-data window so the
 * customer doesn't read "no signal" as "doesn't work."
 */
const RECENT_COPY: { stateLine: string; nextEvidenceLine: string } = {
  stateLine: "Live change detected — too recent for a confidence picture.",
  nextEvidenceLine: "Beacon needs more daily readings before drawing a state.",
};

function pickStateCopy(args: {
  currentVerdict: VerdictLabel | null;
  daysSinceLive: number;
}): { stateLine: string; nextEvidenceLine: string } {
  const v = args.currentVerdict;
  if (
    v === "helping" ||
    v === "hurting" ||
    v === "weak_signal" ||
    v === "nothing_yet" ||
    v === "not_implemented"
  ) {
    return VERDICT_COPY[v];
  }
  if (args.daysSinceLive < 3) return RECENT_COPY;
  return PRE_VERDICT_COPY;
}

function isoDaysBetween(fromISO: string, to: Date): number {
  const fromMs = new Date(fromISO).getTime();
  if (!Number.isFinite(fromMs)) return 0;
  const diffMs = to.getTime() - fromMs;
  return Math.max(0, Math.floor(diffMs / 86_400_000));
}

/**
 * Build the /today live-changes view. Filters recommended_edits to
 * verified_live rows, joins the matching changelog entry by
 * `source_rec_id + target_element_key + action_type`, joins the
 * matching `url_change_outcomes` row by changelog_id, and assembles
 * a stable list ordered most-recent-first with a `maxRows` cap.
 *
 * Pure. Deterministic. Empty input → empty output.
 */
export function buildTodayLiveChanges(
  args: BuildLiveChangesArgs,
): TodayLiveChange[] {
  const max = args.maxRows ?? DEFAULT_MAX_ROWS;

  // Index changelog by (source_rec_id, action_type, target_element_key)
  // for the rec_edit join. Same shape `persistChangelogLiveAt` uses
  // when stamping live_at — keeps semantics aligned.
  type ChangelogKey = string;
  const changelogKey = (
    sourceRecId: string | null | undefined,
    actionType: string | null | undefined,
    elementKey: string | null | undefined,
  ): ChangelogKey =>
    `${sourceRecId ?? ""}::${actionType ?? ""}::${elementKey ?? ""}`;

  const changelogByKey = new Map<ChangelogKey, ChangelogEntry>();
  for (const cl of args.changelogEntries) {
    const k = changelogKey(
      cl.source_rec_id,
      cl.action_type,
      cl.target_element_key,
    );
    // Most-recent wins on collision (stable sort).
    const prior = changelogByKey.get(k);
    if (
      !prior ||
      String(cl.timestamp ?? "") > String(prior.timestamp ?? "")
    ) {
      changelogByKey.set(k, cl);
    }
  }

  // Index outcomes by change_id for the changelog→outcome join.
  const outcomeByChangeId = new Map<string, UrlChangeOutcome>();
  for (const o of args.urlChangeOutcomes) {
    const prior = outcomeByChangeId.get(o.change_id);
    if (!prior || o.updated_at > prior.updated_at) {
      outcomeByChangeId.set(o.change_id, o);
    }
  }

  const out: TodayLiveChange[] = [];

  for (const edit of args.recommendedEdits) {
    const status = edit.implementation_status;
    if (status !== "verified_live" && status !== "verified_live_modified") {
      continue;
    }
    if (!edit.live_at || edit.live_at.length === 0) continue;
    const url = edit.target_url ?? "";
    if (url.length === 0) continue;
    const k = changelogKey(
      edit.rec_id,
      edit.action_type,
      edit.target_element_key,
    );
    const cl = changelogByKey.get(k) ?? null;
    const outcome = cl ? outcomeByChangeId.get(cl.id) ?? null : null;
    const currentVerdict: VerdictLabel | null = outcome?.verdict ?? null;
    const daysSinceLive = isoDaysBetween(edit.live_at, args.now);
    const copy = pickStateCopy({ currentVerdict, daysSinceLive });

    out.push({
      recEditId: edit.id,
      recId: edit.rec_id,
      actionType: edit.action_type,
      targetUrl: normalizeUrl(url) ?? url,
      displayLabel: edit.display_label ?? "Shipped change",
      topicTargeted: cl?.topic_targeted ?? null,
      liveAt: edit.live_at,
      daysSinceLive,
      liveMatchKind: edit.live_match_kind ?? null,
      liveMatchConfidence: edit.live_match_confidence ?? null,
      currentVerdict,
      stateLine: copy.stateLine,
      nextEvidenceLine: copy.nextEvidenceLine,
      changelogId: cl?.id ?? null,
    });
  }

  // Most-recent live_at first; stable secondary by recEditId.
  out.sort((a, b) => {
    if (a.liveAt !== b.liveAt) return b.liveAt.localeCompare(a.liveAt);
    return a.recEditId.localeCompare(b.recEditId);
  });

  return out.slice(0, max);
}
