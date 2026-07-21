import "server-only";

/**
 * changes-data (2026-07-01) — server loader for the canonical Changes list. Fans in the EXISTING
 * sources (the ActionPack worklist + today's daily plan + reservations) and runs the pure
 * buildCanonicalChanges adapter. READ-ONLY, fail-soft, no new persistence. Returns the canonical
 * changes + a sourceId→TodayMove map so a row can expand into the existing rich card (no rewrite of
 * working actions).
 */
import { currentTenantId } from "@/lib/tenant-context";
import { loadSurfaceWithSwr } from "./moves/moves-data";
import { getLatestPreviewPlan, getAcceptedPlan, listActiveReservations } from "@/domains/experiments/daily-experiment-plan-store";
import { buildCanonicalChanges, type CanonicalMoveInput } from "@/domains/changes/build-canonical-changes";
import type { CanonicalChange } from "@/domains/changes/canonical-change";
import { statusView } from "@/domains/changes/canonical-change";
import { decideChangeAction, cannibalizationDirective, isActDecision, stripInstructionsOnConsolidate } from "@/domains/changes/decide-action";
// One-posture-per-page (2026-07-11) - the SAME persisted seasonal store Today's war-room reads
// (war-room-sections.tsx -> loadSeasonalQueries -> the "I would prep this page by <date>" row), so
// the ranked Changes list never holds an act-now card for a page Today is telling the operator to
// wait on. Read-only; PREP_WINDOW_DAYS is the same urgency window the seasonal hint feed uses.
import { loadSeasonalQueries } from "@/domains/seasonal/seasonal-store";
import type { SeasonalQuery } from "@/domains/seasonal/seasonality";
import { PREP_WINDOW_DAYS } from "@/domains/seasonal/seasonal-hints";
import { normalizePath } from "@/domains/experiments/daily-plan-types";
import type { TodayMove } from "./today-moves-data";
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
import { buildNewPagesData } from "./today-newpages-data";
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
import {
  toRankedUnifiedEntry,
  type RankedUnifiedEntry,
  type UnifiedEntry,
} from "@/domains/allocator/unified-list";
// Redirect-safety gate (2026-07-20): the SAME owned-coverage inputs fuseUnifiedList already
// loaded (GSC serving queries per owned page + owned page title/h1/word-count) are the evidence
// applySafeRedirectPlans reads to prove a source is thin/duplicative before allowing a destructive
// redirect. No new fetch: the packet is threaded out of the fuse.
import type { OwnedCoverageInput } from "@/domains/demand-graph/owned-coverage";
// Reuse the canonical exported similarity scorer (max jaccard-tokens / 1-lev-ratio) - no new
// similarity math - for the source-vs-destination title/H1 near-duplicate check.
import { similarity as titleSimilarity } from "@/domains/recommendations/match-engine/similarity";
// Same canonicalizer the GSC cannibalization loader keys competing URLs by, so redirect URLs and
// coverage-evidence URLs land on one key.
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { classifyOpportunityFreshness, summarizeExpiry } from "@/domains/changes/opportunity-expiry";
import { perfMark, perfStage } from "@/lib/obs/perf-log";
import { after } from "next/server";
import { runSingleFlight } from "@/lib/single-flight";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import {
  readChangesSurface,
  writeChangesSurface,
  isChangesSurfaceStale,
} from "./changes-surface-store";
import { readCustomerSurface, isCustomerSurfaceStale } from "./customer-surface-store";
import { plainRankedBy } from "@/lib/plain-language";

export type ChangesView = {
  changes: CanonicalChange[];
  movesById: Record<string, TodayMove>;
  /** Server-only authoritative preparation handoff. Same final actionable
   * order as `changes`, compacted and stripped from the client payload. */
  rankedPreparationEntries?: RankedUnifiedEntry[];
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
   *  to its strongest N) so the list can say so in one quiet line instead of just showing fewer
   *  rows with no acknowledgment. Null when nothing was suppressed this load. */
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
  /** W2-B (2026-07-10) - the SWR snapshot's `computedAt` (when this ranked list was
   *  actually built), so the page can show an honest "I ranked these N ago" line
   *  instead of a frozen "just now". Null on a cold first-ever render. */
  surfaceComputedAt?: string | null;
  /** W2-B - true ONLY on a cold first-ever render (no snapshot yet): the list is
   *  empty because the rebuild was just scheduled in the background, NOT because
   *  there is genuinely nothing to do. The page renders an honest building state. */
  surfaceBuilding?: boolean;
  /** Atomic customer release shared with Today and New Pages. */
  surfaceVersion?: string | null;
};

