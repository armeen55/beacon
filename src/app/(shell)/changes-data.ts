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
import { countLedgerLifecycle, excludeRevertBookkeeping, tonightCounts } from "@/domains/changes/lifecycle-counts";
// FP5b (2026-07-02) - the New Pages board is the ONE home for not-yet-built topics; a
// page-less create row whose topic already has a board card is a duplicate, not a
// second opportunity. Same normalizer the board's own dedupe pass uses.
import { loadNewPagesData } from "./today-newpages-data";
import { topicIdentityKey } from "@/domains/demand-graph/dedupe-new-page-cards";
import { valueWithDeadline } from "@/lib/load-with-deadline";
import { cache } from "react";
// R14b (receipts everywhere) - the shared one-line receipt builder; the line is
// composed HERE (server) so the client list renders a stable string.
import { buildReceiptLine, checkedAgoLabel } from "@/components/data/receipt-line";
// D4/N1 (unified allocator, 2026-07-02) - fuse D2's AEO gap verdicts + D3's SERP steal briefs +
// undercovered keyword-library demand onto this SAME ranked list, so /changes becomes the
// operator's "one ranked decision" across every opportunity source, not just the ActionPack
// worklist. Read-only additive lanes; a lane outage narrows the fused set, never blocks the page.
import { fuseUnifiedList } from "@/domains/allocator/load-unified-list";
import { classifyOpportunityFreshness, summarizeExpiry } from "@/domains/changes/opportunity-expiry";
import { perfMark, perfStage } from "@/lib/obs/perf-log";

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
  /** N46 (R6, 2026-07-02) - present exactly when at least one row's evidence has expired (45d+,
   *  or a seasonal window that already passed) this load. Renders as an honest sub-line inside
   *  the SAME "N more lower-priority ideas" expander (see changes-list-client.tsx) - never a
   *  second expander, never a bare status word. Null when nothing expired. */
  expiredSubline: string | null;
  /** R14b (receipts everywhere) - the one-line receipt above the list: when this ranking was
   *  computed and from what source, plus when tonight's picks were assembled when a plan
   *  exists. Built server-side so the rendered string is hydration-stable. */
  receiptLine: string | null;
  /** R20 (D6 dynamic auto-mode) - the live session-strip counter's server-truth numbers, all
   *  from the SAME FP3 lifecycle rule so the strip never disagrees with the Tonight chip or
   *  Results. `readyCount` = tonight's picks not yet applied (prepared, waiting on the
   *  operator's edit); `shippedThisWeekCount` = changes shipped in the trailing 7 days. The
   *  measuring number the strip shows is `measuringCountCanonical` above (reused, not
   *  re-derived). */
  readyCount: number;
  shippedThisWeekCount: number;
  /** operator spec 2026-07-09 C-17 - the "Watching" tab's items: bare suggestions the calibrated
   *  abstention gate (N49) is holding because none of the three real-signal classes are present
   *  yet (no demand, no competitor teardown, no first-party/GSC movement). Never a confident move,
   *  never deleted - shown honestly on its own lower-priority tab so the operator sees what is on
   *  Beacon's radar. Populated from the SAME partition that keeps them out of the ranked list, so
   *  a held row appears in exactly one place. Empty (or absent) when nothing is being watched. */
  watching?: CanonicalChange[];
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

/** N46 (R6, 2026-07-03) - opportunity expiration, wired AFTER dedupe/rank (this NEVER re-ranks,
 *  only marks freshness/agingChip on the existing rows - order is untouched). Today the only
 *  genuinely dated evidence available at this seam is the accepted/preview PLAN's own createdAt
 *  (a real "this batch's research was assembled at X" timestamp) for rows sourced from tonight's
 *  plan (fromPlanItem sets sourceIds: [e.id], matched here via planItemIds). A worklist-sourced
 *  row (the majority of this list) has no dated evidence threaded to this layer yet, so it is
 *  left unclassified - classifyOpportunityFreshness's own honest default (fresh, never a
 *  fabricated age). PURE; exported for a direct test pin. */
