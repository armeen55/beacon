import "server-only";

/**
 * GSC Proof ledger — durable store for manually-shipped changes (Phase 5, Path B).
 *
 * Mirrors `publishing-mode-store` / `mappings-store` posture EXACTLY:
 *   • Service-role admin client, tenant-scoped on every query (.eq("tenant_id", tid)).
 *   • AMBIENT tenant (currentTenantId()) — same routing as the file fallback (no
 *     explicit-tenant override → no cross-tenant desync).
 *   • FILE FALLBACK so local dev (no Supabase env) AND the pre-migration hosted
 *     window keep working: getSupabaseAdmin() throws → file; PostgREST 42P01
 *     undefined_table → file.
 *   • Fail-soft: reads return [] on any error; never throws into a surface.
 *
 * SEPARATE from the citation proof path (change_outcomes_v2) — its own table, its
 * own enums. Operator substrate (no customer surface writes here).
 */

import { cache } from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { currentTenantId } from "@/lib/tenant-context";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";
import { getDataDir } from "@/lib/tenant";
import { getTenant } from "@/domains/tenants/store";
import type {
  GscWindowMetrics,
  GscProofVerdict,
  GscProofConfidence,
  ProofMetric,
  ProofWindowResult,
  TrafficTier,
} from "./measure";
import type { WindowPlanEntry } from "./window-role";
import type { TrafficOutcome } from "./traffic-outcome";
import type { BehaviorOutcome } from "./behavior-outcome";
import type { CitationOutcome } from "./citation-outcome";
import type { RankRecheckResult } from "./rank-recheck";
import type { ChangeDollarValue } from "./change-dollar-value";
import type { PermutationRead } from "./permutation-null";
import type { BayesianRead } from "./bayesian-read";
import type { TargetQueryRead } from "./target-query-read";
import type { RankedControl } from "./control-matching";
import type { QueryPanelOutcome } from "./query-panel";
import type { WeekdayAdjustedRead } from "./weekday-baseline";
import type { EarlySignalRead } from "./early-signal";
import type { NoveltyDecayRead } from "./novelty-decay";
import type { QueryBreadthRead } from "./query-breadth";
import type { EquivalenceRead } from "./equivalence";
import type { FdrRead } from "./fdr-adjust";
import type { CleanWindowLift } from "./clean-window-salvage";
import type { VerdictRevision } from "./verdict-revisions";

const TABLE = "shipped_change_proof";
const STORE = "proof-gsc-ledger";

/**
 * Predeclaration contract (Lane P2, protocol Section 4.1). The block a change is
 * judged BY, stamped ONCE at ship time and IMMUTABLE after write. A record with a
 * non-null `predeclaredAt` is judged by the predeclaration rules (measureRecord
 * reads the stored `judgedMetric` and never recomputes it); a record WITHOUT it
 * predates the contract and is judged by legacy rules, and every surface labels it
 * so. All fields are additive/optional so a pre-migration row (missing columns ->
 * file fallback) reads as an un-predeclared legacy record.
 */

/** Frozen control set stamped at ship: ordered control URLs plus a SHA-256 over
 *  (urls, matching inputs used). May be null at ship in Lane P2 (the C4 matched-
 *  control selection lands in Lane P3); the round-trip is ready now. */
export type PredeclaredControlSet = {
  urls: string[];
  /** SHA-256 over (urls, matching inputs used) - identity the verdict is frozen against. */
  hash: string;
};

/** Pre-window baseline captured at ship (protocol 4.1). The cheap fields
 *  (clicks/impressions/ctr/position/tier) are stamped at ship from the 28 day pre
 *  window; the compute-heavier ones (dailyVariance, trendSlope, pageFamily) need
 *  the daily series and are filled by Lane P3, so they are optional here. */
export type ProofBaselineSnapshot = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  /** Length of the pre window these numbers cover, in days. */
  windowDays: number;
  trafficTier: TrafficTier;
  dailyVariance?: number | null;
  trendSlope?: number | null;
  pageFamily?: string | null;
};

