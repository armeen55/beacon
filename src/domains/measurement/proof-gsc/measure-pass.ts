import "server-only";

/**
 * measure-pass (CORE 100K) - the GSC before/after comparison engine. Reads the
 * treated page + its comparison pages over the pre-ship window and each 7/14/28
 * post window via the existing GSC connector reads (gsc-window), computes the
 * observational diff in diff, and stamps the record's windows + a stored verdict
 * from the kernel. Replaces the retired run-measurement/measure stack.
 *
 * Observational, never causal: adjustedLift = (treatedPost - treatedPre) -
 * mean(controlPost - controlPre). No permutation nulls, FDR, calibration
 * self-tests, or forecast machinery.
 */

import { createHash } from "node:crypto";

import { canonicalizeCitationUrl } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";
import { readAiObservationViews } from "@/domains/evidence/ai-visibility/ai-observations";
import {
  loadPageSurgeonContext,
  assemblePacketForUrl,
} from "@/domains/decision/recommendation-intelligence/page-surgeon/assemble-packet";
import { readWindowForPages, readLastFinalizedDate } from "./gsc-window";
import {
  BASELINE_WINDOW_DAYS,
  PROOF_WINDOW_DAYS,
  type GscWindowMetrics,
  type ProofWindowDay,
  type ProofWindowResult,
} from "./types";
import type { ShippedChangeRecord } from "./shipped-change-store";
import { addDays, evaluateWindows, readLedger } from "./kernel";
import { day56Followup, FOLLOW_UP_WINDOW_DAY } from "./measure-lifecycle";

const NULL_METRICS: GscWindowMetrics = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

