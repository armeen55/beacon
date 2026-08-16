import "server-only";

/** measure-pass (CORE 100K) - the GSC before/after comparison engine. Reads the treated page + its comparison pages over the pre-ship
 *  window and each 7/14/28 post window via the existing GSC connector reads (gsc-window), computes the observational diff in diff, and
 *  stamps the record's windows + a stored verdict from the kernel. Observational, never causal: adjustedLift = (treatedPost - treatedPre) -
 *  mean(controlPost - controlPre). No permutation nulls, FDR, calibration self-tests, or forecast machinery. */

import { createHash } from "node:crypto";

import { reportingDay } from "@/lib/reporting-day";
import { canonicalizeCitationUrl } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { isAnalysisSettled, readAiObservationViews } from "@/domains/evidence/ai-visibility/ai-observations";
import {
  loadPageSurgeonContext,
  topPagesByDemand,
  assemblePacketForUrl,
} from "@/domains/decision/recommendation-intelligence/page-surgeon/assemble-packet";
import { loadPageJobs } from "@/domains/decision/producers/page-job";
import { loadChangeProposals } from "@/domains/decision/proposal-store";
import { contaminatedPaths, contaminationFor, pathOf as contaminationPathOf, selectMatchedControls, type ControlReceipt } from "./contamination";
import { loadShippedChangesForTenant } from "./shipped-change-store";
import { readWindowForPages, readLastFinalizedDate } from "./gsc-window";
import {
  BASELINE_WINDOW_DAYS,
  PROOF_WINDOW_DAYS,
  type GscWindowMetrics,
  type MeasurementState,
  type ProofWindowDay,
  type ProofWindowResult,
} from "./types";
import type { ShippedChangeRecord } from "./shipped-change-store";
import { addDays, evaluateWindows, readLedger } from "./kernel";
import { day56Followup, FOLLOW_UP_WINDOW_DAY } from "./measure-lifecycle";

const NULL_METRICS: GscWindowMetrics = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

/** GSC's reporting zone is Pacific and so is the operator's; default a ship date to that day, through the ONE definition of a reporting day
 *  rather than a second copy of the zone. */
export function defaultPacificShipDate(now: Date = new Date()): string {
  return reportingDay(now);
}

function dateOnly(iso: string): string {
  return iso.length > 10 ? iso.slice(0, 10) : iso;
}

function toPath(u: string): string {
  return u.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "") || "/";
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;
const mean = (xs: number[]): number => (xs.length > 0 ? xs.reduce((s, d) => s + d, 0) / xs.length : 0);
const ctrDelta = (m0: GscWindowMetrics, m1: GscWindowMetrics): number =>
  m0.impressions > 0 && m1.impressions > 0 ? m1.ctr - m0.ctr : 0;
const posImprove = (m0: GscWindowMetrics, m1: GscWindowMetrics): number =>
  m0.position > 0 && m1.position > 0 ? m0.position - m1.position : 0;

/** One window's observational diff in diff from already-read treated + control window metrics. Pure. Pre clicks are pro-rated to the post
 *  window length so a 28-day pre sum never meets a 7-day post sum. */