export function applyOpportunityFreshness(
  changes: readonly CanonicalChange[],
  planCreatedAt: string | null,
  planItemIds: ReadonlySet<string>,
  now: Date = new Date(),
): CanonicalChange[] {
  if (!planCreatedAt || planItemIds.size === 0) return [...changes];
  return changes.map((c) => {
    const fromPlan = c.sourceIds.some((id) => planItemIds.has(id));
    if (!fromPlan) return c;
    const result = classifyOpportunityFreshness([{ kind: "plan_batch", date: planCreatedAt }], now);
    if (result.verdict === "fresh") return c;
    return { ...c, freshness: result.verdict, agingChip: result.agingChip };
  });
}

// N49 (R21b, 2026-07-03) - CALIBRATED ABSTENTION, LIVE. The Quality Constitution's law 2:
// Beacon never presents a confident move it has no real evidence for. abstention.ts is the pure
// gate; this is its live wire-in on the ONE list the operator acts on. It runs as a FINAL filter
// AFTER dedupe/rank/freshness, and ONLY on bare `suggested` rows (a row that already earned
// `ready`/`apply`/`measuring`/`result`/`blocked` has proven itself and is never re-judged). A
// no-evidence suggestion moves to a "watching" state (removed from the confident list, surfaced as
// one honest count line) instead of being dressed as a confident move; nothing is deleted.
import { partitionByEvidence, type AbstentionEvidence } from "@/domains/recommendations/abstention";

/** N49 - reduce a CanonicalChange (+ its source TodayMove when present) to the three real-signal
 *  classes law 2 recognizes. GENEROUS by construction: any single real signal makes the row
 *  "ready" and passes it through untouched, so this NEVER holds a row that carries real evidence.
 *  Only a row with none of the three - no demand, no competitor teardown, no first-party/GSC
 *  movement - is held. PURE; exported for a direct test pin. */
export function abstentionEvidenceFor(
  c: CanonicalChange,
  move: TodayMove | undefined,
): AbstentionEvidence {
  // Demand: someone is actually searching for this topic. A sized forecast (opportunity-math
  // sized it off real impressions), a real demand number on the move, GSC top queries with
  // impressions, or a demand-first lane (keyword-library / AI-answer gap) all count.
  const hasSized = c.expectedOutcomeLow != null || (c.upside != null && c.upside > 0);
  const hasMoveDemand = (move?.demand ?? 0) > 0;
  const hasDemandQueries = (move?.topQueries ?? []).some((q) => (q.impressions ?? 0) > 0);
  const hasDemandLane = (c.sources ?? []).some(
    (s) => s === "keyword_library" || s === "aeo_gap" || /demand|keyword|search/i.test(s),
  );
  const hasDemandSignal = hasSized || hasMoveDemand || hasDemandQueries || hasDemandLane;

  // Competitor teardown: a competitor page/answer we can point at that this page does not cover.
  const hasCompetitorLane = (c.sources ?? []).some(
    (s) => s === "serp_steal" || s === "aeo_gap" || /competitor|steal/i.test(s),
  );
  const hasCompetitorTeardown =
    !!move?.competitorInformed ||
    !!move?.competitorSteal ||
    !!move?.whoCited ||
    (!!move?.yourGap && move.yourGap.trim().length > 0) ||
    hasCompetitorLane;

  // First-party behavior / GSC: this page's OWN numbers moving - a decay trend, Clarity friction,
  // GA4 engagement, an existing proof read, or a GSC-basis rank signal.
  const hasBehaviorOrGscSignal =
    (move?.declines ?? []).length > 0 ||
    !!move?.friction ||
    !!move?.ga4 ||
    !!move?.proofStatus ||
    move?.demandBasis === "gsc" ||
    hasDemandQueries;

  return { hasDemandSignal, hasCompetitorTeardown, hasBehaviorOrGscSignal };
}