/**
 * W2-B (2026-07-10) - PAYLOAD: the collapsed /changes board must not ship every row's
 * FULL TodayMove dossier (research pack, roundtable debate, prepared drafts, teardown
 * text - multiple KB per row) to the client by default. SlimTodayMove is exactly the
 * field set the COLLAPSED list actually renders or acts on:
 *   - id / action / query / targetUrl: the row actions (mark done / skip / keyboard "d")
 *     and the human page label;
 *   - why / rankWhy: the client-side search haystack;
 *   - sparkline: the tiny inline clicks chart on the row;
 *   - demand / demandBasis (Wave 3C): the small scalars that power the collapsed card's honest
 *     "why now" line ("1,200 times shown on Google a month") without shipping the whole dossier.
 * The FULL TodayMove is loaded ON DEMAND (loadMoveDetailAction in changes/actions.ts)
 * when a row's detail opens. Transport/hydration only - ranking, copy, and the server
 * view are untouched by the slimming itself.
 */
export const SLIM_MOVE_KEYS = ["id", "action", "query", "targetUrl", "why", "rankWhy", "sparkline", "demand", "demandBasis"] as const;
export type SlimTodayMove = Pick<TodayMove, (typeof SLIM_MOVE_KEYS)[number]>;

/** The ChangesView shape actually serialized to the /changes client board. */
export type ChangesClientView = Omit<ChangesView, "movesById" | "rankedPreparationEntries"> & {
  movesById: Record<string, SlimTodayMove>;
};

/** PURE: project one full TodayMove to its collapsed-row summary. */
export function slimMoveForList(m: TodayMove): SlimTodayMove {
  return {
    id: m.id,
    action: m.action,
    query: m.query,
    targetUrl: m.targetUrl,
    why: m.why,
    rankWhy: m.rankWhy,
    sparkline: m.sparkline,
    demand: m.demand,
    demandBasis: m.demandBasis,
  };
}

/** PURE: the client-payload projection of a ChangesView (slim movesById, all else as is). */
export function toClientView(view: ChangesView): ChangesClientView {
  const { rankedPreparationEntries: _serverOnly, movesById: fullMovesById, ...clientView } = view;
  const movesById: Record<string, SlimTodayMove> = {};
  for (const [id, m] of Object.entries(fullMovesById)) movesById[id] = slimMoveForList(m);
  return { ...clientView, movesById };
}

const PREPARABLE_STATUSES = new Set<CanonicalChange["status"]>(["suggested", "ready", "apply"]);

/** PURE: project the final rendered Changes order back onto the allocator's
 * entries. This is the only preparation order; blocked/watching/measuring rows
 * never enter the handoff, and whole source CanonicalChanges are removed. */
export function selectRankedPreparationEntries(
  changes: readonly CanonicalChange[],
  entries: readonly UnifiedEntry[],
): RankedUnifiedEntry[] {
  const byChangeId = new Map<string, UnifiedEntry>();
  for (const entry of entries) {
    byChangeId.set(entry.id, entry);
    if (entry.sourceChange?.id) byChangeId.set(entry.sourceChange.id, entry);
  }
  const ranked: RankedUnifiedEntry[] = [];
  for (const change of changes) {
    if (!PREPARABLE_STATUSES.has(change.status)) continue;
    const entry = byChangeId.get(change.id);
    if (!entry || entry.hold.held || (entry.kind !== "edit" && entry.kind !== "create" && entry.kind !== "fix")) continue;
    ranked.push(toRankedUnifiedEntry(entry, ranked.length));
  }
  return ranked;
}

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
 *  it supersedes any per-page lever work below, so the row's own two lines never disagree.
 *
 *  Wave 3C: the rewrite now consumes the DECIDED action (decide-action.ts), never the raw
 *  `move.cannibalization[0].fix` text. Beacon has already picked exactly one action for this case
 *  (edit_existing / consolidate / prune_redirect); the rationale states that single directive, so
 *  it can never reintroduce a "redirect or internal-link" fork even if an upstream string still
 *  carried one. */
