import "server-only"; import { AEO_BAR } from "@/domains/decision/accept-worthy"; import type { ResearchRunProgress } from "../research-run";
import { claimIdentity } from "@/domains/evidence/pages/fact-check-run"; import { PROOF_SPEND } from "@/lib/spend-scope";
import { isSafeRedirectHopUrl } from "@/lib/net/safe-source-fetch"; import { autoRefreshStaleConnectorsForTenant } from "@/lib/connectors/on-use-refresh";
import { keywordDiscoveryUnit, promptObservationUnit, serpAnalysisUnit, winningPagesUnit, type FunnelUnitOutcome } from "@/domains/evidence";
import { loadFunnelState, saveFunnelState, emptyFunnelState, type FunnelState } from "@/domains/evidence/funnel/state";
import { pageExtractFromRecord, sectionsFrom, type ResearchCase } from "@/domains/evidence/funnel/research-evidence"; import { applySynthesis } from "@/domains/evidence/case-identity";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { normalizeKeyword } from "@/domains/evidence/funnel/normalize";
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
import { getTenant, websiteOf } from "@/domains/account";
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
type AcquisitionNeedBase = Pick<EvidenceRequirement, "kind" | "query" | "url" | "missingTopic" | "topic" | "finding" | "rivalUrl" | "rivalUrls" | "proposalId" | "ownerVersion" | "delivery"> & Partial<Pick<EvidenceRequirement, "reasonCode">>;
type ProposalAcquisitionNeed = AcquisitionNeedBase & { workKey: string; key?: string; unlocks?: { proposalId: string } };
const pathOf = (u: string): string => { try { return new URL(u.startsWith("http") ? u : `https://${u}`).pathname.replace(/\/+$/, "") || "/"; } catch { return u; } }; const sameFinal = (a: string | null | undefined, b: string): boolean => { try { if (!a || !b || a.startsWith("/") || b.startsWith("/")) return false; const absolute = (url: string) => new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`), x = absolute(a), y = absolute(b); return x.protocol === y.protocol && x.port === y.port && x.hostname.replace(/^www\./, "") === y.hostname.replace(/^www\./, "") && x.pathname === y.pathname && x.search === y.search; } catch { return false; } };
const propositionOf = (topic: string, search: string): string => { if (topic === "grouping criteria and selection boundary") topic = AEO_BAR.groupingQuestion; const bare = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""), words = (t: string): string[] => t.trim().split(/\s+/).filter(Boolean), its = new Set(words(topic).map(bare));
  return [...words(search).filter((w) => bare(w) !== "" && !its.has(bare(w))).slice(0, 8), ...words(topic)].join(" ") || topic.trim(); };
const BENIGN_BACKFILL_SKIPS = new Set(["not_started", "already_complete", "no_synced_property", "no_cursor"]);
const FREE_COLLECT_PER_RUN = 8;
const SUPPORT_BACKFILL_PER_DRIVE = 12;
type RefreshSourcesResult = { attempted: number; succeeded: string[]; failures: Array<{ provider: string; detail: string }> };
type BackfillChunkResult = { kind: "advanced"; complete?: boolean; daysPulled?: number } | { kind: "no_work" };
export type ResearchCycleSteps = {
  deliveryScope?: Parameters<typeof DRAFT_BUDGET.scopeAllows>[0]; preferred?: { proposalId: string; workKey: string; strict?: true; version?: number };
  initialTarget?: (tenantId: string, stopBy: number, shared?: Map<string, unknown>, current?: Pick<OwedReading, "kind" | "key" | "workKey" | "ownerVersion">) => Promise<OwedReading | null>;
  scopeOwner?: (tenantId: string, need: ProposalAcquisitionNeed, scope: Parameters<typeof DRAFT_BUDGET.scopeAllows>[0]) => Promise<boolean>;
  refreshSources: (tenantId: string, now: Date, attemptKey: string) => Promise<RefreshSourcesResult>;
  backfillChunk: (tenantId: string, now: Date, attemptKey: string) => Promise<BackfillChunkResult>;
  crawlPages: (tenantId: string, now: Date, deadline: number) => Promise<number>;
  funnelUnit: (phase: ResearchPhase, tenantId: string, cursor: Record<string, unknown> | null, budgetMs: number, focus: ResearchFocus | null) => Promise<FunnelUnitOutcome>;
  investigationFocus: (tenantId: string, basis: string | null) => Promise<ResearchFocus | null>;
  acquireEvidence: (tenantId: string, need: ProposalAcquisitionNeed, basis: string | null, budgetMs: number, review?: Pick<Parameters<typeof import("@/domains/decision/drafted-copy").reviewFinishedCopy>[1], "attempts" | "stopBy">, deliveryScope?: Parameters<typeof DRAFT_BUDGET.scopeAllows>[0], runReceipt?: { runId: string; cycle: string }) => Promise<{ acquired: boolean; detail: string; factCheck?: Awaited<ReturnType<ResearchCycleSteps["factCheck"]>>;
    /** False only when an explicit preflight proves no provider was asked; never inferred from prose. */ attempted?: boolean; preflight?: "owner_unreadable" | "basis_unavailable" | "basis_mismatch" | "owner_changed" | "unchanged_incomplete";
    /** WHETHER THE OBLIGATION THIS PURCHASE WAS BOUGHT FOR CAN NOW BE MET, which is a different question from whether the reading landed (live 2026-09-05): a source read and banked below the confidence its consumer requires is a reading that happened and an obligation that did not move, and calling that acquired is how a row re-owed the same purchase every drive for two days. Absent means the two answers are the same. */ unlocked?: boolean; /** THE PROVIDER WAS POSTED FOR THIS READING AND HAS NOT ANSWERED YET (production run p3, 2026-09-06): the money moves at the post, the answer is collected with a free follow-up, and the drive that collects it therefore buys nothing. Present ONLY where there is a post to collect, so absent is the one answer for every reading that landed, failed or cannot post at all. */ posted?: boolean }>;
  collectBought: (budgetMs: number) => Promise<{ pending: number; ready: number }>;
  currentBasis: (tenantId: string) => Promise<string | null>;
  reconcileCases: (tenantId: string, basis: string, plan: CaseReconcilePlan) => Promise<void>;
  publishSurface: (tenantId: string, attemptKey: string) => Promise<void>;
  factCheck: (tenantId: string, budgetMs: number, renew?: () => Promise<boolean>, /** THE PAGE THAT OPENS THE PASS: the highest-ranked open source need, so a drive checks the page whose funded work is waiting rather than the audience's most-read one. Null keeps the rotation order. */ firstPage?: string | null, /** The drive's working context: this phase runs before the walk and reads the same account, so it shares that read rather than making a second one. */ shared?: Map<string, unknown>, finding?: EvidenceRequirement["finding"])
    => Promise<{ status: "advanced" | "done" | "failed"; banked: number; /** The pages this pass banked evidence ON, so a drive can hire the writer that was waiting on one of them in the same turn. */ bankedPages: string[]; pagesComplete: number; failure?: string; reason?: string }>;
  surfaceStale: (tenantId: string, nowMs: number) => Promise<boolean>;
  analyzeAnswers: (tenantId: string, reportingDay: string, budgetMs: number) => Promise<{ attempted: number; settled: number; refused: number; read: number; outcomes: Record<string, number>; /** Calls that genuinely returned and were paid for; absent from a seam that does not meter. */ billed?: number }>;
  verifyShipments: (tenantId: string, now: Date) => Promise<number>;
  measureShipments: (tenantId: string, now: Date) => Promise<number>;
  dueWork: (tenantId: string, now: Date) => Promise<DueWork>;
  dayStanding: (tenantId: string, reportingDay: string) => Promise<DueWork["checks"] | null>;
  evidenceVersion: (tenantId: string, basis: string) => Promise<number | null>;
  researchOwed: (tenantId: string, pages: readonly string[]) => Promise<string[]>;
  replenishReady: (tenantId: string, now: Date, seen?: { deliveryScope?: Parameters<typeof DRAFT_BUDGET.scopeAllows>[0]; /** The pass's paid AEO diagnosis purse, decided by the caller's shift (2026-09-11: 200 per pass every ten minutes was the invisible dollar-forty an hour). */ aeoDiagnoses?: number; jobs?: Readonly<Record<string, JobMemory>>; /** How many charged calls this DRIVE has already spent on earlier walks. The ceiling is one pass, and a drive may run several walks (the stock walk, one per acquired reading, and the one a banked fact wakes), so a drive that reports its spend gets the REMAINDER of the one ceiling instead of a fresh one. */ callsSpent?: number; callsLimit?: number;
    /** Exact acquired obligation; Decision resolves its current work identity after rebuilding the manifest. */ preferred?: { proposalId: string; workKey: string; strict?: true; version?: number }; sourceWake?: NonNullable<ResearchRunProgress["sourceWakes"]>[number];
    /** THE WORK THE LAST WALK FUNDED AND NEVER BEGAN, by `workKey`: this walk picks it up first, so a drive that runs out of clock hands its remainder to the next one instead of re-walking the same head. */ waiting?: readonly string[];
    /** THE DRIVE'S OWN WORKING CONTEXT (evidence/snapshot-loader carries the contract): the reads this drive has already made, reused by every later walk and dropped part by part as the drive's own writes move them. AND `noRoom` IS THE DRIVE'S OWN ARITHMETIC SAYING THIS BOX CANNOT BEGIN A JOB: the walk's free half runs before the first funded job is considered and the box does not cover it, so the pass runs that free half and funds nothing, rather than selecting a whole manifest and filing every job as "the time box ended before this page's turn" (measured on four consecutive unattended drives, 2026-09-05). */ shared?: Map<string, unknown>; noRoom?: boolean; /** HOW THE CALLER READS A WALK ITS OWN BOX CUT OFF (live 13:00Z drive, 2026-09-05). The drive races this step against a timer as a backstop, and when the timer won it abandoned the promise: the day's memory, the waiting list, every receipt and seventeen provider calls worth 0.18 USD were remembered by nothing, so the next drive funded the same order and lost it the same way. The step hands back a way to ask, once, for the answer this walk would give if it stopped now; the caller keeps it and asks at its box. Read-only, free, and typed as the answer this step returns (the caller names that type, which cannot be written here without the declaration referring to itself). */ filed?: (ask: () => unknown) => void },
    /** The wall-clock moment this drive must stop starting paid work. The pass returns normally at it, with receipts, instead of being cut off by a timer and reporting nothing. */ stopBy?: number) => Promise<{ ready: number; deficit: number; persisted: number; paidPersisted?: number;
    /** TRUE only when a post-pass re-read PROVES the stock is AT THE TARGET. */ satisfied: boolean;
    reason: "made_progress" | "retryable_blocked" | "candidates_exhausted"; retiredWakeKey?: string;
    /** THE DAY'S ONE ATTEMPT LEDGER, keyed on the row's own `workKey`: what each job's attempts cost, how the last one ended, and whether anything is left to do for it under this exact evidence. It replaces four page-keyed lists and the manifest fingerprint that reset them; a workKey nobody remembers is new work by construction. */ jobs: Record<string, JobMemory>;
    /** THE ACCOUNT AND EVIDENCE VERSION AN EXHAUSTION WAS EARNED UNDER, present only with `candidates_exhausted`: due-work reopens the day the moment fresh evidence lands, because a manifest settled against yesterday's readings says nothing about today's. */ closedUnder?: string; preferred?: { proposalId: string; workKey: string; currentWorkKey?: string; retiredReason?: "missing" | "blocked" | "settled" | "out_of_scope" };
    /** THE EXACT READINGS funded candidates were refused for, typed: the dispatch executes these instead of parsing a refusal sentence (Codex, 2026-08-23). */ evidenceOwed?: readonly OwedReading[];
    /** THE FUNDED WORK THIS WALK NEVER BEGAN, by `workKey`. It is a queue position and never a verdict: the next walk of this drive, and the next drive after it, take these first. */ waiting?: readonly string[];
    outcomes?: { declared?: readonly string[]; readySaved: number; evidenceBanked: number; refused: number; blocked: number; unreached: number; stuck: string[];
      /** WHICH OF THE TWO DEADLINE ANSWERS THIS WALK GAVE: `boxed` = the caller stopped waiting and the walk carried on, so these receipts are a snapshot of work still running; `stopped` = the walk itself would not start funded work it could no longer pay for, so nothing is running and that work is the next drive's first; `ran` = it reached the end of what it funded. */ ended?: "boxed" | "stopped" | "ran"; receipts?: unknown[]; preparedMs?: number; ledger?: { before: number; after: number; delta: number; metered: number; unexplained?: number; reconciled: boolean } } } | null>;
};
type CaseReconcilePlan = { planKeys: string[]; maySynthesize: boolean; mark: () => void; /** The drive's working context, so reconciliation reads the account the walk before it already read. */ shared?: Map<string, unknown> };

const canonicalRegistry = (rows: readonly ResearchCase[] = []): string => JSON.stringify([...rows].map((c) => ({ id: c.id, anchors: [...c.anchors].sort(), aliasOf: c.aliasOf ?? null, parentId: c.parentId ?? null, pages: (c.pages ?? []).map((p) => `${p.url}|${p.relation}`).sort() })).sort((a, b) => a.id.localeCompare(b.id)));
const sameRegistry = (before: readonly ResearchCase[] = [], after: readonly ResearchCase[] = []): boolean => canonicalRegistry(before) === canonicalRegistry(after);

async function reconcileCases(tenantId: string, basis: string, plan: CaseReconcilePlan): Promise<void> {
  const saved = await (async () => {
    const snapshot = await loadEvidenceSnapshot(tenantId, plan.shared ? { shared: plan.shared } : {});
    const cases = reconcileResearchCases(snapshot);
    const loaded = await loadFunnelState(tenantId, basis);
    if (sameRegistry(loaded.state.cases, cases)) return true; // nothing moved: no save, and nothing to re-read
    const rowVersion = await saveFunnelState(tenantId, basis, { ...loaded.state, cases }, loaded.rowVersion);
    if (rowVersion == null) return false;
    if (plan.maySynthesize) { plan.mark(); await refineCases(tenantId, basis, snapshot, cases, { ...loaded.state, cases }, rowVersion, plan.planKeys).catch(() => {}); }
    return true;
  })().catch(() => false);
  if (!saved) throw new Error("Which of your topics are which could not be saved, so nothing was spent on them. The next visit picks this up again.");
}

async function refineCases(tenantId: string, basis: string, snapshot: EvidenceSnapshot, cases: ResearchCase[], state: FunnelState, rowVersion: number, planKeys: string[] = []): Promise<void> {
  const investigations = buildTopicInvestigations(snapshot);
  if (investigations.length < 2) return;
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

const crawlKey = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase();
async function decliningPagesFirst(tenantId: string): Promise<typeof nextCrawlCandidates> {
  const decay = await loadGscDecaySignalsForTenant(tenantId).catch(() => null);
  const losing = new Set([...(decay?.values() ?? [])].filter((d) => d.clicksNow < d.clicksPrior).map((d) => crawlKey(d.page)));
  if (losing.size === 0) return nextCrawlCandidates;
  return async (t: string, limit: number, now?: Date, opts?: { strict?: boolean }) => { const urls = await nextCrawlCandidates(t, limit, now, opts);
    return t !== tenantId ? urls : [...urls.filter((u) => losing.has(crawlKey(u))), ...urls.filter((u) => !losing.has(crawlKey(u)))]; };
}

export const defaultSteps: ResearchCycleSteps & {
  resumeAcquired: <T>(got: Awaited<ReturnType<ResearchCycleSteps["acquireEvidence"]>>, kind: EvidenceRequirement["kind"], forget: (...parts: string[]) => void, resume: () => Promise<T>) => Promise<T | null>;
} = {
  async resumeAcquired(got, kind, forget, resume) {
    if (!got.acquired || kind === "factual_source" && got.unlocked !== true) return null;
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
    const read = () => d.loadProposalQueue(tenantId, { currentBasis: basis, deliveryScope: "all_changes" }).catch(() => null); // THE WHOLE QUEUE, READ ONCE: the stock is counted off it (STOCK, never a row count: thin levers fill at most their share of the five, so substantive work keeps funding) and the day's own memory is settled against the rows it holds, which is the same read either way
    const queue = await read();
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
    const answerOf = (paid: Awaited<ReturnType<typeof d.produceProposalsForTenant>>["paid"], ready: number, saved: number, boxed: boolean, failed = false, paidSaved?: number) => { const at: Record<string, JobMemory> = { ...jobs }; /* the memory the rows have already answered, so what a landed row settled is carried onto the run row and never re-opened by this walk's own receipts */
    const count = (o: string) => paid.receipts.filter((r) => r.outcome === o).length;
    const waiting = paid.receipts.filter((r) => (r.outcome === "not_reached" || r.outcome === "cost_blocked") && !!r.workKey).map((r) => r.workKey); // every funded unfinished identity survives; the same run already stores all these receipts
    const metered = Number(paid.receipts.reduce((n, r) => n + (r.costUsd ?? 0), 0).toFixed(6));
    const delta = ledgerBefore != null && ledgerAfter != null ? Number((ledgerAfter - ledgerBefore).toFixed(6)) : -1;
    const tally: { declared?: readonly string[]; readySaved: number; evidenceBanked: number; refused: number; blocked: number; unreached: number; stuck: string[]; familyRead?: { asked: number; loaded: number }; preparedMs?: number; ended?: "boxed" | "stopped" | "ran"; receipts?: unknown[]; ledger?: { before: number; after: number; delta: number; metered: number; unexplained?: number; reconciled: boolean } } = { familyRead: paid.familyRead, ended: boxed ? "boxed" : paid.receipts.some((r) => r.outcome === "not_reached") ? "stopped" : "ran", /* THE TWO DEADLINE ANSWERS, TOLD APART ON THE ROW (2026-09-05): `boxed` is the CALLER giving up on a walk that is still running, so its receipts are a snapshot and the work goes on; `stopped` is the walk itself refusing to start funded work it could no longer pay for, so nothing is running and the next drive takes that work first. They read as one sentence to an operator otherwise, and the answer to each is different. */ ...(paid.preparedMs != null ? { preparedMs: paid.preparedMs } : {}), /* WHAT THE WALK'S FREE HALF COST THIS PASS, carried onto the run row so the next drive's floor is this account's own measurement and never a constant with a margin */ readySaved: count("produced"), evidenceBanked: count("evidence_banked"), refused: count("deterministic_refusal") + count("already_complete"), blocked: count("retryable_blocked") + count("provider_blocked") + count("cost_blocked"), unreached: count("not_reached") + count("superseded"),
      stuck: [...paid.receipts.filter((r) => r.outcome !== "produced").map((r) => `${r.key}:${r.outcome}${r.why ? `: ${r.why}` : ""}`), ...(paid.declined ?? []).map((d) => `${d.key}:declined: ${d.reason}`)].slice(0, 12), /* BOTH HALVES, ALWAYS (production 05:30Z, 2026-09-11): the either-or here meant a walk with any receipt hid every plan decline, so eight declared jobs vanished from the record and an hour went to finding where; the cap rises with the constant cadence's bigger boards. */ // AND A WALK THAT FUNDED NOTHING SAYS WHY ON THE ROW: with no funded key there is no receipt to carry a reason, and a run row that reports an empty walk with no cause is the same silence the typed outcomes exist to end
      receipts: paid.receipts as unknown[], declared: paid.declared, // the COMPLETE per-page record, durable: logs are not the receipt; the declared list says what the plan even considered
      ledger: ledgerBefore != null && ledgerAfter != null
        ? { before: ledgerBefore, after: ledgerAfter, delta, metered, unexplained: Number((delta - metered).toFixed(6)), reconciled: delta + 0.005 >= metered } : undefined };
    for (const r of paid.receipts) { const key = r.workKey; if (!key) continue; // work that declares no identity is remembered by nothing, exactly as the plan reads it
      const settled = r.outcome === "produced" || r.outcome === "evidence_banked" || r.outcome === "deterministic_refusal" || r.outcome === "already_complete"; /* review_saved settles only through the stored-row path in load-proposals: a receipt alone cannot prove the row landed, and a phantom the store downgraded must stay owed (P5 pin). An unsettled review_saved job is re-bought at most once more, because the plan declines any identity after two spent attempts (P4), so the same review is never bought a third time under one workKey. */ if (!settled && (r.providerCalls ?? 0) === 0) { const m = at[key]; if (!m?.settled && (r.outcome === "not_reached" || r.outcome === "cost_blocked")) at[key] = { calls: m?.calls ?? 0, last: r.outcome, settled: false, ...(m?.resume ? { resume: m.resume } : {}), ...(m?.protocol ? { protocol: m.protocol } : {}) }; continue; } // A CAUSAL BLOCK IS NOT A VERDICT (incident, 2026-09-04): money, a provider that would not answer and a job never begun all leave the work owed, and only a finished row or a gate that read it settles it. THE TIMES IT WAS NEVER REACHED ARE NO LONGER COUNTED (measured, 2026-09-05): the count only fed a demotion that could never release, because demoted work is never reached and so only ever waited again; the walk's own `waiting` list carries the queue position, under worth.
      const prior = at[key], progress = !settled && r.family === "new_page" && (r.pageSaved === true || r.patternAccepted === true); at[key] = { calls: (prior?.calls ?? 0) + (settled ? 0 : 1), last: r.outcome, settled, ...(progress ? { resume: "new_page_pattern" } : {}), ...(r.family === "new_page" ? { protocol: "new_page_progress_v1" } : prior?.protocol ? { protocol: prior.protocol } : {}) }; } // ONE ATTEMPT, not one request: a deliverable is three charged calls, and counting requests would decline a job the plan has funded exactly once
    const owner = (w: string): string => paid.declared.filter((k) => w.startsWith(`${k}::`)).sort((a2, b2) => b2.length - a2.length)[0] ?? "", mine = Object.entries(at).map(([w, m]) => [owner(w), m] as const).filter(([k]) => k !== ""); /* AND ONLY NOW MAY A DAY BE CALLED FINISHED: every candidate the current manifest declares carries a settled job, nothing the ledger holds for those candidates is still owed an attempt, and no reading is outstanding. A manifest that declared nothing proves nothing, and neither does one nobody could read. A READING STILL OWED IS WORK STILL OWED (falsifier, 2026-09-02): a day cannot be finished while an acquisition it minted has not landed, whatever its per-page receipts say. A workKey opens with the funding key it was declared under, so the longest declared key it opens with is its own; a remembered job no manifest declares any more belongs to evidence that has moved and holds nothing open. AND A WALK ITS CALLER BOXED PROVES NO EXHAUSTION AND NO PROGRESS: it never reached the end of its own manifest, so it is retryable by construction and the next drive walks on. */
      const exhausted = !boxed && !failed && !seen?.preferred && (!seen?.sourceWake || paid.retiredWakeKey === seen.sourceWake.key) && paid.declared.length > 0 && (paid.evidenceOwed ?? []).length === 0 && mine.every(([, m]) => m.settled) && paid.declared.every((k) => mine.some(([o, m]) => o === k && m.settled));
      log.info("[research-run] the ready inventory after this walk", { tenantId, before, ready, target: floor, declared: paid.declared.length, jobs: Object.keys(at).length, receipts: paid.receipts.length, exhausted, boxed });
      return { ...(paidSaved != null ? { paidPersisted: paidSaved } : {}), ...mark(boxed || failed ? "retryable_blocked" : ready > before ? "made_progress" : exhausted ? "candidates_exhausted" : "retryable_blocked", ready, saved, tally, paid.evidenceOwed ?? [], waiting, at), ...(paid.retiredWakeKey ? { retiredWakeKey: paid.retiredWakeKey } : {}), ...(seen?.preferred && (paid.preferredWorkKey || paid.preferredRetiredReason) ? { preferred: { ...seen.preferred, ...(paid.preferredWorkKey ? { currentWorkKey: paid.preferredWorkKey } : {}), ...(paid.preferredRetiredReason ? { retiredReason: paid.preferredRetiredReason } : {}) } } : {}) }; };
    const preferredRow = seen?.preferred ? await d.loadChangeProposal(tenantId, seen.preferred.proposalId, { canonicalOnly: true }).catch(() => null) : null, owed = (() => { try { return preferredRow ? d.nextObligation(preferredRow)?.kind : null; } catch { return null; } })(); const writable = !!seen?.preferred && preferredRow?.tenantId === tenantId && preferredRow.id === seen.preferred.proposalId && preferredRow.kind === "existing_edit" && preferredRow.recommendedChange?.kind === "existing_edit" && preferredRow.status === "needs_review" && preferredRow.researchOnly === false && preferredRow.basis === basis && preferredRow.workKey === seen.preferred.workKey && !!(preferredRow.pageUrl ?? preferredRow.pagePath) && (owed === "draft" || owed === "redraft"); const preferred = seen?.preferred?.strict && !writable && preferredRow?.kind !== "new_page" ? { proposalId: seen.preferred.proposalId, workKey: seen.preferred.workKey } : seen?.preferred, focusPage = preferred?.strict && preferredRow?.kind === "existing_edit" ? preferredRow.pageUrl ?? preferredRow.pagePath : null;
    const maxCalls = Math.max(0, Math.min(seen?.callsLimit ?? DRAFT_BUDGET.MAX_PAID_CALLS, DRAFT_BUDGET.MAX_PAID_CALLS - (seen?.callsSpent ?? 0)));
    let out = await d.produceProposalsForTenant(tenantId, { now, produce: true, deliveryScope: seen?.deliveryScope ?? "all_changes", aeoDiagnoses: seen?.preferred ? 0 : seen?.aeoDiagnoses, memory: jobs, bypassCache: Object.values(jobs).some((m) => m.calls > 0 && !m.settled), ...(preferred ? { preferred } : {}), ...(seen?.sourceWake ? { sourceWake: seen.sourceWake } : {}), ...(focusPage ? { focusPage } : {}), ...((seen?.callsLimit != null || seen?.callsSpent) ? { maxCalls } : {}), ...(stopBy != null ? { stopBy } : {}), ...(seen?.waiting?.length ? { waiting: seen.waiting } : {}), ...(seen?.shared ? { shared: seen.shared } : {}), ...(seen?.noRoom ? { noRoom: true } : {}), ...(seen?.filed ? { handOver: (ask) => seen.filed?.(() => ((snap) => answerOf(seen?.preferred?.strict && snap.paid.preferredRetiredReason === "missing" ? { ...snap.paid, preferredRetiredReason: undefined } : snap.paid, before, snap.persisted, true))(ask())) } : {}) }).catch(() => null); // A boxed focused walk cannot retire its wake before global proof.
    const sourceDebt = !!out && out.paid.preferredRetiredReason == null && out.paid.receipts.length === 1 && out.paid.receipts[0]?.outcome === "evidence_required" && !!out.paid.receipts[0]?.workKey && out.paid.receipts[0].workKey === out.paid.preferredWorkKey && (out.paid.evidenceOwed ?? []).some(n => n.key === out?.paid.receipts[0]?.key && n.workKey === out?.paid.receipts[0]?.workKey); let combined = false, paidPersisted: number | undefined; if (out && preferredRow?.kind !== "new_page" && seen?.preferred?.strict && preferred?.strict && !seen.sourceWake && (out.paid.preferredRetiredReason === "missing" && out.paid.funded.length === 0 && out.paid.receipts.length === 0 && (out.paid.evidenceOwed ?? []).length === 0 || sourceDebt) && out.outcome !== "evidence_unreadable" && out.outcome !== "persistence_failed" && (out.persisted === 0 || sourceDebt) && out.paid.attemptUnitsSpent === 0 && out.paid.receipts.every(r => (r.providerCalls ?? 0) === 0) && !seen.noRoom && maxCalls > 0 && stopBy != null && stopBy - Date.now() >= Math.max(70_000, (out.paid.preparedMs ?? 45_000) + 40_000)) { const first = out.paid, firstPersisted = out.persisted, id = (r: { key: string; workKey?: string }) => `${r.key}\u0000${r.workKey ?? ""}`, needId = (n: OwedReading) => `${id(n)}\u0000${n.kind}\u0000${n.query}\u0000${n.reasonCode}\u0000${n.proposalId ?? n.unlocks?.proposalId ?? ""}`, terminal = (r: typeof first.receipts[number]) => (r.outcome === "produced" || r.outcome === "already_complete") && (r.persistence === "saved" || r.persistence === "unchanged"), resolved = (paid: typeof first, complete: boolean) => new Set(complete ? paid.receipts.filter(terminal).map(id) : []), carry = (paid: typeof first, complete = false): typeof first => sourceDebt ? { ...paid, declared: [...new Set([...first.declared, ...paid.declared])], funded: [...new Set([...first.funded, ...paid.funded])], receipts: [...new Map([...first.receipts, ...paid.receipts.filter(r => complete && terminal(r) || !first.receipts.some(f => id(f) === id(r)))].map(r => [id(r), r] as const)).values()], evidenceOwed: [...new Map([...(first.evidenceOwed ?? []).filter(n => !resolved(paid, complete).has(id(n))), ...(paid.evidenceOwed ?? [])].map(n => [needId(n), n] as const)).values()], attemptUnitsSpent: first.attemptUnitsSpent + paid.attemptUnitsSpent, declined: [...(first.declined ?? []), ...(paid.declined ?? [])], preferredWorkKey: first.preferredWorkKey, preparedMs: (first.preparedMs ?? 0) + (paid.preparedMs ?? 0) } : { ...paid, preferredRetiredReason: complete && paid.preferredRetiredReason === "missing" ? "missing" : undefined, preparedMs: (first.preparedMs ?? 0) + (paid.preparedMs ?? 0) };
      seen.filed?.(() => answerOf({ ...first, preferredRetiredReason: undefined }, before, firstPersisted, true)); for (const key of seen.shared?.keys() ?? []) if (key.startsWith("cards:") || key.startsWith("proposals:")) seen.shared?.delete(key); // A boxed account-wide recheck preserves the wake; focused cards cannot stand in for it.
      const fallback = await d.produceProposalsForTenant(tenantId, { now, produce: true, deliveryScope: seen.deliveryScope ?? "all_changes", ...(sourceDebt ? {} : { preferred: { proposalId: seen.preferred.proposalId, workKey: seen.preferred.workKey } }), aeoDiagnoses: 0, memory: sourceDebt ? { ...jobs, [first.receipts[0]!.workKey!]: { calls: 0, last: "evidence_required", settled: true } } : jobs, bypassCache: Object.values(jobs).some((m) => m.calls > 0 && !m.settled), maxCalls, stopBy, ...(seen.waiting?.length ? { waiting: seen.waiting } : {}), ...(seen.shared ? { shared: seen.shared } : {}), ...(seen.filed ? { handOver: (ask) => seen.filed?.(() => ((snap) => answerOf(carry(snap.paid), before, firstPersisted + snap.persisted, true, false, snap.persisted))(ask())) } : {}) }).catch(() => null);
      if (fallback?.outcome === "persistence_failed" || fallback?.paid.receipts.some(r => r.persistence === "failed")) PROOF_SPEND.failed(tenantId); combined = !!fallback; paidPersisted = fallback?.persisted; out = fallback ? { ...fallback, persisted: out.persisted + fallback.persisted, paid: carry(fallback.paid, fallback.outcome !== "evidence_unreadable" && fallback.outcome !== "persistence_failed") } : { ...out, paid: { ...first, preferredRetiredReason: undefined } }; } else if (out?.paid.preferredRetiredReason === "missing" && preferred?.strict) out = { ...out, paid: { ...out.paid, preferredRetiredReason: undefined } };
    if (out?.outcome === "persistence_failed" || out?.paid.receipts.some(r => r.persistence === "failed")) PROOF_SPEND.failed(tenantId); ledgerAfter = out ? await getTenantSpentThisMonthUsd(tenantId, now, "adjudicator-openai").catch(() => null) : null;
    if (out && out.held.length > 0) log.info("[research-run] candidates the replenish pass could not finish, each with its reason", { tenantId, held: out.held.slice(0, 6) });
    if (out == null) return mark("retryable_blocked", before, 0); if (out.outcome === "evidence_unreadable" || out.outcome === "persistence_failed") return combined ? answerOf(out.paid, before, out.persisted, false, true, paidPersisted) : mark("retryable_blocked", before, 0);
    const after = await read().then((q) => (q ? d.stockOf(q.ready) : null)), persisted = out.persisted; if (after == null) return sourceDebt ? answerOf(out.paid, before, persisted, false, true, paidPersisted) : mark("retryable_blocked", before, persisted);
    return answerOf(out.paid, after, persisted, false, false, paidPersisted); // the walk ran to its own end, so its answer may close the day or report progress
  },
  async researchOwed(tenantId, pages) {
    if (pages.length === 0) return [];
    const on = new Set(pages.map((p) => p.trim().toLowerCase()));
    const d = await import("@/domains/decision");
    const basis = await d.resolveCurrentBasis(tenantId).catch(() => null);
    const q = await d.loadProposalQueue(tenantId, { currentBasis: basis }).catch(() => null);
    return q == null ? [] : [...new Set(q.research.map((p) => DRAFT_BUDGET.keyOf(p)))].filter((k) => on.has(k.split("::")[0] ?? "")).slice(0, 20); },
  async refreshSources(tenantId, now) {
    const results = await autoRefreshStaleConnectorsForTenant(tenantId, now);
    return { attempted: results.length, succeeded: results.filter((r) => r.ok).map((r) => String(r.provider)),
      failures: results.filter((r) => !r.ok).map((r) => ({ provider: String(r.provider), detail: String(r.detail).slice(0, 200) })) };
  },
  async backfillChunk(tenantId, now) {
    const result = await ensureDeepBackfill(tenantId, now);
    if (result.ran) {
      log.info("[research-run] gsc deep backfill chunk advanced", { tenantId, daysPulled: result.daysPulled, complete: result.complete });
      return { kind: "advanced", complete: result.complete, daysPulled: result.daysPulled };
    }
    if (BENIGN_BACKFILL_SKIPS.has(result.reason)) return { kind: "no_work" };
    throw new Error(`gsc backfill chunk did not advance: ${result.reason}`.slice(0, 200));
  },
  async crawlPages(tenantId, _now, deadline) {
    if (deadline - Date.now() < 50_000) return 0;
    const deps = { pickCandidates: await decliningPagesFirst(tenantId), batchBudgetMs: Math.max(0, deadline - Date.now() - 50_000) };
    const first = await continueColdStartCrawlIfStarted(tenantId, deps);
    if (first.status !== "no_crawl" || first.detail !== "no_frontier_state")
      return first.crawled + await renderUnreadOwnedPages(tenantId, undefined, { deadline }).catch(() => 0);
    const domain = (await getTenant(tenantId).catch(() => null))?.domain?.trim();
    if (!domain) return 0;
    if ((await startColdStartCrawl({ tenantId, domain, deps })).status === "unreachable") return 0;
    if (deadline - Date.now() < 50_000) return 0;
    return (await continueColdStartCrawlIfStarted(tenantId, { ...deps, batchBudgetMs: Math.max(0, deadline - Date.now() - 50_000) })).crawled
      + await renderUnreadOwnedPages(tenantId, undefined, { deadline }).catch(() => 0); },
  async dayStanding(tenantId, day) { const c = await dailyChecks(tenantId, day);
    return c == null ? null : { done: c.done, total: c.total, answers: c.answers, unavailable: c.unavailable, unsupported: c.unsupported,
      ...(c.readingBacklog !== undefined ? { readingBacklog: c.readingBacklog } : {}) }; },
  currentBasis: accountBasis,
  dueWork,
  evidenceVersion: evidenceRowVersion,
  async reconcileCases(tenantId, basis, plan) { await reconcileCases(tenantId, basis, plan); },
  async investigationFocus(tenantId, basis) { return chooseInvestigation(tenantId, basis).catch(() => null); },
  scopeOwner: async (tenantId, need, scope) => {
    const a = need.proposalId, b = need.unlocks?.proposalId, id = a ?? b; if (scope !== "manual_delivery") return true; if (a && b && a !== b) return false; if (!id) return true;
    return import("@/domains/decision/proposal-store").then(m => m.loadChangeProposal(tenantId, id, { canonicalOnly: true })).then(row => !!row && row.id === id && row.tenantId === tenantId && DRAFT_BUDGET.scopeAllows(scope, DRAFT_BUDGET.deliveryOf(row))).catch(() => false);
  },
  async acquireEvidence(tenantId, need, basis, budgetMs, review, deliveryScope = "all_changes", runReceipt) {
    const deferred = (detail: string) => ({ acquired: false as const, attempted: false as const, detail });
    if (!DRAFT_BUDGET.scopeAllows(deliveryScope, DRAFT_BUDGET.requirementDelivery(need))) return deferred("this reading can only unlock whole-page work, which is outside the current existing-page proof");
    if (deliveryScope === "manual_delivery" && await defaultSteps.scopeOwner?.(tenantId, need, deliveryScope) !== true) return deferred("The exact saved owner is unreadable or outside this delivery scope; no provider was called.");
    if (need.kind === "semantic_review" && !need.proposalId) return deferred("a review requirement names no change, so there is nothing to read");
    if (!need.workKey?.trim()) return deferred("the proposal-derived requirement has no nonblank work identity, so no provider may be called");
    if (!need.query.trim() && !need.url) return deferred("the requirement names nothing to read");
    if (!basis) return deferred("this dispatch has no confirmed basis, so nothing can be read against it");
    const { CREDIT_BREAKER } = await import("@/lib/cost/credit-breaker");
    if (need.kind !== "page_source" && await CREDIT_BREAKER.peek(tenantId).catch(() => "held" as const) !== "clear") return deferred(CREDIT_BREAKER.sentence("openai"));
    if (need.kind !== "page_source" && need.kind !== "semantic_review" && await CREDIT_BREAKER.peek(tenantId, {}, "dataforseo").catch(() => "held" as const) !== "clear") return deferred(CREDIT_BREAKER.sentence("dataforseo"));
    const unitStatus = (out: unknown): string => (out as { status?: string }).status ?? "unknown", unitCursor = { basis, ...(runReceipt ?? {}) };
    const landed = (out: unknown): boolean => unitStatus(out) === "done" || unitStatus(out) === "advanced"; // stage one of winning-pages persists its reads and answers `advanced`; both words mean the write landed
    switch (need.kind) {
      case "serp": {
        const out = await serpAnalysisUnit({}, [need.query], "exact")(tenantId, unitCursor, budgetMs).catch((e: unknown) => ({ status: "failed" as const, detail: e instanceof Error ? e.message : String(e) })); // The owed-evidence door may post only its one named query; the broad scheduled agenda still uses the same unit's default mode.
        const key = normalizeKeyword(need.query), rows = (await loadFunnelState(tenantId, basis).catch(() => null))?.state.serps.queries.filter((q) => normalizeKeyword(q.query) === key) ?? [], landed = rows.some((q) => q.status === "done" && !q.identityMismatch && isCurrent("serp_hot", q.observedAt, Date.now())), posted = rows.some((q) => q.status === "posted" && !!q.cacheKey?.trim());
        log.info("[research-run] the exact reading a refused candidate named", { tenantId, kind: need.kind, query: need.query, status: unitStatus(out), landed, posted, basis }); return { acquired: landed, ...(posted ? { posted: true as const } : {}), detail: `results page for "${need.query}": ${landed ? "done" : unitStatus(out) === "done" ? `not on file under ${basis} after the unit finished` : unitStatus(out)}` }; /* Only an exact posted row with a durable provider key is in flight. A blocked bank probe can leave a pending row and still make the unit answer waiting. */
      }
      case "competitor_page": {
        const patternSource = need.reasonCode === "winning_pattern_complete_source_owed", complete = async (): Promise<boolean | null> => { const st = await loadFunnelState(tenantId, basis).catch(() => null), w = st?.rowVersion && st.state.tenantId === tenantId && st.state.basisTag === basis ? jobWinners(projectFunnelEvidence(st.state, Date.now()), [need.query]).find(w => need.url && canonicalUrlKey(w.url) === canonicalUrlKey(need.url)) : null; if (!w?.extract?.mainText?.trim()) return null; if (w.extract.truncated === false && w.extract.fetchedAt && Date.parse(w.extract.fetchedAt) <= Date.now() && isCurrent("winner_extract", w.extract.fetchedAt, Date.now()) && (w.extract.totalChars == null || w.extract.totalChars === w.extract.mainText.length)) return true;
          return await import("@/domains/evidence/dataforseo/page-extract-cache").then(m => m.readPublicPageExtract(w.url, undefined, w.extract!)).catch(() => null) != null; };
        if (patternSource) { const onFile = await complete(); if (onFile == null) return deferred("The exact selected winner is unreadable under this tenant and basis; its complete original remains owed."); if (onFile) return { acquired: true, attempted: false, detail: "The exact selected winner already has a current complete original on file; no source was bought." }; }
        const out = await winningPagesUnit({}, [need.query], null, null, null, need.url ?? null)(tenantId, unitCursor, budgetMs).catch((e: unknown) => ({ status: "failed" as const, detail: e instanceof Error ? e.message : String(e) })), st = landed(out) ? await loadFunnelState(tenantId, basis).catch(() => null) : null, read = st != null && jobWinners(projectFunnelEvidence(st.state, Date.now()), [need.query]).some((w) => (!need.url || [w.url, ...w.appearances.map((a) => a.viaUrl)].some((u) => !!u && canonicalUrlKey(u) === canonicalUrlKey(need.url!))) && typeof w.extract?.mainText === "string" && w.extract.mainText.trim().length > 0) && (!patternSource || await complete() === true);
        return { acquired: read, detail: `winning pages for "${need.query}": ${read ? unitStatus(out) : patternSource ? "a current complete original of the exact selected winner is still owed" : landed(out) ? `no winner of that search carries a reading on file under ${basis} after the unit finished` : unitStatus(out)}` };
      }
      case "page_source": {
        if (!need.url) return { acquired: false, detail: "a page_source requirement names no page" };
        const { loadOwnedPageBodies } = await import("@/domains/evidence/pages/owned-context");
        const read = async () => (await loadOwnedPageBodies(tenantId, [need.url!]).catch(() => null))?.get(canonicalUrlKey(need.url!));
        const faq = need.reasonCode === "schema_visible_pair_unconfirmed", same = (question: string): boolean => question.trim().replace(/\s+/g, " ").toLowerCase() === need.query.trim().replace(/\s+/g, " ").toLowerCase();
        const sufficient = (body: Awaited<ReturnType<typeof read>>): boolean => !!body && body.tenantId === tenantId && sameFinal(body.url, need.url!) && body.version === "current" && sameFinal(body.finalUrl, need.url!) && !!body.contentHash && isCurrent("owned_page", body.fetchedAt, Date.now()) && (faq ? body.faqs.some((pair) => pair.answerComplete === true && same(pair.question)) : body.completeness === "complete");
        const label = faq ? "own-page FAQ capture" : "own-page read", success = faq ? "current complete HTML pair on file" : "current complete capture on file";
        if (sufficient(await read())) return { acquired: true, attempted: false as const, detail: `${label} of ${need.url}: ${success}` };
        if (budgetMs <= 0 || PROOF_SPEND.activeFor(tenantId) === false) return deferred(`${label} of ${need.url}: the current complete saved capture is still owed; no provider was called`);
        const out = await winningPagesUnit({}, [], null, need.url, null, null, true)(tenantId, unitCursor, budgetMs).catch((e: unknown) => ({ status: "failed" as const, detail: e instanceof Error ? e.message : String(e) }));
        const acquired = sufficient(await read());
        const code = "code" in out ? out.code : undefined;
        return { acquired, ...("attempted" in out && out.attempted === false ? { attempted: false as const } : {}), ...(!faq && code === "unchanged_incomplete" ? { preflight: code } : {}), detail: `${label} of ${need.url}: ${acquired ? success : faq ? "the required current complete HTML pair is not on file" : `current complete capture still owed (${code ?? unitStatus(out)})`}` };
      }
      case "factual_source": { const sourceSupport = need.reasonCode === "source_support_unconfirmed", sourceRow = sourceSupport && need.proposalId ? await import("@/domains/decision/proposal-store").then(m => m.loadChangeProposal(tenantId, need.proposalId!, { canonicalOnly: true })).catch(() => null) : null;
        const exactAeo = sourceSupport && (need.key?.includes("::aeo-source:") || !!need.ownerVersion && !need.topic || sourceRow?.changeFamily === "ai_answer_gap"), exactOwner = need.reasonCode === "external_claim_unconfirmed" || exactAeo; let exactOwnerBasis: string | null = null; if (sourceSupport && need.proposalId && !sourceRow) return deferred("the current source owner could not be read; no provider was called");
        if (exactOwner) {
          const id = need.proposalId, { loadChangeProposal } = await import("@/domains/decision/proposal-store"), { resolveCurrentBasis } = await import("@/domains/decision/load-proposals"), { nextObligation } = await import("@/domains/decision/obligation"), { loadOwnedPageBodies } = await import("@/domains/evidence/pages/owned-context");
          const row = sourceSupport ? sourceRow : id ? await loadChangeProposal(tenantId, id, { canonicalOnly: true }).catch(() => null) : null, fullBasis = await resolveCurrentBasis(tenantId).catch(() => null), obligation = row ? nextObligation(row) : null, owed = obligation?.kind === "evidence" ? obligation.need : null, body = need.url ? (await loadOwnedPageBodies(tenantId, [need.url]).catch(() => null))?.get(canonicalUrlKey(need.url)) : null, diagnosis = row?.causeFinding?.payload, aeoDiagnosis = diagnosis?.cause === "ai_citation_gap" || diagnosis?.cause === "retrieved_not_cited" ? diagnosis : null;
          if (!row || row.tenantId !== tenantId || row.id !== id || row.status !== "needs_review" || !fullBasis?.startsWith(`${basis}::`) || row.basis !== fullBasis || row.workKey !== need.workKey || owed?.kind !== "factual_source" || owed.reasonCode !== need.reasonCode || owed.proposalId !== id || owed.query !== need.query || owed.url !== need.url || owed.missingTopic !== need.missingTopic || owed.ownerVersion !== need.ownerVersion || !need.url || need.unlocks?.proposalId !== id || !row.pageUrl || canonicalUrlKey(row.pageUrl) !== canonicalUrlKey(need.url) || !body || body.tenantId !== tenantId || body.version !== "current" || body.completeness !== "complete" || body.sourceCapture?.complete !== true || !body.contentHash || !isCurrent("owned_page", body.fetchedAt, Date.now()) || canonicalUrlKey(body.url) !== canonicalUrlKey(need.url) || body.finalUrl && canonicalUrlKey(body.finalUrl) !== canonicalUrlKey(need.url) || exactAeo && (!row.researchOnly || !need.ownerVersion || body.contentHash !== need.ownerVersion || aeoDiagnosis?.aeoKind !== "missing_information" || aeoDiagnosis.missing?.trim() !== need.missingTopic || aeoDiagnosis.contentHash !== need.ownerVersion || row.factIdentity !== claimIdentity(need.missingTopic ?? "", "", "missing"))) return deferred("the exact current proposal no longer owes this factual claim; no source was bought");
          exactOwnerBasis = row.basis;
        }
        if (need.reasonCode === "causal_answer_source_unconfirmed") { if (!need.proposalId || !need.ownerVersion || !need.url) return deferred("this factual reading has no exact proposal, page or owner version"); const { loadChangeProposal } = await import("@/domains/decision/proposal-store"), { loadOwnedPageBodies } = await import("@/domains/evidence/pages/owned-context"), { resolveCurrentBasis } = await import("@/domains/decision/load-proposals"); const row = await loadChangeProposal(tenantId, need.proposalId, { canonicalOnly: true }).catch(() => null), fullBasis = await resolveCurrentBasis(tenantId).catch(() => null), owed = row?.obligation?.kind === "evidence" ? row.obligation.need : null, body = need.url ? (await loadOwnedPageBodies(tenantId, [need.url]).catch(() => null))?.get(canonicalUrlKey(need.url)) : null; if (!row || row.status !== "needs_review" || row.tenantId !== tenantId || !fullBasis?.startsWith(`${basis}::`) || row.basis !== fullBasis || row.workKey !== need.workKey || !(row.pageUrl ? canonicalUrlKey(row.pageUrl) === canonicalUrlKey(need.url) : (row.pagePath ?? "") === pathOf(need.url)) || owed?.kind !== "factual_source" || owed.query !== need.query || owed.missingTopic !== need.missingTopic || owed.ownerVersion !== need.ownerVersion || owed.reasonCode !== need.reasonCode || !body || body.version !== "current" || body.completeness !== "complete" || body.sourceCapture?.complete !== true || !body.contentHash || body.contentHash !== need.ownerVersion || !isCurrent("owned_page", body.fetchedAt, Date.now()) || body.finalUrl && canonicalUrlKey(body.finalUrl) !== canonicalUrlKey(need.url ?? "")) return deferred("the exact proposal, source and evidence basis no longer owe this factual reading"); }
        if (need.finding && (need.finding.tenantId !== tenantId || need.finding.page !== (need.topic?.key ?? (need.url ? pathOf(need.url) : null)))) return { acquired: false, detail: "the known finding does not belong to this tenant and factual owner" }; const known = need.finding ? (await import("@/domains/evidence/pages/fact-checks").then(m => m.readFactChecks(tenantId, need.finding!.page)).catch(() => [])).find(f => f.page === need.finding!.page && f.statementKey === need.finding!.statementKey) : null;
        if (need.finding && (!known?.subject.trim() || !need.topic && known.current.trim() && (!Number.isSafeInteger(need.finding.sourceVersion) || need.finding.sourceVersion! <= 0 || known.sourceVersion !== need.finding.sourceVersion))) return deferred("the known statement is not inventoried at its submitted source version for this owner; discovery cannot replace it");
        if (need.topic && (need.url || !need.topic.key.startsWith("topic:") || !need.topic.label.trim() || (!known && !need.missingTopic?.trim()))) return { acquired: false, detail: "the prospective factual requirement has ambiguous or missing scope" };
        const sourceBasis = need.topic ? await import("@/domains/decision/load-proposals").then(m => m.resolveCurrentBasis(tenantId)).catch(() => null) : basis; if (!sourceBasis || need.topic && (!/::d\d+$/.test(sourceBasis) || sourceBasis !== basis && sourceBasis.replace(/::d\d+$/, "") !== basis) || need.reasonCode === "new_page_source_owed" && need.ownerVersion !== sourceBasis) return deferred("the prospective factual reading has no current Decision basis under this account");
        const prop = known ? { subject: known.subject, url: need.topic?.key ?? need.url! } : need.missingTopic?.trim() && (need.url || need.topic) ? { subject: need.topic || exactOwner ? need.missingTopic.trim() : propositionOf(need.missingTopic.trim(), need.query), url: need.topic?.key ?? need.url! } : null;
        if (!prop) return deferred("this factual reading names no exact proposition, so no page fact may be researched in its place");
        const atomKey = need.finding?.statementKey ?? (need.missingTopic?.trim() ? claimIdentity(need.missingTopic.trim(), "", "missing") : undefined), exactFinding = !!need.finding && !need.topic && !!known?.current.trim();
        const current = exactFinding ? { pageContentHash: known!.pageContentHash, evidenceBasis: known!.evidenceBasis, searchQuery: "", nominee: undefined } : await seedProposition(tenantId, prop.url, prop.subject, need.topic, sourceBasis, need.finding, atomKey).catch((e) => { log.warn("[research-run] the proposition could not be inventoried", { tenantId, url: prop.url, error: e instanceof Error ? e.message : String(e) }); return null; });
        if (!current) return exactOwner ? deferred(`the exact proposition or its fact store could not be read at the current owner version for ${prop.url}; no provider was called`) : { acquired: false, detail: `the proposition could not be qualified at the current owner version for ${prop.url}, so nothing was researched` }; if (exactOwner && current.evidenceBasis !== exactOwnerBasis) return deferred("the source's current evidence basis moved after its exact proposal was checked; no provider was called");
        const already = await propositionState(tenantId, prop.url, prop.subject, current, need.finding, atomKey).catch(() => null); if (exactOwner && !already) return deferred("the exact fact store could not be read; no source was bought");
        if (already?.researched && !(exactFinding)) return { acquired: true, unlocked: already.usable, attempted: false as const, detail: `no source was bought for ${prop.url}: the answer to "${prop.subject}" is ${already.why}` };
        const read = () => factCheckPass(tenantId, budgetMs, undefined, prop.url, undefined, (need.rivalUrl ?? need.rivalUrls?.[0])?.trim() ? { subject: prop.subject, url: (need.rivalUrl ?? need.rivalUrls![0]!).trim(), urls: need.rivalUrls, anchor: need.missingTopic?.trim() || prop.subject } : undefined, exactFinding ? undefined : prop.subject, need.topic ? { ...need.topic, basis: sourceBasis } : undefined, need.finding, atomKey);
        if (PROOF_SPEND.activeFor(tenantId) === true && current.nominee !== undefined && (!current.nominee || need.rivalUrl != null && need.rivalUrl.trim() !== current.nominee || need.rivalUrls != null && (need.rivalUrls.length !== 1 || need.rivalUrls[0]?.trim() !== current.nominee))) return deferred("the disputed fact has no one safe saved source at this owner version");
        const out = PROOF_SPEND.activeFor(tenantId) === true && !(exactFinding) && (current.nominee || !need.rivalUrl && !need.rivalUrls?.length)
          ? await PROOF_SPEND.withExternalTargets(tenantId, current.nominee ? [{ capability: "onpage_content_parsing", url: current.nominee }] : [{ capability: "serp_organic", url: current.searchQuery }], read) : await read();
        const settled = exactFinding && (out.status === "failed" || out.sourceVersion == null || !Number.isSafeInteger(out.sourceVersion) || out.sourceVersion <= 0) ? null : await propositionState(tenantId, prop.url, prop.subject, current, need.finding, atomKey, exactFinding ? out.sourceVersion : undefined).catch(() => null);
        const said = `${out.status}${out.failure ? ` (${out.failure})` : ""}, ${out.banked} banked`; // the failure rides in the detail, so a credit hold is read by the drive as nothing asked rather than an attempt spent
        if (settled) return { acquired: settled.researched, unlocked: settled.usable, factCheck: out, ...(exactFinding && out.status === "done" && out.banked === 0 ? { attempted: false as const } : {}), detail: `fact check of ${prop!.url}: ${said}; the answer to "${prop!.subject}" is ${settled.why}` };
        return { acquired: !exactFinding && out.status !== "failed" && out.banked > 0, factCheck: out, detail: `fact check of ${need.url ?? "the owed page"}: ${said}` };
      }
      case "semantic_review": {
        if (!need.proposalId) return { acquired: false, detail: "a review requirement names no change, so there is nothing to read" }; // ONE ROW, BY ITS OWN ID: reading the whole account's queue to find one change is an egress bill for a lookup
        const { loadChangeProposal, saveChangeProposal, preflightReviewedProposal } = await import("@/domains/decision/proposal-store");
        const { EDITOR_SHARED, reviewFinishedCopy } = await import("@/domains/decision/drafted-copy"); const { unreviewed } = await import("@/domains/decision/proof");
        const row = await loadChangeProposal(tenantId, need.proposalId, { canonicalOnly: true }).catch(() => null);
        if (!row || row.tenantId !== tenantId || row.id !== need.proposalId) return { acquired: false, detail: `no scoped change on file answers to ${need.proposalId}, so there is nothing to read` };
        const currentBasis = await import("@/domains/decision/load-proposals").then((m) => m.resolveCurrentBasis(tenantId)).catch(() => null);
        const at = new Date(), preflight = await preflightReviewedProposal(tenantId, row, currentBasis, at), owed = (await import("@/domains/decision/obligation")).nextObligation(preflight.reconciled ?? row);
        const key = EDITOR_SHARED.reviewWorkKey(preflight.reconciled ?? row, preflight.captures, preflight.checked);
        if (!basis || !currentBasis?.startsWith(`${basis}::d`) || row.basis !== currentBasis || !["needs_review", "ready"].includes(row.status) || !key || need.workKey !== key || preflight.reason || !(owed?.kind === "review" || owed?.kind === "evidence" && owed.need.kind === "semantic_review")) return { acquired: false, attempted: false, detail: `the exact current review owner or evidence basis could not be confirmed for ${row.id}, so no evaluator was called` };
        const owned = await EDITOR_SHARED.prepareReview(row, preflight).catch(() => null); if (!owned) return { acquired: false, attempted: false, detail: "The exact review ownership could not be saved; no evaluator was called." };
        const read = await reviewFinishedCopy(owned.row, { tenantId, proposalWorkKey: owned.row.workKey, reviewContext: owned.context, now: at, stopBy: Math.min(review?.stopBy ?? Infinity, Date.now() + Math.max(0, budgetMs)), ...(review?.attempts ? { attempts: review.attempts } : {}) }).catch((e: unknown) => ({ row: null, detail: e instanceof Error ? e.message : String(e) }));
        if (!read.row) return { acquired: false, detail: `reading the sources behind ${row.id}: ${read.detail}` }; // a provider that could not answer leaves the row exactly as it stands
        const saved = await saveChangeProposal(read.row, EDITOR_SHARED.reviewOwnership, undefined, owned.row).catch(() => "failed" as const);
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
      for (const key of keys) { if (Date.now() >= endsAt) break; const got = (await collectCapability(key, {}, endsAt).catch(() => null))?.state; if (got === "ok" || got === "hit") ready += 1; } /* THE RECEIPT COUNTS WHAT LANDED ON THIS PASS (measured on the harness, 2026-09-06): a task this collection finishes answers `ok` and only a row that was ALREADY ready answers `hit`, so `ready` read 0 in exactly the case the collection did its job, and the run row said two pages were still pending when both had just come back. Either answer is a page now on file; nothing else is. */
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
      const day = String(cursor?.cycle ?? "").slice(-10) || reportingDay(Date.now());
      return promptObservationUnit({}, await dueObservations(tenantId, day))(tenantId, cursor, budgetMs);
    }
    return keywordDiscoveryUnit({}, cases)(tenantId, cursor, budgetMs); // the facade export is a deps factory returning the executor
  },
  async analyzeAnswers(tenantId, reportingDay, budgetMs) { return runAnswerAnalyses(tenantId, reportingDay, { budgetMs }); },
  async verifyShipments(tenantId) { return verifyDueShipments(tenantId); },
  async measureShipments(tenantId, now) { return settleDueMeasurements(tenantId, { now }); },
  async publishSurface(tenantId) { await publishCustomerSurfaces(tenantId); },
  async initialTarget(tenantId, stopBy, shared) {
    const snapshot = await loadEvidenceSnapshot(tenantId, shared ? { shared } : {}), facts = await import("@/domains/evidence/pages/fact-checks"), basis = await import("@/domains/decision/load-proposals").then(m => m.resolveCurrentBasis(tenantId));
    if (snapshot.scope.tenantId !== tenantId || !snapshot.scope.site || !basis || Date.now() >= stopBy) return null;
    const owners = [...new Set(snapshot.ownedPages.map(p => pathOf(p.url)))], fact = owners.length ? (await currentFactualTarget(tenantId, snapshot, await facts.readFactChecks(tenantId, owners), basis, stopBy))?.need : null;
    return fact ? { ...fact, key: fact.finding!.page, reason: "The current named statement needs its nominated source.", workKey: JSON.stringify([basis, fact.finding, fact.rivalUrl]), ownerVersion: basis } : null;
  },
  async factCheck(tenantId, budgetMs, renew, firstPage, shared, finding) { return factCheckPass(tenantId, budgetMs, renew, firstPage ?? null, shared, undefined, undefined, undefined, finding); },
  async surfaceStale(tenantId, nowMs) {
    const { readCustomerSurface, isCustomerSurfaceStale } = await import("@/app/(shell)/surface-release");
    const surface = await readCustomerSurface(tenantId).catch(() => null);
    return surface == null || isCustomerSurfaceStale(surface.computedAt, nowMs); // no saved release yet = a first publish is genuinely due
  },
};
const owedOneSectionRead = (c: { state: string; subject: string; sources: readonly { groups?: readonly string[]; groupExcerpts?: readonly unknown[]; sectionsRead?: boolean }[] }): boolean => c.state === "checked" && c.subject.endsWith(AEO_BAR.groupingQuestion) && c.sources.length > 0 && !c.sources.some((x) => x.sectionsRead === true || (x.groupExcerpts?.length ?? 0) > 0); /* A GROUPING ANSWER BANKED BEFORE THE SOURCE'S SECTIONS RODE WITH IT IS READ ONCE MORE (2026-09-10): the wildlife hub's grouping row holds two group names and one sentence, and every writer hired on it wrote two empty headings; the row is reopened exactly once: a source read as its sections carries the mark whatever the judge answered, so the row never enters here again, whatever the clock says. */ const ANCHORED_READ_SINCE = Date.parse("2026-09-07T05:00:00Z"), owedOneAnchoredRead = (c: { state: string; verdict: string; sourceReadAt: string | null; checkedAt: string }): boolean => c.state === "checked" && c.verdict === "undecidable" && c.sourceReadAt == null && (Date.parse(c.checkedAt) || 0) < ANCHORED_READ_SINCE; // ONE READ UNDER THE ANCHOR FOR EVERY ROW JUDGED BEFORE THE ANCHOR EXISTED (journey review, 2026-09-07): a missing subject judged undecidable whose passages never carried it (the window opened on the page introduction) was settled for good, so the requirement owed a fact for ever and hired no writer. Rows checked before this release get exactly one read where the winner's own heading starts; a row checked after it never enters this branch, so a researched answer on file still costs nothing to reuse.
async function seedProposition(tenantId: string, pageUrl: string, proposition: string, topic?: EvidenceRequirement["topic"], currentBasis?: string, finding?: EvidenceRequirement["finding"], atomKey?: string): Promise<{ pageContentHash: string | null; evidenceBasis: string | null; searchQuery: string; nominee?: string } | null> {
  const [facts, { claimIdentity, pageHashOf, claimTypeOf, sourceQueryFor }, { loadOwnedPageBodies }, { resolveCurrentBasis }] = await Promise.all([import("@/domains/evidence/pages/fact-checks"), import("@/domains/evidence/pages/fact-check-run"), import("@/domains/evidence/pages/owned-context"), import("@/domains/decision/load-proposals")]);
  const bodies = topic ? null : await loadOwnedPageBodies(tenantId, [pageUrl]).catch(() => null);
  const b = bodies?.get?.(canonicalUrlKey(pageUrl)); if (!topic && (!b || b.version !== "current" || !b.contentHash)) return null;
  const body = b ? [b.title, b.h1, ...(b.headings ?? []), ...(b.passages ?? [])].filter(Boolean).join("\n") : "";
  const basis = topic ? currentBasis ?? null : await resolveCurrentBasis(tenantId).catch(() => null);
  if (!basis) return null;
  const path = topic?.key ?? pathOf(pageUrl), hash = topic ? null : pageHashOf(body), key = finding?.statementKey ?? atomKey ?? claimIdentity(proposition, "", "missing"), current = { pageContentHash: hash, evidenceBasis: basis };
  const held = await facts.readFactChecks(tenantId, path).catch(() => null); if (!held) return null;
  const mine = held.find((h) => h.statementKey === key), unread = !!mine && (owedOneAnchoredRead(mine) || owedOneSectionRead(mine)), astray = !!mine && mine.state === "checked" && mine.verdict === "undecidable" && !!mine.proposed?.trim(), rulesMoved = !!mine && mine.state === "checked" && mine.rulesVersion !== facts.rulesVersionFor(mine); // A CHECKED ROW HOLDING AN UNDECIDED STATEMENT ANSWERED A DIFFERENT SUBJECT (reviewer, 2026-09-02): live, "are there cobras in iran" came back "Iran has AH-1 Cobra attack helicopters." with the judge's own note saying the sources do not address snakes. ONCE: a re-researched row banks its statement only under `page_correct`, so this holds for rows banked before that rule and never again. AND A ROW JUDGED UNDER RULES SINCE REPLACED FOR ITS SHAPE IS NOT RESEARCHED AT THIS VERSION AT ALL: every question-shaped row checked before the rules that judge a missing answer moved reads as satisfied here, so nothing would ever re-judge it.
  if (PROOF_SPEND.activeFor(tenantId) === true && mine?.note.startsWith("Owed again: source support disputed;") && (mine.pageContentHash !== hash || mine.evidenceBasis !== basis)) return null;
  if (finding && (!mine || (mine.current.trim() && !body.includes(mine.current.trim())))) return null;
  const locatorMissing = !!finding && !!mine?.pageLocator && mine.pageLocator !== "missing" && !body.split("\n").includes(mine.pageLocator);
  if (locatorMissing) return null;
  if (topic && mine?.current.trim()) return null;
  const scopeMoved = !!mine && mine.evidenceBasis !== basis; // A checked source at an older decision basis is not current authority, even when the page words are unchanged.
  if (mine?.state === "checked" && mine.pageContentHash === hash && !scopeMoved && !astray && !rulesMoved && !unread) return { ...current, searchQuery: "" };
  if (mine && (mine.state !== "owed" || mine.pageContentHash !== hash || scopeMoved || astray || rulesMoved || unread)) {
    const n0 = await facts.recordFactChecks(tenantId, path, [{ ...mine, state: "owed", rulesVersion: facts.rulesVersionFor(mine), pageContentHash: hash, evidenceBasis: basis, // the reopened row carries the version its shape is judged under, or the same rule would hand it back every drive
      note: astray ? "Reopened: the answer must be about this page's own subject." : unread ? (owedOneSectionRead(mine) ? "Reopened: the words the source keeps under its own headings are read once for this grouping answer." : "Reopened: read once without finding a passage about it, so the winner is read again where its own heading starts.") : rulesMoved ? "Reopened: the rules that judge a missing answer changed." : scopeMoved ? "Reopened: the evidence basis moved and this proposition is owed again under the current basis." : "Reopened: the page moved to a new version and this missing proposition is owed again.", checkedAt: new Date().toISOString() }]).catch(() => 0);
    if (n0 <= 0) return null;
  } else if (!mine) await facts.recordOwedClaims(tenantId, path, [{ statementKey: key, subject: proposition, current: "", locator: "missing" }], hash, basis).catch(() => -1);
  const after = await facts.readFactChecks(tenantId, path).catch(() => null); if (!after) return null;
  const target = after.find((h) => h.page === path && h.statementKey === key && h.subject === proposition && h.state === "owed" && h.pageContentHash === hash && h.evidenceBasis === basis);
  const own = topic?.label ?? [...new Set(body.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 2))].join(" ").split(/\s+/).slice(0, 8).join(" ");
  const nominee = target?.note.startsWith("Owed again: source support disputed;") ? target.sources.length === 1 && !target.sources[0]?.says.trim() && isSafeRedirectHopUrl(target.sources[0].url) ? target.sources[0].url : "" : undefined;
  return target ? { ...current, searchQuery: sourceQueryFor(claimTypeOf(target.subject, target.current, target.pageLocator), target.subject, target.current, own), nominee } : null;
}
async function propositionState(tenantId: string, pageUrl: string, proposition: string, current: NonNullable<Awaited<ReturnType<typeof seedProposition>>>, finding?: EvidenceRequirement["finding"], atomKey?: string, expectedVersion?: number): Promise<{ researched: boolean; usable: boolean; why: string }> {
  const [facts, { claimIdentity }] = await Promise.all([import("@/domains/evidence/pages/fact-checks"), import("@/domains/evidence/pages/fact-check-run")]);
  const path = pageUrl.startsWith("topic:") ? pageUrl : pathOf(pageUrl), key = finding?.statementKey ?? atomKey ?? claimIdentity(proposition, "", "missing"), mine = (await facts.readFactChecks(tenantId, path)).find((h) => h.page === path && h.statementKey === key && (expectedVersion === undefined || h.sourceVersion === expectedVersion) && h.evidenceBasis === current.evidenceBasis && h.pageContentHash === current.pageContentHash && (!pageUrl.startsWith("topic:") || h.current.trim() === "")) ?? null;
  if (mine == null || mine.state !== "checked") return { researched: false, usable: false, why: mine == null ? "not inventoried, so nothing has researched it" : "still owed, so its sources have not been read yet" };
  const usable = facts.authorizedCorrections([mine], undefined, tenantId).length > 0; /* A READ THAT QUOTED NO SOURCE IS NOT FINISHED RESEARCH (delivery loop, 2026-09-07): an undecidable verdict whose passages never carried the subject (the window opened on the wrong region of the page) settled the proposition for good, so the row owed a fact for ever and never a writer. It is researched again, bounded by the day's attempt stop like any other reading; a verdict that quoted a source stands. */
  if (!usable && owedOneAnchoredRead(mine)) return { researched: false, usable: false, why: "read once without finding a passage about it, so the winner is read again where its own heading starts" };
  return { researched: true, usable, why: usable ? "researched, and it stands behind an answer the copy may use" : `researched, and what came back is rated ${mine.confidence} and does not meet the evidence rules copy must stand on` }; // NAMED IN PLAIN WORDS AND NEVER BY A STORED SLUG: this sentence rides the need onto the pass receipt an operator reads
}

async function currentFactualTarget(tenantId: string, snapshot: EvidenceSnapshot | null, held: Awaited<ReturnType<typeof import("@/domains/evidence/pages/fact-checks").readFactChecks>>, basis: string | null, stopBy: number, finding?: EvidenceRequirement["finding"], firstPage?: string | null) {
  const [{ COPY_RULES }, { pageHashOf }, { loadOwnedPageBodies }, account] = await Promise.all([import("@/domains/decision/copy-sanitize"), import("@/domains/evidence/pages/fact-check-run"), import("@/domains/evidence/pages/owned-context"), snapshot ? null : getTenant(tenantId).catch(() => null)]);
  const site = snapshot?.scope.site ?? (account?.id === tenantId && websiteOf(account).account_id === tenantId ? websiteOf(account).canonical_url : null); if (!basis || !site || snapshot && snapshot.scope.tenantId !== tenantId || !snapshot && (!finding || !firstPage || !COPY_RULES.captureAddress(firstPage)) || finding && (finding.tenantId !== tenantId || typeof finding.page !== "string" || !finding.page.startsWith("/") || /[?#]/.test(finding.page) || typeof finding.statementKey !== "string" || !finding.statementKey.trim() || !Number.isSafeInteger(finding.sourceVersion) || finding.sourceVersion! <= 0)) return null;
  const scoped = snapshot ? null : await loadOwnedPageBodies(tenantId, [firstPage!]), bodies = new Map<string, Awaited<ReturnType<typeof loadOwnedPageBodies>>>(scoped ? [[finding!.page, scoped]] : []);
  const pages = snapshot ? [...snapshot.ownedPages].sort((a, b) => (b.search?.impressions90d ?? 0) - (a.search?.impressions90d ?? 0)) : [...scoped!.values()].map(body => ({ url: body.url })), rank = new Map(pages.map((p, i) => [pathOf(p.url), i]));
  const candidates = held.filter(h => finding ? h.page === finding.page && h.statementKey === finding.statementKey && h.state !== "superseded" : h.state === "owed" && h.current.trim() && h.proposed?.trim() && h.proposed.trim() !== h.current.trim()).sort((a, b) => (rank.get(a.page) ?? Infinity) - (rank.get(b.page) ?? Infinity) || (Date.parse(a.checkedAt) || 0) - (Date.parse(b.checkedAt) || 0));
  for (const row of candidates) {
    if (Date.now() >= stopBy) return null;
    const owners = pages.filter(p => pathOf(p.url) === row.page), owner = COPY_RULES.captureAddress(owners[0]?.url);
    if (owners.length !== 1 || held.filter(h => h.page === row.page && h.statementKey === row.statementKey && h.state !== "superseded").length !== 1 || !Number.isSafeInteger(row.sourceVersion) || row.sourceVersion! <= 0 || finding && row.sourceVersion !== finding.sourceVersion || row.evidenceBasis !== basis || !["owed", "checked"].includes(row.state) || !owner || COPY_RULES.captureAddress(new URL("/", owner).href) !== COPY_RULES.captureAddress(site) || firstPage != null && COPY_RULES.captureAddress(firstPage) !== COPY_RULES.captureAddress(owners[0]!.url)) continue;
    if (!bodies.has(row.page)) bodies.set(row.page, await loadOwnedPageBodies(tenantId, [owners[0]!.url]));
    const body = bodies.get(row.page)!.get(canonicalUrlKey(owners[0]!.url)), unit = row.current.trim(), words = body ? [body.title, body.h1, ...body.headings, ...body.passages].filter(Boolean).join("\n") : "", regions = body ? sectionsFrom(body.passages.join("\n"), {}, body.sourceCapture) : [], hits = regions.filter(r => unit && r.text.includes(unit));
    const witness = body?.captureStates?.find(c => c.id === body.captureId); if (!body || body.tenantId !== tenantId || !snapshot && (!witness || witness.tenant_id !== tenantId || witness.page_id !== body.pageId || witness.id !== body.latestCaptureId || witness.capture_version !== body.captureVersion || typeof witness.url !== "string" || COPY_RULES.captureAddress(witness.url) !== COPY_RULES.captureAddress(body.url)) || !COPY_RULES.captureProof(body).length || COPY_RULES.captureAddress(body.url) !== COPY_RULES.captureAddress(owners[0]!.url) || row.pageContentHash !== pageHashOf(words) || !unit || regions.filter(r => r.heading === row.subject).length !== 1 || hits.length !== 1 || hits[0]!.heading !== row.subject || hits[0]!.text.split(unit).length !== 2 || body.passages.filter((text, i) => text.includes(unit) && body.passageMeta?.[i]?.heading === row.subject).length !== 1 || Date.now() >= stopBy) continue;
    const nominee = row.sources.find(s => isSafeRedirectHopUrl(s.url) && !new URL(s.url).hostname.replace(/^www\./, "").endsWith(`.${new URL(body.url).hostname.replace(/^www\./, "")}`) && new URL(s.url).hostname.replace(/^www\./, "") !== new URL(body.url).hostname.replace(/^www\./, ""))?.url;
    if (row.state === "owed" && (!nominee || row.sources.some(s => !s.says.trim() && s.url !== nominee) || row.note.startsWith("Owed again: source support disputed;") && (row.sources.length !== 1 || row.sources[0]!.says.trim()))) continue;
    return { row, body, need: { kind: "factual_source", query: row.subject, url: body.url, reasonCode: "acquire_factual_source", delivery: "existing_page_edit", rivalUrl: nominee, finding: { tenantId, page: row.page, statementKey: row.statementKey, sourceVersion: row.sourceVersion } } satisfies EvidenceRequirement };
  }
  return null;
}

async function factCheckPass(tenantId: string, budgetMs: number, renew: (() => Promise<boolean>) | undefined, firstPage: string | null, shared?: Map<string, unknown>, rival?: { subject: string; url: string; urls?: string[]; anchor?: string }, proposition?: string, topic?: NonNullable<EvidenceRequirement["topic"]> & { basis: string }, finding?: EvidenceRequirement["finding"], atomKey?: string): Promise<{ status: "advanced" | "done" | "failed"; banked: number; bankedPages: string[]; pagesComplete: number; failure?: string; reason?: string; sourceVersion?: number }> {
    const deadlineAt = Date.now() + Math.max(0, budgetMs);
    try {
      const creditHeld = Date.now() < deadlineAt && await import("@/domains/decision/llm/gateway").then((m) => m.creditBreakerHeld(tenantId)).catch(() => true);
      if (Date.now() >= deadlineAt || creditHeld) return { status: "failed", banked: 0, bankedPages: [], pagesComplete: 0, failure: creditHeld ? "credit_held" : "deadline", reason: creditHeld ? "the model provider's credit is spent, so no claim was judged this pass; it resumes when a call goes through" : "the factual-reading deadline has passed, so its evidence remains owed" };
      const [{ runFactCheckPass, claimIdentity }, facts, { loadEvidenceSnapshot }, { loadOwnedPageBodies }] = await Promise.all([
        import("@/domains/evidence/pages/fact-check-run"), import("@/domains/evidence/pages/fact-checks"),
        import("@/domains/evidence/snapshot-loader"), import("@/domains/evidence/pages/owned-context"),
      ]);
      const exact = finding !== undefined && !proposition, snapshot = exact ? null : await loadEvidenceSnapshot(tenantId, shared ? { shared } : {});
      if (topic && (!snapshot || snapshot.scope.tenantId !== tenantId || !snapshot.scope.site)) return { status: "failed", banked: 0, bankedPages: [], pagesComplete: 0, reason: "the prospective research has no verified website scope" };
      const refused = { status: "failed" as const, banked: 0, bankedPages: [], pagesComplete: 0, failure: "source_target_changed", reason: "the exact finding, current owner capture, source nomination or evidence basis could not be verified; no source was researched" };
      let held = (await facts.readFactChecks(tenantId, finding?.page)).filter(h => !finding || h.page === finding.page && h.statementKey === finding.statementKey);
      const qd = new Map<string, number>();
      for (const p of snapshot?.ownedPages ?? []) for (const q of p.search?.topQueries ?? []) for (const w of q.query.toLowerCase().split(/\s+/)) if (w.length > 2) qd.set(w, (qd.get(w) ?? 0) + q.impressions);
      const sdm = (t: string): number => Math.max(0, ...t.toLowerCase().split(/\s+/).filter((w) => w.length > 2).map((w) => qd.get(w) ?? 0));
      held.sort((a, b) => sdm(b.subject) - sdm(a.subject));
      const coverage = new Map<string, number>();
      for (const h of held) coverage.set(h.page, Math.min(coverage.get(h.page) ?? Infinity, Date.parse(h.checkedAt) || 0));
      const owedPage = new Set(held.filter((h) => h.state === "owed").map((h) => h.page)), askedPage = new Set(held.filter((h) => h.state === "owed" && facts.rulesVersionFor(h) === facts.MISSING_ANSWER_RULES_VERSION).map((h) => h.page)); // A MISSING ANSWER IS A CUSTOMER WAITING FOR AN ANSWER BLOCK, INVENTORY IS THE PAGE TALKING TO ITSELF (live, 0c2059ec): three question rows reopened and the drive spent every unit on one hub's "Quick Facts" claims, because holding owed claims at all was the whole tie-break.
      const want = topic?.key ?? (exact ? finding!.page : firstPage ? pathOf(firstPage) : null), named = (u: string): number => (want != null && pathOf(u) === want ? 1 : 0);
      const ranked = [...(snapshot?.ownedPages ?? [])]
        .sort((a, b) => named(b.url) - named(a.url)
          || (askedPage.has(pathOf(b.url)) ? 1 : 0) - (askedPage.has(pathOf(a.url)) ? 1 : 0)
          || (owedPage.has(pathOf(b.url)) ? 1 : 0) - (owedPage.has(pathOf(a.url)) ? 1 : 0)
          || (b.search?.impressions90d ?? 0) - (a.search?.impressions90d ?? 0)
          || (coverage.get(pathOf(a.url)) ?? -1) - (coverage.get(pathOf(b.url)) ?? -1));
      const basis = topic?.basis ?? await import("@/domains/decision/load-proposals").then((m) => m.resolveCurrentBasis(tenantId)).catch(() => null);
      let sourceBody: Awaited<ReturnType<typeof loadOwnedPageBodies>> | undefined;
      if (exact) {
        const target = await currentFactualTarget(tenantId, snapshot, held, basis, deadlineAt, finding, firstPage);
        if (!target || rival && (rival.url !== target.need.rivalUrl || rival.subject !== target.row.subject || rival.urls?.some(url => url !== target.need.rivalUrl))) return refused;
        if (target.row.state === "checked") return facts.authorizedCorrections([target.row], undefined, tenantId).length ? { status: "done", banked: 0, bankedPages: [], pagesComplete: 0, reason: "the exact current finding is already qualified; no source was researched", sourceVersion: target.row.sourceVersion } : refused;
        held = [target.row]; sourceBody = new Map([[canonicalUrlKey(target.body.url), target.body]]); rival = { subject: target.row.subject, url: target.need.rivalUrl!, anchor: target.row.subject };
      }
      const { callStructuredLLM } = await import("@/domains/decision/llm/structured-drafter");
      const read = async (input: { kind: "fact_claim_extraction" | "fact_claim_judgement"; system: string; user: string; grounded: string; projectedCostUsd: number; maxTokens: number }) => {
        const left = deadlineAt - Date.now();
        if (left <= 0) return { hold: "unavailable" as const };
        const r = await callStructuredLLM({ kind: input.kind, tenantId, system: input.system, user: input.user,
          grounded: input.grounded, projectedCostUsd: input.projectedCostUsd, maxTokens: input.maxTokens,
          timeoutMs: Math.max(5_000, Math.min(60_000, left)), stopBy: deadlineAt, now: new Date() }).catch(() => null);
        if (r?.status === "drafted") return { value: r.value as Record<string, unknown> };
        return { hold: r?.status === "blocked_budget" || (r?.status === "validation_failed" && r.failure === "credit_exhausted") ? "capped" as const : r?.status === "validation_failed" ? "refused" as const : "unavailable" as const }; // a door that trips mid-pass is an account-wide stop, never this claim's refusal
      };
      const { providerCall, parseCapability, collectCapability } = await import("@/domains/evidence/dataforseo/capabilities"), { readPublicPageExtract } = await import("@/domains/evidence/dataforseo/page-extract-cache"), { loadResearchState } = await import("@/domains/evidence/funnel/state-repo");
      let winnerState: ReturnType<typeof loadResearchState<FunnelState>> | undefined, sourceReadFailed = false; // One scoped read per fact pass; retained bodies never refresh their source date.
      const bought = async (cap: "serp_organic" | "onpage_content_parsing", input: Record<string, unknown>, key: string) => {
        if (sourceReadFailed || Date.now() >= deadlineAt) return null;
        if (exact && (cap !== "onpage_content_parsing" || input.url !== rival?.url)) return { hold: "refused" as const };
        const transmit = () => providerCall(cap, input as never, { tenantId, unitKey: `fact-check:${key}` });
        let call = await (exact && PROOF_SPEND.activeFor(tenantId) === true ? PROOF_SPEND.withExternalTargets(tenantId, [{ capability: "onpage_content_parsing", url: rival!.url }], transmit) : transmit()).catch(() => null);
        for (let n = 0; call?.state === "waiting" && call.cacheKey && n < 3 && Date.now() + 8_000 < deadlineAt; n += 1) {
          if (n > 0) await new Promise((done) => setTimeout(done, n * 1_000));
          call = await collectCapability(call.cacheKey).catch(() => null);
        }
        if (call && (call.state === "hit" || call.state === "ok")) return { parsed: parseCapability(cap, call.envelope) };
        return { hold: call?.state === "capped" ? "capped" as const : call?.state === "waiting" ? "waiting" as const : "unavailable" as const };
      };
      const out = await runFactCheckPass({
        tenantId, basis, deadlineAt, held, renew, read, ...(rival ? { rival } : {}), structured: (subject: string) => subject.endsWith(AEO_BAR.groupingQuestion),
        ...(want && (proposition || exact) ? { target: { page: want, statementKey: finding?.statementKey ?? atomKey ?? claimIdentity(proposition!, "", "missing") } } : {}),
        pages: topic ? [{ url: `https://${snapshot!.scope.site}`, path: topic.key, prospective: topic.label, loadBody: async () => "" }] : (exact ? [{ url: sourceBody!.values().next().value!.url }] : ranked).map((p) => ({ url: p.url, path: pathOf(p.url), loadBody: async () => {
          const bodies = sourceBody ?? await loadOwnedPageBodies(tenantId, [p.url]).catch(() => null);
          const b = bodies?.get?.(canonicalUrlKey(p.url)); // the same canonical key: an absolute owned-page address read back nothing here, so every page was skipped for having no stored words and the pass banked nothing on a store holding hundreds
          return b?.version === "current" && !!b.contentHash ? [b.title, b.h1, ...b.headings, ...b.passages].filter(Boolean).join("\n") : "";
        } })),
        refreshHeld: (page) => facts.readFactChecks(tenantId, page).then(rows => finding ? rows.filter(h => h.page === finding.page && h.statementKey === finding.statementKey) : rows).catch(() => null),
        readCoverage: (page) => facts.readInventoryCoverage(tenantId, page).catch(() => null),
        writeCoverage: (page, cov) => facts.recordInventoryCoverage(tenantId, page, cov),
        searchSources: async (query) => {
          const r = await bought("serp_organic", { keyword: query }, `serp:${query}`.slice(0, 80));
          if (r == null || "hold" in r) return { hold: r?.hold ?? "unavailable" };
          const parsed = r.parsed as { organic?: { domain: string; url: string; title: string | null }[] } | null;
          if (parsed?.organic && PROOF_SPEND.activeFor(tenantId) === true && !PROOF_SPEND.admitSearchResults(tenantId, query, parsed.organic.map((o) => o.url).filter((url) => { try { return ["http:", "https:"].includes(new URL(url).protocol); } catch { return false; } }))) return { hold: "capped" as const };
          return parsed?.organic ? { organic: parsed.organic } : { hold: "refused" as const };
        },
        fetchSource: async (url, required) => {
          const cached = await readPublicPageExtract(url).catch(() => null), usable = (h: ReturnType<typeof pageExtractFromRecord> | null, when: string | null | undefined): boolean => !!h && h.truncated === false && !!h.mainText?.trim() && Date.parse(when ?? "") <= Date.now() && isCurrent("winner_extract", when, Date.now()) && (!required?.structured || (h.sections?.length ?? 0) >= 2); let held = cached ? pageExtractFromRecord(cached.extract) : null, fetchedAt = cached && Object.hasOwn(cached.extract, "fetchedAt") ? held?.fetchedAt ?? undefined : cached?.fetchedAt;
          if (!usable(held, fetchedAt)) { if (!basis) { sourceReadFailed = true; return { hold: "unavailable" as const }; } const rawBasis = basis.replace(/::d\d+$/, ""); winnerState ??= loadResearchState<FunnelState>(tenantId, rawBasis); const saved = await winnerState.catch(() => null); if (!saved || !(saved.rowVersion > 0) || !saved.state || saved.state.schemaVersion !== emptyFunnelState(tenantId, rawBasis).schemaVersion || saved.state.tenantId !== tenantId || saved.state.basisTag !== rawBasis || !Array.isArray(saved.state.winningPages) || saved.state.winningPages.some(w => !w || typeof w.url !== "string" || w.extract != null && (typeof w.extract !== "object" || Array.isArray(w.extract)))) { sourceReadFailed = true; return { hold: "unavailable" as const }; } const matches = saved.state.winningPages.filter(w => sameFinal(w.url, url)); if (matches.length > 1) { sourceReadFailed = true; return { hold: "refused" as const }; } held = matches[0]?.extract ? pageExtractFromRecord(matches[0].extract as unknown as Record<string, unknown>) : null; fetchedAt = held?.fetchedAt ?? undefined; }
          const r = usable(held, fetchedAt) ? { parsed: held, fetchedAt } : await bought("onpage_content_parsing", { url }, `src:${url}`.slice(0, 80));
          if (r == null || "hold" in r) return { hold: r?.hold ?? "unavailable" };
          const parsed = r.parsed as { title?: string | null; mainText?: string | null; bodyText?: string | null; openingSample?: string | null; headings?: string[]; sections?: { heading: string | null; text: string }[] } | null;
          const text = parsed ? (await import("@/domains/evidence/pages/fact-source-identity")).FACT_SOURCE.text(parsed) : "";
          return text.trim() ? { text, title: parsed?.title ?? null, sections: parsed?.sections ?? [], ...("fetchedAt" in r ? { fetchedAt: r.fetchedAt } : {}) } : { hold: "refused" as const }; // the FETCHED document's own title rides along: it identifies the subject of an anaphoric passage, which a SERP title or slug never can
        },
      });
      const sectionsOwed = held.filter((h) => owedOneSectionRead(h)).slice(0, SUPPORT_BACKFILL_PER_DRIVE); const owedSupport = held.filter((h) => h.state === "checked" && !sectionsOwed.includes(h) && h.sources.some((s) => s.says.trim() !== "" && s.support == null)).slice(0, SUPPORT_BACKFILL_PER_DRIVE); // THE GROUPING ROWS BANKED BEFORE THE SECTIONS RODE ARE DECIDED FIRST (independent review, 2026-09-10): the support backfill below would otherwise take such a row for its missing artifact and rebank it checked in the same pass this slice reopens it.
      const usable = (h: (typeof held)[number]): boolean => facts.authorizedCorrections([h], undefined, tenantId).length > 0;
      const gap = (h: (typeof held)[number]): boolean => h.current.trim() === "" && !!h.proposed?.trim(), stale = (h: (typeof held)[number]): boolean => h.current.trim() === "" && (h.rulesVersion !== facts.rulesVersionFor(h) || (!usable(h) && !!h.proposed?.trim() && h.sources.length > 0 && h.sources.every((s) => s.says.trim() === "") && !h.note.includes("the passage behind this answer was not found"))); // a row whose every source banked an empty quote lost its answer to the verbatim test and is worth one more unit now that the bank searches the passage the judge read; ONCE, so a row whose note already carries those words (claim-support.ts guards on them, fact-check-run.ts banks them) never takes one of the twelve free slots again
      const gapSupport = held.filter((h) => h.state === "checked" && gap(h) && !owedSupport.includes(h) && !sectionsOwed.includes(h)
        && h.sources.some((s) => s.says.trim() !== "" && s.support != null)).slice(0, SUPPORT_BACKFILL_PER_DRIVE);
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
      if (exact && out.banked > 0) {
        const current = (await facts.readFactChecks(tenantId, finding!.page)).filter(h => h.page === finding!.page && h.statementKey === finding!.statementKey && h.state === "checked" && Number.isSafeInteger(h.sourceVersion) && h.sourceVersion! > 0 && h.evidenceBasis === basis && h.pageContentHash === held[0]?.pageContentHash);
        return current.length !== 1 || facts.authorizedCorrections(current, undefined, tenantId).length !== 1 || !await currentFactualTarget(tenantId, snapshot, current, basis, deadlineAt, { ...finding!, sourceVersion: current[0]!.sourceVersion }, firstPage) ? { status: "failed", banked: out.banked, bankedPages: [], pagesComplete: out.pagesComplete, failure: "source_not_qualified", reason: "The named source reading was saved, but it does not qualify this correction; no writer may spend against it." } : { ...out, ...(out.status !== "failed" ? { sourceVersion: current[0]!.sourceVersion } : {}) };
      }
      return { status: out.status, banked: out.banked, bankedPages: out.bankedPages, pagesComplete: out.pagesComplete, failure: out.failure, reason: out.reason };
    } catch (e) {
      log.warn("[research-steps] the fact check could not run this pass", { tenantId, error: e instanceof Error ? e.message : String(e) });
      return { status: "failed", banked: 0, bankedPages: [], pagesComplete: 0, failure: "step_error", reason: "the fact check could not run this pass" };
    }
}