/** N49 - partition the actionable list into the confident (ready) rows the operator sees and the
 *  no-evidence rows held in a watching state. ONLY bare `suggested` rows are eligible to be held;
 *  every other status (and every skipped row, kept out of this pass) rides through unchanged, in
 *  order. Returns the surviving list (confident rows + untouched non-suggested rows, original
 *  order preserved) and the held count for the honest line. PURE; exported for a direct test pin.
 *
 *  BYTE-IDENTICAL GUARANTEE: when every `suggested` row carries at least one real signal, `held`
 *  is 0 and `kept` is the input in order - the exact pre-N49 list. */
export function partitionActionableByEvidence(
  changes: readonly CanonicalChange[],
  movesById: Record<string, TodayMove>,
): { kept: CanonicalChange[]; held: CanonicalChange[]; heldCount: number } {
  // Judge ONLY bare suggestions; anything already earned (or skipped) is never re-gated.
  const judged = changes.filter((c) => c.status === "suggested");
  const passthrough = new Set(changes.filter((c) => c.status !== "suggested"));
  const { held } = partitionByEvidence(judged, (c) =>
    abstentionEvidenceFor(c, c.sourceIds[0] ? movesById[c.sourceIds[0]] : undefined),
  );
  if (held.length === 0) return { kept: [...changes], held: [], heldCount: 0 };
  const heldItems = held.map((h) => h.item);
  const heldIds = new Set(heldItems.map((h) => h.id));
  const kept = changes.filter((c) => passthrough.has(c) || !heldIds.has(c.id));
  // operator spec 2026-07-09 C-17 - the held rows are surfaced (not just counted) on the Watching
  // tab, so return the actual items alongside the count the older callers still read.
  return { kept, held: heldItems, heldCount: heldItems.length };
}