function computeWindowLift(args: {
  day: ProofWindowDay;
  checkOn: string;
  ran: boolean;
  treatedPre: GscWindowMetrics;
  treatedPost: GscWindowMetrics;
  controls: ReadonlyArray<{ pre: GscWindowMetrics; post: GscWindowMetrics }>;
  preWindowDays?: number;
}): ProofWindowResult {
  const { treatedPre, treatedPost, controls } = args;
  if (!args.ran) {
    return {
      day: args.day, checkOn: args.checkOn, ran: false,
      treatedDelta: 0, controlDelta: 0, adjustedLift: 0,
      treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0,
      treatedPosDelta: 0, controlPosDelta: 0, adjustedPosLift: 0,
      controlsUsed: 0, treatedPostImpressions: 0,
      treatedImpressionsDelta: 0, controlImpressionsDelta: 0, adjustedImpressionsLift: 0,
    };
  }
  const preDays = args.preWindowDays ?? args.day;
  const scale = preDays > 0 ? args.day / preDays : 1;
  const scaledPre = (m: GscWindowMetrics) => m.clicks * scale;
  const treatedDelta = treatedPost.clicks - scaledPre(treatedPre);
  const treatedCtr = ctrDelta(treatedPre, treatedPost);
  const treatedPos = posImprove(treatedPre, treatedPost);
  const treatedImpr = treatedPost.impressions - treatedPre.impressions * scale;
  const controlDelta = mean(controls.map((c) => c.post.clicks - scaledPre(c.pre)));
  const controlCtr = mean(controls.map((c) => ctrDelta(c.pre, c.post)));
  const controlPos = mean(controls.map((c) => posImprove(c.pre, c.post)));
  const controlImpr = mean(controls.map((c) => c.post.impressions - c.pre.impressions * scale));
  return {
    day: args.day, checkOn: args.checkOn, ran: true,
    treatedDelta, controlDelta: round2(controlDelta), adjustedLift: round2(treatedDelta - controlDelta),
    treatedCtrDelta: round4(treatedCtr), controlCtrDelta: round4(controlCtr), adjustedCtrLift: round4(treatedCtr - controlCtr),
    treatedPosDelta: round2(treatedPos), controlPosDelta: round2(controlPos), adjustedPosLift: round2(treatedPos - controlPos),
    controlsUsed: controls.length, treatedPostImpressions: treatedPost.impressions,
    treatedImpressionsDelta: round2(treatedImpr), controlImpressionsDelta: round2(controlImpr),
    adjustedImpressionsLift: round2(treatedImpr - controlImpr),
  };
}

/** Map the kernel's live directional read to the stored verdict vocabulary. */
function storedVerdictFor(record: ShippedChangeRecord, now: Date, lastFinal: string | null): {
  verdict: ShippedChangeRecord["verdict"];
  confidence: ShippedChangeRecord["confidence"];
} {
  const read = readLedger([record], now, lastFinal)[0];
  const confidence = read.confidence;
  switch (read.verdict) {
    case "directional_improvement":
    case "stronger_improvement":
      return { verdict: "won", confidence };
    case "directional_decline":
      return { verdict: "lost", confidence };
    case "no_clear_movement":
      return { verdict: "inconclusive", confidence };
    case "insufficient_evidence":
      return { verdict: "insufficient_data", confidence };
    default:
      return { verdict: "measuring", confidence };
  }
}

/** Recompute the outcome for a shipped change from GSC. Reads the pre window once and each post window once, for the treated page + all
 *  controls, and returns a NEW record with windows/verdict/confidence/measuredAt updated. A control that is itself an active treatment can
 *  be excluded from the diff. EVERY CHECKPOINT COUNTS FROM THE STAMP (implementedAt), the day the change actually went live; a record
 *  written before there was a stamp counts from its ship date as it always did. The day-56 read is CONDITIONAL: it runs only for a change
 *  whose 28-day read did not settle, or that moved or hid the page. */
