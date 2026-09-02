import "server-only";

/** research-steps (V1 Truth Convergence Phase 5, 2026-07-31) - the PHASE BODIES of a Research Run: what each phase actually does, and the injectable shape the runner drives them through. Split out of on-visit-refresh.ts, which owns
 *  the ordering, the lease and the truth boundary; the contract between the two is `ResearchCycleSteps` and nothing else. A test replaces one body and gets the real ordering; production passes none and gets the real bodies below. */

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
import { publishCustomerSurfaces } from "./warm-caches";
import { chooseInvestigation, comparisonForFocus, focusReads, type ResearchFocus } from "./investigation-queries";
import { dailyChecks, dueObservations, runAnswerAnalyses } from "./daily-observations";
import { reportingDay } from "@/lib/reporting-day";
import { accountBasis, dueWork, evidenceRowVersion, READY_STOCK_ALARM, readyStockFloor, type DuePhase, type DueWork } from "./due-work";
import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";
import type { EvidenceRequirement } from "@/domains/decision/producers/contract";
import type { ResearchPhase } from "../research-run";
/** ONE OWED READING as the receipt carries it: the typed requirement plus whose work asked and why. */
type OwedReading = EvidenceRequirement & { key: string; reason: string; workKey: string };
/** Reasons the deep-backfill continuation returns when there is simply nothing to do (no backfill started, already finished, or no synced property yet):
 *  healthy no-ops that advance the phase without a failure. Any OTHER reason is a real error and throws. */
const BENIGN_BACKFILL_SKIPS = new Set(["not_started", "already_complete", "no_synced_property", "no_cursor"]);
/** How many accounts one recovery probe may look at, and how the fleet ROTATES past that bound. Twenty was a fixed HEAD of the account list, so account twenty one was never probed, ever: it could be short every day forever and
 *  nothing would find it. The window MOVES now, by a deterministic offset off the clock in id order, wrapping at the end of the fleet, so consecutive dispatches walk the whole list whatever its size with no cursor to persist, no
 *  fleet held in memory and no second scheduler. Still bounded: this is a recovery sweep, not a fleet scan. */
const RECOVERY_PROBE_ACCOUNTS = 20, PROBE_ROTATION_MS = 3_600_000, FREE_COLLECT_PER_RUN = 5;
/** The refresh_sources phase outcome: how many sources were attempted, the identities of the ones that actually synced, and the bounded per-source failure detail for the rest. `succeeded` is a list of provider identities (not a
 *  count) so retries can UNION distinct successes rather than double-count them. */
type RefreshSourcesResult = { attempted: number; succeeded: string[]; failures: Array<{ provider: string; detail: string }> };
/** The gsc_backfill_chunk phase outcome. `advanced` = a chunk pulled (or the backfill defensively completed); `no_work` = a benign skip. A real error is a THROW, never a value. */
type BackfillChunkResult = { kind: "advanced"; complete?: boolean; daysPulled?: number } | { kind: "no_work" };

/** Injectable phase bodies + clock/deadline so the runner is testable with a short budget and stub executors; production passes nothing and uses the real
 *  implementations below. Every executor receives the persisted attemptKey so a retry can prove it is the same unit of work. */
