import "server-only";

/**
 * changes-data (2026-07-01) — server loader for the canonical Changes list. Fans in the EXISTING
 * sources (the ActionPack worklist + today's daily plan + reservations) and runs the pure
 * buildCanonicalChanges adapter. READ-ONLY, fail-soft, no new persistence. Returns the canonical
 * changes + a sourceId→TodayMove map so a row can expand into the existing rich card (no rewrite of
 * working actions).
 */
import { currentTenantId } from "@/lib/tenant-context";
import { loadMovesWorklist } from "./moves/moves-data";
import { getLatestPreviewPlan, getAcceptedPlan, listActiveReservations } from "@/domains/experiments/daily-experiment-plan-store";
import { buildCanonicalChanges, type CanonicalMoveInput } from "@/domains/changes/build-canonical-changes";
import type { CanonicalChange } from "@/domains/changes/canonical-change";
import { statusView } from "@/domains/changes/canonical-change";
import type { TodayMove } from "./today-moves-data";
import { readPublishHealth } from "@/domains/push/publish-canary-store";
// D7 (honest opportunity math) - the SAME bias-correction factor + per-family empirical capture
// band build-today-preview.ts already resolves for the nightly plan, reused here so the ranked
// Changes list forecasts with the tenant's own track record instead of the static 25/75 fallback
// whenever enough settled history exists. Read-only; this file only reads the cached ledger.
import { loadCalibrationRecords } from "@/domains/experiments/forecast-calibration-store";
import { summarizeForecastCalibration, captureDistributionFromCalibrationRecords } from "@/domains/experiments/forecast-calibration";
import { canonicalMoveType } from "@/domains/learning/experiment-prior";
import { blendCaptureBand } from "@/domains/experiments/empirical-capture";
import { captureHypothesis } from "@/domains/forecast/hypothesis-log";
// UX0 (2026-07-02) - the SAME canonical "measuring" count Today reads, so the worklist
// header never shows a different number than Today for the same word. Read-only import;
// proof-gsc is owned by a concurrent workstream, this file only reads its cached loader.
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
// FP3 (2026-07-02) - THE ONE-COUNT RULE: measuring/decided are computed by the shared
// lifecycle classifier (the same split Results renders as its bands), never by this
// file's own verdict-field filter. See domains/changes/lifecycle-counts.ts.
import { countLedgerLifecycle } from "@/domains/changes/lifecycle-counts";
// FP5b (2026-07-02) - the New Pages board is the ONE home for not-yet-built topics; a
// page-less create row whose topic already has a board card is a duplicate, not a
// second opportunity. Same normalizer the board's own dedupe pass uses.
import { loadNewPagesData } from "./today-newpages-data";
import { topicIdentityKey } from "@/domains/demand-graph/dedupe-new-page-cards";
import { valueWithDeadline } from "@/lib/load-with-deadline";
import { cache } from "react";
// D4/N1 (unified allocator, 2026-07-02) - fuse D2's AEO gap verdicts + D3's SERP steal briefs +
// undercovered keyword-library demand onto this SAME ranked list, so /changes becomes the
// operator's "one ranked decision" across every opportunity source, not just the ActionPack
// worklist. Read-only additive lanes; a lane outage narrows the fused set, never blocks the page.
import { fuseUnifiedList } from "@/domains/allocator/load-unified-list";