export async function measureRecord(
  tenantId: string,
  record: ShippedChangeRecord,
  now: Date,
  lastFinalizedDate: string | null | undefined,
  /** REQUIRED, and required on purpose. Three doors used to answer this question three different
   *  ways, so one change read against three different comparison sets. Build it with
   *  `contaminationFor` (contamination.ts) and nothing else; the compiler now asks every caller. */
  excludeControlPaths: ReadonlySet<string>,
): Promise<ShippedChangeRecord> {
  const shipDate = dateOnly(record.implementedAt ?? record.shippedAt);
  const lastFinal = lastFinalizedDate !== undefined ? lastFinalizedDate : await readLastFinalizedDate(tenantId);
  // ONE normalizer governs the whole policy: the exclusion set is keyed by contamination's pathOf,
  // so the consumption side must ask with the same spelling or a query-carrying URL slips the filter.
  const controlPages = record.controlPages.filter((c) => !excludeControlPaths.has(contaminationPathOf(c)));
  const pages = [record.page, ...controlPages];

  const preStart = addDays(shipDate, -BASELINE_WINDOW_DAYS);
  const pre = await readWindowForPages({ tenantId, pages, start: preStart, end: shipDate });

  const readWindow = async (day: ProofWindowDay, ran: boolean): Promise<ProofWindowResult> => {
    const post = ran ? await readWindowForPages({ tenantId, pages, start: shipDate, end: addDays(shipDate, day) }) : null;
    const treatedPre = pre.get(record.page) ?? NULL_METRICS;
    const treatedPost = post?.get(record.page) ?? NULL_METRICS;
    const controls = controlPages
      .map((c) => ({ pre: pre.get(c) ?? NULL_METRICS, post: post?.get(c) ?? NULL_METRICS }))
      .filter((c) => c.pre.impressions > 0 && (!ran || c.post.impressions > 0));
    return computeWindowLift({
      day, checkOn: addDays(shipDate, day), ran, treatedPre, treatedPost, controls,
      preWindowDays: BASELINE_WINDOW_DAYS,
    });
  };

  const windowStates = evaluateWindows(shipDate, now, lastFinal);
  const windows: ProofWindowResult[] = [];
  for (const day of PROOF_WINDOW_DAYS) {
    windows.push(await readWindow(day, windowStates.find((w) => w.day === day)!.state === "closed"));
  }
  // A DAY-56 READING THAT HAS RUN IS KEPT, ALWAYS. The rebuild above covers 7/14/28 only, so a recompute that arrives when the fourth
  // checkpoint is not due again (the ordinary case: it is due exactly once) used to drop a reading Beacon already took and had already
  // judged on. It is carried forward untouched, never re-read, and never re-bought.
  const readSomething = windows.some((w) => w.ran); // what THIS pass read, before the kept reading
  const kept56 = (record.windows ?? []).find((w) => w.day === FOLLOW_UP_WINDOW_DAY && w.ran);
  if (kept56) windows.push(kept56);

  const measured: ShippedChangeRecord = {
    ...record,
    windows,
    measuredAt: readSomething ? now.toISOString() : record.measuredAt,
    updatedAt: now.toISOString(),
  };
  const settle = (): void => {
    const { verdict, confidence } = storedVerdictFor(measured, now, lastFinal);
    // Operator "exclude from learning" pins the stored verdict to inconclusive.
    measured.verdict = record.operatorVerdictOverride === "inconclusive" ? "inconclusive" : verdict;
    measured.confidence = confidence;
  };
  settle();

  // The conditional fourth checkpoint, decided on the 28-day read that just landed.
  const followUp = day56Followup(measured, lastFinal, now);
  if (followUp.due) {
    measured.windows = [...windows, await readWindow(FOLLOW_UP_WINDOW_DAY, true)];
    settle();
  }
  return measured;
}

/** Pull the human context for a shipped change from the cached page context: canonical page, path and the page's top target queries.
 *  Before/after text and the headline action come from the operator's own entry (Slice 7 removed the superseded brief lookup that used to
 *  guess them). Best-effort; every field degrades to null/[]. */
export async function captureChangeMeta(
  tenantId: string,
  pageUrl: string,
): Promise<{ canonPage: string; path: string; before: string | null; after: string | null; targetQueries: string[]; headlineAction: string | null; contentHash: string | null }> {
  let canonPage = canonicalizeCitationUrl(pageUrl) ?? pageUrl;
  const path = toPath(canonPage);
  let targetQueries: string[] = [];
  // The page's HELD content as of the last crawl. Never fetched here: a Shipment records what Beacon already had on file the moment the
  // operator marked the change done, so a later crawl can say whether the page actually moved.
  let contentHash: string | null = null;
  try {
    const ctx = await loadPageSurgeonContext(tenantId);
    if (!ctx.gscByUrl.has(canonPage) && !ctx.snapshotByCanon.has(canonPage)) {
      const match = [...ctx.gscByUrl.keys(), ...ctx.snapshotByCanon.keys()].find((k) => toPath(k) === path) ?? null;
      if (match) canonPage = match;
    }
    const packet = assemblePacketForUrl(ctx, canonPage);
    targetQueries = (packet.gsc?.topQueries ?? []).slice(0, 5).map((q) => q.query);
    contentHash = ctx.snapshotByCanon.get(canonPage)?.content_hash ?? null;
  } catch {
    /* best-effort */
  }
  return { canonPage, path, before: null, after: null, targetQueries, headlineAction: null, contentHash };
}

/** How many rows the probe below reads to find WHICH day the answers on file end on. It never counts anything: the day it names is then
 *  read whole. */
const AI_BASELINE_ROWS = 60;

/** The AI half of the Shipment baseline, from answers ALREADY on file: the latest reporting day's FIRST reading of each tracked question,
 *  how many of those were read closely enough to say whether this account was named (`analyzed`), and how many named it. Zero provider
 *  calls, zero cost. Null when nothing is on file, which is a different claim from zero mentions and is stored as such. `analyzed` IS THE
 *  DENOMINATOR the later comparison divides by, and it is stored here so both sides of a shipped change are the same measure. Counting
 *  mentions over every answer that came back made an answer nobody had read yet an implicit miss, while the after side divided by the
 *  answers actually read: a change was then judged by comparing one rate against a different one. */
