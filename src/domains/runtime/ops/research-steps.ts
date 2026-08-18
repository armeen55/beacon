import "server-only";

/**
 * research-steps (V1 Truth Convergence Phase 5, 2026-07-31) - the PHASE BODIES of a Research Run:
 * what each phase actually does, and the injectable shape the runner drives them through. Split
 * out of on-visit-refresh.ts, which owns the ordering, the lease and the truth boundary; the
 * contract between the two is `ResearchCycleSteps` and nothing else. A test replaces one body and
 * gets the real ordering; production passes none and gets the real bodies below.
 */

import { autoRefreshStaleConnectorsForTenant } from "@/lib/connectors/on-use-refresh";
import {
  keywordDiscoveryUnit, promptObservationUnit, serpAnalysisUnit, winningPagesUnit,
  type FunnelUnitOutcome,
} from "@/domains/evidence";
import { loadFunnelState, saveFunnelState, type FunnelState } from "@/domains/evidence/funnel/state";
import type { ResearchCase } from "@/domains/evidence/funnel/research-evidence";
import { applySynthesis } from "@/domains/evidence/case-identity";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import { renderUnreadOwnedPages } from "@/domains/evidence/pages/rendered-read";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { synthesizeCases } from "@/domains/decision/case-synthesis";
import { buildTopicInvestigations, reconcileResearchCases } from "@/domains/evidence/topic-investigation";
import { ensureDeepBackfill } from "@/lib/connectors/gsc/deep-backfill";
import { continueColdStartCrawlIfStarted, startColdStartCrawl } from "@/domains/evidence/scanning/crawl-frontier";
import { nextCrawlCandidates } from "@/domains/evidence/scanning/owned-pages-store";
import { loadGscDecaySignalsForTenant } from "@/domains/evidence/readers/gsc-page-signals";
import { getTenant } from "@/domains/account";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { shipmentBustedAt, verifyDueShipments } from "@/domains/measurement/verify-shipment";
import { settleDueMeasurements } from "@/domains/measurement/proof-gsc/auto-measure-on-use";
import { log } from "@/lib/logger";
import { warmFreeSurfaces } from "./warm-caches";
import { chooseInvestigation, comparisonForFocus, focusReads, type ResearchFocus } from "./investigation-queries";
import { dailyChecks, dueObservations, runAnswerAnalyses } from "./daily-observations";
import { reportingDay } from "@/lib/reporting-day";
import { accountBasis, dueWork, evidenceRowVersion, type DuePhase, type DueWork } from "./due-work";
import type { ResearchPhase } from "../research-run";

/** Reasons the deep-backfill continuation returns when there is simply nothing to do (no backfill started, already finished, or no synced property yet):
 *  healthy no-ops that advance the phase without a failure. Any OTHER reason is a real error and throws. */
const BENIGN_BACKFILL_SKIPS = new Set(["not_started", "already_complete", "no_synced_property", "no_cursor"]);
/** How many accounts one recovery probe may look at, and how the fleet ROTATES past that bound. Twenty was a fixed HEAD of the account list, so account twenty one
 *  was never probed, ever: it could be short every day forever and nothing would find it. The window MOVES now, by a deterministic offset off the clock in id
 *  order, wrapping at the end of the fleet, so consecutive dispatches walk the whole list whatever its size with no cursor to persist, no fleet held in memory and
 *  no second scheduler. Still bounded: this is a recovery sweep, not a fleet scan. */
const RECOVERY_PROBE_ACCOUNTS = 20, PROBE_ROTATION_MS = 3_600_000;

/** The refresh_sources phase outcome: how many sources were attempted, the identities of the ones that actually synced, and the bounded per-source
 *  failure detail for the rest. `succeeded` is a list of provider identities (not a count) so retries can UNION distinct successes rather than
 *  double-count them. */
type RefreshSourcesResult = { attempted: number; succeeded: string[]; failures: Array<{ provider: string; detail: string }> };

/** The gsc_backfill_chunk phase outcome. `advanced` = a chunk pulled (or the backfill defensively completed); `no_work` = a benign skip. A real error is
 *  a THROW, never a value. */
type BackfillChunkResult = { kind: "advanced"; complete?: boolean; daysPulled?: number } | { kind: "no_work" };

/** Injectable phase bodies + clock/deadline so the runner is testable with a short budget and stub executors; production passes nothing and uses the real
 *  implementations below. Every executor receives the persisted attemptKey so a retry can prove it is the same unit of work. */