export type ChangesView = {
  changes: CanonicalChange[];
  movesById: Record<string, TodayMove>;
  summary: { todo: number; ready: number; measuring: number; results: number; selectedForToday: number; protectedPages: number };
  hasPlan: boolean;
  planAccepted: boolean;
  /** B7 (worklist fix batch) - only set when Ready is 0, so the tab isn't a bare "0" with no
   *  reason. Distinguishes "your Wix pages aren't mapped yet" from "nothing to prepare right now". */
  readyZeroHint: string | null;
  /** UX0/FP3 (2026-07-02) - THE canonical "measuring" count (the ONE-COUNT RULE in
   *  domains/changes/lifecycle-counts.ts: every shipped change without a final read,
   *  the same set Results shows as "In flight"). `summary.measuring` above stays the
   *  count of changes in THIS list that are measuring (a worklist-scoped subset); this
   *  is the whole-tenant truth so the Measuring tab can say "10 of 16 here" instead of
   *  silently disagreeing with Today's number. */
  measuringCountCanonical: number;
  /** FP3 (2026-07-02) - THE canonical "decided" count (shipped changes with a final
   *  read: Results' Wins + What we learned bands). Same subset treatment as
   *  measuringCountCanonical: `summary.results` is this list's own settled rows, this
   *  is the whole-tenant truth. */
  decidedCountCanonical: number;
  /** FP2 (2026-07-02) - "Fix the experience rows silently vanish" finding. Set exactly when
   *  a row TYPE got filtered upstream (the worklist render cap in moves/moves-data.ts truncates
   *  to its strongest N and keeps the true count in stats.movesReady) so the list can say so in
   *  one quiet line instead of just showing fewer rows with no acknowledgment. Null when nothing
   *  was suppressed this load. */
  suppressedRowsNote: string | null;
};

/** FP2 (2026-07-02, killer finding 1) - normalized identity for the dedupe pass below: the
 *  SAME real-world opportunity (same target page or same not-yet-created topic, same query/
 *  label, same lever family) must render as exactly ONE row, never two. `pagePath` already
 *  carries a normalized path when a real page exists (build-canonical-changes.ts's
 *  normalizePath); for a page-less "create" candidate (topic with no URL yet - see the
 *  allocator's fuseByPage, which only merges entries that share a non-null `page`) this falls
 *  back to the normalized topic/label text so two lanes pitching the SAME unbuilt topic
 *  ("best iranian restaurants near me" from both the SERP-steal lane and the keyword-library
 *  lane) still collapse to one row. */