export type ResearchCycleSteps = {
  refreshSources: (tenantId: string, now: Date, attemptKey: string) => Promise<RefreshSourcesResult>;
  backfillChunk: (tenantId: string, now: Date, attemptKey: string) => Promise<BackfillChunkResult>;
  /** ONE bounded batch of the account's OWN website (crawl_pages). The polite raw reads are free; pages the raw fetch stored as zero-word 200s then get a BOUNDED rendered read through the one provider gateway, because a CMS page
   *  rendered with javascript is invisible to a raw fetch and blindness is not evidence. */
  crawlPages: (tenantId: string, now: Date) => Promise<number>;
  /** The four Slice 6 evidence executors (evidence facade), one per funnel phase. */
  funnelUnit: (phase: ResearchPhase, tenantId: string, cursor: Record<string, unknown> | null, budgetMs: number, focus: ResearchFocus | null) => Promise<FunnelUnitOutcome>;
  /** THIS run's investigation, asked for ONCE (Runtime asks Decision, Evidence gets strings and pages). */
  investigationFocus: (tenantId: string, basis: string | null) => Promise<ResearchFocus | null>;
  /** GO AND GET EXACTLY THE READING A FUNDED CANDIDATE WAS REFUSED FOR (Codex, 2026-08-23). Not the ordinary broad
   * investigation, which picks its own topic: THIS reading, named by the producer or the drafting gate that could not proceed without it. EVERY kind the requirement union declares executes here, through machinery that already exists, and the switch is exhaustive so a new kind without a handler fails typecheck instead of becoming a typed dead end. Returns whether the reading landed, so an unfulfilled requirement stays owed. */
  acquireEvidence: (tenantId: string, need: Pick<EvidenceRequirement, "kind" | "query" | "url" | "missingTopic" | "proposalId">, basis: string | null, budgetMs: number) => Promise<{ acquired: boolean; detail: string }>;
  /** FINISH WHAT WAS ALREADY PAID FOR, FREE. A posted provider task is charged when it is posted and collected with a GET; the only collector ran on the scheduler tick, so while hosting was paused 51 tasks sat pending for days, the results pages they had already bought were never banked, and every gate asking for one answered no. Bounded, GET only, nothing posted. */
  collectBought: (budgetMs: number) => Promise<{ pending: number; ready: number }>;
  /** The account's CURRENT onboarding basis (the one Account fingerprint); the funnel scopes every derived read/write to it. Null = not resolvable. */
  currentBasis: (tenantId: string) => Promise<string | null>;
  /** Freeze every case's identity on file before anything reads or spends against it. RESOLVES only when that identity is actually persisted; a THROW pauses the phase before a focus, a unit or a cent. `plan` bounds the ONE advisory
   *  reading: which cases this run froze (they are reviewed first), whether a reading may still be attempted at all this run, and `mark`, called at the instant one is attempted so the runner can persist that fact. */
  reconcileCases: (tenantId: string, basis: string, plan: CaseReconcilePlan) => Promise<void>;
  publishSurface: (tenantId: string, attemptKey: string) => Promise<void>;
  /** CHECK ONE PAGE'S OWN CLAIMS AGAINST SOURCES OUTSIDE IT. Bounded, budgeted and fail-soft: this phase never blocks a run, because a page whose statements could not be checked today is not an outage. */
  /** ONE RESEARCH UNIT'S WORTH of source checking. `budgetMs` is what is LEFT of the drive's own deadline, not a fresh allowance of its own, and `renew` is the caller's lease: a claim is only ever started while the lease is genuinely
   *  held. Answers in the run's vocabulary (advanced / done / failed) so a pass that checked one claim cannot be read as a page, or an account, that is finished. */
  factCheck: (tenantId: string, budgetMs: number, renew?: () => Promise<boolean>)
    => Promise<{ status: "advanced" | "done" | "failed"; banked: number; pagesComplete: number; failure?: string; reason?: string }>;
  surfaceStale: (tenantId: string, nowMs: number) => Promise<boolean>;
  /** Read back the day's NEW answers (bounded, $0 when nothing changed). Returns THE PASS'S OWN RECEIPT, not a bare number: how many answers it took on, how many ended with a durable verdict, how many of those were a non-reading, and
   *  how many real readings landed, so a run row can say what a pass actually did instead of showing a count nobody can check against the debt. Derived work: it never pauses the run. `budgetMs` is what is LEFT of the drive's own
   *  deadline, and the reading obeys it before every wave and every single: a bound counted in answers is not a bound on the wall clock the hosting platform actually enforces. */
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
  /** Every active, unpaused account that still genuinely owes work right now AND EXACTLY WHAT IT OWES, off the ONE canonical due-work truth. The probe already computed that list to decide the account was short, and throwing it away
   *  is what left the pass it opens with no idea why it existed. Free and bounded; the clock is passed in because the bounded window ROTATES across the fleet with it. Empty = a read that SUCCEEDED and proved nothing was left behind;
   *  a read that could not be made THROWS, because an outage and an idle fleet are different answers. */
  strandedToday: (nowMs: number) => Promise<Array<{ tenantId: string; due: DuePhase[] }>>;
  /** The research notes' row version for a basis, read at the moment the decision step concludes: the watermark this pass consumed. Read AFTER the pass's own
   *  writes, never before, or a pass would forever count its own discovery as new evidence and re-open itself. */
  evidenceVersion: (tenantId: string, basis: string) => Promise<number | null>;
  /** FINISH STORED OPPORTUNITIES THROUGH THE ONE CANONICAL PRODUCER before this cycle buys exploratory evidence. The count on the receipt is the LOW-STOCK ALARM ONLY (operator, 2026-08-30): `deficit` reports how far the stock sits under the alarm floor and sizes NOTHING; the buy runs the whole declared manifest to the pass's own money and time bounds, whatever the count. null = the count could not be read, which defers nothing and claims nothing. `seen` is the day's own memory: the manifest it was working through and the pages it has already spent on. */
  replenishReady: (tenantId: string, now: Date, seen?: { fingerprint: string | null; attempted: readonly string[]; tried?: readonly string[] },
    /** The wall-clock moment this drive must stop starting paid work. The pass returns normally at it, with receipts, instead of being cut off by a timer and reporting nothing. */ stopBy?: number) => Promise<{ ready: number; deficit: number; persisted: number;
    /** TRUE only when a post-pass re-read PROVES the stock is AT THE TARGET. */ satisfied: boolean;
    /** HOW THIS DRIVE ENDED, as a machine word. Only two of these four may close a day. `candidates_exhausted` is the one that has to be EARNED: it means every candidate on the current manifest has now been spent on and none of them finished, which is a different fact from "the two I could afford this drive produced nothing" (Codex, 2026-08-22). */
    reason: "made_progress" | "retryable_blocked" | "candidates_exhausted";
    /** The manifest this drive was working through, and the pages spent on so far under it. A different fingerprint is a different question, and the day starts again. */
    fingerprint: string; attempted: string[];
    /** THE EXACT READINGS funded candidates were refused for, typed: the dispatch executes these instead of parsing a refusal sentence (Codex, 2026-08-23). */ evidenceOwed?: readonly OwedReading[];
    /** Pages this day spent real calls on that came back transiently blocked: owed, but ranked behind work nobody has tried, so one stubborn candidate cannot re-consume every drive. */ tried?: string[];
    /** WHAT BECAME OF THE FUNDED WORK. `readySaved` counts CHANGES the operator can act on; `evidenceBanked` counts work that succeeded and is not a change. `receipts` is the COMPLETE per-page record (key, treatment, impact, allowance, exact provider attempts, exact cost, outcome, full reason), durable on the run so a later read reconstructs the dispatch without logs. `ledger` is the adjudicator month total read before and after, beside the metered sum, so the receipt reconciles against real money or names the mismatch itself. */
    outcomes?: { readySaved: number; evidenceBanked: number; refused: number; blocked: number; unreached: number; stuck: string[];
      receipts?: unknown[]; ledger?: { before: number; after: number; delta: number; metered: number; unexplained?: number; reconciled: boolean } } } | null>;
};
/** The page meter is DELETED (operator, 2026-08-30): the pass takes the WHOLE ranked inventory and walks it under its own global claim allowance and deadline, so no owed page ever waits on rotation. Bodies load lazily per page, so an unreached page costs nothing. */

/** What this run still allows the ONE advisory reading. `mark` is the runner's own receipt: the reading is bounded per RUN, never per unit iteration. */
type CaseReconcilePlan = { planKeys: string[]; maySynthesize: boolean; mark: () => void };

/** DID THE REGISTRY ACTUALLY MOVE? Compared the way the registry is READ and never the way it happened to be written: the same rows in another order, or one
 *  row's anchors in another order, are the SAME registry, and a raw JSON compare called that a move, saved it, and bought a reading of a file nothing changed. */
const canonicalRegistry = (rows: readonly ResearchCase[] = []): string => JSON.stringify([...rows].map((c) => ({ id: c.id, anchors: [...c.anchors].sort(), aliasOf: c.aliasOf ?? null, parentId: c.parentId ?? null, pages: (c.pages ?? []).map((p) => `${p.url}|${p.relation}`).sort() })).sort((a, b) => a.id.localeCompare(b.id)));
const sameRegistry = (before: readonly ResearchCase[] = [], after: readonly ResearchCase[] = []): boolean => canonicalRegistry(before) === canonicalRegistry(after);

/** Fold this account's case identities onto the ones already on file and PERSIST them, or THROW. It used to swallow every failure, so a run whose identities were never written went straight on to freeze a plan and spend against them:
 * the comparison it bought belonged to an id nothing on file agreed with. A losing row version is a failure too, because nothing was saved. Nothing here is a partial success. THEN, and only when the registry actually moved this pass AND this run has not asked yet, ONE advisory semantic reading of it (see decision/case-synthesis). That step is fail-soft by contract: the deterministic identities are already saved, so a reading I could not get, could not trust or could not write is simply absent. */
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

