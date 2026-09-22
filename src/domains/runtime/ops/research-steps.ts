import "server-only"; import { AEO_BAR } from "@/domains/decision/accept-worthy";
import { claimIdentity } from "@/domains/evidence/pages/fact-check-run";
import { autoRefreshStaleConnectorsForTenant } from "@/lib/connectors/on-use-refresh";
import { keywordDiscoveryUnit, promptObservationUnit, serpAnalysisUnit, winningPagesUnit, type FunnelUnitOutcome } from "@/domains/evidence";
import { loadFunnelState, saveFunnelState, type FunnelState } from "@/domains/evidence/funnel/state";
import { pageExtractFromRecord, type ResearchCase } from "@/domains/evidence/funnel/research-evidence";
import { applySynthesis } from "@/domains/evidence/case-identity";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader"; import { projectFunnelEvidence } from "@/domains/evidence/funnel/observe";
import { renderUnreadOwnedPages } from "@/domains/evidence/pages/rendered-read";
import { isCurrent } from "@/domains/evidence/freshness";
import { canonicalUrlKey, jobWinners, type EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { synthesizeCases } from "@/domains/decision/case-synthesis";
import { buildTopicInvestigations, reconcileResearchCases } from "@/domains/evidence/topic-investigation";
import { ensureDeepBackfill } from "@/lib/connectors/gsc/deep-backfill";
import { continueColdStartCrawlIfStarted, startColdStartCrawl } from "@/domains/evidence/scanning/crawl-frontier";
import { nextCrawlCandidates } from "@/domains/evidence/scanning/owned-pages-store";
import { loadGscDecaySignalsForTenant } from "@/domains/evidence/readers/gsc-page-signals";
import { getTenant } from "@/domains/account";
import { shipmentBustedAt, verifyDueShipments } from "@/domains/measurement/verify-shipment";
import { settleDueMeasurements } from "@/domains/measurement/proof-gsc/auto-measure-on-use";
import { log } from "@/lib/logger";
import { publishCustomerSurfaces } from "./warm-caches";
import { chooseInvestigation, comparisonForFocus, focusReads, type ResearchFocus } from "./investigation-queries";
import { dailyChecks, dueObservations, runAnswerAnalyses } from "./daily-observations";
import { reportingDay } from "@/lib/reporting-day";
import { accountBasis, dueWork, evidenceRowVersion, READY_STOCK_ALARM, readyStockFloor, type DueWork } from "./due-work";
import { DRAFT_BUDGET, type JobMemory } from "@/domains/decision/draft-budget";
import type { EvidenceRequirement } from "@/domains/decision/producers/contract";
import type { ResearchPhase } from "../research-run";
type OwedReading = EvidenceRequirement & { key: string; reason: string; workKey: string };
type AcquisitionNeedBase = Pick<EvidenceRequirement, "kind" | "query" | "url" | "missingTopic" | "topic" | "finding" | "rivalUrl" | "rivalUrls" | "proposalId" | "delivery"> & Partial<Pick<EvidenceRequirement, "reasonCode">>;
type ProposalAcquisitionNeed = AcquisitionNeedBase & { workKey: string; key?: string; unlocks?: { proposalId: string } };
const pathOf = (u: string): string => { try { return new URL(u.startsWith("http") ? u : `https://${u}`).pathname.replace(/\/+$/, "") || "/"; } catch { return u; } };
/** THE MISSING SUBJECT, CARRIED IN THE FRAME THE SEARCH GIVES IT, and built HERE so the seed, the state read and the receipt name one proposition (campaign, 2026-09-06). A subject lifted off a rival's outline is a label ("Artists"), not something a reader asks: the fact engine searched it as written, read nothing that answers it, and the row then owed an input nothing could supply. The proposition is the search this gap is about with the subject's own words after it: the search's words the subject does not itself carry, bounded, then the subject whole. Built from the tokens already on the requirement and never from a phrase written here, so it holds for any account; a requirement whose search IS its subject is byte for byte what it was, and the page's own subject still leads the query and the judge's question inside the fact engine. PURE. */
const propositionOf = (topic: string, search: string): string => { if (topic === "grouping criteria and selection boundary") topic = AEO_BAR.groupingQuestion; const bare = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""), words = (t: string): string[] => t.trim().split(/\s+/).filter(Boolean), its = new Set(words(topic).map(bare));
  return [...words(search).filter((w) => bare(w) !== "" && !its.has(bare(w))).slice(0, 8), ...words(topic)].join(" ") || topic.trim(); };
const BENIGN_BACKFILL_SKIPS = new Set(["not_started", "already_complete", "no_synced_property", "no_cursor"]);
/** How many accounts one recovery probe may look at, and how the fleet ROTATES past that bound. Twenty was a fixed HEAD of the account list, so account twenty one was never probed, ever: it could be short every day forever and
 *  nothing would find it. The window MOVES now, by a deterministic offset off the clock in id order, wrapping at the end of the fleet, so consecutive dispatches walk the whole list whatever its size with no cursor to persist, no
 *  fleet held in memory and no second scheduler. Still bounded: this is a recovery sweep, not a fleet scan. */