/** GSC's reporting zone is Pacific; default a ship date to that day. */
export function defaultPacificShipDate(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
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

/**
 * One window's observational diff in diff from already-read treated + control
 * window metrics. Pure. Pre clicks are pro-rated to the post window length so a
 * 28-day pre sum is never subtracted from a 7-day post sum.
 */
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

/**
 * Recompute the outcome for a shipped change from GSC. Reads the pre window once and each
 * post window once, for the treated page + all controls. Returns a NEW record with
 * windows/verdict/confidence/measuredAt updated. A control that is itself an active
 * treatment can be excluded from the diff.
 *
 * EVERY CHECKPOINT COUNTS FROM THE STAMP (implementedAt), because that is the day the
 * change actually went live; a record written before there was a stamp counts from its
 * ship date exactly as it always did. The day-56 read is CONDITIONAL: it runs only for a
 * change whose 28-day read did not settle, or that moved or hid the page. A clean 28-day
 * read closes measurement and no day-56 read is taken.
 */
export async function measureRecord(
  tenantId: string,
  record: ShippedChangeRecord,
  now: Date = new Date(),
  lastFinalizedDate?: string | null,
  excludeControlPaths: Set<string> = new Set(),
): Promise<ShippedChangeRecord> {
  const shipDate = dateOnly(record.implementedAt ?? record.shippedAt);
  const lastFinal = lastFinalizedDate !== undefined ? lastFinalizedDate : await readLastFinalizedDate(tenantId);
  const controlPages = record.controlPages.filter((c) => !excludeControlPaths.has(toPath(c)));
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
  // A DAY-56 READING THAT HAS RUN IS KEPT, ALWAYS. The rebuild above covers 7/14/28 only, so a
  // recompute that arrives when the fourth checkpoint is not due again (the ordinary case: it is
  // due exactly once) used to drop a reading Beacon already took and had already judged on. It is
  // carried forward untouched, never re-read, and never re-bought.
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

/**
 * Pull the human context for a shipped change from the cached page context:
 * canonical page, path and the page's top target queries. Before/after text and
 * the headline action come from the operator's own entry (Slice 7 removed the
 * superseded brief lookup that used to guess them). Best-effort; every field
 * degrades to null/[].
 */
export async function captureChangeMeta(
  tenantId: string,
  pageUrl: string,
): Promise<{ canonPage: string; path: string; before: string | null; after: string | null; targetQueries: string[]; headlineAction: string | null; contentHash: string | null }> {
  let canonPage = canonicalizeCitationUrl(pageUrl) ?? pageUrl;
  const path = toPath(canonPage);
  let targetQueries: string[] = [];
  // The page's HELD content as of the last crawl. Never fetched here: a Shipment
  // records what Beacon already had on file the moment the operator marked the
  // change done, so a later crawl can say whether the page actually moved.
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

/** How many rows of already-bought AI answers the Shipment baseline reads back. */
const AI_BASELINE_ROWS = 60;

/**
 * The AI half of the Shipment baseline, from answers ALREADY on file: the latest
 * reporting day's FIRST reading of each tracked question, and how many of those
 * named this account. Zero provider calls, zero cost. Null when nothing is on file,
 * which is a different claim from zero mentions and is stored as such.
 */
async function latestAiPresence(tenantId: string): Promise<{ day: string; checked: number; mentioning: number } | null> {
  try {
    // Slot 0 is asked for in the QUERY, not filtered afterwards: the extra volatility samples
    // would otherwise eat the row cap and leave the baseline reading a fraction of the day.
    const rows = (await readAiObservationViews(tenantId, { limit: AI_BASELINE_ROWS, slot: 0 }))
      .filter((r) => r.slot === 0 && r.status === "observed");
    const day = rows.map((r) => r.day).sort().pop();
    if (!day) return null;
    const onDay = rows.filter((r) => r.day === day);
    const mentioning = onDay.filter((r) => {
      const m = (r.analysis as { ownedBrandMention?: { mentioned?: unknown } } | null)?.ownedBrandMention;
      return m?.mentioned === true;
    }).length;
    return { day, checked: onDay.length, mentioning };
  } catch {
    return null;
  }
}

/** ONE Shipment per (proposal, exact version applied). A retry computes the same id and
 *  upserts itself, so a double press can never leave two records of one change. */
function shipmentIdFor(proposalId: string, proposalVersion: string): string {
  return `shp_${createHash("sha256").update(`${proposalId}|${proposalVersion}`).digest("hex").slice(0, 32)}`;
}

/** What the mark-implemented action knows about the change being shipped. Structural on
 *  purpose: the caller passes the object, Measurement never names a Decision type. */
type ShipmentOrigin = {
  proposalId: string;
  proposalVersion: string;
  basis: string | null;
  caseId: string | null;
  bundleHypothesis: string;
  /** The components the operator says they applied, each with the exact copy it carried and the risk
   *  the proposal graded it at. A subset = a partial bundle, and the copy is what the live check
   *  compares the page against. */
  componentsApplied: Array<{ kind: string; label: string; after?: string | null; risk?: string | null }>;
  implementedAt: string;
  preChangeContentHash: string | null;
  /** THE OVERRIDE, and only the override: the operator states this is live and asks me not to argue. */
  operatorConfirmed?: boolean;
  /** Why they overrode the check, in their own words. */
  operatorOverrideReason?: string | null;
};

/** The operator's own confirmation, written as the verification itself so the verifier never fetches this
 *  page and never claims to have checked anything. Never a default, and never a stand-in for a check that
 *  failed: it exists for the one case where the operator tells me on purpose. */
function operatorConfirmedVerification(
  components: ShipmentOrigin["componentsApplied"], at: string,
): NonNullable<ShippedChangeRecord["verification"]> {
  return {
    status: "operator_confirmed", checkedAt: at,
    components: components.map((c) => ({ kind: c.kind, state: "unknown" as const,
      note: "You confirmed this one yourself, so I did not check the page." })),
  };
}

/**
 * Capture a 28-day baseline + create the ledger record for a manually-shipped
 * change, then measure it immediately. Preserves the (path, ship-date) id.
 *
 * With `shipment`, the SAME record is the canonical Shipment for one ChangeProposal:
 * its id is derived from the proposal and the exact version applied (so a retry lands
 * on the same row), it carries the stamp the measurement window is read from, and its
 * starting numbers cover search AND AI. Every read here is of data already bought.
 */
export async function recordShippedChange(args: {
  tenantId: string;
  page: string;
  path: string;
  actionType: string;
  before: string | null;
  after: string | null;
  targetQueries: string[];
  controlPages: string[];
  shippedAt?: string;
  notes?: string | null;
  verifiedLive?: boolean;
  liveSourceUrl?: string | null;
  shipment?: ShipmentOrigin;
  now?: Date;
}): Promise<ShippedChangeRecord> {
  const now = args.now ?? new Date();
  const shippedAt = args.shippedAt ?? defaultPacificShipDate(now);
  const shipDate = dateOnly(shippedAt);
  const preStart = addDays(shipDate, -BASELINE_WINDOW_DAYS);
  const pre = await readWindowForPages({ tenantId: args.tenantId, pages: [args.page], start: preStart, end: shipDate });
  const base = pre.get(args.page) ?? NULL_METRICS;
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
    // Written once, here, and never touched again: the store refuses a second write.
    shipmentBaseline: ship
      ? { search: searchBaseline, ai: await latestAiPresence(args.tenantId), capturedAt: now.toISOString() }
      : null,
    // Null IS the due marker the verification runtime reads. The ONE exception is the operator's explicit
    // override, which is an answer at mark time, so the live check is not owed and never runs.
    verification: ship?.operatorConfirmed === true
      ? operatorConfirmedVerification(ship.componentsApplied, now.toISOString())
      : null,
    operatorOverrideReason: ship?.operatorOverrideReason ?? null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  return measureRecord(args.tenantId, draft, now);
}