export function reconcileCannibalizationRationale(
  changes: readonly CanonicalChange[],
  movesById: Record<string, TodayMove>,
): CanonicalChange[] {
  return changes.map((c) => {
    const move = c.sourceIds[0] ? movesById[c.sourceIds[0]] : undefined;
    const cannib = move?.cannibalization?.[0];
    if (!cannib) return c;
    const decision = c.decision ?? decideChangeAction(c, move).decision;
    const directive = cannibalizationDirective({
      decision,
      leadPage: cannib.leadPage,
      otherPages: cannib.otherPages,
      query: cannib.query,
      isLead: cannib.isLead,
    });
    const rationale = `${directive} That comes first, any other edit below on this page should wait until this is resolved.`;
    if (c.rationale === rationale && c.decision === decision) return c; // already agrees
    return { ...c, rationale, decision };
  });
}

/** Per-page crawl + demand facts the redirect-safety gate reasons over, keyed by
 *  canonical URL. Built purely from the owned-coverage inputs the fuse already
 *  loaded (no new fetch). */
export type RedirectPageFacts = {
  /** Latest-crawl main-content word count; null when the page was never crawled. */
  wordCount: number | null;
  title: string | null;
  h1: string | null;
  /** GSC queries Google serves to this URL (any position). */
  queries: ReadonlySet<string>;
};

export type RedirectSafetyEvidence = {
  byUrl: ReadonlyMap<string, RedirectPageFacts>;
};

/** One canonical key so a cannibalization URL and a coverage-evidence URL match.
 *  Same canonicalizer the GSC cannibalization loader uses, then lower-cased and
 *  de-trailing-slashed for a stable map key. */
function redirectUrlKey(url: string): string {
  const canon = canonicalizeCitationUrl(url) ?? url;
  return canon.trim().toLowerCase().replace(/\/+$/, "");
}

/** THIN source: a page whose crawled main content is below this many words is a
 *  thin shell that a redirect can safely fold away. Justified from the existing
 *  crawl thresholds: `MIN_TRUSTWORTHY_HTML_CHARS` (500, scan-persistence.ts) is the
 *  floor below which a response is a rendering shell, not a page at all; ~1500
 *  chars of main content (3x that floor, ~250 words at ~6 chars/word) is the
 *  ceiling below which a page is real but too thin to stand on its own. This is
 *  intentionally STRICTER than the 400-word `THIN_WORD_COUNT` merge trigger,
 *  because a redirect DESTROYS the source whereas a merge only folds it. A page
 *  above this bar is treated as a real standalone page and is never auto-redirected. */
export const REDIRECT_SOURCE_THIN_WORD_COUNT = 250;
/** SUBSET demand: the source must serve at least this many GSC queries for a
 *  subset test to mean anything (a single-query page passing "subset" is noise). */
export const REDIRECT_SUBSET_MIN_QUERIES = 2;
/** SUBSET demand: fraction of the source's served queries that the destination
 *  must also serve for the source's demand to count as already-covered by the
 *  destination (so the redirect loses no demand). High by design. */
export const REDIRECT_SUBSET_OVERLAP_FRACTION = 0.75;
/** NEAR-DUPLICATE titles: source and destination title/H1 similarity at or above
 *  this is a near-duplicate. Well above the 0.5 merge-jaccard and 0.3 title/H1
 *  mismatch lines already in the codebase, since here it AUTHORIZES destruction. */
export const REDIRECT_TITLE_DUP_SIMILARITY = 0.8;

/** Path shapes that mark a source as a category / hub whose whole point is to list
 *  many child pages. Folding one of these into a single leaf page orphans every
 *  sibling, so a hub source is never redirect-safe regardless of the other tests. */
const HUB_PATH = /\/(category|categories|product-category|collections?|shop|tag|tags|topics?)\//i;

function isHubSource(url: string): boolean {
  try {
    return HUB_PATH.test(new URL(url).pathname);
  } catch {
    return HUB_PATH.test(url);
  }
}

/** Build the redirect-safety evidence map from the owned-coverage inputs the fuse
 *  already loaded. PURE; no I/O. */