/** The ONE semantic pass over the registry that just changed, applied through the SAME identity rules and saved through the SAME path. Everything it proposes is checked before it is applied, and what I refuse is recorded rather than
 *  argued with. A lost row version here changes nothing that is already on file. */
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
  async replenishReady(tenantId, now, seen, stopBy) {
    const d = await import("@/domains/decision");
    const { creditBreakerHeld } = await import("@/domains/decision/llm/gateway");
    const basis = await d.resolveCurrentBasis(tenantId).catch(() => null);
    // THE EVIDENCE VERSION IS PART OF THE QUESTION. Keyed on the page names alone, a manifest declared exhausted stayed shut for the rest of the day even when fresh evidence for those very pages landed an hour later (Codex, 2026-08-22). AND IT IS STAMPED IN DUE-WORK'S OWN WORDS, because due-work is what reads it back. There are two spellings of this account's basis: the queue's carries a decision-generation suffix, the evidence row is keyed on the bare tag. Built from the queue's spelling, the version read found no row and the stamp came out `...::v::` with nothing in it, so the comparison on the other side could never match: a proven exhaustion could never hold a day shut and the reopen-on-new- evidence rule was dead on arrival. Seen live in the 22:00Z memory on 2026-08-22, before it had cost anything.
    const acct = await accountBasis(tenantId).catch(() => null);
    const version = acct ? await evidenceRowVersion(tenantId, acct).catch(() => null) : null;
    // THE DRAFTING POLICY IS PART OF THE QUESTION TOO. A page written off because the OLD allowance ran out mid-deliverable says nothing about the new one, so a policy change reopens those settlements the same day rather than skipping the very pages it was made for.
    const stamp = `${acct ?? ""}::v${version ?? ""}::p${DRAFT_BUDGET.POLICY}`;
    const read = () => d.loadProposalQueue(tenantId, { currentBasis: basis }).then((q) => d.stockOf(q.ready)).catch(() => null); // STOCK, never a row count: thin levers fill at most their share of the five, so substantive work keeps funding
    const before = await read();
    // A COUNT I COULD NOT READ SETTLES NOTHING: the pass stays owed and the next drive asks again.
    if (before == null) return null;
    // THE DAY'S MEMORY IS KEPT PER MANIFEST. A different basis is a different set of candidates, so what an earlier manifest already tried says nothing about this one and the attempted list starts empty.
    const held = seen?.fingerprint != null && seen.fingerprint.startsWith(`${stamp}::`) ? [...seen.attempted] : []; const floor = await readyStockFloor(tenantId).catch(() => READY_STOCK_ALARM); // the low-stock alarm level: it colors the receipt and nothing else
    const mark = (reason: "made_progress" | "retryable_blocked" | "candidates_exhausted", ready: number, persisted: number, fingerprint: string, attempted: string[],
      outcomes?: { readySaved: number; evidenceBanked: number; refused: number; blocked: number; unreached: number; stuck: string[] }, tried?: string[], evidenceOwed?: readonly OwedReading[]) =>
      ({ ready, deficit: Math.max(0, floor - ready), persisted, satisfied: reason === "candidates_exhausted", reason, fingerprint, attempted, ...(tried && tried.length > 0 ? { tried } : {}), ...(evidenceOwed && evidenceOwed.length > 0 ? { evidenceOwed } : {}), ...(outcomes ? { outcomes } : {}) });
    // THE COUNT SIZES NOTHING (operator, 2026-08-30). The old drive computed a shortfall here and handed it down as the number of rows this pass might buy, so a full-enough queue closed every family's spending while evidenced work stood unwritten. The pass now walks the whole declared manifest bounded by its own call ceiling and time box; the day still ends on CANDIDATES, not a count: `attempted` accumulates every settled key and the pass closes as `candidates_exhausted` only once the manifest it declared is fully settled. The paid pass itself re-judges every stored row first (its deterministic families are rewritten in full), so the count the day reports is proven, not believed.
    // A SPENT PROVIDER BALANCE MAKES NO CALL AND CLAIMS NOTHING: nothing was tried, so nothing is written off as tried, and the day stays open for the moment the credit is back. This is the PURE read of the stop: the probe a cooldown grants is spent by the provider call itself, one door down, never by this guard.
    if (await creditBreakerHeld(tenantId).catch(() => true)) {
      log.warn("[research-run] the provider's own credit is spent, so the ready inventory was not topped up and this stays owed", { tenantId, ready: before, floor });
      return mark("retryable_blocked", before, 0, seen?.fingerprint ?? `${stamp}::held`, held);
    }
    // THE SAME CANONICAL PRODUCER, stored evidence only: it posts no provider task by construction, and its paid work is planned, priced and funded once before it spends. Pages this day already reached a TERMINAL answer for are declared but not funded again, so each drive walks further down the one ranking instead of buying the same settled refusal twice. THE TOP-UP NEVER SERVES A CACHED DRAFT (found live, 2026-08-22 22:10Z). The call cache holds 300 entries for this account, its hard maximum, including 111 atomic edits and 100 page jobs written by the burn passes of 21 August. A hit returns `drafted` at $0 BEFORE the budget gate and the editor REFUNDS the attempt, so every drive replayed drafts written before today's gates existed, failed the same gates in the same way, spent nothing, and left the queue on zero. A stall with no cost signal at all: the 22:00Z drive funded five candidates and made not one OpenAI call.
    const { getTenantSpentThisMonthUsd } = await import("@/lib/cost/budget-ledger-supabase");
    const ledgerBefore = await getTenantSpentThisMonthUsd(tenantId, now, "adjudicator-openai").catch(() => null);
        // THE WALK IS THE DRIVE'S WHOLE ALLOWANCE, and nothing counts it down but money and time: no shortfall, no target, no "enough". THE TOP-UP NEVER SERVES A CACHED DRAFT, so it always pays for a fresh take.
    const out = await d.produceProposalsForTenant(tenantId, { now, produce: true, skipKeys: held, retryKeys: seen?.tried ?? [], bypassCache: true, ...(stopBy != null ? { stopBy } : {}) }).catch(() => null);
    const ledgerAfter = out ? await getTenantSpentThisMonthUsd(tenantId, now, "adjudicator-openai").catch(() => null) : null;
    if (out && out.held.length > 0) log.info("[research-run] candidates the replenish pass could not finish, each with its reason", { tenantId, held: out.held.slice(0, 6) });
    // A PASS THAT COULD NOT RUN, COULD NOT READ ITS EVIDENCE, OR COULD NOT SAVE WHAT IT MADE HAS SETTLED NOTHING. It tried nothing it can prove, so nothing is written off and the day stays open.
    if (out == null || out.outcome === "evidence_unreadable" || out.outcome === "persistence_failed") return mark("retryable_blocked", before, 0, seen?.fingerprint ?? `${stamp}::unread`, held);
    const fingerprint = `${stamp}::${[...out.paid.declared].sort().join("|")}`;
    const fresh = fingerprint === (seen?.fingerprint ?? fingerprint) ? held : []; // a different manifest, basis or evidence version is a different question, and the day's memory of it starts again
    const after = await read(), persisted = out.persisted;
    // A COUNT I COULD NOT READ AFTERWARDS PROVES NOTHING EITHER WAY, least of all that a page is finished with.
    if (after == null) return mark("retryable_blocked", before, persisted, fingerprint, fresh);
    // ONLY A JOB'S OWN RECEIPT MAY WRITE ITS PAGE OFF, and only the two answers that actually settle it: finished work exists, or one of Beacon's own gates read it against today's evidence and refused. An empty balance, a cap, a timeout, a provider that would not answer, an unusable answer and a page never reached all leave it owed. Reading a single "calls were charged" number as "every funded page was attempted" is what let one out-of-quota call write off four pages nobody ever asked about (Codex, 2026-08-22). A KEY IS SETTLED WHEN THERE IS NOTHING LEFT TO DO FOR IT UNDER THIS EVIDENCE: a change was saved, a reading was banked, or one of Beacon's own gates refused it. A DRAFT LEFT IN REVIEW IS NOT SETTLED THE FIRST TIME, AND IS NOT PURSUED FOR EVER EITHER. Counting `review_saved` as done wrote seven weak drafts off as handled and every later drive walked past them. Never counting it starves the queue the other way: one stubborn page would take the top slot on every dispatch. So it settles on the SECOND attempt under the same manifest, which buys exactly one corrective retry with the objection already on the row, and then preserves the best draft and moves to the next candidate. It becomes eligible again when the fingerprint changes, which it does when the evidence, the basis, the drafting policy or the writer contract changes. A BEACON-CAUSED REVIEW IS OWED CORRECTIVE WORK, NEVER EXHAUSTION. The second same-manifest review save used to SETTLE the candidate, so a writer that failed twice declared the day exhausted over its own defect and the queue starved with work still owed. A review save now stays on the retry list only: it ranks behind untried work (so a stubborn page cannot take the top slot every drive) and it keeps the day OPEN, because the operator's queue being short is Beacon's debt while any candidate stands. Only finished work, banked evidence, and Beacon's own deterministic refusal of the CANDIDATE settle it; the fingerprint still reopens everything when the evidence, the policy, or the writer contract moves. A SPEND IS A FACT ABOUT ONE FAMILY'S JOB (operator, 2026-09-02): the day's memory carries `key::family`, so a page whose draft was spent today can still fund the review it owes on the same key. `settledKeys` keeps the BARE key for the two questions that are about the page and not the job.
    const settledRows = out.paid.receipts.filter((r) => r.outcome === "produced" || r.outcome === "evidence_banked" || r.outcome === "deterministic_refusal");
    const attempted = [...new Set([...fresh, ...settledRows.map((r) => `${r.key}::${r.family}`)])];
    const bareOf = (a: string): string => { const i = a.lastIndexOf("::"); return i > 0 ? a.slice(0, i) : a; };
    const settledKeys = new Set([...settledRows.map((r) => r.key), ...fresh.map(bareOf)]);
    // A CANDIDATE THAT WAS TRIED AND SPENT MAY NOT RE-CONSUME EVERY DRIVE (Codex, 2026-08-23). /persian-female-first-names spent seven calls and came back transiently blocked, and on the next drive it was top-ranked again and took the whole box, so the page behind it was unreached for a sixth dispatch. It stays owed and stays fundable; it simply ranks behind work nobody has tried yet. A REVIEW SAVE COUNTS AS AN ATTEMPT, which is what makes the retry above bounded: the first one is remembered here and ranks behind work nobody has tried, and the second settles the candidate instead of taking the top slot for ever. A CANDIDATE WAITING ON EVIDENCE RANKS BEHIND WORK NOBODY HAS TRIED, exactly as a transient block does: its requirement is minted, the acquisition is in flight, and until the reading lands another draft buys the identical refusal. Left at the top, the two hardest candidates re-took both funded slots on every drive and the completable work behind them was never funded once (live, 2026-08-25: five consecutive dispatches funded the same two evidence_required pages while a candidate one word short of its floor sat unfunded).
    const triedNow = out.paid.receipts.filter((r) => (r.outcome === "evidence_required" || r.outcome === "review_saved" || (r.outcome === "retryable_blocked" && (r.providerCalls ?? 0) > 0))).map((r) => r.key);
    // TRIED CARRIES ACROSS FINGERPRINTS WITHIN THE DAY: every banked reading moves the fingerprint, so gating the carry on it reset the memory on nearly every drive and one stubborn distinctness refusal re-took the top slot three paid times in ninety minutes. Tried only RANKS a page behind untried work, never blocks it, so a stale carry costs one day of lower priority at worst.
    const tried = [...new Set([...(seen?.tried ?? []), ...triedNow])].filter((k) => !settledKeys.has(k));
    // A FUNDED PAGE THAT WAS NEVER REACHED IS OWED FIRST, NOT LAST: it is simply absent from `attempted`, so the next continuation ranks it exactly where its impact puts it, which is where the strongest work belongs.
    const count = (o: string) => out.paid.receipts.filter((r) => r.outcome === o).length;
    const metered = Number(out.paid.receipts.reduce((n, r) => n + (r.costUsd ?? 0), 0).toFixed(6));
    const delta = ledgerBefore != null && ledgerAfter != null ? Number((ledgerAfter - ledgerBefore).toFixed(6)) : -1;
    const tally: { readySaved: number; evidenceBanked: number; refused: number; blocked: number; unreached: number; stuck: string[]; receipts?: unknown[]; ledger?: { before: number; after: number; delta: number; metered: number; unexplained?: number; reconciled: boolean } } = { readySaved: count("produced"), evidenceBanked: count("evidence_banked"), refused: count("deterministic_refusal"), blocked: count("retryable_blocked"), unreached: count("not_reached"),
      stuck: out.paid.receipts.filter((r) => r.outcome !== "produced").map((r) => `${r.key}:${r.outcome}${r.why ? `: ${r.why}` : ""}`).slice(0, 5),
      receipts: out.paid.receipts as unknown[], // the COMPLETE per-page record, durable: logs are not the receipt
      // WHAT THE RECEIPTS EXPLAIN, AND WHAT IS LEFT OVER. `metered` is the DRAFTING money the per-page receipts account for; the ledger's delta also carries this pass's page readings and any other adjudicator work in the same window, so demanding they match exactly reported a false mismatch on every pass that read a page. `reconciled` now means the receipts never claim MORE than the ledger saw, and `unexplained` names the rest out loud rather than hiding it (Codex, 2026-08-23).
      ledger: ledgerBefore != null && ledgerAfter != null
        ? { before: ledgerBefore, after: ledgerAfter, delta, metered, unexplained: Number((delta - metered).toFixed(6)), reconciled: delta + 0.005 >= metered } : undefined };
    // FINISHED WORK THAT DID NOT ARRIVE IS NOT FINISHED WORK (Codex, 2026-08-23). A live pass reported one page `produced` with the store answering "saved", and the Ready count did not move: the receipt and the queue disagreed, and only the receipt was read. When they disagree the QUEUE is the authority and the run says so.
    if (tally.readySaved > 0 && after <= before) {
      const claimed = out.paid.receipts.filter((r) => r.outcome === "produced").map((r) => r.key);
      log.error("[research-run] a page reported finished work that the queue cannot see", { tenantId, claimed, before, after });
      tally.stuck = [...claimed.map((k) => `${k}:produced_but_absent: the store accepted this work and the ready queue does not carry it`), ...tally.stuck].slice(0, 5);
      for (const k of claimed) settledKeys.delete(k); // A CLAIM THE QUEUE CANNOT SEE SETTLES NOTHING (falsifier, 2026-09-02): the day closed `candidates_exhausted` over two of exactly these, so work nobody can act on was written off as finished
    }
    if (after > before) return mark("made_progress", after, persisted, fingerprint, attempted, tally, tried, out.paid.evidenceOwed ?? []);
    // AND ONLY NOW MAY A DAY BE CALLED FINISHED: every candidate the current manifest declares carries its own settled receipt. A manifest that declared nothing proves nothing, and neither does one nobody could read. A READING STILL OWED IS WORK STILL OWED (falsifier, 2026-09-02): a day cannot be finished while an acquisition it minted has not landed, whatever its per-page receipts say.
    const exhausted = out.paid.declared.length > 0 && (out.paid.evidenceOwed ?? []).length === 0 && out.paid.declared.every((k) => settledKeys.has(k));
    log.info("[research-run] the ready inventory is still short", { tenantId, before, after, target: floor, declared: out.paid.declared.length, settled: attempted.length, exhausted });
    return mark(exhausted ? "candidates_exhausted" : "retryable_blocked", after, persisted, fingerprint, attempted, tally, tried, out.paid.evidenceOwed ?? []);
  },
  async refreshSources(tenantId, now) {
    // autoRefreshStaleConnectorsForTenant is fail-soft PER SOURCE and returns one { ok } result per ATTEMPTED stale source, which is what the refresh_sources contract above is counting. We do NOT .catch here: a THROW means the whole refresh could not run, and the runner must pause rather than record a false "0 sources, all healthy".
    const results = await autoRefreshStaleConnectorsForTenant(tenantId, now);
    return { attempted: results.length, succeeded: results.filter((r) => r.ok).map((r) => String(r.provider)),
      failures: results.filter((r) => !r.ok).map((r) => ({ provider: String(r.provider), detail: String(r.detail).slice(0, 200) })) };
  },
  async backfillChunk(tenantId, now) {
    // No deadline race: the chunk is bounded by design and its GSC fetch has no AbortSignal, so a race would release the lease while live side-effecting work kept running. ensureDeepBackfill converts a thrown error into { ran:false, reason }, so a non-benign reason here is a real failure.
    const result = await ensureDeepBackfill(tenantId, now);
    if (result.ran) {
      log.info("[research-run] gsc deep backfill chunk advanced", { tenantId, daysPulled: result.daysPulled, complete: result.complete });
      return { kind: "advanced", complete: result.complete, daysPulled: result.daysPulled };
    }
    if (BENIGN_BACKFILL_SKIPS.has(result.reason)) return { kind: "no_work" };
    // A real failure (auth / quota / network / unexpected) throws so the runner pauses AT gsc_backfill_chunk with the cursor untouched, making the retry the identical window.
    throw new Error(`gsc backfill chunk did not advance: ${result.reason}`.slice(0, 200));
  },
  // THE ONE PLACE THE WEBSITE GETS READ, AND THE ONE PLACE A CRAWL BEGINS. A render must never crawl, so the resumable frontier is driven here, one bounded batch per pass. Cold start used to fire only from onboarding, so an account that predates it had no frontier at all: every pass asked to CONTINUE one, was told there is none, and called that a healthy no-op forever. A missing frontier is now initialized once, NEVER forced, so an instance that got there first is loaded and continued rather than reset; unreachable is persisted truth and stops here. Fail-soft throughout, and a site already read whole is still a no-op that advances.
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
  // THE DAY THE FLEET CLAIM CANNOT SEE. claim_due_research_work excludes an account the moment ANY run completed today, so a pass that settled its batch and left the day short is owed nothing further and the rest of the day never happens. This is the free question that finds those accounts, and it asks ONE canonical question: due-work, the same planner every other door consults. It used to ask only whether today's AI observations were short, so an account whose answers were all collected but whose website was two hundred pages unread, whose bought answers nobody had read closely, whose promised evidence date had arrived or whose release was never published looked finished and was never opened again that day. FREE either way (every read is a lean projection of state on file), and A READ THAT FAILED IS NOT AN EMPTY FLEET, so it THROWS rather than answering with a list: empty now means a read that succeeded and proved nobody was left.
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
  // RUNTIME IS THE ONLY WRITER OF A CASE IDENTITY, and it writes them BEFORE the plan names one. Evidence resolves the id against what is already on file (evidence/case-identity carries the whole rule and the incident behind it); this persists that answer through the funnel's own save path, and FAILS CLOSED: an unreadable snapshot or row, or a losing row version, pauses this same phase honestly.
  async reconcileCases(tenantId, basis, plan) { await reconcileCases(tenantId, basis, plan); },
  async investigationFocus(tenantId, basis) { return chooseInvestigation(tenantId, basis).catch(() => null); },
  // THE ACQUISITION TRANSPORTS THE FUNNEL ALREADY USES, pointed at exactly the reading a refusal named. EXHAUSTIVE over the requirement union: `serp` buys the results page through the serp unit, `competitor_page` reads the winners of that exact search through the winning-pages unit (the named unread winner is on that results page, so the priority-query read banks its extract), `page_source` re-reads ONE owned page through the same unit's owned-read seat, and `factual_source` runs the existing fact-check pass with the named page put first. No second pipeline, no new provider path, no new table: every branch is machinery that already persists through its own store.
  async acquireEvidence(tenantId, need, basis, budgetMs) {
    if (!need.query.trim() && !need.url) return { acquired: false, detail: "the requirement names nothing to read" };
    // THE READER NEEDS THE BASIS THE RUN IS WORKING UNDER (Codex, 2026-08-23). A null cursor was handed in, the funnel reads its basis off that cursor, and so every "exact reading" failed before it looked at anything: the one search that finishes the account's strongest page was never fetched, on any dispatch. Runtime already knows the basis.
    if (!basis) return { acquired: false, detail: "this dispatch has no confirmed basis, so nothing can be read against it" };
    const unitStatus = (out: unknown): string => (out as { status?: string }).status ?? "unknown";
    const landed = (out: unknown): boolean => unitStatus(out) === "done" || unitStatus(out) === "advanced"; // stage one of winning-pages persists its reads and answers `advanced`; both words mean the write landed
    switch (need.kind) {
      case "serp": {
        const out = await serpAnalysisUnit({}, [need.query])(tenantId, { basis }, budgetMs).catch((e: unknown) => ({ status: "failed" as const, detail: e instanceof Error ? e.message : String(e) }));
        log.info("[research-run] the exact reading a refused candidate named", { tenantId, kind: need.kind, query: need.query, status: unitStatus(out) });
        return { acquired: unitStatus(out) === "done", detail: `results page for "${need.query}": ${unitStatus(out)}` };
      }
      case "competitor_page": {
        const out = await winningPagesUnit({}, [need.query])(tenantId, { basis }, budgetMs).catch((e: unknown) => ({ status: "failed" as const, detail: e instanceof Error ? e.message : String(e) }));
        log.info("[research-run] the exact reading a refused candidate named", { tenantId, kind: need.kind, query: need.query, url: need.url, status: unitStatus(out) });
        return { acquired: landed(out), detail: `winning pages for "${need.query}": ${unitStatus(out)}` };
      }
      case "page_source": {
        if (!need.url) return { acquired: false, detail: "a page_source requirement names no page" };
        const out = await winningPagesUnit({}, [], null, need.url, null)(tenantId, { basis }, budgetMs).catch((e: unknown) => ({ status: "failed" as const, detail: e instanceof Error ? e.message : String(e) }));
        log.info("[research-run] the exact reading a refused candidate named", { tenantId, kind: need.kind, url: need.url, status: unitStatus(out) });
        return { acquired: landed(out), detail: `own-page read of ${need.url}: ${unitStatus(out)}` };
      }
      case "factual_source": {
        // THE MISSING PROPOSITION IS SEEDED AS AN OWED CLAIM FIRST, under the page's CURRENT body hash and with no current wording, so the same fact-check unit that researches the page's own statements now researches the information the page LACKS: it searches the proposition, reads real sources, and banks `proposed` with quotes. This is the loop's missing half. Without a topic, the pass re-checks the page's owed claims as before.
        if (need.missingTopic?.trim() && need.url) {
          const seeded = await seedMissingProposition(tenantId, need.url, need.missingTopic.trim()).catch((e) => {
            log.warn("[research-run] the missing proposition could not be seeded", { tenantId, url: need.url, error: e instanceof Error ? e.message : String(e) }); return false; });
          if (!seeded) return { acquired: false, detail: `the missing proposition could not be inventoried for ${need.url}, so nothing was researched` };
        }
        const out = await factCheckPass(tenantId, budgetMs, undefined, need.url ?? null);
        log.info("[research-run] the exact reading a refused candidate named", { tenantId, kind: need.kind, url: need.url, topic: need.missingTopic ?? null, banked: out.banked, status: out.status });
        return { acquired: out.status !== "failed" && out.banked > 0, detail: `fact check of ${need.url ?? "the owed page"}: ${out.status}, ${out.banked} banked` };
      }
      case "semantic_review": {
        // THE ONE REQUIREMENT THAT BUYS NO NEW READING: the copy is already final and its sources are already banked beside it, and what is missing is that nobody has read the two together. Filed as a `factual_source` before this case existed, so the runtime went and bought facts while the reading stayed untaken for ever.
        if (!need.proposalId) return { acquired: false, detail: "a review requirement names no change, so there is nothing to read" }; // ONE ROW, BY ITS OWN ID: reading the whole account's queue to find one change is an egress bill for a lookup
        const { loadChangeProposal, saveChangeProposal } = await import("@/domains/decision/proposal-store");
        const { reviewFinishedCopy } = await import("@/domains/decision/drafted-copy");
        const row = await loadChangeProposal(tenantId, need.proposalId).catch(() => null);
        if (!row) return { acquired: false, detail: `no change on file answers to ${need.proposalId}, so there is nothing to read` };
        const read = await reviewFinishedCopy(row, { tenantId, now: new Date() }).catch((e: unknown) => ({ row: null, detail: e instanceof Error ? e.message : String(e) }));
        if (!read.row) return { acquired: false, detail: `reading the sources behind ${row.id}: ${read.detail}` }; // a provider that could not answer leaves the row exactly as it stands
        const saved = await saveChangeProposal(read.row).catch(() => "failed" as const);
        log.info("[research-run] the exact reading a refused candidate named", { tenantId, kind: need.kind, id: row.id, saved, detail: read.detail });
        return { acquired: !!read.row.semanticReview && (saved === "saved" || saved === "unchanged"), detail: `review of ${row.id}: ${read.detail} (${saved})` };
      }
      default: { const impossible: never = need.kind; return { acquired: false, detail: `no acquisition handler exists for ${String(impossible)}` }; }
    }
  },
  async collectBought(budgetMs) { const endsAt = Date.now() + Math.max(0, budgetMs);
    try {
      const { pendingProviderTaskKeys } = await import("@/domains/evidence/dataforseo/default-deps");
      const keys = await pendingProviderTaskKeys(FREE_COLLECT_PER_RUN);
      if (keys.length === 0) return { pending: 0, ready: 0 };
      const { collectCapability } = await import("@/domains/evidence/dataforseo/capabilities");
      let ready = 0;
      for (const key of keys) { if (Date.now() >= endsAt) break; if ((await collectCapability(key).catch(() => null))?.state === "hit") ready += 1; }
      log.info("[research-run] tasks already paid for were checked for free", { pending: keys.length, ready });
      return { pending: keys.length, ready };
    } catch (e) { log.warn("[research-run] the free task collection could not run", { error: e instanceof Error ? e.message.slice(0, 160) : String(e) }); return { pending: 0, ready: 0 }; } },
  async funnelUnit(phase, tenantId, cursor, budgetMs, focus) {
    // An OPEN INVESTIGATION needs BOTH halves: the results page for that exact search AND the pages that win it. The topic is the RUN's, frozen by the caller, never re-picked here: landing a results page closes that search, so a second, independent lookup handed winning-pages a different three than the ones just paid for. The page COMPARISON rides the same phase that reads those winners, because the winners ARE the page set, but as its SECOND stage, so a real lease renewal sits in front of it. A topic whose next legal read is still in the future contributes no search at all: a cooldown is not a queue position.
    const { queries, cases, ownedUrl } = focusReads(focus, Date.now(), (cursor?.basis as string) ?? null);
    if (phase === "serp_analysis") return serpAnalysisUnit({}, queries)(tenantId, cursor, budgetMs);
    if (phase === "winning_pages") {
      // The ask is recomputed for the SAME frozen topic under the CURRENT basis, and only at the comparison stage: nothing is asked for before winners exist. Fail-soft, and no reconfirmed ask means no buy.
      const ask = cursor?.stage === "compare" ? await comparisonForFocus(tenantId, focus, (cursor.basis as string) ?? null).catch(() => null) : null;
      // AT MOST ONE page of the account's OWN per run, and only one the frozen plan named and is due to read. THE OPERATOR'S OWN CHANGE BUSTS THE PAGE'S FRESHNESS (Phase 6). The unit's fifth argument `ownedBustedAt` is when that page's truth moved underneath me, and the Shipment record is its supplier: the moment the operator implemented something at that address. A body read before that moment describes a page that no longer exists, however recent the clock says it is, so it forces a re-read INSIDE the ordinary freshness window instead of serving a stale body for a week. Lean and fail-soft: no shipment for that page, or an unreadable read, is null, which is the same answer as "nothing changed it". The SAME deferral still runs the other way for the ceiling marker this run persists onto its own row (progress.capped): `caseResearchReceipt`'s `cappedToday` argument has no production CALLER yet, because the surface that shows one case's receipt is Phase 8 work. The marker is written now so that surface has something true to read the day it is built, and it is day-scoped so it cannot go stale waiting.
      const bustedAt = ownedUrl ? await shipmentBustedAt(tenantId, ownedUrl).catch(() => null) : null;
      return winningPagesUnit({}, queries, ask, ownedUrl, bustedAt)(tenantId, cursor, budgetMs);
    }
    if (phase === "prompt_observations") {
      // THE DAILY PLAN decides what gets asked, and it is the ONLY thing that does: the unit's own weekly stalest-pair sweep is deleted, not merely overridden, because two selectors meant one of them re-asked a question the other had already read today. One canonical reading per question, per engine, per REPORTING day (src/lib/reporting-day.ts is the one timezone contract), core first and oldest-missing-first. A null plan (I could not read what is due) asks NOTHING. The day is the RUN'S own cycle day, not the wall clock, so a run that spans midnight keeps reporting into the day it opened instead of silently splitting itself.
      const day = String(cursor?.cycle ?? "").slice(-10) || reportingDay(Date.now());
      return promptObservationUnit({}, await dueObservations(tenantId, day))(tenantId, cursor, budgetMs);
    }
    // The plan's own cases ride into discovery, so every keyword is filed under the case it belongs to and the recurring winning domains are bought once per case set.
    return keywordDiscoveryUnit({}, cases)(tenantId, cursor, budgetMs); // the facade export is a deps factory returning the executor
  },
  async analyzeAnswers(tenantId, reportingDay, budgetMs) { return runAnswerAnalyses(tenantId, reportingDay, { budgetMs }); },
  async verifyShipments(tenantId) { return verifyDueShipments(tenantId); },
  async measureShipments(tenantId, now) { return settleDueMeasurements(tenantId, { now }); },
  // publishCustomerSurfaces PROPAGATES failure (no internal swallow): a throw pauses publish_surface and the previously saved surface stays visible.
  async publishSurface(tenantId) { await publishCustomerSurfaces(tenantId); },
  // THE PAGE THIS ACCOUNT IS MOST SHOWN FOR, checked against the sources for its own subjects. One page a pass, statements it has not already checked at this version of the page, and every finding banked as a row of its own. Fail-soft by construction: the answer is a count and a reason, never a thrown run. ONE CLAIM, ON A PAGE CHOSEN BY WHAT IS ACTUALLY OWED. Rotation is the point: the first version always took the single most-shown page, so once that page was exhausted every later pass took it again and page two was unreachable (Codex, 2026-08-18). A page is eligible while it has claims not yet current at its CURRENT content hash; the account's oldest-covered eligible page goes first. Fail-soft: a count and a reason.
  async factCheck(tenantId, budgetMs, renew) { return factCheckPass(tenantId, budgetMs, renew, null); },
  async surfaceStale(tenantId, nowMs) {
    const { readCustomerSurface, isCustomerSurfaceStale } = await import("@/app/(shell)/surface-release");
    const surface = await readCustomerSurface(tenantId).catch(() => null);
    return surface == null || isCustomerSurfaceStale(surface.computedAt, nowMs); // no saved release yet = a first publish is genuinely due
  },
};

