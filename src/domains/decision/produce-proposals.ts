/** decision/produce-proposals: the ONE server path that turns a tenant's cached evidence into persisted ChangeProposals. loadEvidenceSnapshot ($0) -> compileCandidates (act / watch / do nothing) -> candidatesToEvidenceInputs (only what EARNED an action) -> the cold, gated, budgeted drafter plus the ONE validator -> saveChangeProposal. PAID DRAFTING IS BOUNDED to the strongest DEFAULT_MAX_DRAFTS pages. The deep read has FIVE doors (deep-candidates.ts) and each page carries the door it came through. Three halves reach the operator: the strict drafts, every concrete edit the held evidence supports (suggested-edits.ts) and the $0 extras (producers/extra.ts), the last two at needs_review. ONE EVIDENCE BASIS, ONE ROW: an unchanged fingerprint is never re-drafted and never re-inserted. A family this pass rewrites in full and did not re-emit is SWEPT, so a card the rules retired leaves the queue. Publishing stays MANUAL: this only proposes. server-only. */
import "server-only"; import { log } from "@/lib/logger"; import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot"; import { fitCurveForOwnedPages } from "@/domains/evidence/forecast/tenant-ctr-curve"; import { loadBusinessProfile } from "@/domains/account";
import { pagesUnderMeasurement, resolveCurrentBasis } from "./load-proposals"; import { candidatesToEvidenceInputs, compileCandidates, type QualifiedCandidate } from "./opportunities"; import type { CauseFinding } from "./diagnosis";
import { selectDeepCandidates } from "./deep-candidates"; import { produceBundleForSnapshot } from "./produce-bundle"; import { proposeExistingPageChange, type ProposeOptions } from "./propose";
import { loadChangeProposals, saveChangeProposal, withdrawChangeProposal, withdrawnProposalIds } from "./proposal-store"; import { actionableProposalFailures } from "./validate-proposal"; import { rankProposals } from "./rank-proposals";
import { ownershipCards, researchingCards, unsettledCause, withholdReason } from "./authorization"; import { confidenceFor, proposalId, type ActionDiagnosis, type ChangeProposal, type EvidenceReadiness } from "./contracts"; import { openHold, preferFinished } from "./completeness"; import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { loadOwnedPageBodies, type OwnedPageBody } from "@/domains/evidence/pages/owned-context"; import { buildTopicInvestigations, type TopicInvestigation } from "@/domains/evidence/topic-investigation"; import { earnedNewPage, type IntersectionEvidence } from "./coverage-adjudication";
import { extractPageFacts, readWinningPattern } from "./winning-pattern"; import { readCoverage, recordCoverageNeeds, type DecidedTopic } from "./coverage-pass"; import { applyDraftedCopy, staleCopyReasons, withoutCta } from "./drafted-copy";
import { DRAFT_BUDGET } from "./draft-budget"; import { creditBreakerHeld } from "./llm/gateway"; import { MAX_NEW_READS_PER_PASS } from "./producers/page-job";
import { readInventory } from "@/domains/evidence/scanning/owned-pages-store"; import { readTechnicalFindings } from "./technical-findings"; import { buildNewPageProposal } from "./new-page";
import { suggestedEdits } from "./suggested-edits";

export type ProduceProposalsOptions = ProposeOptions & {
  /** A TEST SEAM ONLY: production reads the stored comparison out of the canonical evidence, and passing this skips that read. */
  intersection?: IntersectionEvidence;
  /** Hard cap on how many opportunities this pass drafts (budget guard). */ maxDrafts?: number; /** Pages a pass TODAY already spent on and got nothing from: declared on the manifest, never funded again, so the next pass walks DOWN the ranking rather than buying the same refusal twice. */ skipKeys?: readonly string[]; /** Pages a pass TODAY funded and never reached. Still owed, so never written off; ranked LAST, so the next drive funds what has not been tried instead of holding the same slots open forever. */
  retryKeys?: readonly string[]; // pages this day spent real calls on that came back transiently blocked: still owed, still fundable, ranked behind work nobody has tried
  /** WALL-CLOCK MOMENT THIS PASS MUST STOP STARTING PAID WORK (epoch ms). Not a cancel: work already in flight finishes and is filed. It exists because one deliverable is three charged calls and a reasoning call alone is floored at ninety seconds, so a caller that boxes the whole pass on a timer gets NO receipts at all and re-funds the same pages next time. Stopping cleanly means the pass returns what it learned. */ stopBy?: number; /** The pages still being measured, when the caller knows them: preferred over any derivation here. */ measuringPagePaths?: readonly string[]; /** Persist each landed proposal (default true). Tests pass false to stay pure. */ persist?: boolean; zeroSpend?: boolean; /** NOTHING IS BOUGHT ON THIS PASS, and a paused account drafts nothing whatever the caller asked for. Not a smaller budget: both paid pools are minted EMPTY and the caller runs the pass inside the fail-closed spend scope (lib/spend-scope), so the model door and the provider door refuse on their own however deeply they are reached. Bounding `maxDrafts` alone left the page-reading pool and the drafting attempt pool wide open, which is how a paused account went on paying (operator, 2026-08-19). NON-DESTRUCTIVE BY CONSTRUCTION: the deterministic families are still rewritten in full and only those are swept, banked copy outlives a brief re-minted over it, and no card is withdrawn for work this pass simply did not do. "Did not run" never means "rejected its previous work". */
};
/** How this pass ended. Only `persistence_failed` is a failure; `investigating` is the honest middle: proven gaps exist and what to change is not known yet, so they are VISIBLE rather than read as a quiet day. */
export type ProducerOutcome = "evidence_unreadable" | "no_actionable_candidate" | "investigating" | "actionable_but_no_trusted_draft" | "persistence_failed" | "proposals_persisted";

export type ProduceProposalsResult = {
  /** The ranked proposals this pass produced (may be empty and still a success). */ proposals: ChangeProposal[]; candidates: QualifiedCandidate[]; /** Which of the honest endings this pass reached. */ outcome: ProducerOutcome; /** Candidates that earned an action: a page to edit, plus every consolidation this kernel cannot draft yet. */ actionable: number; /** Proven gaps whose cause is not identified yet: real work, not silence. */ investigating: number; noDraft: number; persisted: number; /** Drafts the store REFUSED to file because that page already carries a change under measurement. */ heldForMeasurement: number; /** Proposals carried forward unchanged: no draft, no write, no dollars. */ reused: number; /** What has been investigated about each topic, over the SAME evidence this pass judged. Research only. */ investigations: TopicInvestigation[]; coverage: DecidedTopic | null; /** the earliest date any page this pass could not read may be tried again; null when nothing is waiting, which is what stops a surface saying "checking" */ waitingUntil: string | null; /** Cards a producer would have minted and HELD instead, each with the typed reason. Refused work is on the receipt, never a silent absence. */ held: { pageUrl: string; reason: string }[]; /** THE PASS'S OWN RECEIPT, PER JOB. Every candidate the manifest saw, the ones it funded, and what actually BECAME of each funded one. The aggregate this replaces was a fiction: allowances are decremented BEFORE the gateway is called, so one charged-looking number made every funded page look attempted even when the first call came back out of quota and the rest were never reached (Codex, 2026-08-22). `attemptUnitsSpent` keeps its honest name: it is allowance consumed, and it is not a billing figure and not proof anybody was asked. */
  paid: { declared: readonly string[]; funded: readonly string[]; attemptUnitsSpent: number; declined?: readonly { key: string; family: string; reason: string }[];
    evidenceOwed?: readonly { key: string; kind: string; query: string; url?: string; reasonCode: string; resumeTreatment: string; reason: string; workKey: string }[]; // the exact readings funded candidates were refused for, typed
    /** THE COMPLETE PER-PAGE RECORD, every field of it SET by the builder below and read off the surface that holds it. Nothing here is optional-and-absent: a receipt that cannot name the family, the treatment, the price it was funded at, the operations it ran, the requests that really left the process, the dollars they cost or the store's own answer is not a receipt (Codex, 2026-08-23). `why` is present whenever anything settled or blocked the page, and is never truncated here. */
    receipts: readonly { key: string; funded: boolean; family: string; treatment: string | null; impact: number; allowance: number; fallbacks: readonly string[];
      ops: number; providerCalls: number; costUsd: number; providerAttempted: boolean;
      outcome: "produced" | "review_saved" | "evidence_required" | "evidence_banked" | "deterministic_refusal" | "retryable_blocked" | "not_reached";
      /** The STORE's own word for what happened to the row, or null where nothing was written. */ persistence: string | null; /** What settled or blocked it, in its own words, WHOLE. */ why?: string }[] }; }; /** Bounded drafting: the strongest few, never a queue. */ export const DEFAULT_MAX_DRAFTS = 5; const MAX_INVENTORY = 200; /** THE RULE TAKEN OUT ON 2026-08-23, in the words it wrote onto the rows it held: a list member checked against the writer's own declared claims, which refused "with mammals of Iran" and "symbolizing royal authority" as things a page offers. A row carrying only this is held by nothing that still exists; every other hold outlives the sweep. */ const WITHDRAWN_HOLD = /and no claim on this card carries it$/;
const NO_BODIES = new Map<string, OwnedPageBody>(); // one bounded inventory page, never the whole site; no page words in hand is a skip, never a failure /** The card families each $0 producer rewrites IN FULL every pass. A family outside its producer's list is somebody else's work and is never swept. `divergence` is listed with nothing writing it any more, and that is the point: it stays under its producer's sweep, so every diagnose-it-yourself card on file is retired the next time that producer finishes. */
const SUGGESTED_FAMILIES = ["title", "h1", "answer_block", "divergence"] as const; const EXTRA_FAMILIES = ["ai_answer_gap", "engine_followup", "internal_link", "missing_description", "duplicate_heading", "thin_page"] as const;
/** WHAT A PRODUCER REWROTE, AND WHETHER IT FINISHED. The sweep used to infer both from the length of one producer's output. A producer that read nothing and a producer that found nothing hand back the same empty list and mean opposite things, and on the night the search read timed out that inference retired cards out from under the operator mid-edit. Completeness is STATED, never read off an output length. */
type ProducerRun = { families: readonly string[]; complete: boolean };
/** THE ONE PAGE A VERDICT DECIDED TO IMPROVE, as facts out of words this pass ALREADY holds. Null for `create_new`, and null when its own words are not held. */
function ownedFactsFor(snapshot: EvidenceSnapshot, decided: DecidedTopic): ReturnType<typeof extractPageFacts>[number] | null {
  if (decided.decision.verdict !== "improve_existing") return null; const url = decided.decision.ownedUrls[0], held = decided.candidates.find((c) => c.url === url && c.bodyHeld); if (!held) return null;
  const at = (u: string): string => { try { return new URL(u.startsWith("http") ? u : `https://${u}`).pathname.replace(/\/+$/, "") || "/"; } catch { return u; } };
  const row = snapshot.ownedPages.find((p) => at(p.url) === at(held.url))?.content ?? null;
  return extractPageFacts([{ url: held.url, extract: { title: held.title, h1: held.h1, wordCount: held.wordCount, headings: row?.outline ?? null, faqCount: row?.faqCount ?? null, openingSample: held.openingSample, entityNames: held.entities } }])[0] ?? null;
}
/** Normalized keys a candidate and a proposal can be matched on. */
const pageKeys = (pageUrl: string | null | undefined): string[] => {
  const url = (pageUrl ?? "").trim().toLowerCase(); if (!url) return [];
  try { return [url, new URL(url.startsWith("http") ? url : `https://${url}`).pathname || "/"]; } catch { return [url]; }
};
/** The pages still being measured: what the caller passed, else the Shipment STAMPS (Decision -> Measurement is the allowed direction), else the drafted dates of the applied rows in hand. Fail-soft. */
async function measuringPaths(tenantId: string, existing: Map<string, ChangeProposal>, opts: ProduceProposalsOptions): Promise<string[]> {
  if (opts.measuringPagePaths) return [...opts.measuringPagePaths]; const shipped = await import("@/domains/measurement/proof-gsc/shipped-change-store").then((m) => m.pagesUnderMeasurementFromShipments(tenantId, opts.now)).catch(() => [] as string[]);
  return shipped.length > 0 ? shipped : pagesUnderMeasurement(existing.values(), opts.now);
}