export function dedupeIdentity(c: CanonicalChange, query: string | null): string {
  const pageKey = c.pagePath && c.pagePath.trim() ? c.pagePath.trim().toLowerCase() : null;
  const topicKey = (query ?? c.pageLabel ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${c.tenantId}::${pageKey ?? `topic:${topicKey}`}::${c.changeFamily}`;
}

const STATUS_STRENGTH: Record<CanonicalChange["status"], number> = {
  result: 7, measuring: 6, verify: 5, apply: 4, ready: 3, blocked: 2, suggested: 1, skipped: 0,
};

/** Pick the stronger of two rows claiming the same identity: most-advanced lifecycle status
 *  wins first (never demote a row that already shipped/measured back to a bare suggestion),
 *  then the row with a real sized forecast over an honest-fallback one, then higher impact
 *  score. Never mutates either input. */
export function strongerChange(a: CanonicalChange, b: CanonicalChange): CanonicalChange {
  const sa = STATUS_STRENGTH[a.status] ?? 0;
  const sb = STATUS_STRENGTH[b.status] ?? 0;
  if (sa !== sb) return sa > sb ? a : b;
  const aSized = a.expectedOutcomeLow != null;
  const bSized = b.expectedOutcomeLow != null;
  if (aSized !== bSized) return aSized ? a : b;
  return (b.impactScore ?? 0) > (a.impactScore ?? 0) ? b : a;
}

/** FP2 - dedupe the fused list by real-world identity, unioning sourceIds/alternateOpportunities/
 *  sources from the dropped duplicate onto the surviving row so no provenance is lost, only the
 *  redundant second row. Order-preserving on the survivors (keeps rankChanges's own sort the only
 *  thing that reorders the list). */
export function dedupeChanges(changes: readonly CanonicalChange[], movesById: Record<string, TodayMove>): CanonicalChange[] {
  const byIdentity = new Map<string, CanonicalChange>();
  const order: string[] = [];
  for (const c of changes) {
    const query = c.sourceIds[0] ? (movesById[c.sourceIds[0]]?.query ?? null) : null;
    const key = dedupeIdentity(c, query);
    const prev = byIdentity.get(key);
    if (!prev) {
      byIdentity.set(key, c);
      order.push(key);
      continue;
    }
    const winner = strongerChange(prev, c);
    const loser = winner === prev ? c : prev;
    byIdentity.set(key, {
      ...winner,
      sourceIds: [...new Set([...winner.sourceIds, ...loser.sourceIds])],
      alternateOpportunities: [...new Set([...winner.alternateOpportunities, ...loser.alternateOpportunities])],
      sources: winner.sources || loser.sources ? [...new Set([...(winner.sources ?? []), ...(loser.sources ?? [])])] : undefined,
    });
  }
  return order.map((k) => byIdentity.get(k)!);
}

/** FP2 (killer finding 1b) - a row whose ONLY sizing is opportunity-math's honest fallback
 *  (`expectedOutcomeLow == null`, i.e. `unsized`) must sort below every row that has a real
 *  forecast, so the templated "not enough history" sentence never crowds out sized rows at
 *  the top of the list. `strategy.ts`'s ranking (strategy.ts's `strategyScore`, not owned by this
 *  change) adds at most a +300 evidence bonus and a +200 ready bonus on top of `impactScore` for
 *  ANY strategy - so subtracting a fixed offset well past that combined ceiling (10,000) from the
 *  row's own impactScore guarantees an unsized row can never outscore a sized one, in any status
 *  or strategy, while SUBTRACTING (not clamping to a shared constant) preserves the unsized rows'
 *  own relative order among each other - a stronger unsized opportunity still ranks above a
 *  weaker one, just always below every sized row. Never hidden, only demoted. */
const UNSIZED_DEMOTION_OFFSET = 10_000;
export function demoteUnsized(changes: readonly CanonicalChange[]): CanonicalChange[] {
  return changes.map((c) => {
    if (c.expectedOutcomeLow != null) return c;
    return { ...c, impactScore: c.impactScore - UNSIZED_DEMOTION_OFFSET };
  });
}

/** FP2 (killer finding 3) - "the secondary explanatory line contradicts the primary
 *  recommendation" on a cannibalization row. Root cause: `today-moves-data.ts` sets `m.why`
 *  (the CanonicalChange's primary `recommendation`) to the cannibalization fix ("fold this page
 *  into X" / "point this page at X"), but can OVERWRITE it afterwards with a different framing
 *  (a striking-distance title pitch, a losing-query recovery pitch) while the card's own "Do
 *  first" lever box (built from `researchPack.onPagePlan`, which never sees the cannibalization
 *  signal at all) keeps recommending standalone work on the SAME page - e.g. "fold this into
 *  your best-ranking page" right next to "sharpen this page's title". That card-internal
 *  contradiction lives in files this change does not own (today-moves-card.tsx/today-moves-
 *  data.ts); what IS in scope is this list's own `rationale` line, which must never repeat or
 *  imply the standalone-work framing once a real cannibalization case exists for the row. When
 *  it does, `rationale` is rewritten to state the consolidation directive plainly and name that
 *  it supersedes any per-page lever work below, so the row's own two lines never disagree. */
export function reconcileCannibalizationRationale(
  changes: readonly CanonicalChange[],
  movesById: Record<string, TodayMove>,
): CanonicalChange[] {
  return changes.map((c) => {
    const move = c.sourceIds[0] ? movesById[c.sourceIds[0]] : undefined;
    const fix = move?.cannibalization?.[0]?.fix;
    if (!fix) return c;
    if (c.rationale === fix) return c; // already agrees, nothing to reconcile
    return {
      ...c,
      rationale: `${fix} That comes first - any other edit below on this page should wait until this is resolved.`,
    };
  });
}

/** FP5b (2026-07-02, killer finding "New-page ideas appear three times") - drop a
 *  page-less create row whose normalized topic already has a card on the New Pages
 *  board (its single home). Rows with a real page are never dropped (an edit to an
 *  existing page is not "a page I don't have yet"), and topics the board does NOT
 *  carry stay on the list so nothing is lost. PURE; exported for a direct test pin. */
export function dropBoardDuplicateNewPageRows(
  changes: readonly CanonicalChange[],
  boardTopicKeys: ReadonlySet<string>,
): CanonicalChange[] {
  if (boardTopicKeys.size === 0) return [...changes];
  return changes.filter(
    (c) =>
      !(
        c.changeFamily === "new_page" &&
        !c.pagePath.trim() &&
        boardTopicKeys.has(topicIdentityKey(c.pageLabel))
      ),
  );
}

/** FP5b - the board's topics, bounded so a cold demand-graph build can never hold the
 *  Changes list hostage (on a timeout we simply skip the dedupe this visit). */
const BOARD_TOPICS_DEADLINE_MS = 10_000;

// FP3 - react.cache()'d so the FP3 lifecycle-counts loader and the page section that
// renders the list share ONE computation per request instead of building it twice.
export const loadChangesView = cache(async (): Promise<ChangesView> => {
  const tenantId = await currentTenantId();
  // Move 3 — every source is fail-soft so one failing store can never blank the whole
  // Changes list. A plan-store outage drops the "today" slice but keeps the ranked moves;
  // a worklist outage keeps any selected plan items. The page renders with what loaded.
  const [wl, accepted, preview, reservations, ledgerRows, calibrationRecords, boardTopicKeys] = await Promise.all([
    loadMovesWorklist().catch(() => ({ moves: [] as TodayMove[], stats: undefined })),
    getAcceptedPlan(tenantId).catch(() => null),
    getLatestPreviewPlan(tenantId).catch(() => null),
    listActiveReservations(tenantId).catch(() => []),
    loadProofLedgerCached(tenantId).catch(() => []),
    loadCalibrationRecords(tenantId).catch(() => []),
    valueWithDeadline(
      loadNewPagesData()
        .then((d) => new Set(d.opportunities.map((o) => topicIdentityKey(o.topic))))
        .catch(() => new Set<string>()),
      new Set<string>(),
      BOARD_TOPICS_DEADLINE_MS,
    ),
  ]);
  // FP3 - THE ONE-COUNT RULE (domains/changes/lifecycle-counts.ts): the same classifier
  // Results uses for its bands, run on the same request-cached ledger rows.
  const ledgerCounts = countLedgerLifecycle(ledgerRows);
  const measuringCountCanonical = ledgerCounts.measuring;
  const decidedCountCanonical = ledgerCounts.decided;
  const plan = accepted ?? preview;
  const moves = (wl.moves ?? []) as TodayMove[];

  // FP2 (killer finding 5) - "Fix the experience rows silently vanish". moves/moves-data.ts caps
  // its render to the strongest MOVES_CAP moves and keeps the true count in stats.movesReady; this
  // is the one place that count is visible before the page renders, so this is the one place that
  // can turn a silent shrink into an honest sentence. `heldWhileMeasuring` (moves already computed
  // but withheld because their page is mid-measurement) is the other real, named suppression this
  // stats object already tracks - both get folded into one quiet acknowledgment line.
  const trueMovesTotal = wl.stats?.movesReady ?? moves.length;
  const heldWhileMeasuring = wl.stats?.heldWhileMeasuring ?? 0;
  const cappedCount = Math.max(0, trueMovesTotal - moves.length);
  let suppressedRowsNote: string | null = null;
  if (cappedCount > 0) {
    suppressedRowsNote = `I'm holding back ${cappedCount} lower-priority idea${cappedCount === 1 ? "" : "s"} out of ${trueMovesTotal} total so this list stays focused on the strongest ones. Nothing is lost, they're just not rendered here.`;
  } else if (heldWhileMeasuring > 0) {
    suppressedRowsNote = `${heldWhileMeasuring} more idea${heldWhileMeasuring === 1 ? "" : "s"} exist${heldWhileMeasuring === 1 ? "s" : ""} for pages that are mid-measurement right now. I'll surface them once those results settle.`;
  }

  // D7 - the tenant's own bias-correction factor + per-actionFamily empirical capture band, the
  // SAME machinery build-today-preview.ts already resolves for the nightly plan (forecast-
  // calibration.ts). A fresh tenant with no settled history yet gets factor 1.0 and the static
  // 25/75 band - byte-identical to the pre-D7 forecastRange defaults.
  const calibrationSummary = summarizeForecastCalibration(calibrationRecords);
  const captureDistribution = captureDistributionFromCalibrationRecords(calibrationRecords);

  const moveInputs: CanonicalMoveInput[] = moves.map((m) => {
    const tq = [...(m.topQueries ?? [])].sort((a, b) => b.impressions - a.impressions)[0];
    const band = blendCaptureBand(captureDistribution.get(canonicalMoveType(m.action)));
    return {
      id: m.id,
      actionType: m.action,
      actionTone: m.actionTone,
      query: m.query,
      targetUrl: m.targetUrl,
      pageLabel: m.pageLabel,
      why: m.why,
      rankWhy: m.rankWhy,
      score: m.score,
      demand: m.demand,
      // D7 (honest opportunity math) - the raw position/impressions/clicks signal, so
      // build-canonical-changes.ts can call opportunity-math.ts's full composer (CTR curve +
      // plain-English position clause) instead of the legacy pre-computed-gap fallback.
      topQueryPosition: tq && tq.impressions > 0 ? tq.position : null,
      topQueryImpressions90d: tq?.impressions ?? null,
      topQueryClicks90d: tq?.clicks ?? null,
      correctionFactor: calibrationSummary.correctionFactor,
      captureBand: { low: band.low, high: band.high, n: band.n, isEmpirical: band.isEmpirical },
      settledResultsCount: calibrationSummary.settledCount,
      proofStatus: m.proofStatus ?? null,
      alreadyMeasuring: m.alreadyMeasuring,
      pageMeasuring: m.pageMeasuring,
      preparedReady: m.preparedChecklist?.readyToReview,
      preparedDraftText: m.preparedDraftText ?? null,
      alternateOpportunities: (m.also ?? []).slice(0, 4),
      proofMaturity: m.proofMaturity ?? null,
      proofDirection: m.proofDirection ?? null,
      proofLabel: m.proofLabel ?? null,
      proofNextCheckpoint: m.proofNextCheckpoint ?? null,
    };
  });

  const worklistChanges = buildCanonicalChanges({ tenantId, moves: moveInputs, plan: plan ?? null, reservations });

  // D4/N1 (unified allocator) - fuse in the lanes buildCanonicalChanges cannot see: D2's AEO gap
  // verdicts, D3's SERP steal briefs, and undercovered keyword-library demand, into ONE ranked
  // CanonicalChange[]. Fail-soft as a whole (fuseUnifiedList never throws); on any unexpected
  // failure fall back to the worklist-only list rather than blanking the page.
  const { changes: fusedChanges } = await fuseUnifiedList(tenantId, worklistChanges).catch(() => ({ changes: worklistChanges }));

  const movesById: Record<string, TodayMove> = {};
  for (const m of moves) movesById[m.id] = m;

  // FP2 (killer finding 2) - the allocator's own fuseByPage only merges lanes that share a real,
  // non-null page; two lanes independently pitching the SAME not-yet-built topic ("best iranian
  // restaurants near me" from both the SERP-steal lane and the keyword-library lane, or a plain
  // worklist/allocator overlap) survive as two rows. Collapse those here, by real-world identity
  // (page-or-topic + query + lever family), before anything ranks or renders the list.
  const deduped = dedupeChanges(fusedChanges, movesById);
  // FP2 (killer finding 3) - when this row's page has a real cannibalization case, its secondary
  // line must agree with (not contradict) the consolidation directive. See the function doc for
  // the exact contradiction this closes.
  const reconciled = reconcileCannibalizationRationale(deduped, movesById);
  // FP2 (killer finding 1) - a row whose only sizing is opportunity-math's honest "not enough
  // history"/"gap too small" fallback must never outrank a row with a real forecast. strategy.ts's
  // ranking is untouched; this only adjusts the ranking INPUT so unsized rows sort to the bottom
  // of their status bucket instead of mixing in among sized ones.
  const demoted = demoteUnsized(reconciled);
  // FP5b - one home per job: a not-yet-built topic that already has a New Pages board
  // card must not ALSO render as a ranked list row ("biggest cities in iran" appearing
  // three times in two formats). The board is the richer home; the list keeps every
  // create topic the board does not carry.
  const changes = dropBoardDuplicateNewPageRows(demoted, boardTopicKeys);

  // D7 (hypothesis capture) - every forecast actually rendered to the operator on this list is
  // logged as a falsifiable hypothesis, so the day-28 settle can grade it later. Fire-and-forget,
  // best-effort (captureHypothesis is itself fail-soft): a logging hiccup must never slow or break
  // the Changes list render. Bounded to rows the operator can actually act on right now (todo/
  // ready) - a blocked/measuring/result row's forecast was already logged when it first became
  // actionable, so re-logging it here would just be a duplicate keyed by the same hypothesisId.
  // Runs on the DEDUPED set so a collapsed duplicate never double-logs the same hypothesisId.
  const actionableWithForecast = changes.filter(
    (c) => (c.status === "suggested" || c.status === "ready" || c.status === "apply") && c.hypothesisId,
  );
  void Promise.allSettled(
    actionableWithForecast.map((c) =>
      captureHypothesis(tenantId, c.pagePath, c.changeType, {
        lowPerMonth: c.expectedOutcomeLow ?? null,
        highPerMonth: c.expectedOutcomeHigh ?? null,
        days: c.expectedOutcomeDays ?? 28,
        basis: c.expectedOutcome ?? "",
        hypothesisId: c.hypothesisId!,
      }),
    ),
  );

  const summary = { todo: 0, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 };
  for (const c of changes) {
    if (c.status === "skipped") continue;
    summary[statusView(c.status)] += 1;
    if (c.selectedForToday) summary.selectedForToday += 1;
    if (c.protectedControl) summary.protectedPages += 1;
  }

  // B7 / FP2 (killer finding 6) - "Ready 0" with no reason reads as broken. A bare "0 ready
  // right now" is still a caption, not an answer - the sentence must say WHY it's zero, WHAT
  // would make it non-zero, and WHEN to expect that, so a fresh operator never has to guess.
  // Only computed when it's actually 0 (no cost otherwise); fail-soft so a canary-store outage
  // never blocks the list.
  let readyZeroHint: string | null = null;
  if (summary.ready === 0) {
    const health = await readPublishHealth(tenantId).catch(() => null);
    if (health && health.urlMapOk === false) {
      readyZeroHint = "0 ready to publish because your Wix pages aren't mapped yet. Once you connect them, prepared changes will show up here ready to ship.";
    } else if (summary.todo > 0) {
      readyZeroHint = `0 are ready to publish yet because none of your ${summary.todo} open idea${summary.todo === 1 ? "" : "s"} has been prepared into an exact edit. Open one from To do and prepare it, and it will show up here.`;
    } else if (summary.measuring > 0) {
      readyZeroHint = `0 ready right now because everything is already live and measuring (${summary.measuring} in progress). I'll show new ideas here once fresh demand data comes in or a measurement settles.`;
    } else {
      readyZeroHint = "0 ready right now because I don't have a prepared idea for you yet. Once your Google and AI demand data syncs, I'll rank real ideas here and you can prepare the strongest ones.";
    }
  }

  return { changes, movesById, summary, hasPlan: !!plan, planAccepted: !!accepted, readyZeroHint, measuringCountCanonical, decidedCountCanonical, suppressedRowsNote };
});