async function latestAiPresence(tenantId: string): Promise<{ day: string; checked: number; analyzed: number; mentioning: number } | null> {
  try {
    // Slot 0 is asked for in the QUERY, not filtered afterwards: the extra volatility samples would otherwise eat the row cap and leave the
    // baseline reading a fraction of the day.
    const probe = (await readAiObservationViews(tenantId, { limit: AI_BASELINE_ROWS, slot: 0 }))
      .filter((r) => r.slot === 0 && r.status === "observed");
    const day = probe.map((r) => r.day).sort().pop();
    if (!day) return null;
    // THEN THE WHOLE DAY, named as a day so the reader hands back all of it. A 140 answer day counted off the newest 60 rows froze a
    // baseline over a fraction of the day and compared every later reading against it, so the "before" side of a shipped change was a
    // sample and the "after" side was a day.
    const onDay = (await readAiObservationViews(tenantId, { day, slot: 0 }))
      .filter((r) => r.slot === 0 && r.status === "observed" && r.day === day);
    // Read closely = the WHOLE answer was read and carries an owned-brand verdict. A reading still missing pieces is real work, not a
    // finished check, so it never enters the baseline denominator.
    const verdictOf = (r: { analysis: Record<string, unknown> | null }) =>
      (r.analysis as { ownedBrandMention?: { mentioned?: unknown } | null } | null)?.ownedBrandMention ?? null;
    const analyzed = onDay.filter((r) => isAnalysisSettled(r) && verdictOf(r) != null);
    return { day, checked: onDay.length, analyzed: analyzed.length,
      mentioning: analyzed.filter((r) => verdictOf(r)?.mentioned === true).length };
  } catch {
    return null;
  }
}

/** ONE Shipment per (proposal, exact version applied). A retry computes the same id and upserts itself, so a double press can never leave
 *  two records of one change. */
function shipmentIdFor(proposalId: string, proposalVersion: string): string {
  return `shp_${createHash("sha256").update(`${proposalId}|${proposalVersion}`).digest("hex").slice(0, 32)}`;
}

/** What the mark-implemented action knows about the change being shipped. Structural on purpose: the caller passes the object, Measurement
 *  never names a Decision type. */
type ShipmentOrigin = {
  proposalId: string;
  proposalVersion: string;
  basis: string | null;
  caseId: string | null;
  bundleHypothesis: string;
  /** The components the operator says they applied, each with the exact copy it carried and the risk the proposal graded it at. A subset =
   *  a partial bundle, and the copy is what the live check compares the page against. */
  componentsApplied: NonNullable<ShippedChangeRecord["componentsApplied"]>;
  implementedAt: string;
  preChangeContentHash: string | null;
  /** TRUE = nothing on file describes this page as it stood before the change, so the live check compares FORWARD only
   *  and no before-state is ever claimed. Set by the repair door, which records a change that was already live. */
  preChangeHashUnavailable?: boolean;
  /** What they say they actually put on the page, in their own words. A NOTE beside the reading, never a substitute for it: no note has
   *  ever made a change verified and none ever will. */
  operatorNote?: string | null;
};

/** The pages this account already has an edit queued or freshly landed on. A page about to move is
 *  not a still page, so it cannot anchor a difference. Never throws: an unreadable queue narrows
 *  the answer to what the ledger alone knows. */
export async function openChangePaths(tenantId: string): Promise<string[]> {
  const store = await loadChangeProposals(tenantId).catch(() => null);
  if (store == null) return [];
  return [...store.values()]
    .filter((p) => p.status === "ready" || p.status === "implemented_pending_verification")
    .map((p) => p.pagePath ?? "")
    .filter((p) => p.length > 0);
}

/** How many demand-ranked pages the matcher considers before picking three. Wider than the three it
 *  needs, so the matched page is chosen rather than whichever page happened to be biggest. */
const CONTROL_CANDIDATE_POOL = 40;

/** The jobs ALREADY on file for these pages, and no others. The transport refuses every call, so a
 *  page whose job was read before answers for free and a page whose job was never read answers null,
 *  which costs nothing and blocks nothing. */