export type ResearchCycleSteps = {
  refreshSources: (tenantId: string, now: Date, attemptKey: string) => Promise<RefreshSourcesResult>;
  backfillChunk: (tenantId: string, now: Date, attemptKey: string) => Promise<BackfillChunkResult>;
  /** ONE bounded batch of the account's OWN website (crawl_pages). The polite raw reads are free; pages the
   *  raw fetch stored as zero-word 200s then get a BOUNDED rendered read through the one provider gateway,
   *  because a CMS page rendered with javascript is invisible to a raw fetch and blindness is not evidence. */
  crawlPages: (tenantId: string, now: Date) => Promise<number>;
  /** The four Slice 6 evidence executors (evidence facade), one per funnel phase. */
  funnelUnit: (phase: ResearchPhase, tenantId: string, cursor: Record<string, unknown> | null, budgetMs: number, focus: ResearchFocus | null) => Promise<FunnelUnitOutcome>;
  /** THIS run's investigation, asked for ONCE (Runtime asks Decision, Evidence gets strings and pages). */
  investigationFocus: (tenantId: string, basis: string | null) => Promise<ResearchFocus | null>;
  /** The account's CURRENT onboarding basis (the one Account fingerprint); the funnel scopes every derived read/write to it. Null = not resolvable. */
  currentBasis: (tenantId: string) => Promise<string | null>;
  /** Freeze every case's identity on file before anything reads or spends against it. RESOLVES only when that identity is actually persisted; a THROW
   *  pauses the phase before a focus, a unit or a cent. `plan` bounds the ONE advisory reading: which cases this run froze (they are reviewed first),
   *  whether a reading may still be attempted at all this run, and `mark`, called at the instant one is attempted so the runner can persist that fact. */
  reconcileCases: (tenantId: string, basis: string, plan: CaseReconcilePlan) => Promise<void>;
  publishSurface: (tenantId: string, attemptKey: string) => Promise<void>;
  /** CHECK ONE PAGE'S OWN CLAIMS AGAINST SOURCES OUTSIDE IT. Bounded, budgeted and fail-soft: this phase
   *  never blocks a run, because a page whose statements could not be checked today is not an outage. */
  factCheck: (tenantId: string, budgetMs: number) => Promise<{ banked: number; reason?: string }>;
  surfaceStale: (tenantId: string, nowMs: number) => Promise<boolean>;
  /** Read back the day's NEW answers (bounded, $0 when nothing changed). Returns THE PASS'S OWN RECEIPT, not a bare number: how many answers it took on, how many
   *  ended with a durable verdict, how many of those were a non-reading, and how many real readings landed, so a run row can say what a pass actually did instead
   *  of showing a count nobody can check against the debt. Derived work: it never pauses the run. `budgetMs` is what is LEFT of the drive's own deadline, and the reading obeys it before every wave and every single:
   *  a bound counted in answers is not a bound on the wall clock the hosting platform actually enforces. */
  analyzeAnswers: (tenantId: string, reportingDay: string, budgetMs: number) => Promise<{ attempted: number; settled: number; refused: number; read: number; outcomes: Record<string, number> }>;
  /** WHAT THE OPERATOR SAID THEY SHIPPED, checked on the live page (verify_and_measure). Bounded to three pages per pass and free: every one is a read of a page the account owns, on the same polite-fetch
   *  path as every other owned read, never a provider. Returns how many verifications landed. Derived work: a check I could not make never pauses the run. */
  verifyShipments: (tenantId: string, now: Date) => Promise<number>;
  /** WHAT THOSE SHIPMENTS ACTUALLY DID, read on the schedule instead of on somebody opening Results (the second half of verify_and_measure). Free (Search Console
   *  and Analytics are already synced), bounded per pass, fail-soft, and it rebuilds the Results surface itself when a reading moved. Returns how many were measured. */
  measureShipments: (tenantId: string, now: Date) => Promise<number>;
  /** WHAT IS GENUINELY OWED, from persisted state only (see due-work). Free. It decides two things and nothing else: whether a second pass may open on a day that already completed one, and whether the
   *  pass that just opened has anything at all to do. */
  dueWork: (tenantId: string, now: Date) => Promise<DueWork>;
  /** TODAY'S WHOLE-DAY STANDING off the canonical planner: settled of intended, and how the settled ones landed. Null = I could not read it, which is never "the day is finished". Free. */
  dayStanding: (tenantId: string, reportingDay: string) => Promise<DueWork["checks"] | null>;
  /** Every active, unpaused account that still genuinely owes work right now AND EXACTLY WHAT IT OWES, off the ONE canonical due-work truth. The probe already
   *  computed that list to decide the account was short, and throwing it away is what left the pass it opens with no idea why it existed. Free and bounded; the
   *  clock is passed in because the bounded window ROTATES across the fleet with it. Empty = a read that SUCCEEDED and proved nothing was left behind; a read
   *  that could not be made THROWS, because an outage and an idle fleet are different answers. */
  strandedToday: (nowMs: number) => Promise<Array<{ tenantId: string; due: DuePhase[] }>>;
  /** The research notes' row version for a basis, read at the moment the decision step concludes: the watermark this pass consumed. Read AFTER the pass's own
   *  writes, never before, or a pass would forever count its own discovery as new evidence and re-open itself. */
  evidenceVersion: (tenantId: string, basis: string) => Promise<number | null>;
};