export function buildRedirectSafetyEvidence(coverage: OwnedCoverageInput | null | undefined): RedirectSafetyEvidence {
  const byUrl = new Map<string, { wordCount: number | null; title: string | null; h1: string | null; queries: Set<string> }>();
  const ensure = (url: string) => {
    const key = redirectUrlKey(url);
    let row = byUrl.get(key);
    if (!row) {
      row = { wordCount: null, title: null, h1: null, queries: new Set<string>() };
      byUrl.set(key, row);
    }
    return row;
  };
  for (const p of coverage?.ownedPages ?? []) {
    if (!p.url) continue;
    const row = ensure(p.url);
    row.wordCount = p.wordCount ?? row.wordCount;
    row.title = p.title ?? row.title;
    row.h1 = p.h1 ?? row.h1;
  }
  for (const s of coverage?.serving ?? []) {
    if (!s.ownerPage || !s.query) continue;
    ensure(s.ownerPage).queries.add(s.query.trim().toLowerCase());
  }
  return { byUrl };
}

/** Is a single source URL safe to fold into the destination via a permanent redirect?
 *  Safe only when at least one destructive-suggestion guard is deterministically
 *  satisfied: the source is a thin shell, OR its served demand is a subset of the
 *  destination's, OR their titles/H1s are near-duplicates. A source we have no
 *  evidence for fails all three (unknown is never "safe to destroy"). */
function redirectSourceIsSafe(sourceUrl: string, leadUrl: string, evidence: RedirectSafetyEvidence): boolean {
  const src = evidence.byUrl.get(redirectUrlKey(sourceUrl));
  const dest = evidence.byUrl.get(redirectUrlKey(leadUrl));

  const thin = src?.wordCount != null && src.wordCount < REDIRECT_SOURCE_THIN_WORD_COUNT;

  let subset = false;
  if (src && dest && src.queries.size >= REDIRECT_SUBSET_MIN_QUERIES) {
    let shared = 0;
    for (const q of src.queries) if (dest.queries.has(q)) shared++;
    subset = shared / src.queries.size >= REDIRECT_SUBSET_OVERLAP_FRACTION;
  }

  let titleDup = false;
  if (src && dest) {
    const st = `${src.title ?? ""} ${src.h1 ?? ""}`.trim().toLowerCase();
    const dt = `${dest.title ?? ""} ${dest.h1 ?? ""}`.trim().toLowerCase();
    titleDup = st.length > 0 && dt.length > 0 && titleSimilarity(st, dt) >= REDIRECT_TITLE_DUP_SIMILARITY;
  }

  return thin || subset || titleDup;
}

/** A redirect is the one recommendation Beacon must never infer from labels, and
 * the one it must never emit against a real page. Gate order:
 *   1. Exact same-site source and target URLs, a non-home target, >=1 source
 *      (fail-closed to Watch - we cannot verify a partial map).
 *   2. Destructive-suggestion guard (2026-07-20): every source must be thin, or
 *      demand-subset of the destination, or a title/H1 near-duplicate. A category
 *      or hub source is NEVER redirect-safe (folding it into one leaf orphans its
 *      children). A plan that fails the guard is DEMOTED to a non-destructive
 *      internal-link consolidation (the pipeline's edit_existing action) rather
 *      than shipping a destructive redirect the operator cannot undo. */