/** One owed claim for information the page DOES NOT HAVE, inventoried under the page's current body hash so the
 * authorized-facts filter accepts what the research banks. Empty current wording is the contract: the stale sweep keeps it (an empty wording is contained by every body), and the judge researches the subject instead of grading a quotation. Idempotent through the store's own conflict key. */
async function seedMissingProposition(tenantId: string, pageUrl: string, topic: string): Promise<boolean> {
  const [facts, { claimIdentity, pageHashOf }, { loadOwnedPageBodies }, { resolveCurrentBasis }] = await Promise.all([
    import("@/domains/evidence/pages/fact-checks"), import("@/domains/evidence/pages/fact-check-run"),
    import("@/domains/evidence/pages/owned-context"), import("@/domains/decision/load-proposals")]);
  const bodies = await loadOwnedPageBodies(tenantId, [pageUrl]).catch(() => null);
  const b = bodies?.get?.(pageUrl); if (!b) return false;
  const body = [b.title, b.h1, ...(b.headings ?? []), ...(b.passages ?? [])].filter(Boolean).join("\n");
  const path = ((): string => { try { return new URL(pageUrl.startsWith("http") ? pageUrl : `https://${pageUrl}`).pathname.replace(/\/+$/, "") || "/"; } catch { return pageUrl; } })();
  const basis = await resolveCurrentBasis(tenantId).catch(() => null);
  const hash = pageHashOf(body), key = claimIdentity(topic, "", "missing");
  // A ROW THE STALE SWEEP RETIRED IS REOPENED AT THE CURRENT VERSION, never insert-ignored into a lie: the seed's upsert used ignoreDuplicates, so a superseded row from an older page version blocked the insert, the seed still reported success, and the requirement re-minted every drive with no research ever happening (audit, 2026-08-26).
  const held = await facts.readFactChecks(tenantId, path).catch(() => [] as Awaited<ReturnType<typeof facts.readFactChecks>>);
  const mine = held.find((h) => h.statementKey === key);
  if (mine?.state === "checked" && mine.pageContentHash === hash) return true; // already researched at this version: the requirement is satisfied, not re-seeded
  if (mine && (mine.state !== "owed" || mine.pageContentHash !== hash)) {
    const n0 = await facts.recordFactChecks(tenantId, path, [{ ...mine, state: "owed", pageContentHash: hash, evidenceBasis: basis,
      note: "Reopened: the page moved to a new version and this missing proposition is owed again.", checkedAt: new Date().toISOString() }]).catch(() => 0);
    if (n0 <= 0) return false;
  } else if (!mine) {
    await facts.recordOwedClaims(tenantId, path, [{ statementKey: key, subject: topic, current: "", locator: "missing" }], hash, basis).catch(() => -1);
  }
  // AND SUCCESS IS VERIFIED, never inferred from a write that may have been ignored: an owed row for this key must
  // actually exist afterward, or the acquisition honestly reports it could not be inventoried.
  const after = await facts.readFactChecks(tenantId, path).catch(() => [] as Awaited<ReturnType<typeof facts.readFactChecks>>);
  return after.some((h) => h.statementKey === key && h.state === "owed");
}