const FREE_COLLECT_PER_RUN = 8;
/** How many banked claims one drive derives missing source support for, at $0 and from quotes already on file. Bounded because it is a backfill of standing inventory, not the pass's own work. */
const SUPPORT_BACKFILL_PER_DRIVE = 12;
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
  acquireEvidence: (tenantId: string, need: ProposalAcquisitionNeed, basis: string | null, budgetMs: number, review?: Pick<Parameters<typeof import("@/domains/decision/drafted-copy").reviewFinishedCopy>[1], "attempts" | "stopBy">, deliveryScope?: Parameters<typeof DRAFT_BUDGET.scopeAllows>[0], runReceipt?: { runId: string; cycle: string }) => Promise<{ acquired: boolean; detail: string;
    /** False only when an explicit preflight proves no provider was asked; never inferred from prose. */ attempted?: boolean;
    /** WHETHER THE OBLIGATION THIS PURCHASE WAS BOUGHT FOR CAN NOW BE MET, which is a different question from whether the reading landed (live 2026-09-05): a source read and banked below the confidence its consumer requires is a reading that happened and an obligation that did not move, and calling that acquired is how a row re-owed the same purchase every drive for two days. Absent means the two answers are the same. */ unlocked?: boolean; /** THE PROVIDER WAS POSTED FOR THIS READING AND HAS NOT ANSWERED YET (production run p3, 2026-09-06): the money moves at the post, the answer is collected with a free follow-up, and the drive that collects it therefore buys nothing. Present ONLY where there is a post to collect, so absent is the one answer for every reading that landed, failed or cannot post at all. */ posted?: boolean }>;
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
  factCheck: (tenantId: string, budgetMs: number, renew?: () => Promise<boolean>, /** THE PAGE THAT OPENS THE PASS: the highest-ranked open source need, so a drive checks the page whose funded work is waiting rather than the audience's most-read one. Null keeps the rotation order. */ firstPage?: string | null, /** The drive's working context: this phase runs before the walk and reads the same account, so it shares that read rather than making a second one. */ shared?: Map<string, unknown>)
    => Promise<{ status: "advanced" | "done" | "failed"; banked: number; /** The pages this pass banked evidence ON, so a drive can hire the writer that was waiting on one of them in the same turn. */ bankedPages: string[]; pagesComplete: number; failure?: string; reason?: string }>;
  surfaceStale: (tenantId: string, nowMs: number) => Promise<boolean>;
  /** Read back the day's NEW answers (bounded, $0 when nothing changed). Returns THE PASS'S OWN RECEIPT, not a bare number: how many answers it took on, how many ended with a durable verdict, how many of those were a non-reading, and
   *  how many real readings landed, so a run row can say what a pass actually did instead of showing a count nobody can check against the debt. Derived work: it never pauses the run. `budgetMs` is what is LEFT of the drive's own
   *  deadline, and the reading obeys it before every wave and every single: a bound counted in answers is not a bound on the wall clock the hosting platform actually enforces. */
  analyzeAnswers: (tenantId: string, reportingDay: string, budgetMs: number) => Promise<{ attempted: number; settled: number; refused: number; read: number; outcomes: Record<string, number>; /** Calls that genuinely returned and were paid for; absent from a seam that does not meter. */ billed?: number }>;
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
  /** The research notes' row version for a basis, read at the moment the decision step concludes: the watermark this pass consumed. Read AFTER the pass's own
   *  writes, never before, or a pass would forever count its own discovery as new evidence and re-open itself. */
  evidenceVersion: (tenantId: string, basis: string) => Promise<number | null>;
  /** FINISH STORED OPPORTUNITIES THROUGH THE ONE CANONICAL PRODUCER before this cycle buys exploratory evidence. The count on the receipt is the LOW-STOCK ALARM ONLY (operator, 2026-08-30): `deficit` reports how far the stock sits under the alarm floor and sizes NOTHING; the buy runs the whole declared manifest to the pass's own money and time bounds, whatever the count. null = the count could not be read, which defers nothing and claims nothing. `seen` is the day's own memory: the manifest it was working through and the pages it has already spent on. */
  /** THE STORED WORK WAITING ON A READING FOR ONE OF THESE PAGES, named by its own funding key. $0 and bounded: one read of rows already on file, no provider and no model. A day closed `candidates_exhausted` remembers no unsettled job and owes no reading BY CONSTRUCTION, so when a fact lands after it this is the only thing left that can say whose work it was for. */
  researchOwed: (tenantId: string, pages: readonly string[]) => Promise<string[]>;
  replenishReady: (tenantId: string, now: Date, seen?: { /** The pass's paid AEO diagnosis purse, decided by the caller's shift (2026-09-11: 200 per pass every ten minutes was the invisible dollar-forty an hour). */ aeoDiagnoses?: number; jobs?: Readonly<Record<string, JobMemory>>; /** How many charged calls this DRIVE has already spent on earlier walks. The ceiling is one pass, and a drive may run several walks (the stock walk, one per acquired reading, and the one a banked fact wakes), so a drive that reports its spend gets the REMAINDER of the one ceiling instead of a fresh one. */ callsSpent?: number;
    /** THE WORK THE LAST WALK FUNDED AND NEVER BEGAN, by `workKey`: this walk picks it up first, so a drive that runs out of clock hands its remainder to the next one instead of re-walking the same head. */ waiting?: readonly string[];
    /** THE DRIVE'S OWN WORKING CONTEXT (evidence/snapshot-loader carries the contract): the reads this drive has already made, reused by every later walk and dropped part by part as the drive's own writes move them. AND `noRoom` IS THE DRIVE'S OWN ARITHMETIC SAYING THIS BOX CANNOT BEGIN A JOB: the walk's free half runs before the first funded job is considered and the box does not cover it, so the pass runs that free half and funds nothing, rather than selecting a whole manifest and filing every job as "the time box ended before this page's turn" (measured on four consecutive unattended drives, 2026-09-05). */ shared?: Map<string, unknown>; noRoom?: boolean; /** HOW THE CALLER READS A WALK ITS OWN BOX CUT OFF (live 13:00Z drive, 2026-09-05). The drive races this step against a timer as a backstop, and when the timer won it abandoned the promise: the day's memory, the waiting list, every receipt and seventeen provider calls worth 0.18 USD were remembered by nothing, so the next drive funded the same order and lost it the same way. The step hands back a way to ask, once, for the answer this walk would give if it stopped now; the caller keeps it and asks at its box. Read-only, free, and typed as the answer this step returns (the caller names that type, which cannot be written here without the declaration referring to itself). */ filed?: (ask: () => unknown) => void },
    /** The wall-clock moment this drive must stop starting paid work. The pass returns normally at it, with receipts, instead of being cut off by a timer and reporting nothing. */ stopBy?: number) => Promise<{ ready: number; deficit: number; persisted: number;
    /** TRUE only when a post-pass re-read PROVES the stock is AT THE TARGET. */ satisfied: boolean;
    /** HOW THIS DRIVE ENDED, as a machine word. Only two of these four may close a day. `candidates_exhausted` is the one that has to be EARNED: it means every candidate on the current manifest has now been spent on and none of them finished, which is a different fact from "the two I could afford this drive produced nothing" (Codex, 2026-08-22). */
    reason: "made_progress" | "retryable_blocked" | "candidates_exhausted";
    /** THE DAY'S ONE ATTEMPT LEDGER, keyed on the row's own `workKey`: what each job's attempts cost, how the last one ended, and whether anything is left to do for it under this exact evidence. It replaces four page-keyed lists and the manifest fingerprint that reset them; a workKey nobody remembers is new work by construction. */ jobs: Record<string, JobMemory>;
    /** THE ACCOUNT AND EVIDENCE VERSION AN EXHAUSTION WAS EARNED UNDER, present only with `candidates_exhausted`: due-work reopens the day the moment fresh evidence lands, because a manifest settled against yesterday's readings says nothing about today's. */ closedUnder?: string;
    /** THE EXACT READINGS funded candidates were refused for, typed: the dispatch executes these instead of parsing a refusal sentence (Codex, 2026-08-23). */ evidenceOwed?: readonly OwedReading[];
    /** THE FUNDED WORK THIS WALK NEVER BEGAN, by `workKey`. It is a queue position and never a verdict: the next walk of this drive, and the next drive after it, take these first. */ waiting?: readonly string[];
    /** WHAT BECAME OF THE FUNDED WORK. `readySaved` counts CHANGES the operator can act on; `evidenceBanked` counts work that succeeded and is not a change. `receipts` is the COMPLETE per-page record (key, treatment, impact, allowance, exact provider attempts, exact cost, outcome, full reason), durable on the run so a later read reconstructs the dispatch without logs. `ledger` is the adjudicator month total read before and after, beside the metered sum, so the receipt reconciles against real money or names the mismatch itself. */
    outcomes?: { declared?: readonly string[]; readySaved: number; evidenceBanked: number; refused: number; blocked: number; unreached: number; stuck: string[];
      /** WHICH OF THE TWO DEADLINE ANSWERS THIS WALK GAVE: `boxed` = the caller stopped waiting and the walk carried on, so these receipts are a snapshot of work still running; `stopped` = the walk itself would not start funded work it could no longer pay for, so nothing is running and that work is the next drive's first; `ran` = it reached the end of what it funded. */ ended?: "boxed" | "stopped" | "ran"; receipts?: unknown[]; preparedMs?: number; ledger?: { before: number; after: number; delta: number; metered: number; unexplained?: number; reconciled: boolean } } } | null>;
};

/** What this run still allows the ONE advisory reading. `mark` is the runner's own receipt: the reading is bounded per RUN, never per unit iteration. */
type CaseReconcilePlan = { planKeys: string[]; maySynthesize: boolean; mark: () => void; /** The drive's working context, so reconciliation reads the account the walk before it already read. */ shared?: Map<string, unknown> };

/** DID THE REGISTRY ACTUALLY MOVE? Compared the way the registry is READ and never the way it happened to be written: the same rows in another order, or one
 *  row's anchors in another order, are the SAME registry, and a raw JSON compare called that a move, saved it, and bought a reading of a file nothing changed. */
const canonicalRegistry = (rows: readonly ResearchCase[] = []): string => JSON.stringify([...rows].map((c) => ({ id: c.id, anchors: [...c.anchors].sort(), aliasOf: c.aliasOf ?? null, parentId: c.parentId ?? null, pages: (c.pages ?? []).map((p) => `${p.url}|${p.relation}`).sort() })).sort((a, b) => a.id.localeCompare(b.id)));
const sameRegistry = (before: readonly ResearchCase[] = [], after: readonly ResearchCase[] = []): boolean => canonicalRegistry(before) === canonicalRegistry(after);

/** Fold this account's case identities onto the ones already on file and PERSIST them, or THROW. It used to swallow every failure, so a run whose identities were never written went straight on to freeze a plan and spend against them:
 * the comparison it bought belonged to an id nothing on file agreed with. A losing row version is a failure too, because nothing was saved. Nothing here is a partial success. THEN, and only when the registry actually moved this pass AND this run has not asked yet, ONE advisory semantic reading of it (see decision/case-synthesis). That step is fail-soft by contract: the deterministic identities are already saved, so a reading I could not get, could not trust or could not write is simply absent. */