/** What this run still allows the ONE advisory reading. `mark` is the runner's own receipt: the reading is bounded per RUN, never per unit iteration. */
type CaseReconcilePlan = { planKeys: string[]; maySynthesize: boolean; mark: () => void };

/** DID THE REGISTRY ACTUALLY MOVE? Compared the way the registry is READ and never the way it happened to be written: the same rows in another order, or one
 *  row's anchors in another order, are the SAME registry, and a raw JSON compare called that a move, saved it, and bought a reading of a file nothing changed. */
const canonicalRegistry = (rows: readonly ResearchCase[] = []): string => JSON.stringify([...rows].map((c) => ({ id: c.id, anchors: [...c.anchors].sort(), aliasOf: c.aliasOf ?? null, parentId: c.parentId ?? null, pages: (c.pages ?? []).map((p) => `${p.url}|${p.relation}`).sort() })).sort((a, b) => a.id.localeCompare(b.id)));
const sameRegistry = (before: readonly ResearchCase[] = [], after: readonly ResearchCase[] = []): boolean => canonicalRegistry(before) === canonicalRegistry(after);

/** Fold this account's case identities onto the ones already on file and PERSIST them, or THROW. It used to swallow every failure, so a run whose
 *  identities were never written went straight on to freeze a plan and spend against them: the comparison it bought belonged to an id nothing on file
 *  agreed with. A losing row version is a failure too, because nothing was saved. Nothing here is a partial success. THEN, and only when the registry actually
 *  moved this pass AND this run has not asked yet, ONE advisory semantic reading of it (see decision/case-synthesis). That step is fail-soft by contract: the
 *  deterministic identities are already saved, so a reading I could not get, could not trust or could not write is simply absent. */
async function reconcileCases(tenantId: string, basis: string, plan: CaseReconcilePlan): Promise<void> {
  const saved = await (async () => {
    const snapshot = await loadEvidenceSnapshot(tenantId);
    const cases = reconcileResearchCases(snapshot);
    const loaded = await loadFunnelState(tenantId, basis);
    if (sameRegistry(loaded.state.cases, cases)) return true; // nothing moved: no save, and nothing to re-read
    const rowVersion = await saveFunnelState(tenantId, basis, { ...loaded.state, cases }, loaded.rowVersion);
    if (rowVersion == null) return false;
    // The mark goes down BEFORE the reading, so one that came back empty, refused or unusable still spends this run's single attempt.
    if (plan.maySynthesize) { plan.mark(); await refineCases(tenantId, basis, snapshot, cases, { ...loaded.state, cases }, rowVersion, plan.planKeys).catch(() => {}); }
    return true;
  })().catch(() => false);
  if (!saved) throw new Error("I could not save which of your topics are which, so I stopped before spending anything on them. I pick this up again on your next visit.");
}

/** The ONE semantic pass over the registry that just changed, applied through the SAME identity rules and saved through the SAME path. Everything it
 *  proposes is checked before it is applied, and what I refuse is recorded rather than argued with. A lost row version here changes nothing that is
 *  already on file. */