/** TWO CONSECUTIVE 28-DAY WINDOWS PER PAGE, Google's and GA4's side by side: the only read that tells "Google moved this page" apart from "something on this page stopped working". $0, fail-soft. */
type Windows = Map<string, { positionNow: number; positionPrior: number; sessionsNow: number; sessionsPrior: number; clicksNow: number; clicksPrior: number; impressionsNow: number; impressionsPrior: number; windowEnd: string; lostClicks: number }>;
async function twoWindows(tenantId: string, now: Date | undefined): Promise<Windows> { const out: Windows = new Map();
  const [decay, visits] = await Promise.all([import("@/domains/evidence/readers/gsc-page-signals").then((m) => m.loadGscDecaySignalsForTenant(tenantId, now ?? new Date())).catch(() => null), import("@/domains/evidence/readers/ga4-page-values").then((m) => m.loadGa4SessionSplitForTenant(tenantId, now ?? new Date())).catch(() => null)]);
  if (!decay) return out;
  for (const [url, d] of decay) out.set(url, { positionNow: d.positionNow, positionPrior: d.positionPrior, clicksNow: d.clicksNow, clicksPrior: d.clicksPrior, sessionsNow: visits?.get(url)?.now ?? 0, sessionsPrior: visits?.get(url)?.prior ?? 0, impressionsNow: d.impressionsNow, impressionsPrior: d.impressionsPrior, windowEnd: d.windowNowEnd, lostClicks: Math.max(0, d.clicksPrior - d.clicksNow) });
  return out;
}

/** WHAT EACH KIND OF CHANGE HAS DONE ON THIS SITE, off its own ledger: how many readings finished, and the net clicks they moved against the pages nobody changed. Fail-soft to nothing. */
async function familyHistoryOf(tenantId: string): Promise<Map<string, { readings: number; netLift: number }>> { const out = new Map<string, { readings: number; netLift: number }>();
  const ledger = await import("@/domains/measurement/proof-gsc/load-ledger").then((m) => m.loadProofLedgerPersisted(tenantId)).catch(() => null); if (!ledger) return out; const { actionFamilyOf } = await import("@/domains/measurement/proof-gsc/change-family");
  for (const r of ledger) {
    const read = [...r.windows].filter((w) => w.ran && (w.controlsUsed ?? 0) > 0 && w.adjustedLift != null && w.day >= 28).sort((a, b) => b.day - a.day)[0]; if (!read) continue; const cur = out.get(actionFamilyOf(r.actionType)) ?? { readings: 0, netLift: 0 };
    out.set(actionFamilyOf(r.actionType), { readings: cur.readings + 1, netLift: cur.netLift + Math.round(read.adjustedLift!) }); }
  return out;
}