/** THE ONE FACT-CHECK PASS, shared by the daily phase (no target: rotation picks the page) and by a `factual_source` acquisition (the named page goes FIRST, because the requirement is that page's owed claims and rotation would spend the pass elsewhere). Same bounds, same stores, same receipts either way. */
async function factCheckPass(tenantId: string, budgetMs: number, renew: (() => Promise<boolean>) | undefined, firstPage: string | null): Promise<{ status: "advanced" | "done" | "failed"; banked: number; pagesComplete: number; failure?: string; reason?: string }> {
    // THE OUTER DEADLINE, NOT AN ALLOWANCE OF ITS OWN: every call inside is bounded by what remains of it.
    const deadlineAt = Date.now() + Math.max(0, budgetMs);
    try {
      const [{ runFactCheckPass }, facts, { loadEvidenceSnapshot }, { loadOwnedPageBodies }] = await Promise.all([
        import("@/domains/evidence/pages/fact-check-run"), import("@/domains/evidence/pages/fact-checks"),
        import("@/domains/evidence/snapshot-loader"), import("@/domains/evidence/pages/owned-context"),
      ]);
      const snapshot = await loadEvidenceSnapshot(tenantId);
      const pathOf = (u: string): string => { try { return new URL(u.startsWith("http") ? u : `https://${u}`).pathname.replace(/\/+$/, "") || "/"; } catch { return u; } };
      const held = await facts.readFactChecks(tenantId);
      // CLAIMS ARE CHECKED IN THE ORDER PEOPLE SEARCH THEM (operator, 2026-08-30): inventory order walked obscure entries while the names the audience actually asks about waited. Measured off stored query rows; unsearched subjects keep inventory order behind the searched ones.
      const qd = new Map<string, number>();
      for (const p of snapshot.ownedPages) for (const q of p.search?.topQueries ?? []) for (const w of q.query.toLowerCase().split(/\s+/)) if (w.length > 2) qd.set(w, (qd.get(w) ?? 0) + q.impressions);
      const sdm = (t: string): number => Math.max(0, ...t.toLowerCase().split(/\s+/).filter((w) => w.length > 2).map((w) => qd.get(w) ?? 0));
      held.sort((a, b) => sdm(b.subject) - sdm(a.subject));
      const coverage = new Map<string, number>();
      for (const h of held) coverage.set(h.page, Math.min(coverage.get(h.page) ?? Infinity, Date.parse(h.checkedAt) || 0));
      // FINISH WHAT IS ALREADY BOUGHT FIRST: a page holding owed claims outranks an unopened one. THEN DEMAND OUTRANKS ROTATION (operator, 2026-08-30): the wave spent most of its $0.60 judging low-value claims because oldest-coverage rotation came before audience, so the audience the account actually has decides next and rotation only breaks the tie. Nothing is dropped: every owed claim stays owed and typed exhaustion still reaches the tail. A NAMED TARGET OUTRANKS EVERYTHING: an acquisition runs for one page's owed claims.
      const owedPage = new Set(held.filter((h) => h.state === "owed").map((h) => h.page));
      const want = firstPage ? pathOf(firstPage) : null, named = (u: string): number => (want != null && pathOf(u) === want ? 1 : 0);
      const ranked = [...snapshot.ownedPages]
        .sort((a, b) => named(b.url) - named(a.url)
          || (owedPage.has(pathOf(b.url)) ? 1 : 0) - (owedPage.has(pathOf(a.url)) ? 1 : 0)
          || (b.search?.impressions90d ?? 0) - (a.search?.impressions90d ?? 0)
          || (coverage.get(pathOf(a.url)) ?? -1) - (coverage.get(pathOf(b.url)) ?? -1));
      const basis = await import("@/domains/decision/load-proposals").then((m) => m.resolveCurrentBasis(tenantId)).catch(() => null);
      const { callStructuredLLM } = await import("@/domains/decision/llm/structured-drafter");
      // THE KIND IS THE SCHEMA: asking editor_judgement for a claim list returns an editor's verdict on one finished edit for ever, never the page's statements. THE MODEL'S OWN OUTCOME, CARRIED: a budget refusal, an answer that would not validate and an engine that could not be reached are three different
      // debts, and the unit names each one on the run row.
      const read = async (input: { kind: "fact_claim_extraction" | "fact_claim_judgement"; system: string; user: string; grounded: string; projectedCostUsd: number; maxTokens: number }) => {
        const left = deadlineAt - Date.now();
        if (left <= 0) return { hold: "unavailable" as const };
        const r = await callStructuredLLM({ kind: input.kind, tenantId, system: input.system, user: input.user,
          grounded: input.grounded, projectedCostUsd: input.projectedCostUsd, maxTokens: input.maxTokens,
          timeoutMs: Math.max(5_000, Math.min(60_000, left)), now: new Date() }).catch(() => null);
        if (r?.status === "drafted") return { value: r.value as Record<string, unknown> };
        return { hold: r?.status === "blocked_budget" ? "capped" as const : r?.status === "validation_failed" ? "refused" as const : "unavailable" as const };
      };
      const { providerCall, parseCapability, collectCapability } = await import("@/domains/evidence/dataforseo/capabilities");
      // A POSTED TASK IS COLLECTED, NEVER LEFT PENDING, and a provider hold keeps its NAME: capped, waiting and transport failure are different debts and the unit types each one (Codex, 2026-08-18).
      const bought = async (cap: "serp_organic" | "onpage_content_parsing", input: Record<string, unknown>, key: string) => {
        if (Date.now() >= deadlineAt) return null;
        let call = await providerCall(cap, input as never, { tenantId, unitKey: `fact-check:${key}` }).catch(() => null);
        if (call?.state === "waiting" && call.cacheKey) call = await collectCapability(call.cacheKey).catch(() => null);
        if (call && (call.state === "hit" || call.state === "ok")) return { parsed: parseCapability(cap, call.envelope) };
        if (call?.state === "capped") return { hold: "capped" as const };
        if (call?.state === "waiting") return { hold: "waiting" as const };
        return { hold: "unavailable" as const };
      };
      const out = await runFactCheckPass({
        tenantId, basis, deadlineAt, held, renew, read,
        pages: ranked.map((p) => ({ url: p.url, path: pathOf(p.url), loadBody: async () => {
          const bodies = await loadOwnedPageBodies(tenantId, [p.url]).catch(() => null);
          const b = bodies?.get?.(p.url);
          return b ? [b.title, b.h1, ...b.headings, ...b.passages].filter(Boolean).join("\n") : "";
        } })),
        refreshHeld: (page) => facts.readFactChecks(tenantId, page).catch(() => null),
        readCoverage: (page) => facts.readInventoryCoverage(tenantId, page).catch(() => null),
        writeCoverage: (page, cov) => facts.recordInventoryCoverage(tenantId, page, cov),
        searchSources: async (query) => {
          const r = await bought("serp_organic", { keyword: query }, `serp:${query}`.slice(0, 80));
          if (r == null || "hold" in r) return { hold: r?.hold ?? "unavailable" };
          const parsed = r.parsed as { organic?: { domain: string; url: string; title: string | null }[] } | null;
          return parsed?.organic ? { organic: parsed.organic } : { hold: "refused" as const };
        },
        // THE SUCCESSOR'S TASK IS POSTED, NEVER COLLECTED, HERE: providerCall returns `waiting` right after the post, the cache keys on the input, and the successor's own searchSources above then collects the very task this posted. Same money doors, same caps; a refusal here simply means the successor pays at its own turn.
        warmSearch: (query) => { if (Date.now() < deadlineAt) void providerCall("serp_organic", { keyword: query } as never, { tenantId, unitKey: `fact-check:${`serp:${query}`.slice(0, 80)}` }).catch(() => null); },
        // THE PARSER'S OWN SHAPE: bodyText, openingSample and headings.
        fetchSource: async (url) => {
          const r = await bought("onpage_content_parsing", { url }, `src:${url}`.slice(0, 80));
          if (r == null || "hold" in r) return { hold: r?.hold ?? "unavailable" };
          const parsed = r.parsed as { title?: string | null; bodyText?: string | null; openingSample?: string | null; headings?: string[] } | null;
          const text = [parsed?.bodyText, parsed?.openingSample, ...(parsed?.headings ?? [])].filter(Boolean).join("\n");
          return text.trim() ? { text, title: parsed?.title ?? null } : { hold: "refused" as const }; // the FETCHED document's own title rides along: it identifies the subject of an anaphoric passage, which a SERP title or slug never can
        },
      });
      return { status: out.status, banked: out.banked, pagesComplete: out.pagesComplete, failure: out.failure, reason: out.reason };
    } catch (e) {
      log.warn("[research-steps] the fact check could not run this pass", { tenantId, error: e instanceof Error ? e.message : String(e) });
      return { status: "failed", banked: 0, pagesComplete: 0, failure: "step_error", reason: "the fact check could not run this pass" };
    }
}