async function refineCases(tenantId: string, basis: string, snapshot: EvidenceSnapshot, cases: ResearchCase[], state: FunnelState, rowVersion: number, planKeys: string[] = []): Promise<void> {
  const investigations = buildTopicInvestigations(snapshot);
  if (investigations.length < 2) return;
  // Which of MY OWN pages Google already serves for a case's own searches: the only addresses the reading may name, a lookup over evidence already in hand, so it
  // fetches nothing and costs nothing. WHICH cases get reviewed when there are more than the reading may hold: the ones this run froze, then the biggest demand.
  const owned = snapshot.ownedPages.map((p) => ({ url: p.url, keys: new Set((p.search?.topQueries ?? []).map((q) => canonicalQueryKey(q.query))) }));
  const synthesis = await synthesizeCases(investigations.map((i) => ({
    id: i.key, label: i.label, queries: i.queries, prompts: i.trackedPrompts.map((p) => p.promptText), groupedBy: i.groupedBy,
    ownedUrls: owned.filter((o) => i.queries.some((q) => o.keys.has(canonicalQueryKey(q)))).map((o) => o.url), inPlan: planKeys.includes(i.key), demand: i.demand.monthlySearchVolume,
  })), tenantId);
  if (!synthesis) return;
  const applied = applySynthesis(cases, synthesis, new Map(investigations.map((i) => [i.key, i.resultDomains])));
  for (const refusal of applied.refused.slice(0, 5)) log.info("[research-run] part of the reading of your topics did not hold up", { tenantId, refusal });
  if (sameRegistry(applied.cases, cases)) return; // nothing survived the checks: nothing to write
  await saveFunnelState(tenantId, basis, { ...state, cases: applied.cases }, rowVersion);
}

/** WHICH OF MY OWN PAGES GETS READ FIRST. The body store feeds every draft and the draft step refuses a page it has not read whole, so the pages the operator is actually waiting on are the ones losing clicks: a page under investigation whose body I never read produces nothing, however many results pages I buy for it. This does NOT change who is a candidate (the inventory still answers that in its own order, uncrawled then stale then blocked) and it can never add a page the inventory withheld; it only moves the DECLINING ones to the front of the batch that pass will read. One lean Search Console read, $0, and fail-soft: no readable decay is simply the inventory's own order, exactly as before. */
const crawlKey = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase();
async function decliningPagesFirst(tenantId: string): Promise<typeof nextCrawlCandidates> {
  const decay = await loadGscDecaySignalsForTenant(tenantId).catch(() => null);
  const losing = new Set([...(decay?.values() ?? [])].filter((d) => d.clicksNow < d.clicksPrior).map((d) => crawlKey(d.page)));
  if (losing.size === 0) return nextCrawlCandidates;
  // BOUND TO THE ACCOUNT THE DECLINE WAS READ FOR: a caller that ever hands this wrapper a different tenant gets the inventory's own order back, never another account's pages ranked over its own. Closing over the outer id alone left that a silent cross-tenant shape.
  return async (t: string, limit: number, now?: Date) => { const urls = await nextCrawlCandidates(t, limit, now);
    return t !== tenantId ? urls : [...urls.filter((u) => losing.has(crawlKey(u))), ...urls.filter((u) => !losing.has(crawlKey(u)))]; };
}