async function cachedPageJobs(tenantId: string, ctx: Awaited<ReturnType<typeof loadPageSurgeonContext>>, urls: string[]) {
  return loadPageJobs(tenantId, urls.map((url) => {
    const snap = ctx.snapshotByCanon.get(url);
    return { url, title: snap?.title, h1: snap?.h1, headings: snap?.h2_list ?? [], wordCount: snap?.word_count ?? null };
  }), { complete: async () => ({ error: "comparison matching reads only the jobs already on file", retryable: false }) })
    .catch(() => new Map<string, { pageType: string }>());
}

/**
 * THE ONE COMPARISON-PAGE CHOOSER, for every door that writes a ledger record, WITH THE RECEIPT.
 *
 * Raw traffic order used to decide this: the three biggest pages on the site stood behind a small
 * one, and the difference they anchored was mostly the difference between a hub and a leaf. The pool
 * is now every page this account is not currently changing, and the three that stand behind a change
 * are the ones whose job on file says the same shape, whose traffic sits beside it, and whose
 * baseline window actually holds Search data. Read for THIS account explicitly and frozen at
 * selection time. NULL is a read that FAILED, a different sentence from a site with too few pages.
 */
export async function matchedControlsFor(
  tenantId: string, treatedPage: string, shipDate: string, now: Date,
): Promise<{ controls: string[]; receipts: ControlReceipt[] } | null> {
  const [ledger, ctx, open] = await Promise.all([
    loadShippedChangesForTenant(tenantId).catch(() => null),
    loadPageSurgeonContext(tenantId).catch(() => null),
    openChangePaths(tenantId),
  ]);
  if (ledger == null || ctx == null) return null;
  const pool = topPagesByDemand(ctx, CONTROL_CANDIDATE_POOL)
    .map((u) => canonicalizeCitationUrl(u) ?? u)
    .filter((u) => u && u !== treatedPage);
  const excluded = contaminationFor(ledger, open, now, { path: toPath(treatedPage), shippedAt: shipDate });
  // The SAME pre-change window the diff in diff reads, so "traffic beside it" and "the baseline holds
  // data" are the numbers the measurement itself will use, not a 90-day average standing in for them.
  const baseline = await readWindowForPages({
    tenantId, pages: [treatedPage, ...pool], start: addDays(shipDate, -BASELINE_WINDOW_DAYS), end: shipDate,
  }).catch(() => new Map<string, GscWindowMetrics>());
  const jobs = await cachedPageJobs(tenantId, ctx, [treatedPage, ...pool]);
  const typeOf = (u: string): string | null => jobs.get(canonicalUrlKey(u))?.pageType ?? null;
  return selectMatchedControls({
    treated: {
      path: toPath(treatedPage), pageType: typeOf(treatedPage),
      baselineImpressions: baseline.get(treatedPage)?.impressions ?? 0,
    },
    candidates: pool.map((url) => ({
      url, path: toPath(url), pageType: typeOf(url),
      baselineImpressions: baseline.get(url)?.impressions ?? 0,
      hasBaseline: (baseline.get(url)?.impressions ?? 0) > 0,
    })),
    excluded,
  });
}

/** The same chooser, for a door that wants only the pages. NULL still means the read failed. */
export async function selectControlPages(tenantId: string, treatedPage: string): Promise<string[] | null> {
  const now = new Date();
  return (await matchedControlsFor(tenantId, treatedPage, defaultPacificShipDate(now), now))?.controls ?? null;
}

/** Capture a 28-day baseline + create the ledger record for a manually-shipped change, then measure it immediately. Preserves the (path,
 *  ship-date) id. With `shipment`, the SAME record is the canonical Shipment for one ChangeProposal: its id is derived from the proposal
 *  and the exact version applied (so a retry lands on the same row), it carries the stamp the measurement window is read from, and its
 *  starting numbers cover search AND AI. Every read here is of data already bought. */