// FP3 - react.cache()'d so the FP3 lifecycle-counts loader and the page section that
// renders the list share ONE computation per request instead of building it twice.
export const loadChangesView = cache(async (): Promise<ChangesView> => {
  const tResolve = perfMark();
  const tenantId = await currentTenantId();
  perfStage("tenant-resolve", tResolve);
  // Move 3 — every source is fail-soft so one failing store can never blank the whole
  // Changes list. A plan-store outage drops the "today" slice but keeps the ranked moves;
  // a worklist outage keeps any selected plan items. The page renders with what loaded.
  const tSources = perfMark();
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
  perfStage("changes-source-read", tSources, { moves: (wl.moves ?? []).length, ledger: ledgerRows.length });
  // FP3 - THE ONE-COUNT RULE (domains/changes/lifecycle-counts.ts): the same classifier
  // Results uses for its bands, run on the same request-cached ledger rows.
  const ledgerCounts = countLedgerLifecycle(ledgerRows);
  const measuringCountCanonical = ledgerCounts.measuring;
  const decidedCountCanonical = ledgerCounts.decided;
  const plan = accepted ?? preview;

  // R20 (D6 dynamic auto-mode) - the session strip's live counter numbers, from the SAME FP3
  // lifecycle rule the Tonight chip uses. `readyCount` = tonight's picks not yet applied
  // (prepared, still waiting on the operator's edit); `shippedThisWeekCount` = changes shipped
  // in the trailing 7 days from the SAME proof ledger the counts above read. Both derived here,
  // no second store.
  const tonight = tonightCounts(accepted, preview);
  const readyCount = Math.max(0, tonight.picked - tonight.applied);
  const weekCutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  // Bug #14 - count DISTINCT operator changes, not the revert bookkeeping rows (a
  // revert_* row is not a change the operator shipped), so this session-strip counter
  // agrees with the FP3 lifecycle counts above and the Results bands.
  const shippedThisWeekCount = excludeRevertBookkeeping(ledgerRows).filter((r) => {
    const t = Date.parse(r.shippedAt);
    return Number.isFinite(t) && t >= weekCutoffMs;
  }).length;
  const moves = (wl.moves ?? []) as TodayMove[];

  // operator spec 2026-07-09 C-18 - the "I'm holding back N lower-priority ideas out of M total"
  // note is KILLED (the operator called it noise; the ranked list already caps + keeps everything
  // one click away via the "N more lower-priority ideas" expander). The only remaining named
  // suppression worth a quiet line is `heldWhileMeasuring` (moves computed but withheld because
  // their page is mid-measurement - a real, actionable reason, not list-length housekeeping).
  const heldWhileMeasuring = wl.stats?.heldWhileMeasuring ?? 0;
  let suppressedRowsNote: string | null = null;
  if (heldWhileMeasuring > 0) {
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
  const tFuse = perfMark();
  const { changes: fusedChanges } = await fuseUnifiedList(tenantId, worklistChanges).catch(() => ({ changes: worklistChanges }));
  perfStage("changes-allocator-fuse", tFuse, { fused: fusedChanges.length });

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
  const boardCleaned = dropBoardDuplicateNewPageRows(demoted, boardTopicKeys);

  // N46 (R6, 2026-07-03) - OPPORTUNITY EXPIRATION, applied AFTER dedupe/rank (never re-ranks,
  // only marks freshness + agingChip on the existing rows in place). Today's plan's own
  // createdAt is the one genuinely dated piece of evidence available at this seam.
  const planItemIds = new Set<string>([...(plan?.selected ?? []).map((e) => e.id), ...(plan?.backups ?? []).map((e) => e.id)]);
  const fresh = applyOpportunityFreshness(boardCleaned, plan?.createdAt ?? null, planItemIds);

  // N49 (R21b, 2026-07-03) - CALIBRATED ABSTENTION, LIVE (the FINAL filter, after dedupe/rank/
  // freshness). A bare suggestion with none of the three real-signal classes (demand, competitor
  // teardown, first-party/GSC movement) is moved to a watching state instead of shown as a
  // confident move. Byte-identical when every suggestion is evidenced (the common case on a
  // well-instrumented tenant): held is 0 and `changes` is exactly `fresh`.
  const abstention = partitionActionableByEvidence(fresh, movesById);
  const changes = abstention.kept;
  // operator spec 2026-07-09 C-17/C-18 - the held rows are no longer collapsed into a "N possible
  // moves are waiting for more evidence" one-liner in the list body (killed as noise). They are
  // surfaced in full on their own lower-priority "Watching" tab instead, each with the honest
  // WATCHING_SENTENCE. Nothing deleted; a held row lives in exactly one place.
  const watching = abstention.held;

  const expirySummary = summarizeExpiry(changes.map((c) => c.freshness ?? "fresh"));

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

  // R14b (receipts everywhere) - the list is ranked at request time from the demand
  // data above; when tonight's plan contributed rows, its own assembly stamp joins
  // the line so "why does this say Tuesday" never needs a support ticket.
  const nowMs = Date.now();
  const planAgo = plan?.createdAt ? checkedAgoLabel(plan.createdAt, nowMs) : null;
  const receiptLine = buildReceiptLine({
    source: "your Search Console demand data",
    checkedAt: new Date(nowMs).toISOString(),
    verb: "ranked",
    nowMs,
    note: planAgo ? `Tonight's picks were put together ${planAgo}.` : null,
  });

  perfStage("changes-assembly", tSources, { changes: changes.length, watching: watching.length });
  return {
    changes,
    movesById,
    summary,
    hasPlan: !!plan,
    planAccepted: !!accepted,
    readyZeroHint,
    measuringCountCanonical,
    decidedCountCanonical,
    suppressedRowsNote,
    expiredSubline: expirySummary.expiredSubline,
    receiptLine,
    readyCount,
    shippedThisWeekCount,
    watching,
  };
});