export const defaultSteps: ResearchCycleSteps = {
  async refreshSources(tenantId, now) {
    // autoRefreshStaleConnectorsForTenant is fail-soft PER SOURCE and returns one { ok } result per ATTEMPTED stale source, which is what the refresh_sources
    // contract above is counting. We do NOT .catch here: a THROW means the whole refresh could not run, and the runner must pause rather than record a false
    // "0 sources, all healthy".
    const results = await autoRefreshStaleConnectorsForTenant(tenantId, now);
    return { attempted: results.length, succeeded: results.filter((r) => r.ok).map((r) => String(r.provider)),
      failures: results.filter((r) => !r.ok).map((r) => ({ provider: String(r.provider), detail: String(r.detail).slice(0, 200) })) };
  },
  async backfillChunk(tenantId, now) {
    // No deadline race: the chunk is bounded by design and its GSC fetch has no AbortSignal, so a race would release the lease while live side-effecting work
    // kept running. ensureDeepBackfill converts a thrown error into { ran:false, reason }, so a non-benign reason here is a real failure.
    const result = await ensureDeepBackfill(tenantId, now);
    if (result.ran) {
      log.info("[research-run] gsc deep backfill chunk advanced", { tenantId, daysPulled: result.daysPulled, complete: result.complete });
      return { kind: "advanced", complete: result.complete, daysPulled: result.daysPulled };
    }
    if (BENIGN_BACKFILL_SKIPS.has(result.reason)) return { kind: "no_work" };
    // A real failure (auth / quota / network / unexpected) throws so the runner pauses AT gsc_backfill_chunk with the cursor untouched, making the retry the
    // identical window.
    throw new Error(`gsc backfill chunk did not advance: ${result.reason}`.slice(0, 200));
  },
  // THE ONE PLACE THE WEBSITE GETS READ, AND THE ONE PLACE A CRAWL BEGINS. A render must never crawl, so the
  // resumable frontier is driven here, one bounded batch per pass. Cold start used to fire only from onboarding,
  // so an account that predates it had no frontier at all: every pass asked to CONTINUE one, was told there is
  // none, and called that a healthy no-op forever. A missing frontier is now initialized once, NEVER forced, so
  // an instance that got there first is loaded and continued rather than reset; unreachable is persisted truth
  // and stops here. Fail-soft throughout, and a site already read whole is still a no-op that advances.
  async crawlPages(tenantId) {
    const deps = { pickCandidates: await decliningPagesFirst(tenantId) };
    const first = await continueColdStartCrawlIfStarted(tenantId, deps);
    if (first.status !== "no_crawl" || first.detail !== "no_frontier_state")
      return first.crawled + await renderUnreadOwnedPages(tenantId).catch(() => 0);
    const domain = (await getTenant(tenantId).catch(() => null))?.domain?.trim();
    if (!domain) return 0;
    if ((await startColdStartCrawl({ tenantId, domain, deps })).status === "unreachable") return 0;
    return (await continueColdStartCrawlIfStarted(tenantId, deps)).crawled
      + await renderUnreadOwnedPages(tenantId).catch(() => 0); },
  async dayStanding(tenantId, day) { const c = await dailyChecks(tenantId, day);
    return c == null ? null : { done: c.done, total: c.total, answers: c.answers, unavailable: c.unavailable, unsupported: c.unsupported }; },
  // THE DAY THE FLEET CLAIM CANNOT SEE. claim_due_research_work excludes an account the moment ANY run completed today, so a pass that settled its batch and left
  // the day short is owed nothing further and the rest of the day never happens. This is the free question that finds those accounts, and it asks ONE canonical
  // question: due-work, the same planner every other door consults. It used to ask only whether today's AI observations were short, so an account whose answers
  // were all collected but whose website was two hundred pages unread, whose bought answers nobody had read closely, whose promised evidence date had arrived or
  // whose release was never published looked finished and was never opened again that day. FREE either way (every read is a lean projection of state on file), and
  // A READ THAT FAILED IS NOT AN EMPTY FLEET, so it THROWS rather than answering with a list: empty now means a read that succeeded and proved nobody was left.
  async strandedToday(nowMs) {
    const active = () => getSupabaseAdmin().from("tenants").select("id", { count: "exact" }).eq("status", "active").not("research_paused", "is", true).order("id", { ascending: true });
    const read = async (start: number, take: number) => {
      const { data, error, count } = await active().range(start, start + Math.max(1, take) - 1);
      if (error != null) throw new Error(`[research-run] the recovery probe could not read the fleet: ${error.message}`);
      return { ids: ((data ?? []) as Array<{ id: string }>).map((r) => String(r.id)), total: Number(count ?? 0) }; };
    const head = await read(0, RECOVERY_PROBE_ACCOUNTS);
    const from = head.total <= RECOVERY_PROBE_ACCOUNTS ? 0 : (Math.floor(nowMs / PROBE_ROTATION_MS) * RECOVERY_PROBE_ACCOUNTS) % head.total;
    const ids = from === 0 ? [...head.ids] : (await read(from, RECOVERY_PROBE_ACCOUNTS)).ids;
    // The window WRAPS: the tail of the fleet and its head belong to one rotation, so nobody sits in a seam.
    if (ids.length < RECOVERY_PROBE_ACCOUNTS) ids.push(...head.ids.filter((id) => !ids.includes(id)).slice(0, RECOVERY_PROBE_ACCOUNTS - ids.length));
    const out: Array<{ tenantId: string; due: DuePhase[] }> = [];
    for (const id of ids) { const work = await dueWork(id, new Date(nowMs)); if (work.readable && work.due.length > 0) out.push({ tenantId: id, due: work.due }); }
    return out; },
  currentBasis: accountBasis,
  dueWork,
  evidenceVersion: evidenceRowVersion,
  // RUNTIME IS THE ONLY WRITER OF A CASE IDENTITY, and it writes them BEFORE the plan names one. Evidence resolves the id against what is already on file
  // (evidence/case-identity carries the whole rule and the incident behind it); this persists that answer through the funnel's own save path, and FAILS
  // CLOSED: an unreadable snapshot or row, or a losing row version, pauses this same phase honestly.
  async reconcileCases(tenantId, basis, plan) { await reconcileCases(tenantId, basis, plan); },
  async investigationFocus(tenantId, basis) { return chooseInvestigation(tenantId, basis).catch(() => null); },
  async funnelUnit(phase, tenantId, cursor, budgetMs, focus) {
    // An OPEN INVESTIGATION needs BOTH halves: the results page for that exact search AND the pages that win it. The topic is the RUN's, frozen by the
    // caller, never re-picked here: landing a results page closes that search, so a second, independent lookup handed winning-pages a different three than
    // the ones just paid for. The page COMPARISON rides the same phase that reads those winners, because the winners ARE the page set, but as its SECOND
    // stage, so a real lease renewal sits in front of it. A topic whose next legal read is still in the future contributes no search at all: a cooldown is
    // not a queue position.
    const { queries, cases, ownedUrl } = focusReads(focus, Date.now(), (cursor?.basis as string) ?? null);
    if (phase === "serp_analysis") return serpAnalysisUnit({}, queries)(tenantId, cursor, budgetMs);
    if (phase === "winning_pages") {
      // The ask is recomputed for the SAME frozen topic under the CURRENT basis, and only at the comparison stage: nothing is asked for before winners exist.
      // Fail-soft, and no reconfirmed ask means no buy.
      const ask = cursor?.stage === "compare" ? await comparisonForFocus(tenantId, focus, (cursor.basis as string) ?? null).catch(() => null) : null;
      // AT MOST ONE page of the account's OWN per run, and only one the frozen plan named and is due to read.
      // THE OPERATOR'S OWN CHANGE BUSTS THE PAGE'S FRESHNESS (Phase 6). The unit's fifth argument `ownedBustedAt` is when that page's truth moved underneath me, and the Shipment record is its supplier: the moment the
      // operator implemented something at that address. A body read before that moment describes a page that no longer exists, however recent the clock says it is, so it forces a re-read INSIDE the ordinary freshness
      // window instead of serving a stale body for a week. Lean and fail-soft: no shipment for that page, or an unreadable read, is null, which is the same answer as "nothing changed it".
      // The SAME deferral still runs the other way for the ceiling marker this run persists onto its own row (progress.capped): `caseResearchReceipt`'s `cappedToday` argument has no production CALLER yet, because the surface that shows one case's receipt is Phase 8 work. The marker is written now so that surface has something true to read the day it is built, and it is day-scoped so it cannot go stale waiting.
      const bustedAt = ownedUrl ? await shipmentBustedAt(tenantId, ownedUrl).catch(() => null) : null;
      return winningPagesUnit({}, queries, ask, ownedUrl, bustedAt)(tenantId, cursor, budgetMs);
    }
    if (phase === "prompt_observations") {
      // THE DAILY PLAN decides what gets asked, and it is the ONLY thing that does: the unit's own weekly stalest-pair sweep is deleted, not merely
      // overridden, because two selectors meant one of them re-asked a question the other had already read today. One canonical reading per question, per
      // engine, per REPORTING day (src/lib/reporting-day.ts is the one timezone contract), core first and oldest-missing-first. A null plan (I could not read what is due) asks NOTHING. The day is the RUN'S own cycle
      // day, not the wall clock, so a run that spans midnight keeps reporting into the day it opened instead of silently splitting itself.
      const day = String(cursor?.cycle ?? "").slice(-10) || reportingDay(Date.now());
      return promptObservationUnit({}, await dueObservations(tenantId, day))(tenantId, cursor, budgetMs);
    }
    // The plan's own cases ride into discovery, so every keyword is filed under the case it belongs to and the recurring winning domains are bought once per case set.
    return keywordDiscoveryUnit({}, cases)(tenantId, cursor, budgetMs); // the facade export is a deps factory returning the executor
  },
  async analyzeAnswers(tenantId, reportingDay, budgetMs) { return runAnswerAnalyses(tenantId, reportingDay, { budgetMs }); },
  async verifyShipments(tenantId) { return verifyDueShipments(tenantId); },
  async measureShipments(tenantId, now) { return settleDueMeasurements(tenantId, { now }); },
  // warmFreeSurfaces PROPAGATES failure (no internal swallow): a throw pauses publish_surface and the previously saved surface stays visible.
  async publishSurface(tenantId) { await warmFreeSurfaces(tenantId); },
  // THE PAGE THIS ACCOUNT IS MOST SHOWN FOR, checked against the sources for its own subjects. One page a
  // pass, statements it has not already checked at this version of the page, and every finding banked as a
  // row of its own. Fail-soft by construction: the answer is a count and a reason, never a thrown run.
  async factCheck(tenantId, budgetMs) {
    try {
      const [{ runFactCheckPass }, { readFactChecks }, { loadEvidenceSnapshot }, { loadOwnedPageBodies }] = await Promise.all([
        import("@/domains/evidence/pages/fact-check-run"), import("@/domains/evidence/pages/fact-checks"),
        import("@/domains/evidence/snapshot-loader"), import("@/domains/evidence/pages/owned-context"),
      ]);
      const snapshot = await loadEvidenceSnapshot(tenantId);
      const page = [...snapshot.ownedPages].sort((a, b) => (b.search?.impressions90d ?? 0) - (a.search?.impressions90d ?? 0))[0];
      if (!page) return { banked: 0, reason: "this account holds no page to check" };
      const bodies = await loadOwnedPageBodies(tenantId, [page.url]).catch(() => null);
      const held0 = bodies?.get?.(page.url); const body = held0 ? [held0.title, held0.h1, ...held0.headings, ...held0.passages].filter(Boolean).join("\n") : "";
      const held = await readFactChecks(tenantId, new URL(page.url.startsWith("http") ? page.url : `https://${page.url}`).pathname.replace(/\/+$/, "") || "/");
      const { callStructuredLLM } = await import("@/domains/decision/llm/structured-drafter");
      return await runFactCheckPass({
        tenantId, now: new Date(), basis: null,
        page: { url: page.url, path: new URL(page.url.startsWith("http") ? page.url : `https://${page.url}`).pathname.replace(/\/+$/, "") || "/", body },
        alreadyChecked: new Set(held.map((h) => h.statementKey)),
        read: async (input) => {
          const r = await callStructuredLLM({ kind: "editor_judgement", tenantId, system: input.system, user: input.user,
            grounded: input.grounded, projectedCostUsd: input.projectedCostUsd, maxTokens: input.maxTokens,
            timeoutMs: Math.min(95_000, Math.max(10_000, budgetMs)), now: new Date() }).catch(() => null);
          return r?.status === "drafted" ? (r.value as Record<string, unknown>) : null;
        },
        // SOURCE ACQUISITION rides the capability this account already buys results pages with, so the phase
        // spends inside the same budget and cache as every other bought read. Absent = this pass banks nothing.
        serpFor: async (query) => {
          const { providerCall, collectCapability, parseCapability } = await import("@/domains/evidence/dataforseo/capabilities");
          const call = await providerCall("serp_organic", { keyword: query }, { tenantId, unitKey: `fact-check:${tenantId}` }).catch(() => null);
          // hit = already bought and cached, ok = bought now. waiting/capped/error all mean no source list
          // this pass, which the runner reports as a reason rather than treating as "no sources exist".
          const envelope = call && (call.state === "hit" || call.state === "ok") ? call.envelope
            : call && call.state === "waiting" && call.cacheKey
              ? await collectCapability(call.cacheKey).then((c) => (c.state === "hit" || c.state === "ok" ? c.envelope : null)).catch(() => null)
              : null;
          if (!envelope) return null;
          const parsed = parseCapability("serp_organic", envelope);
          return parsed ? { organic: parsed.organic.map((o) => ({ domain: o.domain, url: o.url, title: o.title })) } : null;
        },
      });
    } catch (e) {
      log.warn("[research-steps] the fact check could not run this pass", { tenantId, error: e instanceof Error ? e.message : String(e) });
      return { banked: 0, reason: "the fact check could not run this pass" };
    }
  },
  async surfaceStale(tenantId, nowMs) {
    const { readCustomerSurface, isCustomerSurfaceStale } = await import("@/app/(shell)/surface-release");
    const surface = await readCustomerSurface(tenantId).catch(() => null);
    return surface == null || isCustomerSurfaceStale(surface.computedAt, nowMs); // no saved release yet = a first publish is genuinely due
  },
};