/** Produce (and by default persist) ranked ChangeProposals for one tenant from cached evidence only. Never throws on a single-source outage: a failed source simply narrows the snapshot. */
export async function produceProposalsForTenant(tenantId: string, opts: ProduceProposalsOptions = {}): Promise<ProduceProposalsResult> {
  const maxDrafts = opts.zeroSpend === true ? 0 : opts.maxDrafts ?? DEFAULT_MAX_DRAFTS, persist = opts.persist ?? true; const snapshot = await loadEvidenceSnapshot(tenantId, { now: opts.now });
  // A SOURCE THAT DID NOT ANSWER IS NOT AN ACCOUNT WITH NOTHING IN IT: a GSC read that threw makes every page read clean, so the pass ENDS HERE rather than retiring the whole queue. Empty is not failed. AND THE SAME FOR THE PAGE READ: an account whose own pages could not be read presents as an account that owns NO PAGE AT ALL, which is the one condition that earns a brand new page, so a storage outage could talk this pass into building a page for a subject the operator already covers.
  const blind = snapshot.sources.find((s) => (s.source === "gsc" || s.source === "wix") && s.status === "failed");
  if (blind) {
    log.warn(`[produce-proposals] the ${blind.source === "gsc" ? "search data" : "page inventory"} did not answer, so this pass changes nothing`, { tenantId });
    return { proposals: [], candidates: [], outcome: "evidence_unreadable", actionable: 0, investigating: 0, noDraft: 0, persisted: 0, reused: 0, heldForMeasurement: 0, investigations: [], coverage: null, waitingUntil: null, held: [], paid: { declared: [], funded: [], attemptUnitsSpent: 0, receipts: [] } }; }
  const profile = await loadBusinessProfile(tenantId).catch(() => null), allowlist = opts.authoritativeSourceDomains ?? profile?.trustedSourceDomains.value ?? [];
  const bannedTerms = profile?.constraints.value.bannedTerms ?? []; // the account's own vocabulary, read ONCE: every editor in the pass is held to the same words
  /** TWO HARD BUDGETS, and every paid Decision call this pass can reach decrements one of them BEFORE the call, whether it succeeded, refused or threw. 1. THE PAID PLAN (decision/draft-budget, compiled and funded below once every $0 producer has run): the reading of the winning pages, the new page, the shallow field drafts, every deep bundle piece, Beacon's own correction review and the editor. `maxDrafts` is the number of CANDIDATES the whole pass may spend on and MAX_PAID_CALLS caps the charged calls behind them, so no family keeps a pool and none can claim by being reached first. 2. `pageReads` (MAX_NEW_READS_PER_PASS): the durable page readings the $0 producers buy to place their cards (producers/page-job). These are a DIFFERENT thing bought at a different rate and are not folded into the call pool, where sixty of them would starve every drafter; they are named, counted and reported instead. A tripped provider breaker funds nothing at all. */
  const breakerOpen = opts.zeroSpend === true ? true : await creditBreakerHeld(tenantId).catch(() => true); if (breakerOpen && opts.zeroSpend !== true) log.warn("[produce-proposals] the provider's own credit is spent, so this pass drafts nothing and reports no funded work", { tenantId });
  const pageReads = { left: opts.zeroSpend === true ? 0 : MAX_NEW_READS_PER_PASS };
  const basis = await resolveCurrentBasis(tenantId, profile); // The basis this pass generates under: the SAME fingerprint Runtime scopes derived work with. Fail-soft.
  // ONE CURVE FOR THE WHOLE PASS, fitted once and handed to every surface that measures a gap, so the diagnosis, the coverage walk, the bundle and the suggestions cannot judge one page by four bars.
  const curve = fitCurveForOwnedPages(snapshot.ownedPages, { name: profile?.name.value ?? null, domain: snapshot.scope.site }, opts.now);

  const existing = persist ? await loadChangeProposals(tenantId).catch(() => new Map<string, ChangeProposal>()) : new Map<string, ChangeProposal>(); let released = 0;
  /** The drafts already taken back under this basis: without this read the next pass repays every failure. */
  const withdrawn = persist ? await withdrawnProposalIds(tenantId, basis) : new Set<string>();
  /** THE measurement context, derived once and shared by the diagnosis and both rankings. */
  const measuring = { measuringPagePaths: await measuringPaths(tenantId, existing, opts) };
  const [windows, familyHistory] = await Promise.all([twoWindows(tenantId, opts.now), familyHistoryOf(tenantId)]); // THE TWO WINDOWS, AND WHAT THIS ACCOUNT'S OWN FINISHED READINGS SAY. Both $0, both fail soft, neither creates work: one names a fall Google did not cause, the other ranks a losing kind of change below a winning one.

  let investigations: TopicInvestigation[] = []; // THE RESEARCH PACKETS, over the same evidence this pass judges. Non-actionable by construction.
  try { investigations = buildTopicInvestigations(snapshot); }
  catch (e) { log.warn("[produce-proposals] investigations failed (fail-soft)", { tenantId, error: e instanceof Error ? e.message : String(e) }); }
  const technical = readTechnicalFindings({ inventory: await readInventory(tenantId, { limit: MAX_INVENTORY }).catch(() => []), // THE ONE CANONICAL COVERAGE PASS, the same one Runtime buys evidence off. $0, deterministic, fail-soft.
    pages: snapshot.ownedPages.filter((p) => !!p.content).map((p) => ({ url: p.url, title: p.content!.title, h1: p.content!.h1, internal_links: p.content!.internalLinks.map((l) => l.href), canonical_url: p.content!.canonicalUrl ?? null, has_canonical_mismatch: p.content!.hasCanonicalMismatch ?? null, robots_meta: p.content!.robotsMeta ?? null })) });
  let coverage: DecidedTopic | null = null, waitingUntil: string | null = null;
  const extraHeld: { pageUrl: string; reason: string }[] = []; // Filled once the $0 producers run; the same array rides the result so held work reaches the receipt.
  // THE COVERAGE VERDICT, AT $0. The reading of the winning pages that can refine it is PAID, so it is no longer bought here, ahead of everything: it is declared on the pass's ONE manifest below, priced like every other job, and run only if the one ranking funds it (Codex, 2026-08-22, "delete the paid reserve that runs before the rank, or represent that work explicitly in the same manifest").
  try { const read = await readCoverage(snapshot, tenantId, { basis, profile, now: opts.now, intersection: opts.intersection, technical, curve }); coverage = read.decided; waitingUntil = read.waitingUntil; }
  catch (e) { log.warn("[produce-proposals] coverage verdict failed (fail-soft)", { tenantId, error: e instanceof Error ? e.message : String(e) }); }
  const patternKey = coverage && (coverage.decision.verdict === "create_new" || coverage.decision.verdict === "improve_existing") && coverage.investigation.currentReadableWinners >= 2 && !coverage.decision.pattern ? `pattern:${coverage.investigation.key}` : null;
  /** THE FUNDED READING, run FIRST among the funded jobs so every job judged after it is judged against the refined verdict. One bounded call for the ONE topic that earned a verdict, then one free re-read. Fail-soft: no pattern, same verdict. */
  const readPattern = async (slice: { left: number }): Promise<void> => {
    const at = coverage!, mine = new Set(at.investigation.winners.filter((w) => w.extractState === "current").map((w) => w.url)); // ONLY THE WINNERS CURRENTLY HELD A READ OF: the denominator is exactly what was read and is still held.
    const pattern = await readWinningPattern(extractPageFacts((snapshot.research.winningPages ?? []).filter((r) => mine.has(r.url))), ownedFactsFor(snapshot, at), tenantId, { complete: opts.complete, now: opts.now, pageType: at.investigation.pageType, label: at.investigation.label, attempts: slice }).catch(() => null);
    if (!pattern) return; const again = await readCoverage(snapshot, tenantId, { basis, profile, now: opts.now, intersection: opts.intersection, curve, patternFor: { topicKey: at.investigation.key, pattern } }).catch(() => null);
    if (again?.decided) { coverage = again.decided; waitingUntil = again.waitingUntil; }
  };
  /** The pass's own research half, read at the END of the pass so it carries the verdict the funded reading refined rather than the one that stood before it. */
  const research = () => ({ investigations, coverage, waitingUntil, held: extraHeld });
  // THE PAGE'S OWN TWO WINDOWS REACH THE DIAGNOSIS, keyed every way a candidate can be matched. Without this a fall was loaded, rendered on a lane, and never once weighed by the kernel that decides what to do.
  const decline = new Map<string, NonNullable<ReturnType<Windows["get"]>>>(); for (const [url, w] of windows) for (const k of pageKeys(url)) decline.set(k, w);
  const compile = () => compileCandidates(snapshot, { coverage, ...measuring, decline, curve }), bound = Math.min(DEFAULT_MAX_DRAFTS, maxDrafts);
  let candidates = compile(), acted = candidates.filter((c) => c.action === "act_existing_page"), earned = candidatesToEvidenceInputs(snapshot, acted), inputs = earned.slice(0, bound);
  /** THE PAGES THIS PASS NEVER REACHED, because paid drafting stops at `bound`. NOT RE-EMITTED BY A CAP IS NOT NOT RE-EMITTED: the sweep read the budget's silence as the generator withdrawing its own work, and took back a draft already PAID for on the sixth strongest page of every pass. */
  let cappedOut = new Set(earned.slice(bound).flatMap((i) => [proposalId(i), ...pageKeys(i.page.url ?? "")]));
  let deep = selectDeepCandidates({ candidates, coverage, limit: bound }); // SELECTION ONLY: nothing here drafts, buys, or invents a figure.
  // Pages already carrying a change under measurement: a second change on one of them cannot be saved. The ONE measuring context the pass already derived, plus every implemented store row whatever its age: reading only the store here let a page the caller declared under measurement take a fresh $0 card.
  const measuringPagesEarly = new Set([...measuring.measuringPagePaths, ...[...existing.values()].filter((r) => r.status === "implemented_pending_verification").map((r) => r.pagePath ?? "")].map((path) => path.trim().toLowerCase()));

  // EVERY $0 PRODUCER RUNS BEFORE A CENT IS COMMITTED, so the manifest below can price the whole pass rather than whatever happens to have been minted by the time each family asks. THE PAGE'S OWN STATEMENTS AGAINST THEIR SOURCES, minted from banked fact checks alone, so a correction is reproducible (operator, 2026-08-17), and its review is a separate priced job below. READ BEFORE THE QUIET-DAY RETURN: this producer below the early exit meant a quiet day could never regenerate a correction bundle (Codex, 2026-08-18: two ordinary passes must reproduce it).
  const defects = await import("./producers/factual-defects"), factual = await defects.FACTUAL_DEFECTS.cards({ tenantId, snapshot, now: opts.now ?? new Date() }).catch(() => ({ cards: [] as ChangeProposal[], complete: false }));
  // THE $0 QUEUE RUNS ONCE PER PASS, HERE, on every path: both the quiet day and the ordinary one read this same run. Its banked coverage needs are written a few lines down, AFTER the funded reading, so the re-read of the verdict can never be moved by discoveries this same pass just made.
  const { run: extra, unitLoad } = await import("./producers/extra").then((m) => m.extraQueuePass({ tenantId, snapshot, now: opts.now ?? new Date(), curve, reads: pageReads, persist }))
    .catch(() => ({ run: { cards: [] as ChangeProposal[], complete: false, held: [], needsOwnPage: [] as { query: string; refusedPages?: string[] }[], families: [] as string[] }, unitLoad: null }));
  extraHeld.push(...(extra.held ?? []));
  const quietDay = acted.length === 0 && deep.length === 0; // A quiet day returns before the editor ever runs, so it declares no editor work and its slots stay with the corrections that CAN finish.
  // THE COLLAPSE PRODUCER: the largest losses the account's own history can PROVE become cards before any defect sweep fills the queue; a failed history read sweeps nothing.
  const recovery = quietDay ? { cards: [] as ChangeProposal[], complete: false, window: { earlyDays: 0, earlyFrom: null, earlyTo: null }, losses: [] }
    : await import("./producers/demand-recovery").then((m) => m.demandRecoveryCards({ tenantId, snapshot, now: opts.now ?? new Date(), curve, ...(unitLoad ? { preloaded: unitLoad } : {}) }))
      .catch(() => ({ cards: [] as ChangeProposal[], complete: false, window: { earlyDays: 0, earlyFrom: null, earlyTo: null }, losses: [] }));

  /** WHAT EACH PAGE IS WORTH, in ONE unit for every family: the clicks the diagnosis proved recoverable, else the audience that page actually has. The manifest is priced and ranked on this, so a bundle, a new page, a correction review and a description are comparable at all. */
  const audience = new Map<string, number>(), worth = new Map<string, number>(); for (const o of snapshot.ownedPages) if (o.search) for (const k of pageKeys(o.url)) audience.set(k, o.search.impressions90d);
  for (const c of candidates) { const k = pageKeys(c.pageUrl).at(-1) ?? ""; if (!k) continue;
    worth.set(k, Math.max(worth.get(k) ?? 0, c.recoverableClicks, (pageKeys(c.pageUrl).map((x) => audience.get(x)).find((x) => x != null) ?? 0) / 100)); }
  const worthOf = (u: string | null | undefined): number => pageKeys(u).map((k) => worth.get(k)).find((v) => v != null) ?? 0;
  /** THE ONE MANIFEST OF PAID WORK, COMPILED BEFORE A CENT IS SPENT, PRICED BEFORE IT IS RANKED, AND CANONICAL BY PAGE (Codex, 2026-08-22). Every family that can spend model money on this pass declares here: the winning-pattern reading, the new page, the shallow field drafts, the deep bundles, Beacon's own correction review and the editor. Nothing claims a slot by being reached first, and a key that is not on this list can never spend, whenever it asks. AND SEVERAL FAMILIES WANTING ONE PAGE IS ONE JOB, not several: the plan collapses them to a single candidate priced at the dearest of them, so a page can never occupy two slots or two allowances. Declaring them separately meant a successful rewrite left an editor slot funded and unused, and a failed twelve-call rewrite unlocked another three calls on the same page while other pages went unfunded. */
  const newPageIds = coverage && earnedNewPage(coverage.decision) ? [coverage.investigation.key, ...coverage.investigation.aliasKeys] : null;
  const heldNewPage = newPageIds ? [...existing.values()].find((r) => r.kind === "new_page" && r.status !== "implemented_pending_verification" && basis != null && r.basis === basis && newPageIds.some((k) => r.id.includes(`::${k}::`))) ?? null : null, topicWorth = (coverage?.investigation.demand.monthlySearchVolume ?? 0) / 100; // the same unit as every other row: searches a month read as the clicks a page for them could plausibly take
  const jobs: { key: string; family: string; impact: number; calls: number; fallbacks?: string[]; blocked?: string; treatment?: string; workKey?: string }[] = [], editorCards: ChangeProposal[] = []; const page = (c: { pagePath?: string | null; pageUrl?: string | null }) => DRAFT_BUDGET.keyOf(c);
  // WHAT CANNOT BE DONE THIS PASS IS DECIDED BEFORE THE MONEY IS (Codex, 2026-08-23). Live, three of five funded slots came back `not_reached` while completable work below them went unfunded, and every fact that would have refused them was already on file when the manifest was priced: a page already carrying a change under measurement, work the operator took back, a stored row for this exact opportunity that still stands, and a card the authorization boundary refuses on its own diagnosis. A blocked job stays DECLARED, with the reason in the operator's words, and takes no slot, so the money walks down the ranking on the same drive.
  /** WHAT MAKES TWO PIECES OF WORK THE SAME (Codex, 2026-08-23): the page, the evidence underneath it, the family, the treatment, the cause and the search it answers. Comparing the cause alone let an incomplete title bundle stand in for a newly selected rewrite, so the writer was skipped on a page worth 312 recoverable clicks and the receipt called it produced. */
  const workKeyOf = (c: { pagePath?: string | null; pageUrl?: string | null; changeFamily?: string; treatment?: string | null; causeFinding?: { cause: string } | null; diagnosisCause?: string | null; primaryQuery?: string; kind?: string }): string =>
    [DRAFT_BUDGET.keyOf(c), basis ?? "no-basis", snapshot.evidenceHash ?? "", c.kind ?? "", c.changeFamily ?? "", c.treatment ?? "", (c.causeFinding?.cause ?? c.diagnosisCause) ?? "", canonicalQueryKey(c.primaryQuery ?? "")].join("::");
  const preJudged = new Map<string, QualifiedCandidate>(); for (const c of candidates) for (const k of pageKeys(c.pageUrl)) preJudged.set(k, c);
  for (const c of candidates) if (c.cause.payload?.cause === "cannibalization") for (const u of c.cause.payload.competingPaths) for (const k of pageKeys(u)) // THE SAME PROPAGATION THE BOUNDARY READS, or the two answer differently and a slot is burned on a card admit was always going to refuse
    if ((preJudged.get(k)?.cause.cause ?? "no_problem") === "no_problem") preJudged.set(k, c); const preOwned = ownershipCards({ tenantId, now: opts.now ?? new Date(), basis: basis ?? null, pages: snapshot.ownedPages, judged: candidates, queryKeyOf: canonicalQueryKey });
  const measuringNow = (c: { pagePath?: string | null; pageUrl?: string | null }): boolean => [(c.pagePath ?? "").trim().toLowerCase(), (c.pageUrl ?? "").trim().toLowerCase()].some((k) => k.length > 0 && measuringPagesEarly.has(k));
  const MEASURED = "a change on this page is already being measured, so a second one cannot be saved until that finishes", MARKED_DONE = "the change on file for this page is marked done and is being read, so nothing is redrafted for it";
  /** WHY THIS ID CANNOT BE FUNDED, or undefined when it can: the stored row's own state, decided on the same identity the loop that would do the work uses. */
  const blockedById = (id: string, at: { pagePath?: string | null; pageUrl?: string | null }, reuse: boolean): string | undefined => {
    // WITHDRAWN IS DELIBERATELY NOT HERE (Codex, 2026-08-23): `withdrawnProposalIds` is basis-wide with no evidence comparison, while the store's own admission rule compares the readings underneath, so blocking on it would hold a row shut for a whole generation and refuse the redraft moved evidence had earned. The field-draft loop still settles a genuinely withdrawn row with its own receipt, which is where that answer belongs.
    if (measuringNow(at)) return MEASURED; const held = existing.get(id); if (held && held.status === "implemented_pending_verification") return MARKED_DONE;
    return reuse && held && basis != null && held.basis === basis ? "the change already on file for this page still stands under today's evidence, so nothing is redrafted for it" : undefined; };
  /** A card's own ineligibility, including the boundary's answer WITHOUT its withdrawal side effect: the real `admit` below asks the same question and owns the consequence. */
  const blockedFor = (c: ChangeProposal): string | undefined => {
    const key = (c.pageUrl ?? "").trim().toLowerCase(), path = (c.pagePath ?? "").trim().toLowerCase(), cause = (preJudged.get(key) ?? preJudged.get(path))?.cause.cause;
    const split = cause === "cannibalization" && !preOwned.covered.has(key) && !preOwned.covered.has(path); // NO CARD, NO REFUSAL
    return blockedById(c.id, c, false) ?? (split ? undefined : withholdReason(c, cause) ?? undefined); };
  const blockedField = (i: Parameters<typeof proposalId>[0]): string | undefined => blockedById(proposalId(i), { pagePath: i.page.path, pageUrl: i.page.url ?? null }, true);
  if (patternKey) jobs.push({ key: patternKey, family: "winning_pattern", impact: topicWorth, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }); if (newPageIds && !heldNewPage) jobs.push({ key: `topic:${coverage!.investigation.key}`, family: "new_page", impact: topicWorth, calls: DRAFT_BUDGET.BUNDLE_CALLS });
  for (const d of deep) jobs.push({ key: page({ pageUrl: d.pageUrl }), family: "deep_bundle", impact: worthOf(d.pageUrl), calls: DRAFT_BUDGET.BUNDLE_CALLS, workKey: workKeyOf({ pageUrl: d.pageUrl, kind: "existing_edit", changeFamily: "deep_bundle", diagnosisCause: pageKeys(d.pageUrl).map((k) => preJudged.get(k)?.cause.cause).find(Boolean) ?? null, primaryQuery: d.evidence?.query ?? "" }) });
  for (const i of inputs) jobs.push({ key: page({ pagePath: i.page.path, pageUrl: i.page.url ?? null }), family: "field_draft", impact: worthOf(i.page.url ?? i.page.path), calls: DRAFT_BUDGET.DELIVERABLE_CALLS, ...(blockedField(i) ? { blocked: blockedField(i)! } : {}) });
  for (const c of factual.cards) jobs.push({ key: page(c), family: "correction_review", impact: worthOf(c.pageUrl ?? c.pagePath), calls: DRAFT_BUDGET.DELIVERABLE_CALLS * Math.max(1, Math.ceil((c.bundle?.components.length ?? 1) / 10)), ...(blockedFor(c) ? { blocked: blockedFor(c)! } : {}) });
  // The editor's cards are declared for every one of them: which a page still NEEDS is decided further down, once the other families have either produced that page's row or failed to. A RESEARCH TREATMENT IS NOT PAID WRITING WORK (Codex acceptance run, 2026-08-23 03:30Z): /cities was minted technical_reachability, the drafter rightly refused to write for it, and the funded job then sat unfinished on the receipt as a mute retryable_blocked. A card whose treatment needs decisions or acquisition is never DECLARED as an editor job at all: it costs nothing, blocks nothing, and its card already says the real work.
  const needsDecisions = new Set(["technical_reachability", "consolidate_or_differentiate", "new_page"]); if (!quietDay) editorCards.push(...[...recovery.cards, ...extra.cards].filter((c) => !needsDecisions.has(c.treatment ?? "")));
  for (const c of editorCards) jobs.push({ key: page(c), family: "editor", impact: Math.max(c.impactScore ?? 0, worthOf(c.pageUrl ?? c.pagePath)), calls: DRAFT_BUDGET.DELIVERABLE_CALLS, ...(blockedFor(c) ? { blocked: blockedFor(c)! } : {}), ...(c.treatment ? { treatment: c.treatment } : {}) });
  // THE IDENTITY IS DECLARED ONCE, WITH THE JOB, and every later step READS it (Codex, 2026-08-23): recomputing it from whatever a producer returned is how the lookup asked for changeFamily "bundle" while the bundle saved under its own derived family, two identities for one piece of work that can never match.
  const declaredWorkKey = new Map<string, string>(); for (const j of jobs) if (!declaredWorkKey.has(j.key)) declaredWorkKey.set(j.key, j.workKey ?? j.key);
  const budget = DRAFT_BUDGET.plan({ jobs, candidates: maxDrafts, calls: DRAFT_BUDGET.MAX_PAID_CALLS, breakerOpen, ...(opts.skipKeys ? { skip: opts.skipKeys } : {}), ...(opts.retryKeys ? { retry: opts.retryKeys } : {}) });
  /** WHAT BECAME OF EACH FUNDED JOB, recorded where it happens and never inferred from a counter. The strongest answer for a key wins: a page whose bundle failed and whose one-field fallback landed HAS finished work. Anything nobody filed reads `not_reached`: funded, never got to, never written off. `gateWords` is the rule that refused each page, in its own words, so the receipt says WHICH one rather than only that something did. */
  // gateWords: the rule that refused each page, in its own words. The MONEY is metered by the money surface itself.
  const evidenceOwed = new Map<string, { kind: string; query: string; url?: string; reasonCode: string; resumeTreatment: string; reason: string; workKey: string }>(); // the exact reading a funded candidate was refused for, as data
  const gateWords = new Map<string, string>(), filed = new Map<string, { providerAttempted: boolean; outcome: keyof typeof RANK; why?: string; persistence?: string }>(),
    RANK = { produced: 5, review_saved: 4, evidence_required: 2.5, evidence_banked: 3, deterministic_refusal: 2, retryable_blocked: 1, not_reached: 0 } as const; // review_saved: a draft was written and stored for a human to read. It SETTLES the attempt and is NEVER Ready work (Codex, 2026-08-23)
  // The whole entry is REPLACED, never merged: a stronger answer must not inherit the words of the weaker one it overtook, which is how a produced page ends up carrying a refusal it never suffered.
  const persisted_ = new Map<string, string>(); // what the STORE answered for this page, as its own word
  const file = (key: string, outcome: keyof typeof RANK, providerAttempted = true, why?: string): void => { const at = filed.get(key); if (!at || RANK[outcome] > RANK[at.outcome]) filed.set(key, { providerAttempted: providerAttempted || (at?.providerAttempted ?? false), outcome, ...(why ? { why } : {}) }); };
  const outOfTime = (): boolean => opts.stopBy != null && Date.now() >= opts.stopBy; // checked at every paid door: work running is never abandoned, work not begun is not funded and reads `not_reached`, settling nothing
  /** THE COMPLETE PER-PAGE RECORD, and every field of it read off the surface that actually holds it (Codex, 2026-08-23): the funded row carries family, treatment, expected impact and the whole allowance; the money surface carries the logical operations, the requests that really left the process and the dollars they cost; the outcome ledger carries what settled it, the store's own answer and the reason IN FULL, never cut. A live receipt that named none of this was reported as complete because only a mocked producer was ever asked for one. */
  const receipt = () => ({ declared: budget.declared, funded: budget.funded.map((f) => f.key), attemptUnitsSpent: budget.spent().calls,
    declined: budget.declined.map((d) => ({ key: d.key, family: d.family, reason: d.reason })),
    evidenceOwed: [...evidenceOwed.entries()].map(([key, e]) => ({ key, ...e })), // WHAT TO GO AND GET, as data the runtime executes rather than a sentence it parses // WHAT THE PASS REFUSED TO BUY AND WHY, in the operator's words, DURABLE: a log line ages out and was cut at four
    receipts: budget.funded.map((f) => { const r = filed.get(f.key), m = budget.meterOf(f.key); return {
      key: f.key, funded: true, family: f.family, treatment: (f as { treatment?: string }).treatment ?? null, impact: Number(f.impact.toFixed(2)), allowance: f.calls, fallbacks: [...f.fallbacks],
      ops: m?.ops ?? 0, providerCalls: m?.providerCalls ?? 0, costUsd: m?.costUsd ?? 0, // ASKED MEANS A REQUEST LEFT THE PROCESS, off the meter and nothing else: derived from an allowance decrement it read `true` beside "0 calls, $0" on one line
      providerAttempted: (m?.providerCalls ?? 0) > 0, outcome: r?.outcome ?? "not_reached" as const, persistence: persisted_.get(f.key) ?? null,
      // NO FUNDED KEY ENDS SILENT (Codex, 2026-08-23), and nothing here is INFERRED. A reason recorded where it happened wins; where nobody recorded one, the sentence says only what the outcome itself proves. Guessing at a cause (a time box read at the end of the pass) put a plausible falsehood in front of the operator. NO RECEIPT INVENTS A CAUSE (Codex, 2026-08-23): "this pass ended before this page was reached" was printed for pages reached in two seconds and skipped through a branch that recorded nothing. Every funded exit files its own outcome now, so a row with nothing filed is a DEFECT IN THE PASS and says so.
      ...(r?.why ? { why: r.why } : r?.outcome === "produced" ? {} : { why: "no branch of this pass recorded what happened to this funded page, which is a fault in the pass rather than a fact about the page" }) }; }) });
  log.info("[produce-proposals] the paid plan for this pass, decided before it spent anything", { tenantId, declared: jobs.length,
    funded: budget.funded.map((f) => `${f.key} @${f.calls}`).slice(0, 8), refused: budget.declined.slice(0, 4).map((d) => `${d.key}: ${d.reason}`) });
  // THE FUNDED READING RUNS FIRST, and everything derived from the verdict is derived again after it. A key the plan never saw (a verdict this reading only just changed) simply goes unfunded and is picked up next pass, when the stored pattern is already on the verdict the plan is built from.
  if (patternKey) { const slice = outOfTime() ? null : budget.draw(patternKey, DRAFT_BUDGET.DELIVERABLE_CALLS);
    if (slice) { const was = slice.left; await readPattern(slice); file(patternKey, coverage?.decision.pattern ? "evidence_banked" : "retryable_blocked", slice.left < was, coverage?.decision.pattern ? "a reading of the pages that win this subject: evidence for the next decision, not a change anybody can make" : "the reading of the winning pages did not come back"); candidates = compile(); acted = candidates.filter((c) => c.action === "act_existing_page"); earned = candidatesToEvidenceInputs(snapshot, acted); inputs = earned.slice(0, bound);
      cappedOut = new Set(earned.slice(bound).flatMap((i) => [proposalId(i), ...pageKeys(i.page.url ?? "")])); deep = selectDeepCandidates({ candidates, coverage, limit: bound }); } }
  // A SEARCH NO PAGE OF THIS ACCOUNT IS FOR IS BANKED, NOT LOGGED: the coverage walk owns what happens next, on the NEXT pass, exactly as before.
  if (persist && extra.needsOwnPage.length > 0) await recordCoverageNeeds(tenantId, extra.needsOwnPage, opts.now ?? new Date()).catch(() => undefined);

  const recoverableByKey = new Map<string, number>(), readinessByKey = new Map<string, EvidenceReadiness>(), diagnosisByKey = new Map<string, ActionDiagnosis>();
  const causeByKey = new Map<string, CauseFinding>(); // the cause ladder's whole finding, indexed by page alone, not by query: one page gets one reading
  /** THE WINNING DIAGNOSIS FOR EVERY PAGE THIS PASS JUDGED, not only the ones that earned an action. The boundary below asks it of every card whatever producer minted it, so a lever that cannot treat what the evidence NAMED is never offered. */
  const judged = new Map<string, QualifiedCandidate>(); for (const c of candidates) for (const k of pageKeys(c.pageUrl)) judged.set(k, c);
  // A SPLIT IS A FAMILY'S DIAGNOSIS, NOT ONE PAGE'S. Every page the ladder named as competing carries it, or the sibling keeps its own "add a section here" card and goes on making the overlap worse.
  for (const c of candidates) if (c.cause.payload?.cause === "cannibalization") for (const u of c.cause.payload.competingPaths)
    for (const k of pageKeys(u)) if ((judged.get(k)?.cause.cause ?? "no_problem") === "no_problem") judged.set(k, c);
  for (const c of acted) { for (const k of pageKeys(c.pageUrl)) {
      recoverableByKey.set(k, c.recoverableClicks); causeByKey.set(k, c.cause);
      if (c.readiness && c.query) readinessByKey.set(`${k}::${canonicalQueryKey(c.query)}`, c.readiness); // Readiness is a fact about ONE page and ONE EXACT SEARCH, never about a page alone.
      if (c.diagnosis && c.query) diagnosisByKey.set(`${k}::${canonicalQueryKey(c.query)}`, c.diagnosis);
    } }
  /** Stamp the basis, the ranking scalar, the cause the ladder named, and confidence by evidence completeness, whichever producer built it. Never invents a figure. */
  const stamp = (p: ChangeProposal): ChangeProposal => { const key = (p.pageUrl ?? "").trim().toLowerCase(), pathKey = (p.pagePath ?? "").trim().toLowerCase();
    const recoverable = recoverableByKey.get(key) ?? recoverableByKey.get(pathKey);
    const qk = canonicalQueryKey(p.primaryQuery); // only the readiness measured for THIS proposal's own search may set its confidence
    const readiness = readinessByKey.get(`${key}::${qk}`) ?? readinessByKey.get(`${pathKey}::${qk}`); const finding = causeByKey.get(key) ?? causeByKey.get(pathKey);
    return { ...p, ...(basis ? { basis } : {}), workKey: declaredWorkKey.get(DRAFT_BUDGET.keyOf(p)) ?? workKeyOf(p),
      ...(finding && p.diagnosisCause == null ? { causeFinding: finding, diagnosisCause: finding.cause } : {}), // The ladder's own reasoning, carried rather than re-derived, and ONLY onto a proposal that brought none.
      impactScore: recoverable ?? p.impactScore,
      confidence: p.bundle ? p.confidence : readiness ? confidenceFor(readiness, diagnosisByKey.get(`${key}::${qk}`) ?? null) : p.confidence, // A BUNDLE KEEPS ITS OWN CONFIDENCE: it built its own receipt, so a coarser readiness never overwrites it.
    };
  };
  /** RECOVERY BEFORE DISCOVERY: a page that lost real clicks while its ranking held is worth what it LOST. The lost figure never lowers a proven one, and only a card that could actually win those clicks back may claim it: a duplicate heading or an engine follow-up on a page that shed 191 clicks was inheriting all 191 as its own worth and outranking the rewrite that might really recover them. A bundle qualifies outright (it rewrites the page); a single edit only in a family whose words a searcher reads. */
  const RECOVERS_A_FALL = new Set(["title", "h1", "answer_block", "thin_page", "missing_description"]); const lostByKey = new Map([...windows].flatMap(([url, w]) => pageKeys(url).map((k) => [k, w.lostClicks] as const)));
  const recovered = (p: ChangeProposal): ChangeProposal => { // AN ACCURACY DEFECT NEVER INHERITS A FALL: handed the page's lost clicks, a card about statements contradicting their own sources arrived claiming 192 clicks nothing tied it to (the merge of two separate truths the operator forbade, 2026-08-17). A cause that claims no clicks by construction is left alone.
    if ((p.causeFinding?.cause ?? p.diagnosisCause) === "factual_error") return p; if (!p.bundle && !RECOVERS_A_FALL.has(p.changeFamily)) return p; const lost = lostByKey.get((p.pageUrl ?? "").trim().toLowerCase()) ?? lostByKey.get((p.pagePath ?? "").trim().toLowerCase()) ?? 0;
    return lost > (p.impactScore ?? 0) ? { ...p, impactScore: lost, // THE NEW NUMBER SAYS WHERE IT CAME FROM, or the card's own sentence and the order disagree out loud.
      whyItMatters: `${p.whyItMatters} This page also lost ${lost.toLocaleString("en-US")} clicks against the four weeks before, and that fall is what it is ranked on here.` } : p;
  };
  const held = [...existing.values()].filter((p) => p.status !== "implemented_pending_verification");
  /** A stored row generated under THIS basis. A null basis proves nothing, so it reuses nothing. */
  const current = (p: ChangeProposal): boolean => basis != null && p.basis === basis; const currentById = (id: string): ChangeProposal | null => { const p = existing.get(id); return p && p.status !== "implemented_pending_verification" && current(p) ? p : null; };
  const currentBundleFor = (match: (p: ChangeProposal) => boolean): ChangeProposal | null => live.find((p) => !!p.bundle && current(p) && match(p)) ?? null;
  /** THE AUDIENCE BEHIND A CARD, as a real field off this account's own rows and never read back out of a sentence. A defect card carries no recoverable click figure, so without this the order collapsed onto how long the work takes. Only stamped where the row brought none. */
  const byPage = new Map<string, number>(); for (const o of snapshot.ownedPages) if (o.search) for (const k of pageKeys(o.url)) byPage.set(k, o.search.impressions90d);
  const sized = (p: ChangeProposal): ChangeProposal => p.demandImpressions90d != null ? p : { ...p,
    demandImpressions90d: byPage.get((p.pageUrl ?? "").trim().toLowerCase()) ?? byPage.get((p.pagePath ?? "").trim().toLowerCase()) ?? null };
  /** WHAT THIS PASS LEARNED ABOUT ONE PAGE, keyed by its address: the door a drafted change came through, and the reads a signal asked for rather than turned into a card. THE RUN RECEIPT SAYS BOTH. */
  const enteredBy = new Map<string, string>();
  /** WHAT A DEEP READ THAT REACHED A PAGE AND WROTE NOTHING SAID: its one missing read and the levers it weighed. The research card speaks these words, so an arriving results page can never take the card away. */
  const blocked = new Map<string, { reason: string; considered?: readonly { option: string; reason: string }[] }>();
  const runReceipt = (): QualifiedCandidate[] => enteredBy.size === 0 ? candidates : candidates.map((c) => {
      // Every spelling the setter could have used: the raw address, its lowercase, and its bare path. One note (the page-not-Google divergence) was keyed off a canonicalized search key and never found again.
      const entry = pageKeys(c.pageUrl).map((k) => enteredBy.get(k)).find(Boolean) ?? enteredBy.get(c.pageUrl ?? "");
      return entry ? { ...c, reason: `${c.reason} ${entry}` } : c;
    });
  const retired = new Set<string>(); const retire = async (p: ChangeProposal, why: string): Promise<void> => { if (persist) await withdrawChangeProposal(p, why); existing.delete(p.id); retired.add(p.id); };
  for (const p of held) { if (!p.bundle || actionableProposalFailures(p, { tenantId: p.tenantId, currentBasis: p.basis ?? null, now: opts.now }).length === 0) continue;
    await retire(p, "retired: this bundle no longer passes the bar a change must clear to be offered"); }
  const live = held.filter((p) => !retired.has(p.id));
  let persisted = 0, writeFailures = 0, reused = 0, heldForMeasurement = candidates.filter((c) => c.cause.cause === "measuring_change").length; // A HOLD HAPPENS WHERE THE DECISION IS MADE, NOT WHERE THE ROW IS WRITTEN
  /** Persist ONE material row, or nothing when the stored row already says exactly this. THE RANKING ON FILE SURVIVES A RE-STAMP: a producer mints its card before the pass has ranked anything, so dropping the stored receipt would make every pass rewrite every row twice and count it as new work each time. */
  const persistIfChanged = async (input0: ChangeProposal): Promise<"saved" | "unchanged" | "refused" | "blocked" | "failed" | "not_persisted"> => { if (!persist) return "not_persisted";
    const input: ChangeProposal = input0.workKey ? input0 : { ...input0, workKey: declaredWorkKey.get(DRAFT_BUDGET.keyOf(input0)) ?? workKeyOf(input0) }; // IDENTITY IS STAMPED AT THE ONE DOOR so no caller can forget it: the editor path saved raw rows carrying a basis and nothing else, which is why all twenty-five live rows held a null workKey
    // THE "NOT YET" NOTE GOES ON BEFORE THE ROW IS WRITTEN, never after it. Added once the row was already stored, the next pass re-minted the card WITHOUT the note, saved it because it differed from the stored one, then appended the note and saved again: two writes a pass, for ever, on a card nobody had touched. A refresh re-pays nothing only if it also re-writes nothing.
    const note = input.researchOnly === true && !input.bundle ? pageKeys(input.pageUrl).map((k) => blocked.get(k)).find(Boolean) : null; const notYet = note ? `Not yet, because ${note.reason}` : "";
    const raw: ChangeProposal = note && !(input.operatorSteps ?? []).includes(note.reason) && !(input.limitations ?? []).includes(notYet)
      ? { ...input, limitations: [...(input.limitations ?? []), notYet], evidence: { ...input.evidence, hints: [...input.evidence.hints, note.reason], evidenceRefCount: input.evidence.evidenceRefCount + 1 } } : input;
    // A PASS THAT DID NOT REACH A CARD MAY NOT UNDO IT: banked copy survives a brief re-minted on the same page, the same diagnosis, the same evidence and the same lever. THE PAGE AS THIS PASS READ IT rides on the row (its four stored fields, off the snapshot the pass already holds, so this costs no read), so words written for a page since re-crawled into a different shape are retired rather than served, and a page nothing is held for stamps nothing and is decided on everything else.
    const own = snapshot.ownedPages.find((x) => pageKeys(x.url).some((k) => pageKeys(raw.pageUrl ?? raw.pagePath).includes(k))); const held = own?.content ?? null;
    // The words this page is PAID for right now, off the same rows the drafter's own gate reads, so banked copy answers to today's earning list and not the one that stood when it was written.
    const preserve = [...(own?.search?.topQueries ?? [])].filter((q) => q.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, 10).map((q) => q.query);
    // BANKED COPY IS RE-READ AGAINST EVERY DETERMINISTIC RULE THAT STANDS TODAY, because banking skips the drafter and every gate: a closing line telling the reader to read the page, a figure that walked away from its own qualifier, and support that was reworded underneath the words all outlived the rules that refuse them. The closing line is TRIMMED where the field still fills without it, and then the ONE re-read decides: any reason at all and the copy is not preserved, so the card goes back through the normal drafting path rather than being served on. $0, no fresh read, no re-judging. A RESEARCH CARD CARRIES NO FINISHED COPY, so it is never put through the banked-copy gate: its `after` is the SENTENCE SAYING WHAT IS STILL OWED, and reading that as words to preserve failed the gate every pass, dropped the stored row out of sight, and rewrote a settled card twice on every refresh. A TREATMENT CHANGE IS A DELIVERABLE IDENTITY BOUNDARY (Codex, 2026-08-23). Copy is valid only for the treatment that produced it: live, /cities was re-diagnosed technical_reachability ("copy is premature") while its OLD section draft sat beside that verdict as actionable review work. A non-writing incoming treatment RETIRES the stored deliverable with its receipt (previousCopy keeps the words and the reason) and the opportunity persists as the research card it now is. The evidence loses nothing; the contradiction dies.
    const NON_WRITING = new Set(["technical_reachability", "consolidate_or_differentiate", "new_page"]);
    const held0 = existing.get(raw.id), treatmentSwap = held0 != null && NON_WRITING.has(raw.treatment ?? "") && held0.researchOnly !== true
      && held0.recommendedChange.kind === "existing_edit" && held0.recommendedChange.after.trim().length > 0;
    const copy0 = held0 && !treatmentSwap && !held0.bundle && held0.researchOnly !== true && held0.recommendedChange.kind === "existing_edit" ? held0.recommendedChange : null;
    const clean = copy0 ? withoutCta(copy0.after, copy0.field) : null, trimmed = !copy0 ? held0 : clean == null ? null : clean === copy0.after ? held0 : { ...held0!, recommendedChange: { ...copy0, after: clean } };
    const why = trimmed ? staleCopyReasons(trimmed, NO_BODIES, bannedTerms, held, false, preserve) : []; if (why.length > 0) log.info("[produce-proposals] banked copy no longer passes the rules that stand today, so it is not preserved", { tenantId, id: raw.id, reasons: why.slice(0, 3) }); const soft = why.length > 0 && why.every((w) => !DRAFT_BUDGET.HARD_REFUSAL.test(w)); // FINISHED COPY SURVIVES A SOFT RULE (Codex, 2026-08-23): the live /funny-farsi-phrases answer was saved Ready and destroyed back to its own brief ONE SECOND LATER over the word "Farsi", because a re-read applied the ban without the searcher-vocabulary exemption the editor honoured. A soft disagreement DOWNGRADES finished work to a review draft carrying the reason; only the four hard classes still null it.
    const prior = treatmentSwap ? null : why.length === 0 || soft ? trimmed : null; // a SOFT failure hands preservation the FINISHED row: pre-downgrading it read as unfinished and the brief won anyway // a treatment swap forfeits preservation outright: the old copy is retired above, with its receipt
    // FINISHED COPY RETIRED BY TODAY'S RULES STILL LEAVES ITS RECEIPT (review, 2026-08-22): nulling the prior took the words out of preferFinished's sight entirely, so the one loss path a rule change opens was the one
    const retired = treatmentSwap
      ? { previousCopy: { after: held0!.recommendedChange.kind === "existing_edit" ? held0!.recommendedChange.after : "", retiredBecause: `the diagnosis changed to ${raw.treatment}: copy for this page is premature until that work is done`, at: (opts.now ?? new Date()).toISOString() } }
      : why.length > 0 && !soft && trimmed && !trimmed.researchOnly && trimmed.recommendedChange.kind === "existing_edit" && trimmed.recommendedChange.after.trim() // loss path with no history. The receipt rides the incoming row before preservation runs.
        ? { previousCopy: { after: trimmed.recommendedChange.after, retiredBecause: why[0]!, at: (opts.now ?? new Date()).toISOString() } } : {};
    const carried = preferFinished({ ...sized(raw), ...retired, ...(held ? { copyStamp: `${held.title ?? ""}|${held.h1 ?? ""}|${held.metaDescription ?? ""}|${(held.outline ?? []).join(">")}`.slice(0, 400) } : {}) }, prior);
    // THE DOWNGRADE LANDS AFTER PRESERVATION (Codex, 2026-08-23): finished words surviving a soft re-read failure move to review with the reason on the card, so nothing soft ships unread and nothing soft destroys work.
    const carried2 = soft && trimmed && carried.recommendedChange.kind === "existing_edit" && trimmed.recommendedChange.kind === "existing_edit" && carried.recommendedChange.after === trimmed.recommendedChange.after
      ? { ...carried, status: "needs_review" as const, limitations: [...new Set([...carried.limitations, ...why.slice(0, 2)])] } : carried;
    const ranked: ChangeProposal = !carried2.rankingReceipt && prior?.rankingReceipt ? { ...carried2, rankingReceipt: prior.rankingReceipt, ...(prior.whyRankedAboveNext ? { whyRankedAboveNext: prior.whyRankedAboveNext } : {}) } : carried2;
    // READY MEANS THE CHANGE TREATS THE CAUSE ITS OWN EVIDENCE NAMED. Four producers mint `ready`, each off its own drafting, and not one asked whether the lever fits the diagnosis: the ranking was discounting 25 points for exactly that mismatch on the very card it left in the paste-ready lane. Asked ONCE, here, where every producer's row and every reused row passes on its way to the store.
    const unfit = ranked.status === "ready" ? unsettledCause(ranked) ?? openHold(ranked).blocking : null; // the reason rides the ROW, not a log: the operator reads why it is held where they read the change. AND WORK NOBODY CAN RE-PLACE IS NOT READY EITHER, WITHOUT BEING DESTROYED FOR IT: banked body copy is served on without the page's own words in hand, so an anchor no banked fact carries can no longer be checked, and the words, the claims and the evidence are kept exactly as banked while the row goes back to review carrying the sentence that says why (decision/completeness's `openHold`)
    const p: ChangeProposal = unfit ? { ...ranked, status: "needs_review", limitations: [...new Set([...ranked.limitations, unfit])] } : ranked;
    const result = await saveChangeProposal(p);
    if (result === "failed") writeFailures += 1; else if (result === "saved") persisted += 1; else if (result === "blocked") heldForMeasurement += 1; // "unchanged" wrote nothing, so it counts as nothing
    // ONLY WHAT LANDED IS REMEMBERED. A row the store refused or could not take is not on file, and holding it in the pass's own map made every later reader believe it was: the reuse check, the ranking write-back and the receipt below all read this map (Codex, 2026-08-22).
    if (result === "saved" || result === "unchanged") existing.set(p.id, p);
    return result; };
  /** THE RECEIPT IS BOUND TO THE SAVE, never to the drafting. Work that was written and then could not be stored is not finished work: it is owed again. Filing `produced` before the store answered meant a pass where one save landed and another failed wrote BOTH pages off, and the second was never offered again that day. */
  const persistAndFile = async (row: ChangeProposal, key: string): Promise<void> => { const r = await persistIfChanged(row); // a store that REFUSED the row settled it; one that FAILED or HELD it settled nothing
    persisted_.set(key, r); // the STORE'S OWN ANSWER, on the receipt: "produced" is a claim, "saved" is what happened
    // AND WHAT LANDED IS RE-READ FROM THE MAP THE STORE ANSWERED INTO (Codex, 2026-08-23): a live pass filed `produced` with the store answering "saved" while the stored row still carried its brief, so the one number the operator reads never moved. Finished work is a row that is ready, is not research, and carries words. A DRAFT A HUMAN STILL HAS TO READ IS ITS OWN ANSWER (Codex, 2026-08-23): it SETTLES the attempt, because the writing happened and asking again buys the same draft, and it is NEVER counted as Ready work.
    const landed = existing.get(row.id); if (landed && (landed.researchOnly === true || landed.status !== "ready")) {
      file(key, "review_saved", true, `this work was written and stored for review, and the row on file is ${landed.researchOnly === true ? "research" : landed.status}, so nothing finished reached the queue`); return; }
    file(key, r === "saved" || r === "unchanged" || r === "not_persisted" ? "produced" : r === "refused" ? "deterministic_refusal" : "retryable_blocked", true,
      r === "refused" ? "the store refused this row: it does not pass the bar a change must clear to be offered" : r === "failed" ? "the store could not save this row" : undefined); };
  /** What the card builders in decision/authorization need to name a page and stamp a row. */
  const wiring = () => ({ tenantId, now: opts.now ?? new Date(), basis: basis ?? null, pages: snapshot.ownedPages });
  /** THE SPLITS THIS PASS ACTUALLY SETTLES, one card per group, strongest first. Computed BEFORE the boundary runs, because a page may only be refused a card for a split that some card here settles. */
  const ownership = ownershipCards({ ...wiring(), judged: candidates, queryKeyOf: canonicalQueryKey });
  /** THE AUTHORIZATION BOUNDARY, asked of every card an independent producer mints. A change whose lever cannot treat the winning diagnosis for its OWN page is not offered: adding copy to one of two pages splitting a search leaves them splitting it, and the ranking picking the biggest number is exactly how that card led. It is withheld with its reason on the run receipt and any row on file for it is taken back. A page with no material diagnosis authorizes everything, byte for byte as before. A BUNDLE IS NOT ASKED: it is produced BY the ladder and refuses itself when the producer does not match the cause. */
  const admit = async (p: ChangeProposal): Promise<boolean> => { const key = (p.pageUrl ?? "").trim().toLowerCase(), path = (p.pagePath ?? "").trim().toLowerCase(), cause = (judged.get(key) ?? judged.get(path))?.cause.cause;
    if (cause === "cannibalization" && !ownership.covered.has(key) && !ownership.covered.has(path)) return true; // NO CARD, NO REFUSAL: a split this pass does not settle may not silence the page it names.
    const no = withholdReason(p, cause); if (!no) return true;
    extraHeld.push({ pageUrl: p.pageUrl ?? p.pagePath ?? "", reason: no });
    const stored = existing.get(p.id); if (stored && persist) { await withdrawChangeProposal(stored, no).catch(() => false); existing.delete(p.id); }
    return false; }; /** RANK, THEN WRITE THE ORDER BACK. Every card was written before the pass had ranked it, so the stored rows carried a null ranking receipt and nothing on file could say why a card sat where it sat. Written back ONLY where the order actually moved, so a settled queue still writes nothing, and never at all on a pass whose writes were already failing: a store that would not take the row will not take its order either. */
  const rankAndStamp = async (rows: readonly ChangeProposal[]): Promise<ChangeProposal[]> => {
    const ranked = rankProposals(rows.map((p) => existing.get(p.id) ?? p).map(recovered).map(sized), { ...measuring, familyHistory }); // WHAT WAS PERSISTED IS WHAT GETS RANKED, or a card whose banked copy was kept above would rank as a brief the store no longer holds.
    if (!persist || writeFailures > 0) return ranked;
    for (const p of ranked) {
      const stored = existing.get(p.id);
      // THE NUMBER ON THE CARD IS PART OF THE ORDER, not decoration under it. This compared the ranker's SCORE alone, so a page whose fall was newly measured kept its old impact figure on file: the queue ranked it on 191 recovered clicks and the card it opened still said the old number.
      if (stored && stored.rankingReceipt?.score === p.rankingReceipt?.score
        && (stored.impactScore ?? null) === (p.impactScore ?? null)
        && (stored.whyRankedAboveNext ?? null) === (p.whyRankedAboveNext ?? null)) continue;
      if (await saveChangeProposal(p).catch(() => "failed" as const) === "saved") existing.set(p.id, p);
    }
    return ranked;
  };
  const proposals: ChangeProposal[] = []; for (const card of ownership.cards) { proposals.push(card); await persistIfChanged(card); } // suggested-edits reads every page's search evidence, so it may only claim to have rewritten its families when that evidence was whole. Empty is not fresh: no rows read is not every page judged.
  const gscComplete = snapshot.sources.some((s) => s.source === "gsc" && s.status === "fresh");  /** THE GENEROUS HALF OF THE QUEUE: every concrete edit the held evidence supports, at needs_review. */
  const withSuggestions = async (strict: ChangeProposal[]): Promise<ProducerRun> => {
    const skip = new Set([...strict.flatMap((p) => [p.id, (p.pagePath ?? "").trim().toLowerCase()]), ...withdrawn]);
    for (const s of suggestedEdits(snapshot, candidates, { now: opts.now ?? new Date(), basis, skip, windows, needs: enteredBy, curve })) {
      if (existing.get(s.id)?.status === "implemented_pending_verification") { heldForMeasurement += 1; continue; }
      if (!await admit(s)) continue;
      strict.push(s); await persistIfChanged(s); }
    return { families: SUGGESTED_FAMILIES, complete: gscComplete };
  };
  /** A CARD THIS PASS DID NOT RE-EMIT IS ONE THE GENERATOR NO LONGER STANDS BEHIND, so it is taken back. Serving it beside the card that replaced it is how a query-pasted title outlived its own fix. Only untouched needs_review rows in the families a producer that FINISHED rewrites IN FULL qualify: anything the operator acted on, every bundle, and every family nobody finished, all stay. */
  // THE PAGES THE BUNDLE DOOR ACTUALLY WALKED THIS PASS. Exempt from every sweep, two refuted "settle which page owns this search" rows outlived their evidence and their page-level suppression hid the real card (operator, 2026-08-17). A bundle may be swept, but ONLY on a page this pass genuinely re-walked: silence about a page nobody looked at proves nothing.
  const doorWalked = new Set<string>();
  const sweepStale = async (runs: readonly ProducerRun[]): Promise<void> => {
    if (!persist) return;
    const families = runs.filter((r) => r.complete).flatMap((r) => [...r.families]);
    if (families.length === 0) return void log.warn("[produce-proposals] no producer finished, so no card is taken back", { tenantId });
    const pattern = new RegExp(`::existing_edit::(${families.join("|")})$`), ids = new Set(proposals.map((p) => p.id));
    // THE CAP SHIELD COVERS PAID WORK ONLY. The $0 producers walk EVERY page EVERY pass, so their silence past the paid bound is a real withdrawal; shielding it kept thirty-five stale titles alive for days (operator, 2026-08-17: the cheetah card).
    const zeroDollar = new RegExp(`::existing_edit::(${[...SUGGESTED_FAMILIES, ...EXTRA_FAMILIES, "demand_recovery", "factual_correction"].join("|")})$`);
    let taken = 0;
    for (const [id, row] of existing) {
      if (ids.has(id) || (!zeroDollar.test(id) && (cappedOut.has(id) || cappedOut.has((row.pagePath ?? "").trim().toLowerCase())))) continue; if (row.status !== "needs_review" || !pattern.test(id)) continue;
      if (row.bundle && !doorWalked.has((row.pagePath ?? "").trim().toLowerCase()) && !doorWalked.has((row.pageUrl ?? "").trim().toLowerCase())) continue;
      if (await withdrawChangeProposal(row, "swept: the producer that owns this family rewrote it and did not re-emit this card").catch(() => false)) taken += 1;
    }
    if (taken > 0) log.info("[produce-proposals] stale cards withdrawn", { tenantId, taken, families });
  };
  const decided = coverage; // A SUBJECT THIS ACCOUNT HAS NO PAGE FOR: an EARNED create_new verdict is the only road to one.
  if (decided && earnedNewPage(decided.decision)) {
    const heldPage = heldNewPage ?? live.find((r) => r.kind === "new_page" && current(r) && [decided.investigation.key, ...decided.investigation.aliasKeys].some((k) => r.id.includes(`::${k}::`))) ?? null; // An id this case ABSORBED still names this case's page, or a merge builds a second page for one subject.
    if (heldPage) { proposals.push(heldPage); reused += 1; }
    else {
      const slot = outOfTime() ? null : budget.draw(`topic:${decided.investigation.key}`, DRAFT_BUDGET.BUNDLE_CALLS); // THE WHOLE PAGE IS A TWELVE-CALL PROPOSAL and the plan above ranked it as one, against everything else this pass could have bought instead.
      const built = slot ? await buildNewPageProposal(decided, tenantId, { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache, attempts: slot }).catch((e) => ({ status: "none" as const, reason: e instanceof Error ? e.message : String(e) }))
        : { status: "none" as const, reason: "the pass's paid plan funded stronger work than a whole new page" };
      if (built.status === "built") { const page = { ...built.proposal, ...(basis ? { basis } : {}) }; proposals.push(page); await persistAndFile(page, `topic:${decided.investigation.key}`); }
      else { if (slot) file(`topic:${decided.investigation.key}`, "retryable_blocked"); log.info("[produce-proposals] no new page this pass", { tenantId, reason: built.reason }); }
    }
  }
  const investigating = candidates.filter((c) => c.action === "research_needed").length, consolidating = candidates.filter((c) => c.action === "consolidate").length; // A CONSOLIDATION IS WORK, NOT SILENCE: a split nothing can draft yet is counted, not passed over
  for (const c of factual.cards) {
    if (measuringPagesEarly.has((c.pagePath ?? "").trim().toLowerCase()) || !(await admit(c))) continue;
    // BEACON REVIEWS ITS OWN CORRECTIONS, ON THE PLAN'S OWN TERMS: the review was priced and ranked with everything else, so it can no longer spend in front of higher-ranked completable work, and an unfunded review leaves the card exactly as minted rather than promoting anything nobody read.
    const slot = outOfTime() ? null : budget.draw(DRAFT_BUDGET.keyOf(c), DRAFT_BUDGET.DELIVERABLE_CALLS * Math.max(1, Math.ceil((c.bundle?.components.length ?? 1) / 10)));
    const card = slot ? await defects.FACTUAL_DEFECTS.review(c, { tenantId, now: opts.now ?? new Date(), attempts: slot,
      ...(opts.complete ? { complete: opts.complete } : {}), ...(opts.bypassCache ? { bypassCache: true } : {}) }).catch(() => c) : c;
    const p = { ...card, ...(basis ? { basis } : {}) }; if (slot && card === c) file(DRAFT_BUDGET.keyOf(c), "retryable_blocked");
    if (!proposals.some((x) => x.id === p.id)) { proposals.push(p); if (slot && card !== c) await persistAndFile(p, DRAFT_BUDGET.keyOf(c)); else await persistIfChanged(p); }
  }
  // A HOLD LIFTED BY A RULE CHANGE REACHES EVERY ROW IT WRONGLY HELD, not only the pages a later pass happens to work. Three finished answers sat in Review on the live account over a parser that read "with mammals of Iran" and "symbolizing royal authority" as things a page offers. The parser was corrected, and the answers stayed unreachable: a soft hold is stamped ON the row, the row is only ever re-read when its page comes back up, and the day's manifest had already spent on those pages. Every held row is re-read here instead, against the same page, the same account vocabulary and the same earning words the per-page path uses, and a row that nothing finds fault with today is released. The gate speaks in lowercase and the writer's own caveats do not, so the dead rule's receipt leaves and the reader's caveats stay. Nothing is promoted past its own cause: the fitness check re-asks, and a row it still blocks is left exactly where it is.
  if (persist) for (const row of [...existing.values()]) {
    const gateLines = row.limitations.filter((l) => /^[a-z]/.test(l)), held = row.status === "needs_review" && gateLines.length > 0;
    if ((!held && row.status !== "ready") || row.researchOnly === true || row.bundle || row.recommendedChange.kind !== "existing_edit" || !row.recommendedChange.after.trim()) continue;
    const on = snapshot.ownedPages.find((x) => pageKeys(x.url).some((k) => pageKeys(row.pageUrl ?? row.pagePath).includes(k)));
    const kept = [...(on?.search?.topQueries ?? [])].filter((q) => q.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, 10).map((q) => q.query);
    // READ AS THE PER-PAGE PATH READS, not strictly. A row carrying no claims and no support facts comes back "nothing wrong", so copy with no record of what it stands on is exempt from every rule there is, and the emptier a row is the safer it looks. Reading it strictly here HOLDS BACK EVERY DETERMINISTIC EDIT: a title or description written without a model carries no claims by construction, and the sweep would empty the queue of exactly the work that needs no evidence. The hole is real and it is not this sweep's to close.
    const why2 = staleCopyReasons(row, NO_BODIES, bannedTerms, on?.content ?? null, false, kept);
    // THE SAME RE-READ ANSWERS BOTH WAYS, and it has to, or the queue only ever ratchets open. A rule added today reaches finished rows exactly as a rule withdrawn today does: the row moves to review carrying the reason, and it keeps every word, because holding work back is not the same as destroying it and no sweep may destroy.
    const moved: ChangeProposal | null = why2.length > 0
      ? row.status === "ready" ? { ...row, status: "needs_review", limitations: [...new Set([...row.limitations, ...why2.slice(0, 2)])] } : null
      // A RULE WITHDRAWAL NAMES ITS OWN RECEIPT, and releases nothing else. Releasing every row a re-read no longer objects to sounds symmetrical and is not: the re-read here is WEAKER than the gate set that wrote the hold, because a stored row has no deliverable to re-check, so a row held by any of the drafting gates this reader cannot run would be promoted and its reason deleted. The hold this pass is entitled to lift is the one whose rule was taken out, by the exact words that rule wrote. Anything else keeps its hold and waits for a redraft, which is what actually replaces bad copy. The hold is also read BEFORE its words come off: stripping first let the fitness check read a row the hold had already been erased from.
      : held && gateLines.every((l) => WITHDRAWN_HOLD.test(l)) && !(unsettledCause(row) ?? openHold(row).blocking)
        ? { ...row, status: "ready", limitations: row.limitations.filter((l) => !/^[a-z]/.test(l)) } : null;
    if (!moved || (moved.status === "ready" && (unsettledCause(moved) ?? openHold(moved).blocking))) continue;
    if (await saveChangeProposal(moved) === "saved") { existing.set(moved.id, moved); released += 1;
      log.info("[produce-proposals] row re-read against the rules that stand today", { tenantId, id: moved.id, now: moved.status }); } }
  if (quietDay) {
    log.info("[produce-proposals] nothing earned an action this pass", { tenantId, judged: candidates.length, watching: candidates.filter((c) => c.action === "watch").length + consolidating, researching: investigating });
    for (const c of extra.cards) { // A QUIET DAY STILL JUDGES THE AI CASES: returning before the $0 queue left the case file empty forever on a paused quiet account (first canonical $0 acceptance run, 2026-08-21).
      if (measuringPagesEarly.has((c.pagePath ?? "").trim().toLowerCase()) || !(await admit(c))) continue;
      const p = { ...c, ...(basis ? { basis } : {}) };
      if (!proposals.some((x) => x.id === p.id)) { proposals.push(p); await persistIfChanged(p); }
    }
    await sweepStale([await withSuggestions(proposals), { families: ["factual_correction"], complete: factual.complete }, // A proven gap with no explanation yet is NOT a quiet day, and neither is one that cannot be drafted.
      { families: extra.families, complete: extra.families.length > 0 }]);
    return { proposals: await rankAndStamp(proposals), candidates: runReceipt(),
      outcome: proposals.length > 0 ? "proposals_persisted" : investigating > 0 ? "investigating"
        : consolidating > 0 ? "actionable_but_no_trusted_draft" : "no_actionable_candidate",
      actionable: consolidating, investigating, noDraft: 0, persisted, reused, heldForMeasurement, paid: receipt(), ...research() };
  }
  /** Every page a door selected, by both keys: a bundle for a page this pass did not select is dropped. */
  const selectedKeys = new Set(deep.flatMap((d) => pageKeys(d.pageUrl)));
  /** The deep bundle each selected page already holds under the current basis, keyed by that page. */
  const heldDeep = new Map<string, ChangeProposal>();
  for (const d of deep) {
    const keys = pageKeys(d.pageUrl);
    // SAME PAGE IS NOT SAME WORK (Codex, 2026-08-23). This matched ANY stored bundle on the address, so a forty-item factual-correction bundle satisfied a newly selected deep rewrite and a stale title-family bundle satisfied another job: the writer was never called, the allowance never drawn, and the receipt then reported "the pass ended before this page was reached" for a page reached in two seconds. Reuse has to be the SAME job, the diagnosis this pass funded the work for answered by a bundle minted for that same diagnosis; anything else is different work, funded and executed. EXACT WORK IDENTITY, NEVER A SHARED CAUSE (Codex, 2026-08-23). "Both are cannibalization" let an incomplete title bundle answer a newly selected rewrite: zero calls, no writer, and a receipt claiming produced for a page the queue could not see. Reuse needs the same page, evidence, family, treatment, cause and search, AND the stored row must be finished work rather than a draft awaiting review.
    const wantKey = declaredWorkKey.get(DRAFT_BUDGET.keyOf({ pageUrl: d.pageUrl })) ?? null, has = wantKey == null ? null : currentBundleFor((p) => p.kind === "existing_edit" && keys.includes((p.pagePath ?? "").trim().toLowerCase()) && p.workKey === wantKey && p.status === "ready" && p.researchOnly !== true);
    if (has) heldDeep.set(d.pageUrl, has);
  }
  const bundledNow = new Set<string>(), readNow = new Set(snapshot.ownedPages.flatMap((o) => pageKeys(o.url))); // bundledNow: pages whose whole-page rewrite LANDED this pass, so their one-field edits are replaced rather than bought as well // A CHANGE MAY NOT OUTLIVE ITS OWN EXPLANATION, and only about a page this pass ACTUALLY READ.
  const provenNow = new Set([...acted.flatMap((c) => pageKeys(c.pageUrl)), ...selectedKeys]);
  for (const p of live) {
    const key = (p.pagePath ?? "").trim().toLowerCase();
    if (!p.bundle || p.kind !== "existing_edit" || !current(p) || retired.has(p.id) || !readNow.has(key) || provenNow.has(key)) continue;
    await retire(p, "retired: this page was read again this pass and nothing on it earned a change");
  }
  if (decided) for (const p of live) { // AND THE PAGE NOBODY EARNED: only a pass that REACHED a verdict may retire one.
    if (p.kind !== "new_page" || !current(p) || retired.has(p.id)) continue;
    if (earnedNewPage(decided.decision) && [decided.investigation.key, ...decided.investigation.aliasKeys].some((k) => p.id.includes(`::${k}::`))) continue;
    await retire(p, "retired: this pass reached a verdict and no case still asks for this new page");
  }

  const bundleOpts = { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache, authoritativeSourceDomains: allowlist, technical, curve, bannedTerms }, // ONE bundle per SELECTED page, strongest door first. A bundle REPLACES its own shallow drafts.
    onThrow = (e: unknown): { status: "none"; reason: string; considered?: { option: string; reason: string }[]; requirement?: { kind: "serp" | "page_source" | "competitor_page" | "factual_source"; query: string; url?: string; reasonCode: string; resumeTreatment: string } } => { log.warn("[produce-proposals] bundle threw (fail-soft)", { tenantId, error: e instanceof Error ? e.message : String(e) }); return { status: "none", reason: "threw" }; };

  for (const d of deep) {
    // Every page THIS CASE IS ABOUT gets its own words read FIRST, because a stored bundle is re-read against them before it is served again.
    const bodyByUrl = await loadOwnedPageBodies(tenantId, [...new Set([d.pageUrl, ...d.evidence.competingUrls, ...pageKeys(d.pageUrl).map((k) => judged.get(k)?.cause.payload).flatMap((c) => c?.cause === "cannibalization" ? c.competingPaths : [])])]).catch(() => null);
    // A STORED BUNDLE IS RE-READ BEFORE IT IS SERVED AGAIN. Reuse skipped the drafter AND every gate, so a piece written before a gate existed outlived the gate that would have refused it. A piece a current gate refuses sends the whole bundle back through the producer THIS pass instead of being handed over one more time.
    const heldBundle = heldDeep.get(d.pageUrl) ?? null, stale = heldBundle ? staleCopyReasons(heldBundle, bodyByUrl ?? NO_BODIES, bannedTerms) : [];
    if (heldBundle && stale.length > 0) log.info("[produce-proposals] a stored bundle no longer passes its own gates, so it is drafted again", { tenantId, id: heldBundle.id, reasons: stale.slice(0, 3) });
    if (heldBundle && stale.length === 0) {
      if (!proposals.some((p) => p.id === heldBundle.id)) { const proposal = stamp(heldBundle); // A held bundle reaches the queue here, re-stamped.
        proposals.push(proposal); reused += 1; await persistIfChanged(proposal); }
      enteredBy.set(d.pageUrl, d.entry);
      file(DRAFT_BUDGET.keyOf({ pageUrl: d.pageUrl }), "produced", false, "the finished change already on file for this page is this exact work and still passes its own gates, so nothing was bought"); continue; }
    doorWalked.add((d.pageUrl ?? "").trim().toLowerCase()); // THE DOOR TRAVELS WITH THE PAGE, so a page an engine skipped is never explained in the click door's words.
    for (const k of pageKeys(d.pageUrl)) doorWalked.add(k.trim().toLowerCase());
    const slot = outOfTime() ? null : budget.draw(DRAFT_BUDGET.keyOf({ pageUrl: d.pageUrl }), DRAFT_BUDGET.BUNDLE_CALLS); // A DEEP BUNDLE IS A TWELVE-CALL PROPOSAL, ranked as one above against every cheaper change it would have starved.
    if (!slot) { file(DRAFT_BUDGET.keyOf({ pageUrl: d.pageUrl }), "retryable_blocked", false, outOfTime() ? "the drive's time box ended before this page was started" : "this page's allowance was already spent by another family on the same page"); continue; }
    const bundled = await produceBundleForSnapshot(snapshot, { ...bundleOpts, attempts: slot, onlyPageUrl: d.pageUrl, door: d,
      coverage, ...measuring, decline: pageKeys(d.pageUrl).map((k) => decline.get(k)).find(Boolean), ...(bodyByUrl ? { bodyByUrl } : {}) }).catch(onThrow);
    const covered = bundled.status === "bundled" ? (bundled.proposal.pageUrl ?? "").trim().toLowerCase() : ""; const path = bundled.status === "bundled" ? (bundled.proposal.pagePath ?? "").trim().toLowerCase() : "";
    // A BUNDLE THAT DID NOT LAND WRITES NOTHING OFF. AND THE PRODUCER ALREADY SAID WHAT IT NEEDS, IN DATA (Codex, 2026-08-23): reading it back out of the English refusal was the same defect twice, because "No results page for X is on file" matched no pattern the runtime knew and the one reading that finishes the account's strongest page was never fetched. English is display text; the requirement is the instruction.
    if (bundled.status !== "bundled" && bundled.requirement) { const k = DRAFT_BUDGET.keyOf({ pageUrl: d.pageUrl });
      evidenceOwed.set(k, { ...bundled.requirement, reason: bundled.reason, workKey: declaredWorkKey.get(k) ?? "" }); file(k, "evidence_required", true, bundled.reason); }
    else if (bundled.status !== "bundled") file(DRAFT_BUDGET.keyOf({ pageUrl: d.pageUrl }), "retryable_blocked", true, bundled.reason);
    if (bundled.status !== "bundled" || (!selectedKeys.has(covered) && !selectedKeys.has(path))) {
      log.info("[produce-proposals] no bundle this pass", { tenantId, page: d.pageUrl, door: d.door,
        reason: bundled.status === "bundled" ? "page no door selected" : bundled.reason });
      // THE REFUSAL BELONGS ON THE RECEIPT, beside the door the page came through, not only in a log. A REFUSAL IS NOT COPY, though: a split's own card is minted from the diagnosis above, in this file's own words, so an internal refusal string never reaches an operator and never churns a stored row.
      if (bundled.status !== "bundled") { enteredBy.set(d.pageUrl, `${d.entry} ${bundled.reason}`); for (const k of pageKeys(d.pageUrl)) blocked.set(k, { reason: bundled.reason, ...(bundled.considered?.length ? { considered: bundled.considered } : {}) }); }
      continue;
    }
    const page = bundled.proposal.pagePath;
    for (let i = proposals.length - 1; i >= 0; i--) if (proposals[i]!.kind === "existing_edit" && proposals[i]!.pagePath === page) proposals.splice(i, 1);
    const proposal = stamp(bundled.proposal); proposals.push(proposal);
    for (const k of pageKeys(d.pageUrl)) bundledNow.add(k); if (path) bundledNow.add(path);
    await persistAndFile(proposal, DRAFT_BUDGET.keyOf({ pageUrl: d.pageUrl })); enteredBy.set(d.pageUrl, d.entry);
  }

  // THE FIELD DRAFTS COME AFTER THE WHOLE-PAGE REWRITES, and for a page the deep door selected they are its FALLBACK rather than a second purchase: the page declared ONE allowance, the rewrite spends first, and a rewrite that did not land leaves what is left to the one-field edit. Drafting the field edit first and rewriting over it, which is how this ran, paid for the same page twice and threw one of the two away.
  let noDraft = 0;
  for (const input of inputs) {
    if (pageKeys(input.page.url ?? input.page.path).some((k) => bundledNow.has(k))) continue; // the rewrite landed, and it replaces this edit
    if (measuringNow({ pagePath: input.page.path, pageUrl: input.page.url ?? null })) { heldForMeasurement += 1; continue; } // ONE page may be funded through a live sibling family; that never licenses drafting for a page under measurement
    const settled = existing.get(proposalId(input)); // A refresh re-pays nothing, and SETTLED WORK IS NOT REDRAFTED.
    if (settled && settled.status === "implemented_pending_verification") { heldForMeasurement += 1; continue; } // An IMPLEMENTED row is a change under measurement, so the fresh idea for that page is HELD, not dropped.
    if (withdrawn.has(proposalId(input))) { const k = DRAFT_BUDGET.keyOf({ pagePath: input.page.path, pageUrl: input.page.url ?? null }); // work already taken back under this evidence is SETTLED, not blocked
      file(k, "deterministic_refusal", false, "this work was already taken back under this evidence, so it is not offered again"); continue; }
    const held = currentById(proposalId(input))
      ?? (input.opportunity.kind === "existing_edit"
        ? [...heldDeep.values()].find((b) => b.pagePath === input.page.path) ?? null : null);
    if (held) {
      if (!proposals.some((p) => p.id === held.id)) { const restamped = stamp(held); // Reuse skips the DRAFTER, never the judgment: a stored row is re-stamped against today's evidence.
        proposals.push(restamped); reused += 1; await persistIfChanged(restamped); }
      continue;
    }
    // ONE ALLOWANCE, WHICHEVER FAMILY IS SPENDING IT: this draws its own deliverable's price from the page's single allowance, so on a page the deep door selected it is the rewrite's FALLBACK on the rewrite's own remainder, never a second purchase.
    const slot = outOfTime() ? null : budget.draw(DRAFT_BUDGET.keyOf({ pagePath: input.page.path, pageUrl: input.page.url ?? null }), DRAFT_BUDGET.DELIVERABLE_CALLS);
    if (!slot || slot.left <= 0) { noDraft += 1; log.info("[produce-proposals] the pass's paid plan funded no allowance for this page", { tenantId, page: input.page.path }); continue; }
    const outcome = await proposeExistingPageChange(input, { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache, authoritativeSourceDomains: allowlist, attempts: slot }).catch((e) => {
      log.warn("[produce-proposals] propose threw (fail-soft)", { tenantId, id: input.opportunity.query, error: e instanceof Error ? e.message : String(e) });
      return { status: "no_draft" as const, reason: "threw", drafterStatus: "error" }; });
    // WHOSE FAILURE IT WAS, TYPED. `not_diagnosed` is Beacon's own evidence gate reading today's evidence and refusing, and a withdrawn draft is a safety gate refusing finished words: both are decided HERE, against what is on file, so they are terminal for this evidence. Everything else (the cap, an empty balance, a timeout, a provider that would not answer, an answer that would not validate) is somebody else being unable to answer, and it writes nothing off.
    if (outcome.status !== "ready") {
      const why = outcome.status === "no_draft" ? outcome.drafterStatus : "withdrawn";
      file(DRAFT_BUDGET.keyOf({ pagePath: input.page.path, pageUrl: input.page.url ?? null }), why === "withdrawn" || why === "not_diagnosed" ? "deterministic_refusal" : "retryable_blocked", why !== "budget_spent" && why !== "off", outcome.status === "no_draft" ? outcome.reason : "a safety gate rejected this draft, so it was never offered");
      noDraft += 1;
      if (outcome.status === "withdrawn" && persist) await withdrawChangeProposal(stamp(outcome.proposal), "refused: a safety gate rejected this draft, so it was never offered"); // A REFUSED DRAFT IS FILED, NOT FORGOTTEN: history is what stops the next pass paying to fail twice.
      continue;
    }
    const proposal = stamp(outcome.proposal); proposals.push(proposal);
    await persistAndFile(proposal, DRAFT_BUDGET.keyOf({ pagePath: input.page.path, pageUrl: input.page.url ?? null })); }
  const suggested = await withSuggestions(proposals);
  // THE COLLAPSE PRODUCER: the largest losses the account's own history can PROVE become cards before any defect sweep fills the queue; a failed history read sweeps nothing. The $0 queue rides its ONE entrance (producers/extra.extraQueuePass), which owns the unit load so both producers join the SAME audiences. THE BOUNDARY IS ASKED BEFORE THE MONEY IS SPENT: a card the diagnosis will not authorize, or that the store will refuse (a page under measurement rejects new drafts at save time), is not worth paying to write; drafting one anyway spent four charged calls a pass on copy that could never land. ONE PAGE, ONE DELIVERABLE THIS PASS. A page another family already produced a row for takes no second one-field card, and a page whose draft did NOT land still gets its cheaper card rather than nothing. This used to hold only by accident of ordering: the $0 queue ran after the drafters and skipped whatever pages already had a row on file. It runs before the pass spends anything now, so the rule says itself, over the same rows the store would have shown it.
  const coveredNow = new Set(proposals.filter((r) => r.status === "ready" && r.researchOnly !== true).flatMap((r) => [(r.pagePath ?? "").trim().toLowerCase(), (r.pageUrl ?? "").trim().toLowerCase()]).filter(Boolean)); // FINISHED work holds a page, not an unfinished card sitting on it
  const eligible: ChangeProposal[] = []; for (const c of editorCards) { const at = [(c.pagePath ?? "").trim().toLowerCase(), (c.pageUrl ?? "").trim().toLowerCase()]; // the SAME list the manifest priced, so nothing spends outside the one plan
    if (at.some((k) => measuringPagesEarly.has(k)) || !(await admit(c))) continue; // asked FIRST, so a card the diagnosis refuses is refused OUT LOUD with its reason on the receipt, rather than disappearing into the page-already-covered rule
    // MONEY COMMITTED TO A PAGE REACHES THAT PAGE (Codex, 2026-08-23). This dropped any page already carrying a row from another family, and both of the account's strongest candidates carry one: /persian-female-first-names a factual-correction card and /iran-flags/iran-islamic-republic-flag-history a title card, so at 557 and 312 recoverable clicks they were funded and then excluded before the writer ever saw them, coming back "not reached" with ZERO calls on four dispatches running while pages worth 87 and 57 spent. One card per page is the manifest's job and the manifest already decided: a FUNDED page is drafted, whatever else sits on it. A PAGE WAITING ON EVIDENCE IS NOT HANDED TO A GENERIC EDITOR (Codex, 2026-08-23): once the deep door reports it cannot read what happened to this page, seven calls rewriting the same contradicted copy buy the same refusal. A fallback must treat the SAME cause with evidence in hand; this one cannot.
    if (evidenceOwed.has(page(c))) { file(page(c), "evidence_required", false, evidenceOwed.get(page(c))!.reason); continue; }
    if (!at.some((k) => coveredNow.has(k))) eligible.push(c); }
  // The editor's own cards were priced and ranked on the ONE manifest above with everything else, so this is now only the order it WALKS them in: an unfunded card is refused by the plan, never by arriving late. IT ORDERS, IT DOES NOT STAMP. The ranker returns rows carrying a receipt, and letting that provisional one ride to the store made every pass write each card twice: once with the score as it stood before the pass finished, then again with the real one. The order is taken; the cards themselves go on untouched, and rankAndStamp below is the only thing that ever writes an order down.
  const byId = new Map(eligible.map((c) => [c.id, c] as const));
  // THE WRITER WALKS THE ORDER THE MONEY WAS COMMITTED IN (Codex, 2026-08-23). The manifest funds by expected site impact and this loop walked `rankProposals` instead, a different score, so a live pass funded /persian-female-first-names at 560 recoverable clicks and /iran-flags/iran-islamic-republic-flag-history at 317, then drafted a product page worth 0.04 until the time box closed and reported both of the others as never reached. Two rankings meant the strongest work could be funded and never be first. The funded order leads; anything unfunded keeps the ranker's own order behind it.
  const fundedRank = new Map(budget.funded.map((f, i) => [f.key, i])), atRank = (p: ChangeProposal): number => fundedRank.get(DRAFT_BUDGET.keyOf(p)) ?? Number.MAX_SAFE_INTEGER;
  const allowed = rankProposals(eligible.map(recovered).map(sized), { ...measuring, familyHistory }).map((p) => byId.get(p.id) ?? p).sort((a, b) => atRank(a) - atRank(b));
  const drafted = await applyDraftedCopy(allowed,{ tenantId, snapshot, unsettled: new Set<string>(), refusals: gateWords, note: (k, o, why) => file(k, o, true, why), ...(opts.stopBy != null ? { stopBy: opts.stopBy } : {}), now: opts.now ?? new Date(), complete: opts.complete, bypassCache: opts.bypassCache, bannedTerms, budget }).catch(() => allowed); // the account's own vocabulary AND the pass's ONE paid plan reach the editor
  // THE EDITOR REPORTS THROUGH ITS OWN CARDS: one that came back with finished words produced; one that did not was refused by whoever could not answer, and is offered again. A CARD THE PLAN NEVER FUNDED WAS NEVER TRIED: it reads `not_reached`, not `blocked`. Filing every unfinished editor card as blocked said the pass had attempted work it had not even paid for, which is the kind of receipt this repair exists to stop telling.
  for (const raw of drafted) { const p = { ...raw, ...(basis ? { basis } : {}) }, key = DRAFT_BUDGET.keyOf(p); proposals.push(p);
    if (p.researchOnly === false && p.status === "ready") await persistAndFile(p, key); else { if (budget.funded.some((f) => f.key === key)) file(key, "retryable_blocked"); await persistIfChanged(p); } } // Stamped with THIS pass's basis, or the actionable door refuses every one as drafted under an older bar.
  // A NON-WRITING DIAGNOSIS IS RESEARCH WORK, PERSISTED ON ANY DAY (Codex, 2026-08-23): the funding filter above keeps these cards out of the editor, and on an ordinary day nothing else saved them, so the diagnosis that retires premature copy was DISCARDED whenever the day was not quiet. They buy nothing and file nothing; they land as the research cards they are, and persistIfChanged retires any finished copy the changed treatment has made premature.
  if (!quietDay) for (const c of [...recovery.cards, ...extra.cards].filter((x) => needsDecisions.has(x.treatment ?? ""))) {
    const at = [(c.pagePath ?? "").trim().toLowerCase(), (c.pageUrl ?? "").trim().toLowerCase()], taken = new Set(proposals.flatMap((r) => [(r.pagePath ?? "").trim().toLowerCase(), (r.pageUrl ?? "").trim().toLowerCase()]).filter(Boolean));
    if (at.some((k) => measuringPagesEarly.has(k)) || !(await admit(c))) continue;
    const p = { ...c, ...(basis ? { basis } : {}) };
    if (!proposals.some((x) => x.id === p.id) && !at.some((k) => taken.has(k))) { proposals.push(p); await persistIfChanged(p); }
  }
  // THE ONE READ A DEEP PASS SAID IT NEEDED, ONTO THE CARD THAT ALREADY SPEAKS FOR THAT PAGE, because a card for a page whose work is not written yet is minted BEFORE that read runs. Only a research card, never a change with copy on it. A REFUSAL IS NOT AN INSTRUCTION, though: numbered under "Read this twice, then:" it read as the thing to go and do, which is the one thing it says nobody can do yet, so it lands as the "not yet" line under the card. A REFUSAL THAT RULES OUT AN ACTION IS THE MOST USEFUL THING ON THE CARD, and it is shown: the ownership card names which page the figures keep and never what settling it takes, so the producer's structural "no merge here, and here are the sections that rule it out" is the answer rather than a contradiction (2026-08-14, when suppressing it hid the truth and left the falsehood standing).
  for (let i = 0; i < proposals.length; i += 1) {
    const p = proposals[i]!, block = pageKeys(p.pageUrl).map((k) => blocked.get(k)).find(Boolean), notYet = block ? `Not yet, because ${block.reason}` : "";
    if (!block || p.bundle || p.researchOnly !== true || (p.operatorSteps ?? []).includes(block.reason) || (p.limitations ?? []).includes(notYet)) continue;
    // THE STORED ROW ALREADY CARRIES THE NOTE (persistIfChanged puts it on before the write), so this only brings the returned list into line with what was written. No second save: writing the same row twice a pass is how a settled queue reported itself as fresh work.
    proposals[i] = existing.get(p.id) ?? { ...p, limitations: [...(p.limitations ?? []), notYet], evidence: { ...p.evidence, hints: [...p.evidence.hints, block.reason], evidenceRefCount: p.evidence.evidenceRefCount + 1 } }; }
  // A PROVEN FALL WITH NO DRAFTING EVIDENCE IS STILL WORK: no door reaches it and no producer can write for it, so the loss was invisible. It gets the ONE card naming what is missing, ranked on what it LOST.
  for (const card of researchingCards({ ...wiring(), judged: candidates, queryKeyOf: canonicalQueryKey, blocked,
    serpQueryKeys: new Set(snapshot.research.serpEvidence.map((e) => canonicalQueryKey(e.query))),
    skip: new Set(proposals.flatMap((p) => [(p.pagePath ?? "").toLowerCase(), (p.pageUrl ?? "").toLowerCase()])) })) {
    proposals.push(card); await persistIfChanged(card);
  }
  const extraFamilies = extra.families ?? [...EXTRA_FAMILIES]; // EACH PRODUCER SWEEPS ITS OWN FAMILIES, per family: `extra.families` lists only the ones whose evidence answered in full, so gating them on extra.complete froze finished sweeps for a neighbour's outage.
  await sweepStale([suggested, { families: extraFamilies, complete: extraFamilies.length > 0 },
    { families: ["demand_recovery"], complete: recovery.complete },
    { families: ["factual_correction"], complete: factual.complete }, // A page whose corrected words are live checks out on the next run, so its card retires itself here.
    { families: ["ownership", "researching"], complete: gscComplete },
    { families: ["consolidation", "title-family", "section-family"], complete: doorWalked.size > 0 }]); // The door's own families, swept on the pages above and nowhere else.
  const outcome: ProducerOutcome = // The honest ending. A write that failed on EVERY attempt is a failure, not a quiet day.
    writeFailures > 0 && persisted === 0 ? "persistence_failed"
      : proposals.length > 0 ? "proposals_persisted"
        : acted.length + consolidating > 0 ? "actionable_but_no_trusted_draft"
          : investigating > 0 ? "investigating" : "no_actionable_candidate";
  // WHAT THIS PASS SPENT, OFF THE BUDGET OBJECTS THEMSELVES, so the receipt is arithmetic rather than a claim: attempts made against the pool, and page readings bought against theirs.
  log.info("[produce-proposals] paid work this pass", { tenantId, ...budget.spent(), callsUncommitted: Math.max(0, budget.calls.left), pageReadsMade: MAX_NEW_READS_PER_PASS - Math.max(0, pageReads.left), pageReadsLeft: Math.max(0, pageReads.left) });
  if (outcome !== "proposals_persisted") log.warn("[produce-proposals] pass produced no durable work", { tenantId, outcome, actionable: acted.length, noDraft, writeFailures });
  return { proposals: await rankAndStamp(proposals), candidates: runReceipt(), outcome,
    actionable: acted.length + consolidating, investigating, noDraft, persisted, reused, heldForMeasurement, paid: receipt(), ...research() };
}