export type ShippedChangeRecord = {
  /** Stable per (page, ship-date). */
  id: string;
  /** Canonical page URL. */
  page: string;
  /** Host-stripped path (display + control matching). */
  path: string;
  actionType: string;
  before: string | null;
  after: string | null;
  /** ISO timestamp the operator confirmed it shipped live. */
  shippedAt: string;
  /** GSC metrics over the pre-ship window (display snapshot). */
  baseline: GscWindowMetrics & { windowDays: number };
  targetQueries: string[];
  /** Canonical control page URLs for diff-in-diff. */
  controlPages: string[];
  windows: ProofWindowResult[];
  verdict: GscProofVerdict;
  confidence: GscProofConfidence;
  measuredAt: string | null;
  /** GA4 traffic + conversion outcome (Dollar-ROI, gap #1). COMPUTED at measure
   *  time and recomputed on every load — NOT persisted (no column; recordToRow
   *  omits it), so it stays in lockstep with live GA4 like the GSC verdict. */
  trafficOutcome?: TrafficOutcome | null;
  /** Behavior lane (BEACON_500 N4 + N17, 2026-07-03): how visitors behaved
   *  since the change (GA4 engaged share + conversions, Clarity frustration +
   *  quick-backs) plus the did-they-find-their-answer read, computed on the
   *  live_at clock (the ship date - NEVER gated on Google recrawl or GSC
   *  finalization). Same computed-only posture as trafficOutcome: NOT
   *  persisted (recordToRow omits it), recomputed on every measure. Feeds N10
   *  as a CORROBORATION-only input (a win with worse behavior demotes solid
   *  to decent); behavior alone never upgrades a verdict. Null when neither
   *  source has a post-ship day yet. */
  behaviorOutcome?: BehaviorOutcome | null;
  /** AI-citation outcome (master plan item 5): did AI answers start or stop
   *  citing this page after the ship, adjusted by the comparison pages? Same
   *  computed-only posture as trafficOutcome: NOT persisted (recordToRow
   *  omits it), recomputed on every measure. Populated ONLY for
   *  citation-relevant action types (answer block / FAQ / new page / schema). */
  citationOutcome?: CitationOutcome | null;
  /** Live-SERP rank re-check (BEACON_500 item 19): the literal Google position at
   *  ship vs the freshest cache-busted read, for whichever proof window most
   *  recently fired a re-check. Same computed-only posture as trafficOutcome and
   *  citationOutcome: NOT persisted (recordToRow omits it) - recomputed each
   *  measure pass from serp-history + a bounded, idempotent live re-check. Null
   *  when no target query is known, no window is due, or the live read failed. */
  rankOutcome?: RankRecheckResult | null;
  /** Dollar attribution for this specific shipped change (BEACON_500 item 22):
   *  the operator's own unit-economics rate (item 3) x the extra sessions or
   *  key events THIS change earned, from trafficOutcome. Same computed-only
   *  posture as trafficOutcome/citationOutcome/rankOutcome: NOT persisted
   *  (recordToRow omits it), recomputed on every measure. Null when there is
   *  no traffic outcome yet, or when no revenue model is configured (in which
   *  case the sentence still names the extra visits, in clicks only). */
  dollarValue?: ChangeDollarValue | null;
  /** Permutation-null read (master plan item 37): where the treated lift lands
   *  against every untreated page's same-window pseudo-lift (percentile 0-1,
   *  plus the raw nGreater/nTotal counts the plain-English sentence names).
   *  Same computed-only posture as trafficOutcome/citationOutcome/rankOutcome/
   *  dollarValue: NOT persisted (recordToRow omits it), recomputed on every
   *  measure. Null when fewer than MIN_NULL_PAGES untreated pages were
   *  available (honest skip, never a fabricated percentile off a thin pool). */
  permutationRead?: PermutationRead | null;
  /** Bayesian read (master plan item 67): P(this helped) plus a 90% credible
   *  interval on monthly clicks, computed from the SAME basis window's
   *  treated pre/post metrics. Same computed-only posture as
   *  trafficOutcome/citationOutcome/rankOutcome/dollarValue/permutationRead:
   *  NOT persisted (recordToRow omits it), recomputed on every measure. Never
   *  changes `verdict`/`confidence` - a pure additive quantification layer.
   *  Null for a position-judged change or before any window has closed. */
  bayesianRead?: BayesianRead | null;
  /** Per-target-query diff-in-diff (master plan item 68): CTR + position for
   *  the record's OWN targetQueries (not the page's whole query mix), treated
   *  vs comparison pages, over the same basis window. Same computed-only
   *  posture as the other attachments above: NOT persisted (recordToRow
   *  omits it), recomputed on every measure. Empty array when there are no
   *  target queries, no window has closed, or a query's data is too thin
   *  (< 50 impressions either window) - honest silence, never a fabricated
   *  read off a sliver of data. */
  targetQueryRead?: TargetQueryRead[];
  /** Fixed query panel (P4 R10a, v1 item 150): the record's OWN frozen
   *  targetQueries measured as ONE aggregate panel before/after, alongside
   *  the page-level outcome, with a plain disagreement sentence when the two
   *  point opposite ways. Same computed-only posture as the attachments
   *  above: NOT persisted (recordToRow omits it), recomputed on every
   *  measure. Null when the panel had no honest pre-ship presence. */
  panelOutcome?: QueryPanelOutcome | null;
  /** Day-of-week baselines (P4 R10a, v1 item 285): the basis window's
   *  treated-page lift re-read against same-weekday baseline MEDIANS,
   *  alongside the raw day-sum number. Presentation prefers the adjusted
   *  figure only when the two differ by more than 20 percent. Computed-only,
   *  never persisted; null without full baseline coverage or a closed window. */
  weekdayAdjustedLift?: WeekdayAdjustedRead | null;
  /** Adaptive windows (P4 R10a, v1 item 288): earlyDecisive / earlyFutile
   *  presentation flags when the post-ship days are already unambiguous.
   *  NEVER closes or shortens a window (the N11 clock is inviolable) - this
   *  is presentation language plus an N10 confidence input only. Computed
   *  only while the 28-day window is still open; never persisted. */
  earlySignal?: EarlySignalRead | null;
  /** Novelty-decay flag (P4 R10a, v1 item 378): lift peaked in week 1 and
   *  faded back toward baseline by week 4 - looks like novelty, not a
   *  lasting win. Feeds N10 as a demotion input. Computed-only, never
   *  persisted; null before 28 finalized post-ship days exist. */
  noveltyDecay?: NoveltyDecayRead | null;
  /** Distinct-query growth (P4 R10b, v1 item 151): did this page start
   *  showing up for MORE distinct searches (reach) or did the same searches
   *  click more (depth)? Equal-length windows either side of the ship, from
   *  gsc_daily_rows' page+query grain. Feeds the presentation only, never
   *  the verdict and not N10. Computed-only, never persisted; null without
   *  query-grain data or a closed window. */
  queryBreadth?: QueryBreadthRead | null;
  /** Equivalence read (P4 R10b, v1 item 289): the plausible effect range of
   *  a mature non-win sits entirely inside the too-small-to-matter band, so
   *  "did nothing" is PROVEN rather than unknown. Feeds N10 as provenNeutral
   *  (grades solid-for-learning, distinct from inconclusive). Computed-only,
   *  never persisted; null before the 28 day window closes, for a win, or
   *  when the sample is too thin to prove anything. */
  equivalence?: EquivalenceRead | null;
  /** Many-measurements caution (P4 R10b, v1 item 291): with N simultaneous
   *  mature wins, the pool-wide adjustment holds the champagne on wins too
   *  close to the by-chance line. Attached by the LEDGER pass (load-ledger
   *  .ts) - the only place all rows are in hand at once - never by
   *  measureRecord. N10 demotes an fdrCaution win from solid to decent.
   *  Computed-only, never persisted (recordToRow omits it). */
  fdrRead?: FdrRead | null;
  /** Clean-window salvage (P4 R10b, v1 item 152): when a Google update or
   *  sitewide shock muddied part of this window, the treated page's own lift
   *  re-read on the >= 10 clean days alone, so a partially-muddied read is
   *  salvaged instead of written off wholesale. Presentation only - renders
   *  under the weather caveat; the verdict, learning gates, and clocks are
   *  untouched. Computed-only, never persisted; null when no shock muddied a
   *  day or too few clean days remain. */
  cleanWindowLift?: CleanWindowLift | null;
  /** Operator free-text on the shipped change. */
  notes: string | null;
  /** Operator confirmed it's live on the site (manual ship). */
  verifiedLive: boolean;
  /** Optional URL the operator verified it live at. */
  liveSourceUrl: string | null;
  /** ISO timestamp the operator manually requested a Google recrawl/indexing. */
  recrawlRequestedAt: string | null;
  /** BEACON_500 items 33 + 36 (2026-07-02): plain-language receipt lines for any
   *  raw comparison-page candidate the matcher left out at selection time (scale
   *  mismatch, diverging pre-ship trend, or too much shared search demand with
   *  the treated page). Additive, optional (older rows never had a matcher run) -
   *  null means either no candidates were excluded or this row predates item 33.
   *  Set ONCE at selection time in auto-record-on-ship.ts; never rewritten by
   *  re-measurement. */
  controlMatchNotes?: string[] | null;
  /** BEACON_500 item 33 (2026-07-02): true when the matcher had to fall back
   *  to its best-available comparison pages because too few candidates passed
   *  the baseline-scale + pre-ship trend bands (control-matching.ts's
   *  usedFallback). Feeds measurement-maturity.ts's weakComparison input at
   *  read time so the parallel-trends veto can downgrade the presentation.
   *  Additive, optional (older rows never had a matcher run) - undefined/false
   *  reads identically to "not flagged". Set ONCE at selection time; never
   *  rewritten by re-measurement. */
  controlMatchWeak?: boolean;
  /** BEACON_500 N13 (2026-07-03): the FULL ranked comparison-page candidate
   *  list (control-matching.ts's RankedControl[] - kept AND excluded, in
   *  original candidate order, with the matching inputs that produced each
   *  verdict) frozen at THIS ship's selection time. This is the ONLY pool a
   *  later contamination-driven promotion may draw from (control-
   *  contamination.ts's promoteFromFrozenPool) - it is NEVER re-ranked with
   *  post-ship data, because choosing a replacement using information that
   *  arrived after the ship would bias the verdict toward whatever outcome
   *  the replacement happened to show. Null for older rows that predate N13
   *  (no frozen pool exists) or when the matcher itself failed at selection
   *  time (the top-3-by-demand fallback has nothing ranked to freeze). Set
   *  ONCE at selection time; never rewritten by re-measurement. */
  controlDonorPool?: RankedControl[] | null;
  /** R14a (2026-07-03): APPEND-ONLY trail of verdict CHANGES. Written at the
   *  measureRecord seam ONLY when a re-measurement actually changed the stored
   *  verdict (won -> inconclusive, measuring -> won); the first measurement is
   *  an announcement, not a revision, and past entries are NEVER rewritten.
   *  This is the one field that makes a rewritten verdict honest: /results
   *  renders it in the card expand and the "We got this wrong" recap reads it.
   *  Additive, optional - null on rows that never flipped. PERSISTED (unlike
   *  the computed attachments above) because it is history, not a recompute. */
  verdictRevisions?: VerdictRevision[] | null;
  /** Operator override that PINS the learning verdict to "inconclusive",
   *  excluding this change from the per-action_type outcome prior that steers
   *  recommendation ranking. Use when a measured "won"/"lost" is mis-attributed
   *  (control contamination / seasonal co-movement) and would otherwise skew
   *  the prior. Survives re-measurement (applied in measureRecord). null = the
   *  measured verdict stands. */
  operatorVerdictOverride: "inconclusive" | null;
  /** J-73/C-25 (2026-07-09): structured proposal-vs-live diff from the
   *  crawl-based auto-verify pass (verify-shipped-change.ts). The ORIGINAL
   *  proposal is NEVER overwritten by this - `after` above stays exactly what
   *  Beacon proposed; `liveText` here is a SEPARATE field holding whatever the
   *  crawl actually found on the page. Null before the first verify pass runs,
   *  when the crawl failed (nothing to diff), or on a row that predates
   *  J-73/C-25. */
  editDiff?: EditDiffRecord | null;
  /** J-73/C-25 (2026-07-09): the crawl-verify pass's verdict, stored as a
   *  `VerifyEnvelope` (W5 stop-ship F5) that separates the LATCHED canonical
   *  success from mutable retry bookkeeping. This REPLACES the honor-system
   *  `verifiedLive` flag as the source of truth for "did the operator's edit
   *  actually ship" - only a verified_live outcome ever flips `verifiedLive`
   *  true (set atomically by `markVerifyResultById`). Read via `canonicalOutcome`
   *  / `retryEligibility`. Legacy flat rows are normalized to an envelope on
   *  read. Null before the first verify pass runs, or on a row that predates
   *  J-73/C-25. */
  verifyState?: VerifyEnvelope | null;
  /** 2026-07-11 quarantine: the classifier version that produced this row's
   *  verdict, or null when it was measured under the pre-self-test thresholds
   *  (every existing row). null = UNCALIBRATED by definition, and
   *  isCalibratedVerdict (verdict-calibration.ts) fails closed on it, so no
   *  uncalibrated won/lost is shown as a trustworthy win/loss, ranks anything,
   *  or trains a learner. run-measurement.ts NEVER stamps this (measurements
   *  still run under the old thresholds); only the future corrected classifier
   *  may write a registered version here. Additive, optional - a missing column
   *  reads as null (fail-closed) via the file fallback. */
  calibrationVersion: string | null;
  /** Predeclaration contract (Lane P2, protocol Section 4.1). Stamped ONCE at
   *  ship, immutable after write. ADDITIVE + optional, matching the posture of
   *  the other recent persisted additive fields on this record (controlMatchNotes,
   *  controlDonorPool, verdictRevisions, editDiff, verifyState): a record that
   *  never went through the contract simply has these undefined, which reads
   *  identically to a legacy row (no predeclaredAt = judged by legacy rules).
   *  `judgedMetric` is the metric this change is judged on, computed once from
   *  actionType at ship - measureRecord READS this when `predeclaredAt` is set and
   *  NEVER recomputes via pickProofMetric. */
  judgedMetric?: ProofMetric | null;
  /** +1 or -1: the direction of the judged metric that counts as success (a title
   *  rewrite expects +, a consolidation may expect - on the donor page). */
  expectedDirection?: 1 | -1 | null;
  /** The single window whose close decides the verdict (28). */
  primaryWindowDays?: number | null;
  /** The full ordered window plan, each labeled primary / context / demote_only
   *  (protocol 4.2: 7 context, 14 context, 28 primary, 56 demote_only, 84 context). */
  windowPlan?: WindowPlanEntry[] | null;
  /** Frozen control set (ordered URLs + hash). May be null at ship in Lane P2
   *  (C4 matched-control selection lands in Lane P3); the round-trip is ready. */
  controlSetIds?: PredeclaredControlSet | null;
  /** Predeclared backup controls for contamination replacement (protocol L4b).
   *  May be null at ship in Lane P2 (see controlSetIds). */
  controlAlternates?: string[] | null;
  /** Hash of the frozen thresholds artifact this change was predeclared against
   *  (protocol Section 5 step 2). Distinct from calibrationVersion (stamped at
   *  measure time by the corrected classifier). */
  classifierVersionPredeclared?: string | null;
  /** Pre-window baseline captured at ship. */
  baselineSnapshot?: ProofBaselineSnapshot | null;
  /** ISO timestamp the predeclaration block was stamped. A record MISSING this is
   *  judged by legacy rules; its presence is the switch measureRecord reads. */
  predeclaredAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * J-73/C-25 (2026-07-09) - the crawl-verify pass's outcome. Mirrors the
 * existing `MatchResult` (outcome + kind) idiom in
 * `recommendations/match-engine/types.ts` (read-only, never imported here -
 * that file's `MatchOutcome` has no `crawl_failed` case, so this is a
 * deliberately separate, smaller union scoped to the manual-ship crawl path).
 *
 * Exactly six reachable states (verify-shipped-change.ts's `classify`):
 *   - { outcome: "verified_live", kind: "exact" }     - normalized text match.
 *   - { outcome: "verified_live", kind: "modified" }  - similarity >= the
 *     per-action "modified" threshold AND the claim/entity tokens (numbers,
 *     names) are all still present - an honest paraphrase, still counts live.
 *   - { outcome: "verified_live_modified", kind: null } - similarity >=
 *     "modified" but a claim/entity token changed - the operator shipped
 *     something, just not exactly the proposal.
 *   - { outcome: "not_found", kind: null } - below the "medium" threshold on
 *     a GOOD crawl. NEVER marks shipped.
 *   - { outcome: "needs_review", kind: null } - either a medium-confidence
 *     match (below "modified", at/above "medium") or top-2 candidates BOTH
 *     clearing "modified" (ambiguous - Beacon can't tell which one is right).
 *     Held for operator review; NEVER auto-marked live.
 *   - { outcome: "crawl_failed", kind: null } - the fetch failed/timed out, a
 *     tenant-domain mismatch blocked the crawl, or there was nothing to
 *     verify against. The record is left un-verified (amber staleness on the
 *     surface, never a silent "verified").
 */
export type VerifyOutcome =
  | "verified_live"
  | "verified_live_modified"
  | "not_found"
  | "needs_review"
  | "crawl_failed";

export type VerifyKind = "exact" | "modified" | null;

export type VerifyState = {
  outcome: VerifyOutcome;
  /** Meaningful only when `outcome === "verified_live"`; null otherwise. */
  kind: VerifyKind;
};

/**
 * W5 stop-ship F5 (2026-07-09) - the persisted `verify_state` shape. The flat
 * `VerifyState` above is what `classify` PRODUCES for one pass; the envelope is
 * what the LEDGER STORES, so a transient failure can never clobber a proven
 * live verification and retries are fair (backoff + a permanent exhausted
 * state). Separation of concerns:
 *   - `canonical` is the LATCHED verdict. ONLY a verified_live /
 *     verified_live_modified success ever lands here, and no failure ever
 *     overwrites it (enforced by a CAS guard + a read-side no-op).
 *   - the rest is mutable retry bookkeeping driven by transient failures
 *     (crawl_failed / not_found / needs_review): attempt count, the last
 *     attempt, the next-eligible-retry time, and a permanent exhausted flag.
 * Legacy flat rows are normalized to this on read (normalizeVerifyEnvelope).
 */
export type VerifyAttempt = {
  /** The non-success verdict of this attempt (never a canonical success). */
  state: "crawl_failed" | "not_found" | "needs_review";
  /** ISO timestamp the attempt ran ("" for a normalized legacy row). */
  at: string;
  /** Optional short failure detail (host + reason only, never a body). */
  error?: string;
  /** Optional best-candidate similarity from the attempt's editDiff. */
  similarity?: number;
};

export type VerifyEnvelope = {
  /** The latched success verdict, or null while unproven. ONLY ever a
   *  verified_live / verified_live_modified VerifyState. */
  canonical: VerifyState | null;
  /** ISO timestamp the canonical success was latched, or null. */
  canonicalAt: string | null;
  /** The most recent non-success attempt, or null. */
  lastAttempt: VerifyAttempt | null;
  /** Consecutive non-success attempts since the last reset / success. */
  attempts: number;
  /** ISO timestamp the next retry becomes eligible, or null (now / exhausted). */
  nextRetryAt: string | null;
  /** True once attempts hit MAX_VERIFY_ATTEMPTS - permanently off the retry list. */
  exhausted: boolean;
};

/** Attempts before a row is permanently excluded from auto-retry (F6). */
export const MAX_VERIFY_ATTEMPTS = 5;
const VERIFY_BACKOFF_BASE_MS = 6 * 60 * 60 * 1000; // 6h
const VERIFY_BACKOFF_CAP_MS = 7 * 24 * 60 * 60 * 1000; // 7d

/** Exponential retry backoff: 6h * 2^(n-1), capped at 7 days. */
export function verifyBackoffMs(attempt: number): number {
  if (attempt <= 1) return VERIFY_BACKOFF_BASE_MS;
  return Math.min(VERIFY_BACKOFF_BASE_MS * 2 ** (attempt - 1), VERIFY_BACKOFF_CAP_MS);
}

function addMsIso(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function isCanonicalSuccessOutcome(o: string | null | undefined): boolean {
  return o === "verified_live" || o === "verified_live_modified";
}

/** J-73 (2026-07-09) - one field's proposal-vs-live comparison, captured by
 *  the crawl-verify pass. `proposedAfter` is a COPY of `after` at the moment
 *  the crawl ran (never the field that gets overwritten); `liveText` is
 *  whatever the crawl found in that same spot (empty string when the crawl
 *  succeeded but found nothing there at all). */
export type EditDiffRecord = {
  /** Which page element the diff covers, e.g. "title", "h1", "passage[2]". */
  field: string;
  /** The operator's original proposed text, copied at capture time. */
  proposedAfter: string;
  /** The text the crawl actually found live at `field`. */
  liveText: string;
  /** [0,1] similarity between `proposedAfter` and `liveText`, normalized. */
  similarity: number;
  /** Human-readable outcome label - mirrors `VerifyState.outcome`. */
  verdict: string;
  /** ISO timestamp the crawl ran. */
  capturedAt: string;
};

type LedgerRow = {
  tenant_id: string;
  id: string;
  page: string;
  path: string;
  action_type: string;
  before_text: string | null;
  after_text: string | null;
  shipped_at: string;
  baseline: ShippedChangeRecord["baseline"];
  target_queries: string[];
  control_pages: string[];
  windows: ProofWindowResult[];
  verdict: string;
  confidence: string;
  measured_at: string | null;
  notes: string | null;
  verified_live: boolean;
  live_source_url: string | null;
  recrawl_requested_at: string | null;
  /** Additive column (migration 2026-06-23). Optional in the row type so the
   *  store keeps working before the migration is applied. recordToRow emits it
   *  UNCONDITIONALLY (audit-9) — incl. null — so the operator-clearable override
   *  round-trips ("Include again" → null actually clears it post-migration); a
   *  missing column on read/write is tolerated by isUndefinedTableError
   *  (PGRST204) → file fallback. */
  operator_verdict_override?: "inconclusive" | null;
  /** BEACON_500 items 33 + 36 additive column. Optional in the row type (same
   *  posture as operator_verdict_override) so a pre-migration environment keeps
   *  working — a missing column trips PGRST204 -> isUndefinedTableError ->
   *  file fallback, which round-trips this field with no schema at all. */
  control_match_notes?: string[] | null;
  /** Additive column, same posture as control_match_notes. */
  control_match_weak?: boolean | null;
  /** N13 additive column, same posture as control_match_notes/control_match_weak
   *  - a missing column trips PGRST204 -> isUndefinedTableError -> file
   *  fallback, which round-trips this field with no schema at all. */
  control_donor_pool?: RankedControl[] | null;
  /** R14a additive column, same posture as control_donor_pool: pre-migration a
   *  missing column trips PGRST204 -> full-record file fallback, which
   *  round-trips this field with no schema at all. */
  verdict_revisions?: VerdictRevision[] | null;
  /** J-73/C-25 additive column (migration 2026-07-09_shipped_change_verify_
   *  columns.sql), same posture as verdict_revisions: pre-migration a missing
   *  column trips PGRST204 -> full-record file fallback, which round-trips
   *  this field with no schema at all. */
  edit_diff?: EditDiffRecord | null;
  /** J-73/C-25 additive column, same posture as edit_diff. Stores a
   *  `VerifyEnvelope` (W5 stop-ship F5); legacy rows may still hold a flat
   *  `VerifyState`, normalized on read. */
  verify_state?: VerifyEnvelope | VerifyState | null;
  /** 2026-07-11 quarantine additive column (migration 2026-07-12_verdict_
   *  calibration_version.sql), same posture as verify_state/verdict_revisions:
   *  pre-migration a missing column trips PGRST204 -> isUndefinedTableError ->
   *  full-record file fallback, which round-trips this field with no schema at
   *  all. null = uncalibrated by definition (no default, no backfill). */
  calibration_version?: string | null;
  /** Predeclaration contract additive columns (migration 2026-07-13_proof_
   *  predeclaration.sql), same posture as calibration_version: pre-migration a
   *  missing column trips PGRST204 -> isUndefinedTableError -> full-record file
   *  fallback, which round-trips these fields with no schema at all. All nullable,
   *  no default, no backfill (a null predeclared_at = a legacy row). */
  judged_metric?: string | null;
  expected_direction?: number | null;
  primary_window_days?: number | null;
  window_plan?: WindowPlanEntry[] | null;
  control_set_ids?: PredeclaredControlSet | null;
  control_alternates?: string[] | null;
  classifier_version_predeclared?: string | null;
  baseline_snapshot?: ProofBaselineSnapshot | null;
  predeclared_at?: string | null;
  created_at: string;
  updated_at: string;
};

function isUndefinedTableError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  // Raw Postgres reports 42P01 (undefined table); PostgREST (the supabase-js path)
  // reports PGRST205 ("Could not find the table … in the schema cache") and PGRST204
  // ("Could not find the 'x' column … in the schema cache") when an additive-column
  // migration hasn't been applied yet. Catch all so the file fallback engages and
  // additive-column migrations stay deploy-order-independent like the table itself.
  if (
    typeof e.code === "string" &&
    (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204")
  ) {
    return true;
  }
  return (
    typeof e.message === "string" &&
    /schema cache|could not find the (table|.*column)/i.test(e.message)
  );
}

const VALID_VERDICTS: ReadonlySet<string> = new Set([
  "measuring",
  "won",
  "lost",
  "inconclusive",
  "insufficient_data",
]);
const VALID_CONFIDENCES: ReadonlySet<string> = new Set(["high", "medium", "low"]);
const VALID_METRICS: ReadonlySet<string> = new Set(["clicks", "ctr", "position"]);
const VALID_WINDOW_ROLES: ReadonlySet<string> = new Set(["context", "primary", "demote_only"]);
/** Fallback so a legacy/partial row without a baseline can't crash a render. */
const ZERO_BASELINE: ShippedChangeRecord["baseline"] = {
  clicks: 0,
  impressions: 0,
  ctr: 0,
  position: 0,
  windowDays: 28,
};

const VALID_VERIFY_OUTCOMES: ReadonlySet<string> = new Set([
  "verified_live",
  "verified_live_modified",
  "not_found",
  "needs_review",
  "crawl_failed",
]);

/** True for a well-formed persisted `VerifyEnvelope` (W5 stop-ship F5). The
 *  discriminating keys (`canonical` + numeric `attempts` + boolean `exhausted`)
 *  separate it from a legacy flat `{outcome,kind}` value. */
export function isValidVerifyEnvelope(v: unknown): v is VerifyEnvelope {
  if (v == null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!("canonical" in o) || typeof o.attempts !== "number" || typeof o.exhausted !== "boolean") return false;
  if (o.canonical !== null) {
    if (o.canonical == null || typeof o.canonical !== "object") return false;
    const c = o.canonical as { outcome?: unknown; kind?: unknown };
    if (typeof c.outcome !== "string" || !isCanonicalSuccessOutcome(c.outcome)) return false;
    if (!(c.kind === "exact" || c.kind === "modified" || c.kind === null || c.kind === undefined)) return false;
  }
  return true;
}

/** True for a legacy flat `{outcome,kind}` value (pre-F5), distinguished from an
 *  envelope by having `outcome` and NONE of the envelope-only keys. */
function isLegacyFlatVerifyState(v: unknown): v is VerifyState {
  if (v == null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if ("canonical" in o || "attempts" in o || "exhausted" in o) return false;
  if (typeof o.outcome !== "string" || !VALID_VERIFY_OUTCOMES.has(o.outcome)) return false;
  return o.kind === "exact" || o.kind === "modified" || o.kind === null || o.kind === undefined;
}

/**
 * W5 stop-ship F5: coerce a persisted `verify_state` value (an envelope, a
 * legacy flat VerifyState, or garbage) into a clean `VerifyEnvelope`, or null.
 * Legacy normalization: a flat SUCCESS becomes a latched canonical; a flat
 * non-success becomes one recorded attempt (attempts:1). Never throws.
 */
export function normalizeVerifyEnvelope(v: unknown): VerifyEnvelope | null {
  if (isValidVerifyEnvelope(v)) {
    const o = v as VerifyEnvelope;
    return {
      canonical: o.canonical ?? null,
      canonicalAt: typeof o.canonicalAt === "string" ? o.canonicalAt : null,
      lastAttempt:
        o.lastAttempt && typeof o.lastAttempt === "object" ? (o.lastAttempt as VerifyAttempt) : null,
      attempts: Number.isFinite(o.attempts) ? o.attempts : 0,
      nextRetryAt: typeof o.nextRetryAt === "string" ? o.nextRetryAt : null,
      exhausted: o.exhausted === true,
    };
  }
  if (isLegacyFlatVerifyState(v)) {
    const flat = v as VerifyState;
    if (isCanonicalSuccessOutcome(flat.outcome)) {
      return {
        canonical: { outcome: flat.outcome, kind: flat.kind ?? null },
        canonicalAt: null,
        lastAttempt: null,
        attempts: 0,
        nextRetryAt: null,
        exhausted: false,
      };
    }
    return {
      canonical: null,
      canonicalAt: null,
      lastAttempt: { state: flat.outcome as VerifyAttempt["state"], at: "" },
      attempts: 1,
      nextRetryAt: null,
      exhausted: false,
    };
  }
  return null;
}

/** The latched canonical success outcome, or null. Accepts an envelope, a
 *  legacy flat value, or null (normalized internally). This is the ONLY read
 *  the two consumers (auto-measure-on-use, auto-record-on-ship) use to ask
 *  "is this change proven live?". */
export function canonicalOutcome(
  v: VerifyEnvelope | VerifyState | null | undefined,
): VerifyOutcome | null {
  if (v == null) return null;
  return normalizeVerifyEnvelope(v)?.canonical?.outcome ?? null;
}

/** True when a row is eligible for an auto re-verify at `nowIso`: not a latched
 *  canonical success, not exhausted, and past its backoff (or never scheduled). */
export function retryEligibility(
  v: VerifyEnvelope | VerifyState | null | undefined,
  nowIso: string,
): boolean {
  const env = normalizeVerifyEnvelope(v);
  if (env == null) return true; // never verified -> eligible
  if (isCanonicalSuccessOutcome(env.canonical?.outcome)) return false;
  if (env.exhausted) return false;
  if (env.nextRetryAt == null) return true;
  return env.nextRetryAt <= nowIso;
}

/** The last-attempt timestamp used to sort the retry queue oldest-first; a
 *  never-attempted row sorts first (""). */
export function verifyLastAttemptAt(v: VerifyEnvelope | VerifyState | null | undefined): string {
  return normalizeVerifyEnvelope(v)?.lastAttempt?.at ?? "";
}

/** Guards a read row's `edit_diff` JSON against a malformed/legacy value
 *  before it's trusted as an `EditDiffRecord`. */
function isValidEditDiff(v: unknown): v is EditDiffRecord {
  if (v == null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.field === "string" &&
    typeof o.proposedAfter === "string" &&
    typeof o.liveText === "string" &&
    typeof o.similarity === "number" &&
    typeof o.verdict === "string" &&
    typeof o.capturedAt === "string"
  );
}

/** Read-guard the predeclared judged metric; anything not a known ProofMetric
 *  reads as null (an un-predeclared row), never a fabricated metric. */
function coerceJudgedMetric(v: unknown): ProofMetric | null {
  return typeof v === "string" && VALID_METRICS.has(v) ? (v as ProofMetric) : null;
}

/** Read-guard the expected direction to exactly +1 or -1; anything else -> null. */
function coerceExpectedDirection(v: unknown): 1 | -1 | null {
  return v === 1 ? 1 : v === -1 ? -1 : null;
}

/** Guards a read row's `window_plan` JSON: an array of {day:number, role:WindowRole}. */
function coerceWindowPlan(v: unknown): WindowPlanEntry[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: WindowPlanEntry[] = [];
  for (const e of v) {
    if (e == null || typeof e !== "object") return null;
    const o = e as { day?: unknown; role?: unknown };
    if (typeof o.day !== "number" || typeof o.role !== "string" || !VALID_WINDOW_ROLES.has(o.role)) {
      return null;
    }
    out.push({ day: o.day as WindowPlanEntry["day"], role: o.role as WindowPlanEntry["role"] });
  }
  return out;
}

/** Guards a read row's `control_set_ids` JSON against a malformed value. */
function coerceControlSet(v: unknown): PredeclaredControlSet | null {
  if (v == null || typeof v !== "object") return null;
  const o = v as { urls?: unknown; hash?: unknown };
  if (!Array.isArray(o.urls) || typeof o.hash !== "string") return null;
  return { urls: o.urls.map((u) => String(u)), hash: o.hash };
}

/** Guards a read row's `baseline_snapshot` JSON against a malformed value. */
function coerceBaselineSnapshot(v: unknown): ProofBaselineSnapshot | null {
  if (v == null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.clicks !== "number" ||
    typeof o.impressions !== "number" ||
    typeof o.ctr !== "number" ||
    typeof o.position !== "number" ||
    typeof o.windowDays !== "number" ||
    typeof o.trafficTier !== "string"
  ) {
    return null;
  }
  return {
    clicks: o.clicks,
    impressions: o.impressions,
    ctr: o.ctr,
    position: o.position,
    windowDays: o.windowDays,
    trafficTier: o.trafficTier as TrafficTier,
    dailyVariance: typeof o.dailyVariance === "number" ? o.dailyVariance : null,
    trendSlope: typeof o.trendSlope === "number" ? o.trendSlope : null,
    pageFamily: typeof o.pageFamily === "string" ? o.pageFamily : null,
  };
}

export function recordToRow(tid: string, r: ShippedChangeRecord): LedgerRow {
  return {
    tenant_id: tid,
    id: r.id,
    page: r.page,
    path: r.path,
    action_type: r.actionType,
    before_text: r.before,
    after_text: r.after,
    shipped_at: r.shippedAt,
    baseline: r.baseline,
    target_queries: r.targetQueries,
    control_pages: r.controlPages,
    windows: r.windows,
    verdict: r.verdict,
    confidence: r.confidence,
    measured_at: r.measuredAt,
    notes: r.notes,
    verified_live: r.verifiedLive,
    live_source_url: r.liveSourceUrl,
    recrawl_requested_at: r.recrawlRequestedAt,
    // audit-9: emit UNCONDITIONALLY (like every other nullable column) so a null
    // round-trips. The override is operator-CLEARABLE ("Include again" sets it
    // null) — a conditional emit omitted the column on re-include, and a Supabase
    // upsert leaves omitted columns at their existing value, so the exclusion
    // stuck forever post-migration. Pre-migration the null emit still trips
    // PGRST204 → isUndefinedTableError routes to the full-record file fallback
    // (which clears it correctly), so this is safe before AND after the migration.
    operator_verdict_override: r.operatorVerdictOverride,
    // Additive, write-once at selection time (never operator-cleared like the
    // override above) — emit unconditionally so a null still overwrites a stale
    // value on re-record, same round-trip safety as every other nullable column.
    control_match_notes: r.controlMatchNotes ?? null,
    control_match_weak: r.controlMatchWeak ?? false,
    // N13, write-once at selection time (never rewritten by re-measurement or
    // by the read-time contamination check) - emit unconditionally so a null
    // still overwrites a stale value, same round-trip safety as every other
    // nullable column here.
    control_donor_pool: r.controlDonorPool ?? null,
    // R14a, APPEND-ONLY history written by the measureRecord seam - emit
    // unconditionally so a null still overwrites a stale value, same
    // round-trip safety as every other nullable column here.
    verdict_revisions: r.verdictRevisions ?? null,
    // J-73/C-25, written by the crawl-verify pass (markVerifyResultById) -
    // emit unconditionally, same round-trip safety as every other nullable
    // column here.
    edit_diff: r.editDiff ?? null,
    verify_state: r.verifyState ?? null,
    // 2026-07-11 quarantine, write-through of the (today always null) version -
    // emit unconditionally so a null still overwrites a stale value, same
    // round-trip safety as every other nullable column here. run-measurement.ts
    // never sets this; only the future corrected classifier may.
    calibration_version: r.calibrationVersion ?? null,
    // Predeclaration contract (Lane P2), stamped once at ship and immutable
    // after - emit unconditionally so a null still overwrites a stale value,
    // same round-trip safety as every other nullable column here.
    judged_metric: r.judgedMetric ?? null,
    expected_direction: r.expectedDirection ?? null,
    primary_window_days: r.primaryWindowDays ?? null,
    window_plan: r.windowPlan ?? null,
    control_set_ids: r.controlSetIds ?? null,
    control_alternates: r.controlAlternates ?? null,
    classifier_version_predeclared: r.classifierVersionPredeclared ?? null,
    baseline_snapshot: r.baselineSnapshot ?? null,
    predeclared_at: r.predeclaredAt ?? null,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

export function rowToRecord(row: LedgerRow): ShippedChangeRecord {
  return {
    id: row.id,
    page: row.page,
    path: row.path,
    actionType: row.action_type,
    before: row.before_text ?? null,
    after: row.after_text ?? null,
    shippedAt: row.shipped_at,
    baseline: row.baseline ?? ZERO_BASELINE,
    targetQueries: row.target_queries ?? [],
    controlPages: row.control_pages ?? [],
    windows: row.windows ?? [],
    verdict: (VALID_VERDICTS.has(row.verdict) ? row.verdict : "inconclusive") as GscProofVerdict,
    confidence: (VALID_CONFIDENCES.has(row.confidence)
      ? row.confidence
      : "low") as GscProofConfidence,
    measuredAt: row.measured_at ?? null,
    notes: row.notes ?? null,
    verifiedLive: row.verified_live ?? false,
    liveSourceUrl: row.live_source_url ?? null,
    recrawlRequestedAt: row.recrawl_requested_at ?? null,
    operatorVerdictOverride:
      row.operator_verdict_override === "inconclusive" ? "inconclusive" : null,
    controlMatchNotes: Array.isArray(row.control_match_notes) && row.control_match_notes.length > 0
      ? row.control_match_notes
      : null,
    controlMatchWeak: row.control_match_weak === true,
    controlDonorPool: Array.isArray(row.control_donor_pool) && row.control_donor_pool.length > 0
      ? row.control_donor_pool
      : null,
    verdictRevisions: Array.isArray(row.verdict_revisions) && row.verdict_revisions.length > 0
      ? row.verdict_revisions
      : null,
    editDiff: isValidEditDiff(row.edit_diff) ? row.edit_diff : null,
    // W5 stop-ship F5: normalize an envelope OR a legacy flat value on read; a
    // malformed blob normalizes to null (never crashes a render).
    verifyState: normalizeVerifyEnvelope(row.verify_state),
    // 2026-07-11 quarantine: a non-string (null / absent column / garbage) reads
    // as null -> uncalibrated -> fail-closed. Never trusts a malformed value.
    calibrationVersion:
      typeof row.calibration_version === "string" ? row.calibration_version : null,
    // Predeclaration contract (Lane P2): every field read through a guard so a
    // malformed / absent column reads as null (an un-predeclared legacy row),
    // never a fabricated value. predeclaredAt is the switch measureRecord reads.
    judgedMetric: coerceJudgedMetric(row.judged_metric),
    expectedDirection: coerceExpectedDirection(row.expected_direction),
    primaryWindowDays:
      typeof row.primary_window_days === "number" ? row.primary_window_days : null,
    windowPlan: coerceWindowPlan(row.window_plan),
    controlSetIds: coerceControlSet(row.control_set_ids),
    controlAlternates: Array.isArray(row.control_alternates)
      ? row.control_alternates.map((u) => String(u))
      : null,
    classifierVersionPredeclared:
      typeof row.classifier_version_predeclared === "string"
        ? row.classifier_version_predeclared
        : null,
    baselineSnapshot: coerceBaselineSnapshot(row.baseline_snapshot),
    predeclaredAt: typeof row.predeclared_at === "string" ? row.predeclared_at : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readFile(): Promise<ShippedChangeRecord[]> {
  try {
    return (await readStore<ShippedChangeRecord>(STORE)) ?? [];
  } catch (err) {
    log.warn("shipped-change-store: file ledger read failed; treating as empty", {
      store: STORE,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

async function writeFile(records: ShippedChangeRecord[]): Promise<void> {
  await writeStore<ShippedChangeRecord>(STORE, records);
}

/**
 * Codex P2 (2026-07-09): resolve the on-disk slug for an EXPLICIT tenantId,
 * mirroring `resolveSlugForTenant` in tenant-repo.ts. Registry first; then the
 * operator-bootstrap env match (BEACON_TENANT_ID + BEACON_TENANT_SLUG) ONLY when
 * the explicit tenantId is that same bootstrap tenant. Any other unresolved
 * tenant returns null so the caller FAILS CLOSED (empty ledger) - it NEVER falls
 * back to the ambient/flat founder `.data/` directory.
 */
async function resolveSlugForTenant(tenantId: string): Promise<string | null> {
  const tenant = await getTenant(tenantId);
  if (tenant) return tenant.slug;
  const envId = process.env.BEACON_TENANT_ID;
  const envSlug = process.env.BEACON_TENANT_SLUG;
  if (envId && envSlug && envId === tenantId) return envSlug;
  return null;
}

/**
 * Codex P2 (2026-07-09): tenant-EXPLICIT file fallback for the proof ledger,
 * mirroring `readProfoundImportRunsForTenant` in tenant-repo.ts. Reads
 * `.data/tenants/{slug}/proof-gsc-ledger.json` DIRECTLY (getDataDir(slug) +
 * readFileSync) after resolving the slug from the explicit tenantId - it NEVER
 * calls `readStore(STORE)`, which routes through the AMBIENT `currentTenantSlug()`
 * and would silently ignore the explicit arg (the founder-leak this fixes: the
 * passive re-verify loop runs in next/after() OUTSIDE the render's tenant scope,
 * where the ambient slug resolves to the founder/empty tenant). Fail-soft -> [].
 */
async function readShippedChangesFileForTenant(tenantId: string): Promise<ShippedChangeRecord[]> {
  const slug = await resolveSlugForTenant(tenantId);
  if (slug == null) return []; // unresolved tenant -> fail closed, never the founder file
  const filePath = join(getDataDir(slug), `${STORE}.json`);
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    return Array.isArray(parsed) ? (parsed as ShippedChangeRecord[]) : [];
  } catch (err) {
    log.warn("shipped-change-store: tenant ledger file unreadable/corrupt; treating as empty", {
      tenant: tenantId,
      store: STORE,
      file: filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** All shipped-change records for the ambient tenant, newest ship first. Fail-soft → []. */
/**
 * R23 P17 (2026-07-03, read-path perf): request-cached ledger read.
 *
 * `loadShippedChanges` is the hottest read on the /changes and cockpit paths: a
 * single /changes render reads it FIVE times in one request (four learners inside
 * the demand-graph build, win-rate prior + effect-size prior + page-outcome
 * caution + dismissal do-not-repeat, plus the ActionPack's daily-experiment
 * gate), and the cockpit reads it again from the scoreboard, the stand-up, and
 * the moves loader. Each call is a real `SELECT * FROM shipped_change_proof`
 * round-trip on hosted Supabase (no `readStore` in-process cache; that only
 * backs the file fallback).
 *
 * Wrapping the read in `react.cache` collapses ALL same-request reads to ONE
 * query (identical to the ga4-page-values / clarity-page-signals / fanout-seeds
 * caches already in this codebase). BEHAVIOR-PRESERVING: `react.cache` is scoped
 * to a single React request/render, so every caller in one render sees the exact
 * same rows it would have read alone (identical output, byte for byte); it just
 * skips the redundant network reads. Outside a request scope (crons, scripts,
 * tests) `cache()` degrades to a plain passthrough, so the nightly measurement
 * loops keep reading live.
 *
 * SAFE against mutations: audited every writer, and no code path does
 * read, then upsert, then read-fresh WITHIN one request expecting the new value;
 * every server action reads once, upserts, then `revalidatePath()` (which starts
 * a fresh request with a fresh cache). The measurement/revert loops that upsert
 * many rows run in cron scope where the cache is a no-op.
 */
export const loadShippedChanges = cache(loadShippedChangesUncached);

async function loadShippedChangesUncached(): Promise<ShippedChangeRecord[]> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return sortNewest(await readFile()); // no env → file
  }
  let tid: string;
  try {
    tid = await currentTenantId();
  } catch (err) {
    // Sibling read-error branch in queryTenantLedger (:~1029) logs; this one
    // silently blanked the ledger when the tenant could not be resolved.
    log.warn("shipped-change-store: tenant resolve failed; ledger reads as empty", {
      store: STORE,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  return queryTenantLedger(admin, tid);
}

/**
 * W5 stop-ship F3 (2026-07-09): tenant-EXPLICIT ledger read - the SAME query
 * loadShippedChanges runs, but for a caller-supplied tenant instead of the
 * ambient `currentTenantId()`. Used by the passive re-verify loop, which fires
 * in next/after() OUTSIDE the render's tenant scope: reading via the ambient
 * tenant there could resolve the wrong (or an empty) tenant and re-verify /
 * write the wrong ledger. Deliberately NOT react.cache'd (after() runs outside
 * a request scope, where cache() is a no-op anyway). Fail-soft -> [].
 */
export async function loadShippedChangesForTenant(tenantId: string): Promise<ShippedChangeRecord[]> {
  if (!tenantId) return [];
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    // Codex P2: no env -> tenant-EXPLICIT file read, never the ambient founder file.
    return sortNewest(await readShippedChangesFileForTenant(tenantId));
  }
  // Codex P2: on an undefined-table fallback, read the EXPLICIT tenant's file too.
  return queryTenantLedger(admin, tenantId, () => readShippedChangesFileForTenant(tenantId));
}

async function queryTenantLedger(
  admin: ReturnType<typeof getSupabaseAdmin>,
  tid: string,
  fallback: () => Promise<ShippedChangeRecord[]> = readFile,
): Promise<ShippedChangeRecord[]> {
  const { data, error } = await admin.from(TABLE).select("*").eq("tenant_id", tid);
  if (error != null) {
    if (isUndefinedTableError(error)) return sortNewest(await fallback());
    console.error(
      `[shipped-change-store] read failed for ${tid}: ${error.message ?? String(error)}`,
    );
    return [];
  }
  return sortNewest((data as LedgerRow[]).map(rowToRecord));
}

/**
 * R4 (2026-07-03): every ledger mutation invalidates the /results SWR snapshot
 * (results-surface-store) at THIS choke point, so no writer - operator action,
 * passive auto-measure, revert executor, armed publish auto-record - can leave
 * /results serving a stale snapshot past its own mutation. Best-effort and
 * fail-soft: an invalidation failure never fails the durable write it follows.
 * (`import type` from the store keeps the reverse edge erased - no runtime cycle.)
 */
async function invalidateResultsSurfaceSafe(): Promise<void> {
  try {
    const { invalidateResultsSurface } = await import(
      "@/app/(shell)/results/results-surface-store"
    );
    await invalidateResultsSurface();
  } catch {
    /* best-effort; the snapshot TTL still bounds staleness */
  }
  // W2-B (2026-07-10): a ledger mutation also changes the /changes measuring/decided
  // counts (both read the same lifecycle split), so refresh that SWR snapshot too.
  // Same best-effort dynamic-import posture; the TTL bounds staleness on any failure.
  try {
    const { invalidateChangesSurface } = await import("@/app/(shell)/changes-surface-store");
    await invalidateChangesSurface();
  } catch {
    /* best-effort */
  }
}

/** Upsert one record (by id) for the ambient tenant. Durable + file mirror. */
export async function upsertShippedChange(record: ShippedChangeRecord): Promise<void> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    await upsertFile(record); // no env → file only
    await invalidateResultsSurfaceSafe();
    return;
  }
  const tid = await currentTenantId();
  const up = await admin
    .from(TABLE)
    .upsert(recordToRow(tid, record), { onConflict: "tenant_id,id" });
  if (up.error != null) {
    if (isUndefinedTableError(up.error)) {
      // Deploy-order safety net: a missing table/column routes the write to the file
      // mirror so it works pre-migration. BUT on Vercel the file is ephemeral, so if a
      // migration is never applied this silently loses durable writes (it stranded ALL
      // proof-verdict settlement when 2026-06-23_…_operator_verdict_override.sql wasn't
      // applied to beacon-main). WARN loudly so a pending migration is observable, not
      // a silent multi-week data-loss.
      console.warn(
        `[shipped-change-store] DURABLE upsert fell back to file (apply the pending migration): ${
          (up.error as { code?: string }).code ?? "?"
        } ${(up.error as { message?: string }).message ?? String(up.error)}`,
      );
      await upsertFile(record);
      await invalidateResultsSurfaceSafe();
      return;
    }
    throw new Error(
      `shipped-change-store: upsert failed for ${tid}: ${up.error.message ?? String(up.error)}`,
    );
  }
  await mirrorFile(record);
  await invalidateResultsSurfaceSafe();
}

async function upsertFile(record: ShippedChangeRecord): Promise<void> {
  const rows = await readFile();
  const next = rows.filter((r) => r.id !== record.id);
  next.push(record);
  await writeFile(next);
}

/**
 * Stamp recrawl_requested_at on ONE proof row via a targeted, tenant-EXPLICIT update (no
 * load-all/upsert-all, no ambient-tenant double-source). Operator-attested GSC submission marker —
 * does NOT call Google. Fail-soft on a missing table (pre-migration); throws on a real DB error.
 */
export async function markRecrawlRequestedById(tenantId: string, id: string, atIso: string): Promise<void> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    const rows = await readFile();
    const rec = rows.find((r) => r.id === id);
    if (rec) await upsertFile({ ...rec, recrawlRequestedAt: atIso, updatedAt: new Date().toISOString() });
    await invalidateResultsSurfaceSafe();
    return;
  }
  const { error } = await admin
    .from(TABLE)
    .update({ recrawl_requested_at: atIso, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error != null && !isUndefinedTableError(error)) {
    throw new Error(`shipped-change-store: markRecrawlRequestedById failed for ${id}: ${error.message ?? String(error)}`);
  }
  await invalidateResultsSurfaceSafe();
}

/**
 * J-73/C-25 + W5 stop-ship F5 (2026-07-09): stamp the crawl-verify pass's
 * outcome on ONE proof row via a targeted, tenant-EXPLICIT write (no
 * load-all/upsert-all, no ambient-tenant double-source, so a caller that
 * resolved a foreign tenantId can never write another tenant's row). The
 * persisted `verify_state` is a VerifyEnvelope, written under a strict trust
 * boundary:
 *
 *   SUCCESS (verified_live / verified_live_modified) - a BLIND atomic single
 *   UPDATE that LATCHES the canonical verdict (canonical + canonicalAt,
 *   attempts reset to 0, lastAttempt/nextRetryAt cleared, exhausted false),
 *   writes edit_diff when present, and flips verified_live=true ONLY for a
 *   verified_live outcome (verified_live_modified latches the envelope but
 *   never the customer-receipt boolean).
 *
 *   FAILURE (crawl_failed / not_found / needs_review) - a COMPARE-AND-SET:
 *   read the current envelope; if a canonical success already latched, no-op;
 *   otherwise bump attempts (exhausted at MAX_VERIFY_ATTEMPTS, else schedule
 *   the next retry via exponential backoff) and write ONLY the retry fields,
 *   guarded by `verify_state->>canonical is null` so a concurrent success can
 *   never be clobbered (0 rows matched = success won = a legitimate no-op).
 *   `->>` (not `->`) is used so a JSON-null / absent canonical satisfies
 *   is.null while a latched success object never does. The failure path never
 *   touches edit_diff, verified_live, or the canonical verdict.
 *
 * Fail-soft on a missing table/column (pre-migration -> file mirror); throws
 * on a real DB error.
 */
export async function markVerifyResultById(
  tenantId: string,
  id: string,
  args: { verifyState: VerifyState; editDiff: EditDiffRecord | null },
): Promise<void> {
  const outcome = args.verifyState.outcome;
  const isSuccess = isCanonicalSuccessOutcome(outcome);
  const nowIso = new Date().toISOString();

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    await markVerifyResultFile(id, args, isSuccess, outcome, nowIso);
    await invalidateResultsSurfaceSafe();
    return;
  }

  if (isSuccess) {
    const envelope: VerifyEnvelope = {
      canonical: { outcome, kind: args.verifyState.kind ?? null },
      canonicalAt: nowIso,
      lastAttempt: null,
      attempts: 0,
      nextRetryAt: null,
      exhausted: false,
    };
    const update: Record<string, unknown> = { verify_state: envelope, updated_at: nowIso };
    if (args.editDiff != null) update.edit_diff = args.editDiff;
    if (outcome === "verified_live") update.verified_live = true;
    const { error } = await admin.from(TABLE).update(update).eq("tenant_id", tenantId).eq("id", id);
    if (error != null && !isUndefinedTableError(error)) {
      throw new Error(
        `shipped-change-store: markVerifyResultById failed for ${id}: ${error.message ?? String(error)}`,
      );
    }
    await invalidateResultsSurfaceSafe();
    return;
  }

  // FAILURE: read the current envelope (fail to the file mirror pre-migration).
  let currentEnv: VerifyEnvelope | null = null;
  const read = await admin
    .from(TABLE)
    .select("verify_state")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (read.error != null) {
    if (isUndefinedTableError(read.error)) {
      await markVerifyResultFile(id, args, isSuccess, outcome, nowIso);
      await invalidateResultsSurfaceSafe();
      return;
    }
    throw new Error(
      `shipped-change-store: markVerifyResultById read failed for ${id}: ${read.error.message ?? String(read.error)}`,
    );
  }
  currentEnv = normalizeVerifyEnvelope((read.data as { verify_state?: unknown } | null)?.verify_state);
  if (currentEnv && isCanonicalSuccessOutcome(currentEnv.canonical?.outcome)) {
    await invalidateResultsSurfaceSafe();
    return; // already latched live -> nothing to do
  }

  const envelope = nextFailureEnvelope(currentEnv, outcome, args.editDiff, nowIso);
  const { error } = await admin
    .from(TABLE)
    .update({ verify_state: envelope, updated_at: nowIso })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    // CAS guard: only rows whose canonical is still JSON-null/absent match, so a
    // success that latched between our read and write is never clobbered.
    .filter("verify_state->>canonical", "is", null)
    .select("id");
  if (error != null && !isUndefinedTableError(error)) {
    throw new Error(
      `shipped-change-store: markVerifyResultById failed for ${id}: ${error.message ?? String(error)}`,
    );
  }
  // 0 rows returned (a concurrent success won the CAS) is a legitimate no-op.
  await invalidateResultsSurfaceSafe();
}

/** Build the next envelope for a FAILURE attempt, preserving any (null-here)
 *  canonical and advancing the retry bookkeeping. */
function nextFailureEnvelope(
  currentEnv: VerifyEnvelope | null,
  outcome: VerifyOutcome,
  editDiff: EditDiffRecord | null,
  nowIso: string,
): VerifyEnvelope {
  const attempts = (currentEnv?.attempts ?? 0) + 1;
  const exhausted = attempts >= MAX_VERIFY_ATTEMPTS;
  const nextRetryAt = exhausted ? null : addMsIso(nowIso, verifyBackoffMs(attempts));
  const lastAttempt: VerifyAttempt = { state: outcome as VerifyAttempt["state"], at: nowIso };
  if (editDiff?.similarity != null) lastAttempt.similarity = editDiff.similarity;
  return {
    canonical: currentEnv?.canonical ?? null,
    canonicalAt: currentEnv?.canonicalAt ?? null,
    lastAttempt,
    attempts,
    nextRetryAt,
    exhausted,
  };
}

/** File-fallback mirror of markVerifyResultById's envelope merge (single
 *  process): SUCCESS resets + latches; FAILURE no-ops on a canonical success,
 *  else bumps attempt fields while preserving canonical / editDiff / verifiedLive. */
async function markVerifyResultFile(
  id: string,
  args: { verifyState: VerifyState; editDiff: EditDiffRecord | null },
  isSuccess: boolean,
  outcome: VerifyOutcome,
  nowIso: string,
): Promise<void> {
  const rows = await readFile();
  const rec = rows.find((r) => r.id === id);
  if (!rec) return;
  const currentEnv = normalizeVerifyEnvelope(rec.verifyState);

  if (isSuccess) {
    const envelope: VerifyEnvelope = {
      canonical: { outcome, kind: args.verifyState.kind ?? null },
      canonicalAt: nowIso,
      lastAttempt: null,
      attempts: 0,
      nextRetryAt: null,
      exhausted: false,
    };
    await upsertFile({
      ...rec,
      verifyState: envelope,
      editDiff: args.editDiff != null ? args.editDiff : (rec.editDiff ?? null),
      verifiedLive: outcome === "verified_live" ? true : rec.verifiedLive,
      updatedAt: nowIso,
    });
    return;
  }

  // FAILURE: preserve everything when a canonical success already latched.
  if (currentEnv && isCanonicalSuccessOutcome(currentEnv.canonical?.outcome)) return;
  const envelope = nextFailureEnvelope(currentEnv, outcome, args.editDiff, nowIso);
  await upsertFile({
    ...rec,
    verifyState: envelope,
    // FAILURE never touches editDiff or verifiedLive.
    updatedAt: nowIso,
  });
}

/**
 * W5 stop-ship F6 (2026-07-09): RESET a row's retry bookkeeping (attempts /
 * exhausted / nextRetryAt / lastAttempt) so an EXPLICIT operator re-accept
 * re-arms auto-verification even for an exhausted row. A latched canonical
 * success is left completely alone (never re-verified). Tenant-explicit,
 * single-row; fail-soft on a missing table/column; throws on a real DB error.
 */
export async function resetVerifyRetryById(tenantId: string, id: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const freshEnvelope: VerifyEnvelope = {
    canonical: null,
    canonicalAt: null,
    lastAttempt: null,
    attempts: 0,
    nextRetryAt: null,
    exhausted: false,
  };
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    const rows = await readFile();
    const rec = rows.find((r) => r.id === id);
    if (rec && !isCanonicalSuccessOutcome(canonicalOutcome(rec.verifyState))) {
      await upsertFile({ ...rec, verifyState: freshEnvelope, updatedAt: nowIso });
    }
    await invalidateResultsSurfaceSafe();
    return;
  }
  const { error } = await admin
    .from(TABLE)
    .update({ verify_state: freshEnvelope, updated_at: nowIso })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    // Never reset a latched success (guard identical to the failure CAS).
    .filter("verify_state->>canonical", "is", null);
  if (error != null && !isUndefinedTableError(error)) {
    throw new Error(
      `shipped-change-store: resetVerifyRetryById failed for ${id}: ${error.message ?? String(error)}`,
    );
  }
  await invalidateResultsSurfaceSafe();
}

/**
 * Item 11 (2026-07-02): append ONE additive note line to a proof row. NEVER
 * touches windows, verdict, confidence, or any measurement field - the record
 * is re-persisted as-is with only `notes` extended and `updatedAt` stamped.
 * Used by the revert executor to mark "I put the old version back" on the
 * original row without mutating its measurement history. Fail-soft on a
 * missing row (no-op); ambient-tenant routing like the other helpers here.
 */
export async function appendShippedChangeNote(id: string, note: string): Promise<void> {
  const line = (note ?? "").trim();
  if (line === "") return;
  const records = await loadShippedChanges();
  const rec = records.find((r) => r.id === id);
  if (rec == null) return;
  const notes =
    rec.notes != null && rec.notes.trim() !== "" ? `${rec.notes}\n${line}` : line;
  await upsertShippedChange({ ...rec, notes, updatedAt: new Date().toISOString() });
}

async function mirrorFile(record: ShippedChangeRecord): Promise<void> {
  try {
    await upsertFile(record);
  } catch {
    /* best-effort local parity */
  }
}

function sortNewest(records: ShippedChangeRecord[]): ShippedChangeRecord[] {
  return [...records].sort((a, b) => (a.shippedAt < b.shippedAt ? 1 : -1));
}