export async function recordShippedChange(args: {
  tenantId: string;
  page: string;
  path: string;
  actionType: string;
  before: string | null;
  after: string | null;
  targetQueries: string[];
  controlPages: string[];
  /** WHY each comparison page qualified, in checkable facts. Absent on a door that chose its own. */
  controlsReceipt?: ControlReceipt[] | null;
  shippedAt?: string;
  notes?: string | null;
  verifiedLive?: boolean;
  liveSourceUrl?: string | null;
  shipment?: ShipmentOrigin;
  /** Whether this one can be fairly compared, decided by the recording seam BEFORE the write. A shortage
   *  is recorded here, never used to refuse the write: an implementation fact is a fact. */
  measurementState?: MeasurementState | null;
  /** The ONE metric this change was made to move. Defaults to clicks; an AI citation card passes ai_mentions. */
  judgedMetric?: string | null;
  now?: Date;
}): Promise<ShippedChangeRecord> {
  // NO FLOOR ON THE WRITE. A shipment used to be refused outright below MIN_CONTROLS, so a true
  // implementation went unrecorded because Beacon could not measure it: two different facts, and the
  // one about the operator's work is never contingent on the one about the data. The shortage travels
  // as `measurementState` and Results says it plainly instead.
  const now = args.now ?? new Date();
  const shippedAt = args.shippedAt ?? defaultPacificShipDate(now);
  const shipDate = dateOnly(shippedAt);
  const preStart = addDays(shipDate, -BASELINE_WINDOW_DAYS);
  const pre = await readWindowForPages({ tenantId: args.tenantId, pages: [args.page], start: preStart, end: shipDate })
    .catch(() => new Map<string, GscWindowMetrics>());
  // NOTHING ON FILE IS NOT ZERO. A page Search Console holds no row for gets NO frozen starting point
  // rather than a row of zeros, which would read on screen as "it had no traffic before" and become the
  // number every later window is compared against.
  const held = pre.get(args.page) ?? null;
  const base = held ?? NULL_METRICS;
  const ship = args.shipment ?? null;
  const searchBaseline = { ...base, windowDays: BASELINE_WINDOW_DAYS };
  const draft: ShippedChangeRecord = {
    id: ship ? shipmentIdFor(ship.proposalId, ship.proposalVersion) : `${args.path}::${shipDate}`,
    page: args.page,
    path: args.path,
    actionType: args.actionType,
    before: args.before,
    after: args.after,
    shippedAt,
    baseline: searchBaseline,
    targetQueries: args.targetQueries,
    controlPages: args.controlPages,
    controlsReceipt: args.controlsReceipt ?? null,
    // WHAT THIS SHIPMENT IS JUDGED ON, declared at record time. A change is a bet on ONE metric over ONE
    // window; leaving these null let every later reading pick its own yardstick.
    judgedMetric: args.judgedMetric ?? "clicks", primaryWindowDays: 28,
    windows: [],
    verdict: "measuring",
    confidence: "low",
    measuredAt: null,
    notes: args.notes ?? null,
    verifiedLive: args.verifiedLive ?? false,
    liveSourceUrl: args.liveSourceUrl ?? null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null,
    proposalId: ship?.proposalId ?? null,
    proposalVersion: ship?.proposalVersion ?? null,
    basis: ship?.basis ?? null,
    caseId: ship?.caseId ?? null,
    bundleHypothesis: ship?.bundleHypothesis ?? null,
    componentsApplied: ship?.componentsApplied ?? null,
    implementedAt: ship?.implementedAt ?? null,
    preChangeContentHash: ship?.preChangeContentHash ?? null,
    preChangeHashUnavailable: ship?.preChangeHashUnavailable === true,
    measurementState: args.measurementState ?? null,
    // Written once, here, and never touched again: the store refuses a second write.
    shipmentBaseline: ship && held
      ? { search: searchBaseline, ai: await latestAiPresence(args.tenantId), capturedAt: now.toISOString() }
      : null,
    // NULL, ALWAYS, and null IS the due marker the verification runtime reads. Marking a change done starts the check; nothing the operator
    // can press or type ends it, so this is never written at mark time.
    verification: null,
    operatorNote: ship?.operatorNote ?? null,
    // Nothing is frozen at ship time: the first window has not even opened.
    pinnedRead: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  // The one policy, asked here exactly as every other door asks it: the pages that cannot stand
  // behind THIS change over ITS window, and nothing wider.
  const [ledger, open] = await Promise.all([
    loadShippedChangesForTenant(args.tenantId).catch(() => [] as ShippedChangeRecord[]),
    openChangePaths(args.tenantId),
  ]);
  return measureRecord(args.tenantId, draft, now, undefined,
    contaminatedPaths(contaminationFor(ledger, open, now, draft)));
}