async function reconcileCases(tenantId: string, basis: string, plan: CaseReconcilePlan): Promise<void> {
  const saved = await (async () => {
    const snapshot = await loadEvidenceSnapshot(tenantId, plan.shared ? { shared: plan.shared } : {});
    const cases = reconcileResearchCases(snapshot);
    const loaded = await loadFunnelState(tenantId, basis);
    if (sameRegistry(loaded.state.cases, cases)) return true; // nothing moved: no save, and nothing to re-read
    const rowVersion = await saveFunnelState(tenantId, basis, { ...loaded.state, cases }, loaded.rowVersion);
    if (rowVersion == null) return false;
    // The mark goes down BEFORE the reading, so one that came back empty, refused or unusable still spends this run's single attempt.
    if (plan.maySynthesize) { plan.mark(); await refineCases(tenantId, basis, snapshot, cases, { ...loaded.state, cases }, rowVersion, plan.planKeys).catch(() => {}); }
    return true;
  })().catch(() => false);
  if (!saved) throw new Error("Which of your topics are which could not be saved, so nothing was spent on them. The next visit picks this up again.");
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

export const defaultSteps: ResearchCycleSteps & {
  resumeAcquired: <T>(got: Awaited<ReturnType<ResearchCycleSteps["acquireEvidence"]>>, kind: EvidenceRequirement["kind"], forget: (...parts: string[]) => void, resume: () => Promise<T>) => Promise<T | null>;
} = {
  async resumeAcquired(got, kind, forget, resume) {
    if (!got.acquired) return null;
    forget("evidence", "cards", ...(kind === "semantic_review" ? ["proposals"] : []));
    return got.unlocked === false ? null : resume();
  },
  async replenishReady(tenantId, now, seen, stopBy) {
    const d = await import("@/domains/decision");
    const { creditBreakerHeld } = await import("@/domains/decision/llm/gateway");
    const basis = await d.resolveCurrentBasis(tenantId).catch(() => null);
    const acct = await accountBasis(tenantId).catch(() => null);
    if (basis == null || acct == null) return null;
    const version = acct ? await evidenceRowVersion(tenantId, acct).catch(() => null) : null;
    const closedUnder = `${acct ?? ""}::v${version ?? ""}`;
    const read = () => d.loadProposalQueue(tenantId, { currentBasis: basis, deliveryScope: "existing_page_edits" }).catch(() => null); // THE WHOLE QUEUE, READ ONCE: the stock is counted off it (STOCK, never a row count: thin levers fill at most their share of the five, so substantive work keeps funding) and the day's own memory is settled against the rows it holds, which is the same read either way
    const queue = await read();
    // A QUEUE I COULD NOT READ SETTLES NOTHING: the pass stays owed and the next drive asks again.
    if (queue == null) return null; const before = d.stockOf(queue.ready);
    const jobs: Record<string, JobMemory> = d.settledByRows(seen?.jobs ?? {}, queue, reportingDay(now)); const floor = await readyStockFloor(tenantId).catch(() => READY_STOCK_ALARM); /* THE ROWS ANSWER BEFORE ANYTHING IS FUNDED: a job the caller's box cut off mid-flight lands its row after the box, and the memory takes that row's own answer rather than funding the same work a second time (decision/load-proposals settledByRows). AND THE MOMENT IT MAY SETTLE FROM IS THIS DAY'S OWN START: a drive holds no start of its own here, and the memory it carries is the day's, so a row standing since an earlier day answers for that day and never for this one, while the row a boxed walk landed minutes after the drive before it still settles the work it paid for. */ // the low-stock alarm level: it colors the receipt and nothing else
    const mark = (reason: "made_progress" | "retryable_blocked" | "candidates_exhausted", ready: number, persisted: number,
      outcomes?: { declared?: readonly string[]; readySaved: number; evidenceBanked: number; refused: number; blocked: number; unreached: number; stuck: string[]; familyRead?: { asked: number; loaded: number } }, evidenceOwed?: readonly OwedReading[], waiting?: readonly string[], at: Record<string, JobMemory> = jobs) =>
      ({ ready, deficit: Math.max(0, floor - ready), persisted, satisfied: reason === "candidates_exhausted", reason, jobs: at, ...(reason === "candidates_exhausted" ? { closedUnder } : {}), ...(evidenceOwed && evidenceOwed.length > 0 ? { evidenceOwed } : {}), ...(waiting && waiting.length > 0 ? { waiting } : {}), ...(outcomes ? { outcomes } : {}) });
    if (await creditBreakerHeld(tenantId).catch(() => true)) {
      log.warn("[research-run] the provider's own credit is spent, so the ready inventory was not topped up and this stays owed", { tenantId, ready: before, floor });
      return mark("retryable_blocked", before, 0);
    }
    const { getTenantSpentThisMonthUsd } = await import("@/lib/cost/budget-ledger-supabase");
    const ledgerBefore = await getTenantSpentThisMonthUsd(tenantId, now, "adjudicator-openai").catch(() => null); let ledgerAfter: number | null = null; // read again below, and declared here because the composer above may be asked while the walk is still running
        // THE WALK IS THE DRIVE'S WHOLE ALLOWANCE, and nothing counts it down but money and time: no shortfall, no target, no "enough". THE TOP-UP NEVER SERVES A CACHED DRAFT, so it always pays for a fresh take.
    // AND A DRIVE SPENDS ONE CEILING, NOT ONE PER WALK (reviewer, 2026-09-02): `MAX_PAID_CALLS` bounds a PASS, and a drive runs the stock walk, one walk per acquired reading and one more when a banked fact wakes work, so ten fresh ceilings could run under a single deadline. A caller that reports what its earlier walks metered gets the remainder of the one ceiling; a caller that reports nothing gets the ceiling, exactly as before.
    /** THE ANSWER THIS WALK WOULD GIVE IF IT STOPPED NOW, composed from the pass's own record and nothing else, so the walk that runs to its end and the walk a caller's box cut off are read by ONE piece of arithmetic (live 13:00Z drive, 2026-09-05). A boxed answer settles nothing and closes no day: it carries what was spent, what was begun, what is still owed and what is still waiting, which is exactly what the next drive needs to not fund the same order again. */
    const answerOf = (paid: Awaited<ReturnType<typeof d.produceProposalsForTenant>>["paid"], ready: number, saved: number, boxed: boolean) => { const at: Record<string, JobMemory> = { ...jobs }; /* the memory the rows have already answered, so what a landed row settled is carried onto the run row and never re-opened by this walk's own receipts */
    const count = (o: string) => paid.receipts.filter((r) => r.outcome === o).length;
    // WHAT THIS WALK SELECTED AND NEVER BEGAN, by the work's own identity. A job the clock or the money never reached is not a job that failed: it is the head of the next walk's queue, in this drive and in the one after it, so funded work cannot be selected for ever and started never (live, twenty-seven of twenty-nine funded rows on one drive, 2026-09-04).
    const waiting = paid.receipts.filter((r) => (r.outcome === "not_reached" || r.outcome === "cost_blocked") && !!r.workKey).map((r) => r.workKey).slice(0, 40); // in the plan's own rank order, bounded so a row carries a queue position and never a whole manifest
    const metered = Number(paid.receipts.reduce((n, r) => n + (r.costUsd ?? 0), 0).toFixed(6));
    const delta = ledgerBefore != null && ledgerAfter != null ? Number((ledgerAfter - ledgerBefore).toFixed(6)) : -1;
    const tally: { declared?: readonly string[]; readySaved: number; evidenceBanked: number; refused: number; blocked: number; unreached: number; stuck: string[]; familyRead?: { asked: number; loaded: number }; preparedMs?: number; ended?: "boxed" | "stopped" | "ran"; receipts?: unknown[]; ledger?: { before: number; after: number; delta: number; metered: number; unexplained?: number; reconciled: boolean } } = { familyRead: paid.familyRead, ended: boxed ? "boxed" : paid.receipts.some((r) => r.outcome === "not_reached") ? "stopped" : "ran", /* THE TWO DEADLINE ANSWERS, TOLD APART ON THE ROW (2026-09-05): `boxed` is the CALLER giving up on a walk that is still running, so its receipts are a snapshot and the work goes on; `stopped` is the walk itself refusing to start funded work it could no longer pay for, so nothing is running and the next drive takes that work first. They read as one sentence to an operator otherwise, and the answer to each is different. */ ...(paid.preparedMs != null ? { preparedMs: paid.preparedMs } : {}), /* WHAT THE WALK'S FREE HALF COST THIS PASS, carried onto the run row so the next drive's floor is this account's own measurement and never a constant with a margin */ readySaved: count("produced"), evidenceBanked: count("evidence_banked"), refused: count("deterministic_refusal") + count("already_complete"), blocked: count("retryable_blocked") + count("provider_blocked") + count("cost_blocked"), unreached: count("not_reached") + count("superseded"),
      stuck: [...paid.receipts.filter((r) => r.outcome !== "produced").map((r) => `${r.key}:${r.outcome}${r.why ? `: ${r.why}` : ""}`), ...(paid.declined ?? []).map((d) => `${d.key}:declined: ${d.reason}`)].slice(0, 12), /* BOTH HALVES, ALWAYS (production 05:30Z, 2026-09-11): the either-or here meant a walk with any receipt hid every plan decline, so eight declared jobs vanished from the record and an hour went to finding where; the cap rises with the constant cadence's bigger boards. */ // AND A WALK THAT FUNDED NOTHING SAYS WHY ON THE ROW: with no funded key there is no receipt to carry a reason, and a run row that reports an empty walk with no cause is the same silence the typed outcomes exist to end
      receipts: paid.receipts as unknown[], declared: paid.declared, // the COMPLETE per-page record, durable: logs are not the receipt; the declared list says what the plan even considered
      // WHAT THE RECEIPTS EXPLAIN, AND WHAT IS LEFT OVER. `metered` is the DRAFTING money the per-page receipts account for; the ledger's delta also carries this pass's page readings and any other adjudicator work in the same window, so demanding they match exactly reported a false mismatch on every pass that read a page. `reconciled` now means the receipts never claim MORE than the ledger saw, and `unexplained` names the rest out loud rather than hiding it (Codex, 2026-08-23).
      ledger: ledgerBefore != null && ledgerAfter != null
        ? { before: ledgerBefore, after: ledgerAfter, delta, metered, unexplained: Number((delta - metered).toFixed(6)), reconciled: delta + 0.005 >= metered } : undefined };
    // AND THE LEDGER IS WRITTEN FROM THE RECEIPTS THEMSELVES. Three answers SETTLE a job, and only those three: finished work exists, a reading was banked, or one of Beacon's own gates read it against today's evidence and refused. An empty balance, a cap, a timeout, a provider that would not answer, an unusable answer and a job never reached all leave it owed, because none of them proves the next attempt would fail too. PRODUCED SETTLES ONLY WHAT THE STORE CAN STAND BEHIND, and the producer answers that question PER ROW at the end of its own pass: every produced claim is re-read against the row standing on file and refiled `review_saved` when that row is not ready, so a receipt saying `produced` here is a durable Ready row and settles. The stock DELTA that used to decide it here was a fault (reviewer, 2026-09-02): one real landing beside one phantom moved the count, so both settled and neither was named. AND A JOB NOBODY STARTED IS UNSPENT: a receipt with no calls that settled nothing writes no entry at all, so the next continuation ranks it exactly where its impact puts it rather than behind work that has already been tried.
    for (const r of paid.receipts) { const key = r.workKey; if (!key) continue; // work that declares no identity is remembered by nothing, exactly as the plan reads it
      const settled = r.outcome === "produced" || r.outcome === "evidence_banked" || r.outcome === "deterministic_refusal" || r.outcome === "already_complete"; /* review_saved settles only through the stored-row path in load-proposals: a receipt alone cannot prove the row landed, and a phantom the store downgraded must stay owed (P5 pin). An unsettled review_saved job is re-bought at most once more, because the plan declines any identity after two spent attempts (P4), so the same review is never bought a third time under one workKey. */ if (!settled && (r.providerCalls ?? 0) === 0) { const m = at[key]; if (!m?.settled && (r.outcome === "not_reached" || r.outcome === "cost_blocked")) at[key] = { calls: m?.calls ?? 0, last: r.outcome, settled: false }; continue; } // A CAUSAL BLOCK IS NOT A VERDICT (incident, 2026-09-04): money, a provider that would not answer and a job never begun all leave the work owed, and only a finished row or a gate that read it settles it. THE TIMES IT WAS NEVER REACHED ARE NO LONGER COUNTED (measured, 2026-09-05): the count only fed a demotion that could never release, because demoted work is never reached and so only ever waited again; the walk's own `waiting` list carries the queue position, under worth.
      at[key] = { calls: (at[key]?.calls ?? 0) + (settled ? 0 : 1), last: r.outcome, settled }; } // ONE ATTEMPT, not one request: a deliverable is three charged calls, and counting requests would decline a job the plan has funded exactly once
    const owner = (w: string): string => paid.declared.filter((k) => w.startsWith(`${k}::`)).sort((a2, b2) => b2.length - a2.length)[0] ?? "", mine = Object.entries(at).map(([w, m]) => [owner(w), m] as const).filter(([k]) => k !== ""); /* AND ONLY NOW MAY A DAY BE CALLED FINISHED: every candidate the current manifest declares carries a settled job, nothing the ledger holds for those candidates is still owed an attempt, and no reading is outstanding. A manifest that declared nothing proves nothing, and neither does one nobody could read. A READING STILL OWED IS WORK STILL OWED (falsifier, 2026-09-02): a day cannot be finished while an acquisition it minted has not landed, whatever its per-page receipts say. A workKey opens with the funding key it was declared under, so the longest declared key it opens with is its own; a remembered job no manifest declares any more belongs to evidence that has moved and holds nothing open. AND A WALK ITS CALLER BOXED PROVES NO EXHAUSTION AND NO PROGRESS: it never reached the end of its own manifest, so it is retryable by construction and the next drive walks on. */
      const exhausted = !boxed && paid.declared.length > 0 && (paid.evidenceOwed ?? []).length === 0 && mine.every(([, m]) => m.settled) && paid.declared.every((k) => mine.some(([o, m]) => o === k && m.settled));
      log.info("[research-run] the ready inventory after this walk", { tenantId, before, ready, target: floor, declared: paid.declared.length, jobs: Object.keys(at).length, receipts: paid.receipts.length, exhausted, boxed });
      return mark(boxed ? "retryable_blocked" : ready > before ? "made_progress" : exhausted ? "candidates_exhausted" : "retryable_blocked", ready, saved, tally, paid.evidenceOwed ?? [], waiting, at); };
    const out = await d.produceProposalsForTenant(tenantId, { now, produce: true, deliveryScope: "existing_page_edits", aeoDiagnoses: seen?.aeoDiagnoses, memory: jobs, bypassCache: Object.values(jobs).some((m) => m.calls > 0 && !m.settled), ...(seen?.callsSpent ? { maxCalls: Math.max(0, DRAFT_BUDGET.MAX_PAID_CALLS - seen.callsSpent) } : {}), ...(stopBy != null ? { stopBy } : {}), ...(seen?.waiting?.length ? { waiting: seen.waiting } : {}), ...(seen?.shared ? { shared: seen.shared } : {}), ...(seen?.noRoom ? { noRoom: true } : {}), ...(seen?.filed ? { handOver: (ask) => seen.filed?.(() => ((snap) => answerOf(snap.paid, before, snap.persisted, true))(ask())) } : {}) }).catch(() => null); // AND THE CALLER KEEPS A WAY TO READ THIS WALK IF ITS OWN BOX ENDS FIRST: the walk hands one back as soon as it has a record to give, and a drive that times out reads it instead of throwing the whole pass away. The scheduled production entrance explicitly holds whole-page writing outside this manual-edit proving phase.
    ledgerAfter = out ? await getTenantSpentThisMonthUsd(tenantId, now, "adjudicator-openai").catch(() => null) : null;
    if (out && out.held.length > 0) log.info("[research-run] candidates the replenish pass could not finish, each with its reason", { tenantId, held: out.held.slice(0, 6) });
    // A PASS THAT COULD NOT RUN, COULD NOT READ ITS EVIDENCE, OR COULD NOT SAVE WHAT IT MADE HAS SETTLED NOTHING. It tried nothing it can prove, so nothing is written off and the day stays open.
    if (out == null || out.outcome === "evidence_unreadable" || out.outcome === "persistence_failed") return mark("retryable_blocked", before, 0);
    const after = await read().then((q) => (q ? d.stockOf(q.ready) : null)), persisted = out.persisted;
    // A COUNT NOBODY COULD READ AFTERWARDS PROVES NOTHING EITHER WAY, least of all that a page is finished with.
    if (after == null) return mark("retryable_blocked", before, persisted);
    return answerOf(out.paid, after, persisted, false); // the walk ran to its own end, so its answer may close the day or report progress
  },
  // ONE READ OF ROWS ALREADY ON FILE, and never a second store: the ranked queue this account already keeps names every opportunity still being researched, and a row that owes a reading for a page a fact just landed on is exactly the work that fact was bought for. Bounded to twenty, fail-soft to nothing, and it buys nothing at all.
  async researchOwed(tenantId, pages) {
    if (pages.length === 0) return [];
    const on = new Set(pages.map((p) => p.trim().toLowerCase()));
    const d = await import("@/domains/decision");
    const basis = await d.resolveCurrentBasis(tenantId).catch(() => null);
    const q = await d.loadProposalQueue(tenantId, { currentBasis: basis }).catch(() => null);
    return q == null ? [] : [...new Set(q.research.map((p) => DRAFT_BUDGET.keyOf(p)))].filter((k) => on.has(k.split("::")[0] ?? "")).slice(0, 20); },
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
    return c == null ? null : { done: c.done, total: c.total, answers: c.answers, unavailable: c.unavailable, unsupported: c.unsupported,
      ...(c.readingBacklog !== undefined ? { readingBacklog: c.readingBacklog } : {}) }; },
  currentBasis: accountBasis,
  dueWork,
  evidenceVersion: evidenceRowVersion,
  // RUNTIME IS THE ONLY WRITER OF A CASE IDENTITY, and it writes them BEFORE the plan names one. Evidence resolves the id against what is already on file (evidence/case-identity carries the whole rule and the incident behind it); this persists that answer through the funnel's own save path, and FAILS CLOSED: an unreadable snapshot or row, or a losing row version, pauses this same phase honestly.
  async reconcileCases(tenantId, basis, plan) { await reconcileCases(tenantId, basis, plan); },
  async investigationFocus(tenantId, basis) { return chooseInvestigation(tenantId, basis).catch(() => null); },
  async acquireEvidence(tenantId, need, basis, budgetMs, review, deliveryScope = "all_changes", runReceipt) {
    const deferred = (detail: string) => ({ acquired: false as const, attempted: false as const, detail });
    if (!DRAFT_BUDGET.scopeAllows(deliveryScope, DRAFT_BUDGET.requirementDelivery(need))) return deferred("this reading can only unlock whole-page work, which is outside the current existing-page proof");
    if (need.kind === "semantic_review" && !need.proposalId) return deferred("a review requirement names no change, so there is nothing to read");
    if (!need.workKey?.trim()) return deferred("the proposal-derived requirement has no nonblank work identity, so no provider may be called");
    if (!need.query.trim() && !need.url) return deferred("the requirement names nothing to read");
    if (!basis) return deferred("this dispatch has no confirmed basis, so nothing can be read against it");
    const { CREDIT_BREAKER } = await import("@/lib/cost/credit-breaker");
    // Owned-page repair starts with free saved/raw reads; its paid fallback checks both provider doors itself.
    if (need.kind !== "page_source" && await CREDIT_BREAKER.peek(tenantId).catch(() => "held" as const) !== "clear") return deferred(CREDIT_BREAKER.sentence("openai"));
    if (need.kind !== "page_source" && need.kind !== "semantic_review" && await CREDIT_BREAKER.peek(tenantId, {}, "dataforseo").catch(() => "held" as const) !== "clear") return deferred(CREDIT_BREAKER.sentence("dataforseo"));
    const unitStatus = (out: unknown): string => (out as { status?: string }).status ?? "unknown", unitCursor = { basis, ...(runReceipt ?? {}) };
    const landed = (out: unknown): boolean => unitStatus(out) === "done" || unitStatus(out) === "advanced"; // stage one of winning-pages persists its reads and answers `advanced`; both words mean the write landed
    switch (need.kind) {
      case "serp": {
        const out = await serpAnalysisUnit({}, [need.query])(tenantId, unitCursor, budgetMs).catch((e: unknown) => ({ status: "failed" as const, detail: e instanceof Error ? e.message : String(e) })); // LANDED MEANS ON FILE (live 2026-09-02): the unit answers done for its whole agenda, and eight "done" readings were on no row, so the page itself is read back under the basis before it counts
        const key = canonicalQueryKey(need.query), landed = (await loadFunnelState(tenantId, basis).catch(() => null))?.state.serps.queries.some((q) => canonicalQueryKey(q.query) === key && q.status === "done") === true; /* AND THE STORE IS THE WHOLE ANSWER (measured on the harness, 2026-09-06): the unit answers for its own agenda, so the first of three owed pages bought on one drive came back `advanced` with more searches still to make, its page was on file, and the row was told the reading had not landed. It was then re-owed, re-bought and counted an attempt against itself for a page it already had. What decides is what the basis carries; `waiting` is unchanged, because a posted page is not on file. */
        log.info("[research-run] the exact reading a refused candidate named", { tenantId, kind: need.kind, query: need.query, status: unitStatus(out), landed, basis }); return { acquired: landed, ...(unitStatus(out) === "waiting" ? { posted: true as const } : {}), detail: `results page for "${need.query}": ${landed ? "done" : unitStatus(out) === "done" ? `not on file under ${basis} after the unit finished` : unitStatus(out)}` }; /* WAITING IS THE POST, TYPED AND NEVER READ OUT OF THE SENTENCE: the unit answers `waiting` while any search it asked for is posted and pending, and the collection behind it is a free GET the next drive makes. This is the one requirement kind that can answer it; the winner read and the source check either land or fail. */
      }
      case "competitor_page": {
        const out = await winningPagesUnit({}, [need.query], null, null, null, need.url ?? null)(tenantId, unitCursor, budgetMs).catch((e: unknown) => ({ status: "failed" as const, detail: e instanceof Error ? e.message : String(e) })), st = landed(out) ? await loadFunnelState(tenantId, basis).catch(() => null) : null, read = st != null && jobWinners(projectFunnelEvidence(st.state, Date.now()), [need.query]).some((w) => (!need.url || [w.url, ...w.appearances.map((a) => a.viaUrl)].some((u) => !!u && canonicalUrlKey(u) === canonicalUrlKey(need.url!))) && typeof w.extract?.mainText === "string" && w.extract.mainText.trim().length > 0);
        return { acquired: read, detail: `winning pages for "${need.query}": ${read ? unitStatus(out) : landed(out) ? `no winner of that search carries a reading on file under ${basis} after the unit finished` : unitStatus(out)}` };
      }
      case "page_source": {
        if (!need.url) return { acquired: false, detail: "a page_source requirement names no page" };
        const out = await winningPagesUnit({}, [], null, need.url, null, null, true)(tenantId, unitCursor, budgetMs).catch((e: unknown) => ({ status: "failed" as const, detail: e instanceof Error ? e.message : String(e) }));
        const { loadOwnedPageBodies } = await import("@/domains/evidence/pages/owned-context");
        const body = (await loadOwnedPageBodies(tenantId, [need.url]).catch(() => null))?.get(canonicalUrlKey(need.url));
        const current = body?.version === "current" && !!body.contentHash && isCurrent("owned_page", body.fetchedAt, Date.now());
        if (need.reasonCode === "schema_visible_pair_unconfirmed") {
          const same = (question: string): boolean => question.trim().replace(/\s+/g, " ").toLowerCase() === need.query.trim().replace(/\s+/g, " ").toLowerCase();
          const acquired = current && body.faqs.some((pair) => pair.answerComplete === true && same(pair.question));
          return { acquired, ...("attempted" in out && out.attempted === false ? { attempted: false as const } : {}), detail: `own-page FAQ capture of ${need.url}: ${acquired ? "current complete HTML pair on file" : "the required current complete HTML pair is not on file"}` };
        }
        const acquired = current && body.completeness === "complete";
        return { acquired, ...("attempted" in out && out.attempted === false ? { attempted: false as const } : {}), detail: `own-page read of ${need.url}: ${acquired ? "current complete capture on file" : `current complete capture still owed (${unitStatus(out)})`}` };
      }
      case "factual_source": {
        if (need.finding && (need.finding.tenantId !== tenantId || need.finding.page !== (need.topic?.key ?? (need.url ? pathOf(need.url) : null)))) return { acquired: false, detail: "the known finding does not belong to this tenant and factual owner" };
        const known = need.finding ? (await import("@/domains/evidence/pages/fact-checks").then(m => m.readFactChecks(tenantId, need.finding!.page)).catch(() => [])).find(f => f.page === need.finding!.page && f.statementKey === need.finding!.statementKey) : null;
        if (need.finding && !known?.subject.trim()) return { acquired: false, detail: "the known statement is not inventoried for this owner; discovery cannot replace it" };
        if (need.topic && (need.url || !need.topic.key.startsWith("topic:") || !need.topic.label.trim() || (!known && !need.missingTopic?.trim()))) return { acquired: false, detail: "the prospective factual requirement has ambiguous or missing scope" };
        const prop = known ? { subject: known.subject, url: need.topic?.key ?? need.url! } : need.missingTopic?.trim() && (need.url || need.topic) ? { subject: need.topic ? need.missingTopic.trim() : propositionOf(need.missingTopic.trim(), need.query), url: need.topic?.key ?? need.url! } : null;
        const atomKey = need.finding?.statementKey ?? (need.missingTopic?.trim() ? claimIdentity(need.missingTopic.trim(), "", "missing") : undefined);
        let current: Awaited<ReturnType<typeof seedProposition>> = null;
        if (prop) {
          current = await seedProposition(tenantId, prop.url, prop.subject, need.topic, basis, need.finding, atomKey).catch((e) => { log.warn("[research-run] the proposition could not be inventoried", { tenantId, url: prop.url, error: e instanceof Error ? e.message : String(e) }); return null; });
          if (!current) return { acquired: false, detail: `the proposition could not be qualified at the current owner version for ${prop.url}, so nothing was researched` };
          const already = await propositionState(tenantId, prop.url, prop.subject, current, need.finding, atomKey).catch(() => null);
          if (already?.researched) return { acquired: true, unlocked: already.usable, detail: `no source was bought for ${prop.url}: the answer to "${prop.subject}" is ${already.why}` };
        }
        const out = await factCheckPass(tenantId, budgetMs, undefined, prop?.url ?? need.url ?? null, undefined, prop && (need.rivalUrl ?? need.rivalUrls?.[0])?.trim() ? { subject: prop.subject, url: (need.rivalUrl ?? need.rivalUrls![0]!).trim(), urls: need.rivalUrls, anchor: need.missingTopic?.trim() || prop.subject } : undefined, prop?.subject, need.topic ? { ...need.topic, basis } : undefined, need.finding, atomKey);
        const settled = prop && current ? await propositionState(tenantId, prop.url, prop.subject, current, need.finding, atomKey).catch(() => null) : null;
        const said = `${out.status}${out.failure ? ` (${out.failure})` : ""}, ${out.banked} banked`; // the failure rides in the detail, so a credit hold is read by the drive as nothing asked rather than an attempt spent
        if (settled) return { acquired: settled.researched, unlocked: settled.usable, detail: `fact check of ${prop!.url}: ${said}; the answer to "${prop!.subject}" is ${settled.why}` };
        return { acquired: out.status !== "failed" && out.banked > 0, detail: `fact check of ${need.url ?? "the owed page"}: ${said}` };
      }
      case "semantic_review": {
        if (!need.proposalId) return { acquired: false, detail: "a review requirement names no change, so there is nothing to read" }; // ONE ROW, BY ITS OWN ID: reading the whole account's queue to find one change is an egress bill for a lookup
        const { loadChangeProposal, saveChangeProposal } = await import("@/domains/decision/proposal-store");
        const { reviewFinishedCopy } = await import("@/domains/decision/drafted-copy"); const { unreviewed } = await import("@/domains/decision/proof");
        const row = await loadChangeProposal(tenantId, need.proposalId).catch(() => null);
        if (!row || row.tenantId !== tenantId || row.id !== need.proposalId) return { acquired: false, detail: `no scoped change on file answers to ${need.proposalId}, so there is nothing to read` };
        const read = await reviewFinishedCopy(row, { tenantId, proposalWorkKey: need.workKey, now: new Date(), stopBy: Math.min(review?.stopBy ?? Infinity, Date.now() + Math.max(0, budgetMs)), ...(review?.attempts ? { attempts: review.attempts } : {}) }).catch((e: unknown) => ({ row: null, detail: e instanceof Error ? e.message : String(e) }));
        if (!read.row) return { acquired: false, detail: `reading the sources behind ${row.id}: ${read.detail}` }; // a provider that could not answer leaves the row exactly as it stands
        const saved = await saveChangeProposal(read.row).catch(() => "failed" as const);
        return { acquired: saved === "saved" || saved === "unchanged", unlocked: (saved === "saved" || saved === "unchanged") && unreviewed(read.row) === null, detail: `review of ${row.id}: ${read.detail} (${saved})` };
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
      for (const key of keys) { if (Date.now() >= endsAt) break; const got = (await collectCapability(key).catch(() => null))?.state; if (got === "ok" || got === "hit") ready += 1; } /* THE RECEIPT COUNTS WHAT LANDED ON THIS PASS (measured on the harness, 2026-09-06): a task this collection finishes answers `ok` and only a row that was ALREADY ready answers `hit`, so `ready` read 0 in exactly the case the collection did its job, and the run row said two pages were still pending when both had just come back. Either answer is a page now on file; nothing else is. */
      log.info("[research-run] tasks already paid for were checked for free", { pending: keys.length, ready });
      return { pending: keys.length, ready };
    } catch (e) { log.warn("[research-run] the free task collection could not run", { error: e instanceof Error ? e.message.slice(0, 160) : String(e) }); return { pending: 0, ready: 0 }; } },
  async funnelUnit(phase, tenantId, cursor, budgetMs, focus) {
    const { queries, cases, ownedUrl } = focusReads(focus, Date.now(), (cursor?.basis as string) ?? null);
    if (phase === "serp_analysis") return serpAnalysisUnit({}, queries)(tenantId, cursor, budgetMs);
    if (phase === "winning_pages") {
      const ask = cursor?.stage === "compare" ? await comparisonForFocus(tenantId, focus, (cursor.basis as string) ?? null).catch(() => null) : null;
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
  async factCheck(tenantId, budgetMs, renew, firstPage, shared) { return factCheckPass(tenantId, budgetMs, renew, firstPage ?? null, shared); },
  async surfaceStale(tenantId, nowMs) {
    const { readCustomerSurface, isCustomerSurfaceStale } = await import("@/app/(shell)/surface-release");
    const surface = await readCustomerSurface(tenantId).catch(() => null);
    return surface == null || isCustomerSurfaceStale(surface.computedAt, nowMs); // no saved release yet = a first publish is genuinely due
  },
};
const owedOneSectionRead = (c: { state: string; subject: string; sources: readonly { groups?: readonly string[]; groupExcerpts?: readonly unknown[]; sectionsRead?: boolean }[] }): boolean => c.state === "checked" && c.subject.endsWith(AEO_BAR.groupingQuestion) && c.sources.length > 0 && !c.sources.some((x) => x.sectionsRead === true || (x.groupExcerpts?.length ?? 0) > 0); /* A GROUPING ANSWER BANKED BEFORE THE SOURCE'S SECTIONS RODE WITH IT IS READ ONCE MORE (2026-09-10): the wildlife hub's grouping row holds two group names and one sentence, and every writer hired on it wrote two empty headings; the row is reopened exactly once: a source read as its sections carries the mark whatever the judge answered, so the row never enters here again, whatever the clock says. */ const ANCHORED_READ_SINCE = Date.parse("2026-09-07T05:00:00Z"), owedOneAnchoredRead = (c: { state: string; verdict: string; sourceReadAt: string | null; checkedAt: string }): boolean => c.state === "checked" && c.verdict === "undecidable" && c.sourceReadAt == null && (Date.parse(c.checkedAt) || 0) < ANCHORED_READ_SINCE; // ONE READ UNDER THE ANCHOR FOR EVERY ROW JUDGED BEFORE THE ANCHOR EXISTED (journey review, 2026-09-07): a missing subject judged undecidable whose passages never carried it (the window opened on the page introduction) was settled for good, so the requirement owed a fact for ever and hired no writer. Rows checked before this release get exactly one read where the winner's own heading starts; a row checked after it never enters this branch, so a researched answer on file still costs nothing to reuse.
/** Reopen the exact known statement only while its wording/locator still belong to the current owner; otherwise
 * inventory a genuinely new missing proposition. Return the observed body/basis scope that settlement must read back. */
async function seedProposition(tenantId: string, pageUrl: string, proposition: string, topic?: EvidenceRequirement["topic"], currentBasis?: string, finding?: EvidenceRequirement["finding"], atomKey?: string): Promise<{ pageContentHash: string | null; evidenceBasis: string | null } | null> {
  const [facts, { claimIdentity, pageHashOf }, { loadOwnedPageBodies }, { resolveCurrentBasis }] = await Promise.all([
    import("@/domains/evidence/pages/fact-checks"), import("@/domains/evidence/pages/fact-check-run"),
    import("@/domains/evidence/pages/owned-context"), import("@/domains/decision/load-proposals")]);
  const bodies = topic ? null : await loadOwnedPageBodies(tenantId, [pageUrl]).catch(() => null);
  const b = bodies?.get?.(canonicalUrlKey(pageUrl)); if (!topic && (!b || b.version !== "current" || !b.contentHash)) return null;
  const body = b ? [b.title, b.h1, ...(b.headings ?? []), ...(b.passages ?? [])].filter(Boolean).join("\n") : "";
  const basis = topic ? currentBasis ?? null : await resolveCurrentBasis(tenantId).catch(() => null);
  if (topic && !basis) return null;
  const path = topic?.key ?? pathOf(pageUrl), hash = topic ? null : pageHashOf(body), key = finding?.statementKey ?? atomKey ?? claimIdentity(proposition, "", "missing"), current = { pageContentHash: hash, evidenceBasis: basis };
  const held = await facts.readFactChecks(tenantId, path).catch(() => [] as Awaited<ReturnType<typeof facts.readFactChecks>>);
  const mine = held.find((h) => h.statementKey === key), unread = !!mine && (owedOneAnchoredRead(mine) || owedOneSectionRead(mine)), astray = !!mine && mine.state === "checked" && mine.verdict === "undecidable" && !!mine.proposed?.trim(), rulesMoved = !!mine && mine.state === "checked" && mine.rulesVersion !== facts.rulesVersionFor(mine); // A CHECKED ROW HOLDING AN UNDECIDED STATEMENT ANSWERED A DIFFERENT SUBJECT (reviewer, 2026-09-02): live, "are there cobras in iran" came back "Iran has AH-1 Cobra attack helicopters." with the judge's own note saying the sources do not address snakes. ONCE: a re-researched row banks its statement only under `page_correct`, so this holds for rows banked before that rule and never again. AND A ROW JUDGED UNDER RULES SINCE REPLACED FOR ITS SHAPE IS NOT RESEARCHED AT THIS VERSION AT ALL: every question-shaped row checked before the rules that judge a missing answer moved reads as satisfied here, so nothing would ever re-judge it.
  if (finding && (!mine || (mine.current.trim() && !body.includes(mine.current.trim())) || (mine.pageLocator && mine.pageLocator !== "missing" && !body.split("\n").includes(mine.pageLocator)))) return null;
  if (topic && mine?.current.trim()) return null;
  const scopeMoved = !!topic && !!mine && mine.evidenceBasis !== basis; // a topic row is scoped to its basis; a URL row is scoped to its page and is reopened only when that page moved
  if (mine?.state === "checked" && mine.pageContentHash === hash && !scopeMoved && !astray && !rulesMoved && !unread) return current;
  if (mine && (mine.state !== "owed" || mine.pageContentHash !== hash || scopeMoved || astray || rulesMoved || unread)) {
    const n0 = await facts.recordFactChecks(tenantId, path, [{ ...mine, state: "owed", rulesVersion: facts.rulesVersionFor(mine), pageContentHash: hash, evidenceBasis: basis, // the reopened row carries the version its shape is judged under, or the same rule would hand it back every drive
      note: astray ? "Reopened: the answer must be about this page's own subject." : unread ? (owedOneSectionRead(mine) ? "Reopened: the words the source keeps under its own headings are read once for this grouping answer." : "Reopened: read once without finding a passage about it, so the winner is read again where its own heading starts.") : rulesMoved ? "Reopened: the rules that judge a missing answer changed." : scopeMoved ? "Reopened: the evidence basis moved and this proposition is owed again under the current basis." : "Reopened: the page moved to a new version and this missing proposition is owed again.", checkedAt: new Date().toISOString() }]).catch(() => 0);
    if (n0 <= 0) return null;
  } else if (!mine) await facts.recordOwedClaims(tenantId, path, [{ statementKey: key, subject: proposition, current: "", locator: "missing" }], hash, basis).catch(() => -1);
  const after = await facts.readFactChecks(tenantId, path).catch(() => [] as Awaited<ReturnType<typeof facts.readFactChecks>>);
  return after.some((h) => h.statementKey === key && h.state === "owed" && h.pageContentHash === hash && h.evidenceBasis === basis) ? current : null;
}

/** Read back the exact researched proposition through the canonical copy-authorization rule. */
async function propositionState(tenantId: string, pageUrl: string, proposition: string, current: NonNullable<Awaited<ReturnType<typeof seedProposition>>>, finding?: EvidenceRequirement["finding"], atomKey?: string): Promise<{ researched: boolean; usable: boolean; why: string }> {
  const [facts, { claimIdentity }] = await Promise.all([import("@/domains/evidence/pages/fact-checks"), import("@/domains/evidence/pages/fact-check-run")]);
  const path = pageUrl.startsWith("topic:") ? pageUrl : pathOf(pageUrl), key = finding?.statementKey ?? atomKey ?? claimIdentity(proposition, "", "missing"), mine = (await facts.readFactChecks(tenantId, path).catch(() => [])).find((h) => h.page === path && h.statementKey === key && h.evidenceBasis === current.evidenceBasis && h.pageContentHash === current.pageContentHash && (!pageUrl.startsWith("topic:") || h.current.trim() === "")) ?? null;
  if (mine == null || mine.state !== "checked") return { researched: false, usable: false, why: mine == null ? "not inventoried, so nothing has researched it" : "still owed, so its sources have not been read yet" };
  const usable = facts.authorizedCorrections([mine], undefined, tenantId).length > 0; /* A READ THAT QUOTED NO SOURCE IS NOT FINISHED RESEARCH (delivery loop, 2026-09-07): an undecidable verdict whose passages never carried the subject (the window opened on the wrong region of the page) settled the proposition for good, so the row owed a fact for ever and never a writer. It is researched again, bounded by the day's attempt stop like any other reading; a verdict that quoted a source stands. */
  if (!usable && owedOneAnchoredRead(mine)) return { researched: false, usable: false, why: "read once without finding a passage about it, so the winner is read again where its own heading starts" };
  return { researched: true, usable, why: usable ? "researched, and it stands behind an answer the copy may use" : `researched, and what came back is rated ${mine.confidence} and does not meet the evidence rules copy must stand on` }; // NAMED IN PLAIN WORDS AND NEVER BY A STORED SLUG: this sentence rides the need onto the pass receipt an operator reads
}

/** THE ONE FACT-CHECK PASS, shared by the daily phase (no target: rotation picks the page) and by a `factual_source` acquisition (the named page goes FIRST, because the requirement is that page's owed claims and rotation would spend the pass elsewhere). Same bounds, same stores, same receipts either way. */
async function factCheckPass(tenantId: string, budgetMs: number, renew: (() => Promise<boolean>) | undefined, firstPage: string | null, shared?: Map<string, unknown>, rival?: { subject: string; url: string; urls?: string[]; anchor?: string }, proposition?: string, topic?: NonNullable<EvidenceRequirement["topic"]> & { basis: string }, finding?: EvidenceRequirement["finding"], atomKey?: string): Promise<{ status: "advanced" | "done" | "failed"; banked: number; bankedPages: string[]; pagesComplete: number; failure?: string; reason?: string }> {
    const deadlineAt = Date.now() + Math.max(0, budgetMs);
    try {
      if (await import("@/domains/decision/llm/gateway").then((m) => m.creditBreakerHeld(tenantId)).catch(() => true)) return { status: "failed", banked: 0, bankedPages: [], pagesComplete: 0, failure: "credit_held", reason: "the model provider's credit is spent, so no claim was judged this pass; it resumes when a call goes through" }; /* THE LANE IS SKIPPED, NOT LOOPED (audit 3.7, 2026-09-14): a held door answers every judge call at $0 as a refusal, the pass read that as one claim's own fault, set it aside and walked up to 200 claims through cached sources burning the drive's clock on a judge that cannot answer */
      const [{ runFactCheckPass, claimIdentity }, facts, { loadEvidenceSnapshot }, { loadOwnedPageBodies }] = await Promise.all([
        import("@/domains/evidence/pages/fact-check-run"), import("@/domains/evidence/pages/fact-checks"),
        import("@/domains/evidence/snapshot-loader"), import("@/domains/evidence/pages/owned-context"),
      ]);
      const snapshot = await loadEvidenceSnapshot(tenantId, shared ? { shared } : {});
      if (topic && (snapshot.scope.tenantId !== tenantId || !snapshot.scope.site)) return { status: "failed", banked: 0, bankedPages: [], pagesComplete: 0, reason: "the prospective research has no verified website scope" };
      const held = await facts.readFactChecks(tenantId);
      const qd = new Map<string, number>();
      for (const p of snapshot.ownedPages) for (const q of p.search?.topQueries ?? []) for (const w of q.query.toLowerCase().split(/\s+/)) if (w.length > 2) qd.set(w, (qd.get(w) ?? 0) + q.impressions);
      const sdm = (t: string): number => Math.max(0, ...t.toLowerCase().split(/\s+/).filter((w) => w.length > 2).map((w) => qd.get(w) ?? 0));
      held.sort((a, b) => sdm(b.subject) - sdm(a.subject));
      const coverage = new Map<string, number>();
      for (const h of held) coverage.set(h.page, Math.min(coverage.get(h.page) ?? Infinity, Date.parse(h.checkedAt) || 0));
      // FINISH WHAT IS ALREADY BOUGHT FIRST: a page holding owed claims outranks an unopened one. THEN DEMAND OUTRANKS ROTATION (operator, 2026-08-30): the wave spent most of its $0.60 judging low-value claims because oldest-coverage rotation came before audience, so the audience the account actually has decides next and rotation only breaks the tie. Nothing is dropped: every owed claim stays owed and typed exhaustion still reaches the tail. A NAMED TARGET OUTRANKS EVERYTHING: an acquisition runs for one page's owed claims.
      const owedPage = new Set(held.filter((h) => h.state === "owed").map((h) => h.page)), askedPage = new Set(held.filter((h) => h.state === "owed" && facts.rulesVersionFor(h) === facts.MISSING_ANSWER_RULES_VERSION).map((h) => h.page)); // A MISSING ANSWER IS A CUSTOMER WAITING FOR AN ANSWER BLOCK, INVENTORY IS THE PAGE TALKING TO ITSELF (live, 0c2059ec): three question rows reopened and the drive spent every unit on one hub's "Quick Facts" claims, because holding owed claims at all was the whole tie-break.
      const want = topic?.key ?? (firstPage ? pathOf(firstPage) : null), named = (u: string): number => (want != null && pathOf(u) === want ? 1 : 0);
      const ranked = [...snapshot.ownedPages]
        .sort((a, b) => named(b.url) - named(a.url)
          || (askedPage.has(pathOf(b.url)) ? 1 : 0) - (askedPage.has(pathOf(a.url)) ? 1 : 0)
          || (owedPage.has(pathOf(b.url)) ? 1 : 0) - (owedPage.has(pathOf(a.url)) ? 1 : 0)
          || (b.search?.impressions90d ?? 0) - (a.search?.impressions90d ?? 0)
          || (coverage.get(pathOf(a.url)) ?? -1) - (coverage.get(pathOf(b.url)) ?? -1));
      const basis = topic?.basis ?? await import("@/domains/decision/load-proposals").then((m) => m.resolveCurrentBasis(tenantId)).catch(() => null);
      const { callStructuredLLM } = await import("@/domains/decision/llm/structured-drafter");
      const read = async (input: { kind: "fact_claim_extraction" | "fact_claim_judgement"; system: string; user: string; grounded: string; projectedCostUsd: number; maxTokens: number }) => {
        const left = deadlineAt - Date.now();
        if (left <= 0) return { hold: "unavailable" as const };
        const r = await callStructuredLLM({ kind: input.kind, tenantId, system: input.system, user: input.user,
          grounded: input.grounded, projectedCostUsd: input.projectedCostUsd, maxTokens: input.maxTokens,
          timeoutMs: Math.max(5_000, Math.min(60_000, left)), now: new Date() }).catch(() => null);
        if (r?.status === "drafted") return { value: r.value as Record<string, unknown> };
        return { hold: r?.status === "blocked_budget" || (r?.status === "validation_failed" && r.failure === "credit_exhausted") ? "capped" as const : r?.status === "validation_failed" ? "refused" as const : "unavailable" as const }; // a door that trips mid-pass is an account-wide stop, never this claim's refusal
      };
      const { providerCall, parseCapability, collectCapability } = await import("@/domains/evidence/dataforseo/capabilities"), { readPublicPageExtract } = await import("@/domains/evidence/dataforseo/page-extract-cache");
      // A POSTED TASK IS COLLECTED, NEVER LEFT PENDING, and a provider hold keeps its NAME: capped, waiting and transport failure are different debts and the unit types each one (Codex, 2026-08-18).
      const bought = async (cap: "serp_organic" | "onpage_content_parsing", input: Record<string, unknown>, key: string) => {
        if (Date.now() >= deadlineAt) return null;
        let call = await providerCall(cap, input as never, { tenantId, unitKey: `fact-check:${key}` }).catch(() => null);
        if (call?.state === "waiting" && call.cacheKey) call = await collectCapability(call.cacheKey).catch(() => null);
        if (call && (call.state === "hit" || call.state === "ok")) return { parsed: parseCapability(cap, call.envelope) };
        return { hold: call?.state === "capped" ? "capped" as const : call?.state === "waiting" ? "waiting" as const : "unavailable" as const };
      };
      const out = await runFactCheckPass({
        tenantId, basis, deadlineAt, held, renew, read, ...(rival ? { rival } : {}), structured: (subject: string) => subject.endsWith(AEO_BAR.groupingQuestion),
        ...(want && proposition ? { target: { page: want, statementKey: finding?.statementKey ?? atomKey ?? claimIdentity(proposition, "", "missing") } } : {}),
        pages: topic ? [{ url: `https://${snapshot.scope.site}`, path: topic.key, prospective: topic.label, loadBody: async () => "" }] : ranked.map((p) => ({ url: p.url, path: pathOf(p.url), loadBody: async () => {
          const bodies = await loadOwnedPageBodies(tenantId, [p.url]).catch(() => null);
          const b = bodies?.get?.(canonicalUrlKey(p.url)); // the same canonical key: an absolute owned-page address read back nothing here, so every page was skipped for having no stored words and the pass banked nothing on a store holding hundreds
          return b?.version === "current" && !!b.contentHash ? [b.title, b.h1, ...b.headings, ...b.passages].filter(Boolean).join("\n") : "";
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
        // THE PARSER'S OWN SHAPE: bodyText, openingSample and headings.
        fetchSource: async (url, required) => {
          const cached = await readPublicPageExtract(url).catch(() => null);
          const held = cached ? pageExtractFromRecord(cached.extract) : null, at = Date.parse(cached?.fetchedAt ?? "");
          const r = held?.truncated === false && held.mainText?.trim() && Number.isFinite(at) && at <= Date.now() && (!required?.structured || (held.sections?.length ?? 0) >= 2) ? { parsed: held, fetchedAt: cached!.fetchedAt } : await bought("onpage_content_parsing", { url }, `src:${url}`.slice(0, 80));
          if (r == null || "hold" in r) return { hold: r?.hold ?? "unavailable" };
          const parsed = r.parsed as { title?: string | null; mainText?: string | null; bodyText?: string | null; openingSample?: string | null; headings?: string[]; sections?: { heading: string | null; text: string }[] } | null;
          const text = parsed?.sections?.length /* THE SECTIONS INLINE, EACH HEADING ABOVE ITS OWN WORDS (delivery loop, 2026-09-07): a flat body followed by the heading list put every heading at the document's tail, so a window anchored on the winner's heading opened on the wrong region; the flat shape stays for a parse that carried no topics */ ? parsed.sections.map((s) => [s.heading, s.text].filter(Boolean).join("\n")).join("\n") : [parsed?.mainText ?? parsed?.bodyText, parsed?.openingSample, ...(parsed?.headings ?? [])].filter(Boolean).join("\n");
          return text.trim() ? { text, title: parsed?.title ?? null, sections: parsed?.sections ?? [], ...("fetchedAt" in r ? { fetchedAt: r.fetchedAt } : {}) } : { hold: "refused" as const }; // the FETCHED document's own title rides along: it identifies the subject of an anaphoric passage, which a SERP title or slug never can
        },
      });
      // AND THE SUPPORT ARTIFACT EVERY BANKED SOURCE OWES, DERIVED AT $0 AND BOUNDED PER DRIVE. Nothing in the runtime ever ran this, so 1,023 of 1,194 banked sources carry no artifact at all and not one of the rows they back may be spent on a correction: evidence this account already paid for, sitting unusable. Deterministic derivation from the quote ALREADY ON FILE only, so no search, no fetch and no cent; a claim its own
      // quote genuinely cannot carry is banked unsupported with its reason rather than reopened, because reopening buys fresh research and this is the free half. Fail-soft: it never decides the phase's own answer.
      const sectionsOwed = held.filter((h) => owedOneSectionRead(h)).slice(0, SUPPORT_BACKFILL_PER_DRIVE); const owedSupport = held.filter((h) => h.state === "checked" && !sectionsOwed.includes(h) && h.sources.some((s) => s.says.trim() !== "" && s.support == null)).slice(0, SUPPORT_BACKFILL_PER_DRIVE); // THE GROUPING ROWS BANKED BEFORE THE SECTIONS RODE ARE DECIDED FIRST (independent review, 2026-09-10): the support backfill below would otherwise take such a row for its missing artifact and rebank it checked in the same pass this slice reopens it.
      // AND THE MISSING-INFORMATION ROWS WHOSE ARTIFACTS WERE JUDGED BY THE HEADWORD RULE. A row that corrects nothing is supported by PROPOSITION CARRIAGE, so its banked artifacts were decided under a question that never applied to it and are stale by identity; they are re-derived here at $0, and a row still below confirmed is handed back to the fact pass once so the proposition rule may settle it. Its own slice, so this never crowds out the rows that carry no artifact at all.
      /* A READING THE CONSUMER CAN ALREADY USE IS NEVER RE-OWED AND NEVER RE-BOUGHT (round-three reviewer, 2026-09-05). Both predicates below asked `confidence !== "confirmed"`, which was the whole-account bar before the evidence bar became proportional to what a treatment risks: an ADDITIVE answer a reader undoes by deleting it is now accepted at `likely`, so a row the writer may already stand on was reopened here, and reopening buys fresh research. The bar is not mirrored as a grade, it is ASKED of the one door that decides it (`authorizedCorrections`), so the money and the copy can never drift apart again; the call is one in-memory read of the row already in hand and costs nothing. */
      const usable = (h: (typeof held)[number]): boolean => facts.authorizedCorrections([h], undefined, tenantId).length > 0;
      const gap = (h: (typeof held)[number]): boolean => h.current.trim() === "" && !!h.proposed?.trim(), stale = (h: (typeof held)[number]): boolean => h.current.trim() === "" && (h.rulesVersion !== facts.rulesVersionFor(h) || (!usable(h) && !!h.proposed?.trim() && h.sources.length > 0 && h.sources.every((s) => s.says.trim() === "") && !h.note.includes("the passage behind this answer was not found"))); // a row whose every source banked an empty quote lost its answer to the verbatim test and is worth one more unit now that the bank searches the passage the judge read; ONCE, so a row whose note already carries those words (claim-support.ts guards on them, fact-check-run.ts banks them) never takes one of the twelve free slots again
      const gapSupport = held.filter((h) => h.state === "checked" && gap(h) && !owedSupport.includes(h) && !sectionsOwed.includes(h)
        && h.sources.some((s) => s.says.trim() !== "" && s.support != null)).slice(0, SUPPORT_BACKFILL_PER_DRIVE);
      // AND THE MISSING-ANSWER ROWS JUDGED UNDER RULES SINCE REPLACED FOR THEIR SHAPE. A question the page does not answer is judged under rules of its own now, and nothing else re-judges a row already checked: the artifacts above are current, the unit's own sweep waits for the page to come up by cursor, and the seed reads the row as satisfied. Its own slice, bounded like the others, and every row it feeds is reopened at $0 for one paid re-research at its turn.
      const rulesMoved = held.filter((h) => h.state === "checked" && stale(h) && !owedSupport.includes(h) && !gapSupport.includes(h) && !sectionsOwed.includes(h)).slice(0, SUPPORT_BACKFILL_PER_DRIVE); for (const pg of new Set(sectionsOwed.map((h) => h.page))) if (Date.now() < deadlineAt) await facts.reopenObsoleteChecks(tenantId, pg, sectionsOwed.filter((h) => h.page === pg), "Reopened: the words the source keeps under its own headings are read once for this grouping answer.").catch(() => 0); // THE GROUPING ROWS BANKED BEFORE THE SECTIONS RODE, REOPENED FROM THE PASS ITSELF (independent review, 2026-09-10): the seed above is reached only through a writer that owes a grouping, and the wildlife hub's row already holds two groups, so nothing would ever have reopened it; its own slice, bounded like the others, and every row it feeds is read once more at its turn.
      const targets = [...owedSupport, ...gapSupport, ...rulesMoved].map((h) => ({ page: h.page, statementKey: h.statementKey,
        onUnsupported: gap(h) && !usable(h) ? "reopen" as const : "bank" as const, ...(stale(h) ? { rulesStale: true } : {}) })); // THE FLAG IS THE ROW'S OWN, NEVER THE SLICE IT ARRIVED IN (live, 0c2059ec): the flag row carries two current artifacts, so slice 2 took it, reported already_current and the third slice then subtracted it for ever. Every selected row is asked the same question.
      if (targets.length > 0 && Date.now() < deadlineAt) {
        const { backfillClaimSupport } = await import("@/domains/evidence/pages/claim-support");
        const page = new Map<string, ReturnType<typeof facts.readFactChecks>>(); // one read per PAGE, not per claim: a page's rows answer every target on it
        const banked = await backfillClaimSupport(tenantId, targets,
          { rows: (p) => { const held0 = page.get(p) ?? facts.readFactChecks(tenantId, p); page.set(p, held0); return held0; }, rulesVersionFor: facts.rulesVersionFor,
            rebank: (p, rows) => facts.recordFactChecks(tenantId, p, rows), reopen: (p, rows, why) => facts.reopenObsoleteChecks(tenantId, p, rows, why) }).catch(() => []);
        log.info("[research-steps] source support derived for claims already paid for", { tenantId, asked: targets.length, supported: banked.filter((o) => o.action === "banked_supported").length, reopened: banked.filter((o) => o.action === "reopened").length });
      }
      return { status: out.status, banked: out.banked, bankedPages: out.bankedPages, pagesComplete: out.pagesComplete, failure: out.failure, reason: out.reason };
    } catch (e) {
      log.warn("[research-steps] the fact check could not run this pass", { tenantId, error: e instanceof Error ? e.message : String(e) });
      return { status: "failed", banked: 0, bankedPages: [], pagesComplete: 0, failure: "step_error", reason: "the fact check could not run this pass" };
    }
}