export function applySafeRedirectPlans(
  changes: readonly CanonicalChange[],
  movesById: Record<string, TodayMove>,
  evidence: RedirectSafetyEvidence = { byUrl: new Map() },
): CanonicalChange[] {
  return changes.map((change) => {
    if (change.decision !== "prune_redirect") return change;
    const move = change.sourceIds[0] ? movesById[change.sourceIds[0]] : undefined;
    const caseRow = move?.cannibalization?.find((row) => row.decision === "prune_redirect");
    const leadUrl = caseRow?.leadUrl ?? "";
    const sourceUrls = [...new Set(caseRow?.otherUrls ?? [])];
    let safe = sourceUrls.length > 0;
    try {
      const target = new URL(leadUrl);
      safe = safe && target.pathname !== "/";
      for (const sourceUrl of sourceUrls) {
        const source = new URL(sourceUrl);
        if (source.hostname !== target.hostname || source.href === target.href) safe = false;
      }
    } catch {
      safe = false;
    }
    if (!safe) {
      return {
        ...change,
        decision: "watch",
        exactInstructions: null,
        qualityDecision: "flagged",
        qualityNote: "I do not have an exact, same-site source-to-target redirect map yet, so I will not ask you to redirect anything.",
        rationale: "I am holding this until every source URL and the live destination are verified.",
      };
    }

    // Destructive-suggestion guard. A category / hub source can never fold into one
    // leaf, so it is held for a human even if the URL map is clean.
    const hubSource = sourceUrls.find((u) => isHubSource(u));
    if (hubSource) {
      return {
        ...change,
        decision: "watch",
        exactInstructions: null,
        qualityDecision: "flagged",
        qualityNote: `I will not redirect a category or hub page (${hubSource}) into a single page. That would orphan every child page under it, so I am holding this for a human to review.`,
        rationale: "A category page lists many children; folding it into one page loses all the siblings, so I am not treating this as a redirect.",
      };
    }
    // Every remaining source must prove it is thin, demand-subset, or a near-duplicate.
    const unsafeSource = sourceUrls.find((u) => !redirectSourceIsSafe(u, leadUrl, evidence));
    if (unsafeSource) {
      const linkPlan = sourceUrls.map((source) => `${source} -> add one internal link to ${leadUrl}`).join("\n");
      return {
        ...change,
        decision: "edit_existing",
        before: sourceUrls.join(", "),
        after: leadUrl,
        exactInstructions: `Keep every page live. On each of these, add one internal link pointing at ${leadUrl} so they stop splitting its clicks:\n${linkPlan}`,
        recommendation:
          sourceUrls.length === 1
            ? `Link ${sourceUrls[0]} to ${leadUrl} instead of redirecting it.`
            : `Link these ${sourceUrls.length} pages to ${leadUrl} with one internal link each instead of redirecting them.`,
        qualityDecision: "flagged",
        qualityNote: `${unsafeSource} looks like a real standalone page (not thin, not a demand subset of the destination, not a near-duplicate title), so I will not ask you to delete it with a redirect. Consolidate with an internal link instead.`,
        rationale: "I only redirect a page when it is a thin shell or a duplicate of the destination. This one is neither, so the safe move is an internal link, not a redirect.",
      };
    }

    const mappings = sourceUrls.map((source) => `${source} -> ${leadUrl}`).join("\n");
    return {
      ...change,
      exactInstructions: `Create these permanent redirects:\n${mappings}\nKeep ${leadUrl} live and indexable.`,
      before: sourceUrls.join(", "),
      after: leadUrl,
      recommendation:
        sourceUrls.length === 1
          ? `Redirect ${sourceUrls[0]} into ${leadUrl}.`
          : `Redirect these ${sourceUrls.length} dead competing pages into ${leadUrl}: ${sourceUrls.join(", ")}.`,
      qualityDecision: "approved",
      qualityNote: "Exact same-site source and destination URLs verified from Search Console cannibalization evidence, and the source is a thin or duplicative page safe to fold in.",
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

/** One-posture-per-page (2026-07-11) - the pages Today's war-room is holding in a SEASONAL WAIT
 *  posture, keyed by normalized path -> the exact sentence Today shows ("I would prep this page by
 *  <date>, six weeks ahead, so Google has it indexed before the wave."). A page is in a WAIT
 *  posture (not a "prep now" one) when its prep deadline is further out than the SAME
 *  PREP_WINDOW_DAYS urgency window the seasonal hint feed uses: inside that window the prep IS the
 *  act-now move, so Today and Changes already agree and nothing is demoted. Only entries with a
 *  known top page contribute (nothing else is exact to a page). PURE; exported for a direct test pin. */
export function seasonalWaitPathsFrom(seasonal: readonly SeasonalQuery[], now: Date = new Date()): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of seasonal) {
    if (!s.topPage) continue;
    const target = Date.parse(`${s.prepByDate}T00:00:00Z`);
    if (!Number.isFinite(target)) continue;
    const days = Math.round((target - now.getTime()) / 86_400_000);
    if (days <= PREP_WINDOW_DAYS) continue; // prep is due/urgent -> act now, not a wait
    const key = normalizePath(s.topPage);
    if (!out.has(key)) out.set(key, s.sentence);
  }
  return out;
}

/** One-posture-per-page (2026-07-11) - when a page is held in a seasonal WAIT posture on another
 *  surface (Today's war-room), the Changes board must not ALSO hold an act-now card for it, or the
 *  operator sees "act now" and "wait until <date>" for the same page at once. For each act-now
 *  change on such a page, demote it to the SAME watching state the zero-click trap uses (decision
 *  "watch", held with the seasonal sentence as its honest reason), reusing decide-action's existing
 *  vocabulary. A row already watching / blocked / measuring / settled is left untouched, and a page
 *  with no matching wait posture rides through byte-identical. PURE; exported for a direct test pin. */
export function applySeasonalWaitPosture(
  changes: readonly CanonicalChange[],
  seasonalWaitByPath: ReadonlyMap<string, string>,
): CanonicalChange[] {
  if (seasonalWaitByPath.size === 0) return [...changes];
  return changes.map((c) => {
    if (!isActDecision(c.decision)) return c;
    const sentence = seasonalWaitByPath.get(c.pagePath);
    if (!sentence) return c;
    const status = c.status === "ready" ? "suggested" : c.status;
    return { ...c, status, qualityDecision: "flagged", qualityNote: sentence, decision: "watch" };
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

/** DATE-BOMB GUARD (2026-07-20) - the page renders "I ranked these {ago}." from
 *  `surfaceComputedAt` via checkedAgoLabel. `invalidateChangesSurface` stamps a stale
 *  snapshot with `new Date(0).toISOString()` (epoch 0) to preserve the last-known-good
 *  list while a rebuild runs; that epoch-0 timestamp, fed to checkedAgoLabel, renders a
 *  nonsense "20655 days ago". A stamp that is unparseable, at/before the Unix epoch, or
 *  before Beacon existed (pre-2026) is never a real ranking time: return null so the
 *  page OMITS the age line entirely rather than showing a five-digit day count. PURE. */
const MIN_VALID_COMPUTED_AT_MS = Date.parse("2026-01-01T00:00:00Z");
export function sanitizeSurfaceComputedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t < MIN_VALID_COMPUTED_AT_MS) return null;
  return iso;
}

/** W2-B (2026-07-10) - the honest cold/first-ever ChangesView: an empty, non-broken
 *  shape flagged `surfaceBuilding` so the page shows "I'm putting your ranked changes
 *  together" (not the "No changes yet" lie) while the background rebuild runs. */
const EMPTY_CHANGES_VIEW: ChangesView = {
  changes: [],
  movesById: {},
  summary: { todo: 0, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 },
  hasPlan: false,
  planAccepted: false,
  readyZeroHint: null,
  measuringCountCanonical: 0,
  decidedCountCanonical: 0,
  suppressedRowsNote: null,
  expiredSubline: null,
  receiptLine: null,
  readyCount: 0,
  shippedThisWeekCount: 0,
  watching: [],
  surfaceComputedAt: null,
  surfaceBuilding: true,
};

/**
 * W2-B (2026-07-10) - THE render entry (request-cached). Serves the ranked ChangesView
 * from the tenant-scoped SWR snapshot: a present snapshot serves INSTANTLY (with its
 * computedAt for the honest staleness line) and, when stale, schedules ONE
 * single-flighted background rebuild via after(). A COLD first-ever load NEVER blocks
 * on the ~14s fuse: it serves the honest "building" empty state and schedules the
 * rebuild, so the next visit is instant. Every surface that reads the view (Today,
 * lifecycle counts, page dossier) shares this one snapshot per request via react.cache.
 */
export const loadChangesView = cache(
  async (): Promise<ChangesView> => loadChangesViewWithSwr(await currentTenantId()),
);

/** Injectable builder so tests can drive the SWR flow without running the heavy fuse. */
type ChangesViewBuilder = (tenantId: string) => Promise<ChangesView>;

/**
 * Exported for tests; render paths go through loadChangesView above. The optional
 * `build` dep lets a test observe the cold/stale/fresh/single-flight/tenant-threading
 * behavior with a cheap fake builder instead of the real ~14s fuse.
 */
export async function loadChangesViewWithSwr(
  tenantId: string,
  deps: { build?: ChangesViewBuilder } = {},
): Promise<ChangesView> {
  const build = deps.build ?? buildChangesViewUncached;
  const scheduleRebuild = (action: string) =>
    after(async () => {
      try {
        // Single-flight: concurrent stale/cold readers in this lambda collapse to ONE
        // rebuild instead of racing duplicate fuses.
        await runSingleFlight(`changes-surface:${tenantId}`, () => rebuildChangesSurfaceWith(tenantId, build));
      } catch (e) {
        await recordAppError({ route: "/changes", tenantId, action, ...errorFieldsFrom(e) });
      }
    });

  const customer = await readCustomerSurface(tenantId).catch(() => null);
  if (customer) {
    if (isCustomerSurfaceStale(customer.computedAt, Date.now())) {
      after(async () => {
        const { refreshCustomerSurface } = await import("./customer-surface-refresh");
        await refreshCustomerSurface(tenantId).catch(() => null);
      });
    }
    return {
      ...customer.changes,
      surfaceComputedAt: sanitizeSurfaceComputedAt(customer.computedAt),
      surfaceBuilding: false,
      surfaceVersion: customer.releaseId,
    };
  }
  const cached = await readChangesSurface(tenantId).catch(() => null);
  if (cached) {
    if (isChangesSurfaceStale(cached.computedAt, Date.now())) scheduleRebuild("background-refresh");
    // Guard against the epoch-0 stale sentinel (invalidateChangesSurface) leaking to the
    // page's "I ranked these {ago}" line as a five-digit "20655 days ago".
    return { ...cached.view, surfaceComputedAt: sanitizeSurfaceComputedAt(cached.computedAt), surfaceBuilding: false };
  }
  // Cold first-ever / invalidated: NEVER block on the fuse (it can exceed the page's
  // 25s always-paint floor). Schedule the rebuild and serve the honest building state.
  scheduleRebuild("cold-rebuild");
  return EMPTY_CHANGES_VIEW;
}

/**
 * W2-B - rebuild the ranked ChangesView NOW and persist the snapshot (the background
 * refresh body; also the nightly-warm entry). Build-then-write: a failed build throws
 * and the previous snapshot stays in place.
 */
export async function rebuildChangesSurface(tenantId: string): Promise<ChangesView> {
  return rebuildChangesSurfaceWith(tenantId, buildChangesViewUncached);
}

async function rebuildChangesSurfaceWith(tenantId: string, build: ChangesViewBuilder): Promise<ChangesView> {
  const computedAt = new Date().toISOString();
  const view = await build(tenantId);
  // P2-f (2026-07-10, visual audit HARD lint) - this runs inside next/server's after()
  // (see scheduleRebuild above), OUTSIDE the render's request scope. writeChangesSurface's
  // own persistence would otherwise resolve the write's tenant via json-store's ambient
  // currentTenantSlug() (request-header-based), which is not the tenant this rebuild is
  // for in a background task. `tenantId` is already threaded through `build(tenantId)`
  // above - thread it through the write too, so the two can never disagree.
  await writeChangesSurface(view, computedAt, tenantId);
  return view;
}

// FP3 - the heavy compute. Formerly `loadChangesView` (react.cache'd inline); now the
// SWR snapshot's build body, called from rebuildChangesSurface in after() (off the
// render critical path). Tenant is passed EXPLICITLY so the after() rebuild is
// tenant-correct even outside the render's ambient scope.
async function buildChangesViewUncached(tenantId: string): Promise<ChangesView> {
  // Move 3 — every source is fail-soft so one failing store can never blank the whole
  // Changes list. A plan-store outage drops the "today" slice but keeps the ranked moves;
  // a worklist outage keeps any selected plan items. The page renders with what loaded.
  const tSources = perfMark();
  const [wl, accepted, preview, reservations, ledgerRows, calibrationRecords, boardTopicKeys, seasonalQueries] = await Promise.all([
    loadSurfaceWithSwr(tenantId).catch(() => ({ moves: [] as TodayMove[], stats: undefined })),
    getAcceptedPlan(tenantId).catch(() => null),
    getLatestPreviewPlan(tenantId).catch(() => null),
    listActiveReservations(tenantId).catch(() => []),
    loadProofLedgerCached(tenantId).catch(() => []),
    loadCalibrationRecords(tenantId).catch(() => []),
    valueWithDeadline(
      buildNewPagesData(tenantId)
        .then((d) => new Set(d.opportunities.map((o) => topicIdentityKey(o.topic))))
        .catch(() => new Set<string>()),
      new Set<string>(),
      BOARD_TOPICS_DEADLINE_MS,
    ),
    // One-posture-per-page - the same seasonal store Today reads; fail-soft (an outage just means
    // no seasonal demotion this build, never a blanked list).
    loadSeasonalQueries(tenantId).catch(() => [] as SeasonalQuery[]),
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
      hasIndependentAeoEvidence: Boolean(m.whoCited),
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
  const { changes: fusedChanges, entries: unifiedEntries, coverageInputs } = await fuseUnifiedList(tenantId, worklistChanges).catch(() => ({ changes: worklistChanges, entries: [] as UnifiedEntry[], coverageInputs: { serving: [], ownedPages: [] } as OwnedCoverageInput }));
  perfStage("changes-allocator-fuse", tFuse, { fused: fusedChanges.length });

  // The move's "why this ranked here" string (m.rankWhy) joins RAW evidence-source keys and vendor
  // names ("Ranked by rank_revenue + profound + gsc + clarity + competitor_teardown."). Every
  // consumer of this view (the slim client payload's rankWhy, the row search haystack, the detail
  // MoveCard) must read plain evidence names, never a slug, so it is rewritten once here.
  const movesById: Record<string, TodayMove> = {};
  for (const m of moves) movesById[m.id] = { ...m, rankWhy: plainRankedBy(m.rankWhy) ?? m.rankWhy };

  // FP2 (killer finding 2) - the allocator's own fuseByPage only merges lanes that share a real,
  // non-null page; two lanes independently pitching the SAME not-yet-built topic ("best iranian
  // restaurants near me" from both the SERP-steal lane and the keyword-library lane, or a plain
  // worklist/allocator overlap) survive as two rows. Collapse those here, by real-world identity
  // (page-or-topic + query + lever family), before anything ranks or renders the list.
  const deduped = dedupeChanges(fusedChanges, movesById);
  // Wave 3C (D3) - THE one decision per card. build-canonical-changes set a base decision from each
  // change's own type/family; here we refine it with the source move's cannibalization case (which
  // the pure adapter cannot see) so every row - worklist AND the fused D2/D3/keyword-library lanes -
  // carries exactly one decision + one CTA before anything ranks or renders.
  const decided = deduped.map((c) => {
    const move = c.sourceIds[0] ? movesById[c.sourceIds[0]] : undefined;
    // decideChangeAction now reads c.pagePath (a full CanonicalChange), so a new_page-family row on
    // an already-live page is refined to edit_existing here too. Strip any paste-ready instructions
    // the instant the refined decision lands on consolidate - a merge is advisory prose only.
    const decision = decideChangeAction(c, move).decision;
    return stripInstructionsOnConsolidate(decision, { ...c, decision });
  });
  // FP2 (killer finding 3) - when this row's page has a real cannibalization case, its secondary
  // line must agree with (not contradict) the consolidation directive. Wave 3C: the reconciled
  // rationale is built from the DECIDED action above, never the ambiguous fix text.
  const redirectEvidence = buildRedirectSafetyEvidence(coverageInputs);
  const reconciled = applySafeRedirectPlans(reconcileCannibalizationRationale(decided, movesById), movesById, redirectEvidence);
  // One-posture-per-page (2026-07-11) - a page Today's war-room is telling the operator to WAIT on
  // (a seasonal window whose prep deadline is still months out) must not carry an act-now card here
  // at the same time. Demote any such act-now row to the same watching state the zero-click trap
  // uses, held with the exact seasonal sentence Today shows. Applied BEFORE the ranking input below
  // (and before the client ranks) so the board order reflects the demotion, never a surface-local
  // patch. Byte-identical when nothing is in a seasonal wait posture.
  const seasonalWaitByPath = seasonalWaitPathsFrom(seasonalQueries);
  const oneposture = applySeasonalWaitPosture(reconciled, seasonalWaitByPath);
  // FP2 (killer finding 1) - a row whose only sizing is opportunity-math's honest "not enough
  // history"/"gap too small" fallback must never outrank a row with a real forecast. strategy.ts's
  // ranking is untouched; this only adjusts the ranking INPUT so unsized rows sort to the bottom
  // of their status bucket instead of mixing in among sized ones.
  const demoted = demoteUnsized(oneposture);
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
  const rankedPreparationEntries = selectRankedPreparationEntries(changes, unifiedEntries);

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
    if (summary.todo > 0) {
      readyZeroHint = `None has cleared Ready yet. I am checking the strongest ideas automatically. Until a card contains the exact publishable copy or redirect map, leave it in To do; Wix is only needed if you want Beacon to publish for you.`;
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
    note: planAgo ? `Today's picks were put together ${planAgo}.` : null,
  });

  perfStage("changes-assembly", tSources, { changes: changes.length, watching: watching.length });
  return {
    changes,
    movesById,
    rankedPreparationEntries,
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
}
