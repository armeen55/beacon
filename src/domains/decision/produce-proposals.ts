/** decision/produce-proposals: the ONE server path that turns a tenant's cached evidence into persisted ChangeProposals. loadEvidenceSnapshot ($0) -> compileCandidates (act / watch / do nothing) -> candidatesToEvidenceInputs (only what EARNED an action) -> the cold, gated, budgeted drafter plus the ONE validator -> saveChangeProposal. PAID DRAFTING IS BOUNDED to the strongest DEFAULT_MAX_DRAFTS pages. The deep read has FIVE doors (deep-candidates.ts) and each page carries the door it came through. Three halves reach the operator: the strict drafts, every concrete edit the held evidence supports (suggested-edits.ts) and the $0 extras (producers/extra.ts), the last two at needs_review. ONE EVIDENCE BASIS, ONE ROW: an unchanged fingerprint is never re-drafted and never re-inserted. A family this pass rewrites in full and did not re-emit is SWEPT, so a card the rules retired leaves the queue. Publishing stays MANUAL: this only proposes. server-only. */
import "server-only";
import { log } from "@/lib/logger";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { fitCurveForOwnedPages } from "@/domains/evidence/forecast/tenant-ctr-curve";
import { loadBusinessProfile } from "@/domains/account";
import { pagesUnderMeasurement, resolveCurrentBasis } from "./load-proposals";
import { candidatesToEvidenceInputs, compileCandidates, type QualifiedCandidate } from "./opportunities";
import type { CauseFinding } from "./diagnosis";
import { selectDeepCandidates } from "./deep-candidates";
import { produceBundleForSnapshot } from "./produce-bundle";
import { proposeExistingPageChange, type ProposeOptions } from "./propose";
import { loadChangeProposals, saveChangeProposal, withdrawChangeProposal, withdrawnProposalIds } from "./proposal-store";
import { actionableProposalFailures } from "./validate-proposal";
import { rankProposals } from "./rank-proposals";
import { ownershipCards, researchingCards, unsettledCause, withholdReason } from "./authorization";
import { confidenceFor, proposalId, type ActionDiagnosis, type ChangeProposal, type EvidenceReadiness } from "./contracts"; import { openHold, preferFinished } from "./completeness";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { loadOwnedPageBodies, type OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import { buildTopicInvestigations, type TopicInvestigation } from "@/domains/evidence/topic-investigation";
import { earnedNewPage, type IntersectionEvidence } from "./coverage-adjudication";
import { extractPageFacts, readWinningPattern } from "./winning-pattern";
import { readCoverage, recordCoverageNeeds, type DecidedTopic } from "./coverage-pass";
import { applyDraftedCopy, staleCopyReasons, withoutCta } from "./drafted-copy";
import { DRAFT_BUDGET } from "./draft-budget";
import { creditBreakerHeld } from "./llm/gateway";
import { MAX_NEW_READS_PER_PASS } from "./producers/page-job";
import { readInventory } from "@/domains/evidence/scanning/owned-pages-store";
import { readTechnicalFindings } from "./technical-findings";
import { buildNewPageProposal } from "./new-page";
import { suggestedEdits } from "./suggested-edits";

export type ProduceProposalsOptions = ProposeOptions & {
  /** A TEST SEAM ONLY: production reads the stored comparison out of the canonical evidence, and passing this skips that read. */
  intersection?: IntersectionEvidence;
  /** Hard cap on how many opportunities this pass drafts (budget guard). */ maxDrafts?: number;
  /** Pages a pass TODAY already spent on and got nothing from: declared on the manifest, never funded again, so the next pass walks DOWN the ranking rather than buying the same refusal twice. */ skipKeys?: readonly string[];
  /** WALL-CLOCK MOMENT THIS PASS MUST STOP STARTING PAID WORK (epoch ms). Not a cancel: work already in flight finishes and is filed. It exists because one deliverable is three charged calls and a reasoning call alone is floored at ninety seconds, so a caller that boxes the whole pass on a timer gets NO receipts at all and re-funds the same pages next time. Stopping cleanly means the pass returns what it learned. */ stopBy?: number; /** The pages still being measured, when the caller knows them: preferred over any derivation here. */ measuringPagePaths?: readonly string[]; /** Persist each landed proposal (default true). Tests pass false to stay pure. */ persist?: boolean; zeroSpend?: boolean; /** NOTHING IS BOUGHT ON THIS PASS, and a paused account drafts nothing whatever the caller asked for. Not a smaller budget: both paid pools are minted EMPTY and the caller runs the pass inside the fail-closed spend scope (lib/spend-scope), so the model door and the provider door refuse on their own however deeply they are reached. Bounding `maxDrafts` alone left the page-reading pool and the drafting attempt pool wide open, which is how a paused account went on paying (operator, 2026-08-19). NON-DESTRUCTIVE BY CONSTRUCTION: the deterministic families are still rewritten in full and only those are swept, banked copy outlives a brief re-minted over it, and no card is withdrawn for work this pass simply did not do. "Did not run" never means "rejected its previous work". */
};
/** How this pass ended. Only `persistence_failed` is a failure; `investigating` is the honest middle: proven gaps exist and what to change is not known yet, so they are VISIBLE rather than read as a quiet day. */
export type ProducerOutcome = "evidence_unreadable" | "no_actionable_candidate" | "investigating" | "actionable_but_no_trusted_draft" | "persistence_failed" | "proposals_persisted";

export type ProduceProposalsResult = {
  /** The ranked proposals this pass produced (may be empty and still a success). */ proposals: ChangeProposal[]; candidates: QualifiedCandidate[]; /** Which of the honest endings this pass reached. */ outcome: ProducerOutcome; /** Candidates that earned an action: a page to edit, plus every consolidation this kernel cannot draft yet. */ actionable: number; /** Proven gaps whose cause is not identified yet: real work, not silence. */ investigating: number; noDraft: number; persisted: number;
  /** Drafts the store REFUSED to file because that page already carries a change under measurement. */ heldForMeasurement: number; /** Proposals carried forward unchanged: no draft, no write, no dollars. */ reused: number; /** What has been investigated about each topic, over the SAME evidence this pass judged. Research only. */ investigations: TopicInvestigation[]; coverage: DecidedTopic | null;
  /** the earliest date any page this pass could not read may be tried again; null when nothing is waiting, which is what stops a surface saying "checking" */ waitingUntil: string | null;
  /** Cards a producer would have minted and HELD instead, each with the typed reason. Refused work is on the receipt, never a silent absence. */ held: { pageUrl: string; reason: string }[];
  /** THE PASS'S OWN RECEIPT, PER JOB. Every candidate the manifest saw, the ones it funded, and what actually BECAME of each funded one. The aggregate this replaces was a fiction: allowances are decremented BEFORE the gateway is called, so one charged-looking number made every funded page look attempted even when the first call came back out of quota and the rest were never reached (Codex, 2026-08-22). `attemptUnitsSpent` keeps its honest name: it is allowance consumed, and it is not a billing figure and not proof anybody was asked. */
  paid: { declared: readonly string[]; funded: readonly string[]; attemptUnitsSpent: number;
    receipts: readonly { key: string; funded: boolean; providerAttempted: boolean;
      /** `produced` = finished work exists for this key. `deterministic_refusal` = one of Beacon's OWN gates read the work against today's evidence and said no. `retryable_blocked` = nobody could answer for it (credit, cap, timeout, provider, unreadable) or the drafter's own answer was unusable. `not_reached` = funded and never got to. ONLY the first two may ever write a key off. */
      outcome: "produced" | "deterministic_refusal" | "retryable_blocked" | "not_reached"; /** The rule that refused it, in its own words. */ why?: string }[] };
};
/** Bounded drafting: the strongest few, never a queue. */ export const DEFAULT_MAX_DRAFTS = 5;
const MAX_INVENTORY = 200; const NO_BODIES = new Map<string, OwnedPageBody>(); // one bounded inventory page, never the whole site; no page words in hand is a skip, never a failure
/** The card families each $0 producer rewrites IN FULL every pass. A family outside its producer's list is somebody else's work and is never swept. `divergence` is listed with nothing writing it any more, and that is the point: it stays under its producer's sweep, so every diagnose-it-yourself card on file is retired the next time that producer finishes. */
const SUGGESTED_FAMILIES = ["title", "h1", "answer_block", "divergence"] as const;
const EXTRA_FAMILIES = ["ai_answer_gap", "engine_followup", "internal_link", "missing_description", "duplicate_heading", "thin_page"] as const;
/** WHAT A PRODUCER REWROTE, AND WHETHER IT FINISHED. The sweep used to infer both from the length of one producer's output. A producer that read nothing and a producer that found nothing hand back the same empty list and mean opposite things, and on the night the search read timed out that inference retired cards out from under the operator mid-edit. Completeness is STATED, never read off an output length. */
type ProducerRun = { families: readonly string[]; complete: boolean };
/** THE ONE PAGE A VERDICT DECIDED TO IMPROVE, as facts out of words this pass ALREADY holds. Null for `create_new`, and null when its own words are not held. */
function ownedFactsFor(snapshot: EvidenceSnapshot, decided: DecidedTopic): ReturnType<typeof extractPageFacts>[number] | null {
  if (decided.decision.verdict !== "improve_existing") return null;
  const url = decided.decision.ownedUrls[0], held = decided.candidates.find((c) => c.url === url && c.bodyHeld);
  if (!held) return null;
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
  if (opts.measuringPagePaths) return [...opts.measuringPagePaths];
  const shipped = await import("@/domains/measurement/proof-gsc/shipped-change-store").then((m) => m.pagesUnderMeasurementFromShipments(tenantId, opts.now)).catch(() => [] as string[]);
  return shipped.length > 0 ? shipped : pagesUnderMeasurement(existing.values(), opts.now);
}

/** TWO CONSECUTIVE 28-DAY WINDOWS PER PAGE, Google's and GA4's side by side: the only read that tells "Google moved this page" apart from "something on this page stopped working". $0, fail-soft. */
type Windows = Map<string, { positionNow: number; positionPrior: number; sessionsNow: number; sessionsPrior: number; clicksNow: number; clicksPrior: number; impressionsNow: number; impressionsPrior: number; windowEnd: string; lostClicks: number }>;
async function twoWindows(tenantId: string, now: Date | undefined): Promise<Windows> {
  const out: Windows = new Map();
  const [decay, visits] = await Promise.all([import("@/domains/evidence/readers/gsc-page-signals").then((m) => m.loadGscDecaySignalsForTenant(tenantId, now ?? new Date())).catch(() => null), import("@/domains/evidence/readers/ga4-page-values").then((m) => m.loadGa4SessionSplitForTenant(tenantId, now ?? new Date())).catch(() => null)]);
  if (!decay) return out;
  for (const [url, d] of decay) out.set(url, { positionNow: d.positionNow, positionPrior: d.positionPrior, clicksNow: d.clicksNow, clicksPrior: d.clicksPrior, sessionsNow: visits?.get(url)?.now ?? 0, sessionsPrior: visits?.get(url)?.prior ?? 0, impressionsNow: d.impressionsNow, impressionsPrior: d.impressionsPrior, windowEnd: d.windowNowEnd, lostClicks: Math.max(0, d.clicksPrior - d.clicksNow) });
  return out;
}

/** WHAT EACH KIND OF CHANGE HAS DONE ON THIS SITE, off its own ledger: how many readings finished, and the net clicks they moved against the pages nobody changed. Fail-soft to nothing. */
async function familyHistoryOf(tenantId: string): Promise<Map<string, { readings: number; netLift: number }>> {
  const out = new Map<string, { readings: number; netLift: number }>();
  const ledger = await import("@/domains/measurement/proof-gsc/load-ledger").then((m) => m.loadProofLedgerPersisted(tenantId)).catch(() => null);
  if (!ledger) return out;
  const { actionFamilyOf } = await import("@/domains/measurement/proof-gsc/change-family");
  for (const r of ledger) {
    const read = [...r.windows].filter((w) => w.ran && (w.controlsUsed ?? 0) > 0 && w.adjustedLift != null && w.day >= 28).sort((a, b) => b.day - a.day)[0];
    if (!read) continue;
    const cur = out.get(actionFamilyOf(r.actionType)) ?? { readings: 0, netLift: 0 };
    out.set(actionFamilyOf(r.actionType), { readings: cur.readings + 1, netLift: cur.netLift + Math.round(read.adjustedLift!) });
  }
  return out;
}

/** Produce (and by default persist) ranked ChangeProposals for one tenant from cached evidence only. Never throws on a single-source outage: a failed source simply narrows the snapshot. */
export async function produceProposalsForTenant(tenantId: string, opts: ProduceProposalsOptions = {}): Promise<ProduceProposalsResult> {
  const maxDrafts = opts.zeroSpend === true ? 0 : opts.maxDrafts ?? DEFAULT_MAX_DRAFTS, persist = opts.persist ?? true;
  const snapshot = await loadEvidenceSnapshot(tenantId, { now: opts.now });
  // A SOURCE THAT DID NOT ANSWER IS NOT AN ACCOUNT WITH NOTHING IN IT: a GSC read that threw makes every page read clean, so the pass ENDS HERE rather than retiring the whole queue. Empty is not failed. AND THE SAME FOR THE PAGE READ: an account whose own pages could not be read presents as an account that owns NO PAGE AT ALL, which is the one condition that earns a brand new page, so a storage outage could talk this pass into building a page for a subject the operator already covers.
  const blind = snapshot.sources.find((s) => (s.source === "gsc" || s.source === "wix") && s.status === "failed");
  if (blind) {
    log.warn(`[produce-proposals] the ${blind.source === "gsc" ? "search data" : "page inventory"} did not answer, so this pass changes nothing`, { tenantId });
    return { proposals: [], candidates: [], outcome: "evidence_unreadable", actionable: 0, investigating: 0, noDraft: 0, persisted: 0, reused: 0, heldForMeasurement: 0, investigations: [], coverage: null, waitingUntil: null, held: [], paid: { declared: [], funded: [], attemptUnitsSpent: 0, receipts: [] } }; }
  const profile = await loadBusinessProfile(tenantId).catch(() => null), allowlist = opts.authoritativeSourceDomains ?? profile?.trustedSourceDomains.value ?? [];
  const bannedTerms = profile?.constraints.value.bannedTerms ?? []; // the account's own vocabulary, read ONCE: every editor in the pass is held to the same words
  /** TWO HARD BUDGETS, and every paid Decision call this pass can reach decrements one of them BEFORE the call, whether it succeeded, refused or threw. 1. THE PAID PLAN (decision/draft-budget, compiled and funded below once every $0 producer has run): the reading of the winning pages, the new page, the shallow field drafts, every deep bundle piece, Beacon's own correction review and the editor. `maxDrafts` is the number of CANDIDATES the whole pass may spend on and MAX_PAID_CALLS caps the charged calls behind them, so no family keeps a pool and none can claim by being reached first. 2. `pageReads` (MAX_NEW_READS_PER_PASS): the durable page readings the $0 producers buy to place their cards (producers/page-job). These are a DIFFERENT thing bought at a different rate and are not folded into the call pool, where sixty of them would starve every drafter; they are named, counted and reported instead. A tripped provider breaker funds nothing at all. */
  const breakerOpen = opts.zeroSpend === true ? true : await creditBreakerHeld(tenantId).catch(() => true);
  if (breakerOpen && opts.zeroSpend !== true) log.warn("[produce-proposals] the provider's own credit is spent, so this pass drafts nothing and reports no funded work", { tenantId });
  const pageReads = { left: opts.zeroSpend === true ? 0 : MAX_NEW_READS_PER_PASS };
  const basis = await resolveCurrentBasis(tenantId, profile); // The basis this pass generates under: the SAME fingerprint Runtime scopes derived work with. Fail-soft.
  // ONE CURVE FOR THE WHOLE PASS, fitted once and handed to every surface that measures a gap, so the diagnosis, the coverage walk, the bundle and the suggestions cannot judge one page by four bars.
  const curve = fitCurveForOwnedPages(snapshot.ownedPages, { name: profile?.name.value ?? null, domain: snapshot.scope.site }, opts.now);

  const existing = persist ? await loadChangeProposals(tenantId).catch(() => new Map<string, ChangeProposal>()) : new Map<string, ChangeProposal>();
  /** The drafts already taken back under this basis: without this read the next pass repays every failure. */
  const withdrawn = persist ? await withdrawnProposalIds(tenantId, basis) : new Set<string>();
  /** THE measurement context, derived once and shared by the diagnosis and both rankings. */
  const measuring = { measuringPagePaths: await measuringPaths(tenantId, existing, opts) };
  // THE TWO WINDOWS, AND WHAT THIS ACCOUNT'S OWN FINISHED READINGS SAY. Both $0, both fail soft, neither creates work: one names a fall Google did not cause, the other ranks a losing kind of change below a winning one.
  const [windows, familyHistory] = await Promise.all([twoWindows(tenantId, opts.now), familyHistoryOf(tenantId)]);

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
    if (!pattern) return;
    const again = await readCoverage(snapshot, tenantId, { basis, profile, now: opts.now, intersection: opts.intersection, curve, patternFor: { topicKey: at.investigation.key, pattern } }).catch(() => null);
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
  const jobs: { key: string; family: string; impact: number; calls: number; fallbacks?: string[] }[] = [], editorCards: ChangeProposal[] = [];
  const page = (c: { pagePath?: string | null; pageUrl?: string | null }) => DRAFT_BUDGET.keyOf(c);
  if (patternKey) jobs.push({ key: patternKey, family: "winning_pattern", impact: topicWorth, calls: DRAFT_BUDGET.DELIVERABLE_CALLS });
  if (newPageIds && !heldNewPage) jobs.push({ key: `topic:${coverage!.investigation.key}`, family: "new_page", impact: topicWorth, calls: DRAFT_BUDGET.BUNDLE_CALLS });
  for (const d of deep) jobs.push({ key: page({ pageUrl: d.pageUrl }), family: "deep_bundle", impact: worthOf(d.pageUrl), calls: DRAFT_BUDGET.BUNDLE_CALLS });
  for (const i of inputs) jobs.push({ key: page({ pagePath: i.page.path, pageUrl: i.page.url ?? null }), family: "field_draft", impact: worthOf(i.page.url ?? i.page.path), calls: DRAFT_BUDGET.DELIVERABLE_CALLS });
  for (const c of factual.cards) jobs.push({ key: page(c), family: "correction_review", impact: worthOf(c.pageUrl ?? c.pagePath), calls: DRAFT_BUDGET.DELIVERABLE_CALLS * Math.max(1, Math.ceil((c.bundle?.components.length ?? 1) / 10)) });
  // The editor's cards are declared for every one of them: which a page still NEEDS is decided further down, once the other families have either produced that page's row or failed to.
  if (!quietDay) editorCards.push(...recovery.cards, ...extra.cards);
  for (const c of editorCards) jobs.push({ key: page(c), family: "editor", impact: Math.max(c.impactScore ?? 0, worthOf(c.pageUrl ?? c.pagePath)), calls: DRAFT_BUDGET.DELIVERABLE_CALLS });
  const budget = DRAFT_BUDGET.plan({ jobs, candidates: maxDrafts, calls: DRAFT_BUDGET.MAX_PAID_CALLS, breakerOpen, ...(opts.skipKeys ? { skip: opts.skipKeys } : {}) });
  /** WHAT BECAME OF EACH FUNDED JOB, recorded where it actually happens and never inferred from a counter. The strongest answer for a key wins, because a page whose bundle failed and whose one-field fallback then landed HAS finished work. Anything nobody filed in reads as `not_reached`: funded, never got to, and therefore never written off. */
  const gateWords = new Map<string, string>(), // the rule that refused each page, in its own words, so the receipt says WHICH one rather than only that something did
    filed = new Map<string, { providerAttempted: boolean; outcome: "produced" | "deterministic_refusal" | "retryable_blocked" | "not_reached" }>(), RANK = { produced: 3, deterministic_refusal: 2, retryable_blocked: 1, not_reached: 0 } as const;
  const file = (key: string, outcome: keyof typeof RANK, providerAttempted = true): void => { const at = filed.get(key); if (!at || RANK[outcome] > RANK[at.outcome]) filed.set(key, { providerAttempted: providerAttempted || (at?.providerAttempted ?? false), outcome }); };
  /** OUT OF TIME TO START ANYTHING NEW, checked at every paid door: work running is never abandoned, work not begun is not funded and comes back `not_reached`, settling nothing and staying owed. */
  const outOfTime = (): boolean => opts.stopBy != null && Date.now() >= opts.stopBy;
  const receipt = () => ({ declared: budget.declared, funded: budget.funded.map((f) => f.key), attemptUnitsSpent: budget.spent().calls, receipts: budget.funded.map((f) => ({ key: f.key, funded: true, providerAttempted: filed.get(f.key)?.providerAttempted ?? false, outcome: filed.get(f.key)?.outcome ?? "not_reached" as const })) });
  log.info("[produce-proposals] the paid plan for this pass, decided before it spent anything", { tenantId, declared: jobs.length,
    funded: budget.funded.map((f) => `${f.key} @${f.calls}`).slice(0, 8), refused: budget.declined.slice(0, 4).map((d) => `${d.key}: ${d.reason}`) });
  // THE FUNDED READING RUNS FIRST, and everything derived from the verdict is derived again after it. A key the plan never saw (a verdict this reading only just changed) simply goes unfunded and is picked up next pass, when the stored pattern is already on the verdict the plan is built from.
  if (patternKey) { const slice = outOfTime() ? null : budget.draw(patternKey, DRAFT_BUDGET.DELIVERABLE_CALLS);
    if (slice) { const was = slice.left; await readPattern(slice); file(patternKey, coverage?.decision.pattern ? "produced" : "retryable_blocked", slice.left < was); candidates = compile(); acted = candidates.filter((c) => c.action === "act_existing_page"); earned = candidatesToEvidenceInputs(snapshot, acted); inputs = earned.slice(0, bound);
      cappedOut = new Set(earned.slice(bound).flatMap((i) => [proposalId(i), ...pageKeys(i.page.url ?? "")])); deep = selectDeepCandidates({ candidates, coverage, limit: bound }); } }
  // A SEARCH NO PAGE OF THIS ACCOUNT IS FOR IS BANKED, NOT LOGGED: the coverage walk owns what happens next, on the NEXT pass, exactly as before.
  if (persist && extra.needsOwnPage.length > 0) await recordCoverageNeeds(tenantId, extra.needsOwnPage, opts.now ?? new Date()).catch(() => undefined);

  const recoverableByKey = new Map<string, number>(), readinessByKey = new Map<string, EvidenceReadiness>(), diagnosisByKey = new Map<string, ActionDiagnosis>();
  /** THE CAUSE LADDER'S WHOLE FINDING, indexed by page alone, not by query: one page gets one reading. */
  const causeByKey = new Map<string, CauseFinding>();
  /** THE WINNING DIAGNOSIS FOR EVERY PAGE THIS PASS JUDGED, not only the ones that earned an action. The boundary below asks it of every card whatever producer minted it, so a lever that cannot treat what the evidence NAMED is never offered. */
  const judged = new Map<string, QualifiedCandidate>();
  for (const c of candidates) for (const k of pageKeys(c.pageUrl)) judged.set(k, c);
  // A SPLIT IS A FAMILY'S DIAGNOSIS, NOT ONE PAGE'S. Every page the ladder named as competing carries it, or the sibling keeps its own "add a section here" card and goes on making the overlap worse.
  for (const c of candidates) if (c.cause.payload?.cause === "cannibalization") for (const u of c.cause.payload.competingPaths)
    for (const k of pageKeys(u)) if ((judged.get(k)?.cause.cause ?? "no_problem") === "no_problem") judged.set(k, c);
  for (const c of acted) {
    for (const k of pageKeys(c.pageUrl)) {
      recoverableByKey.set(k, c.recoverableClicks);
      causeByKey.set(k, c.cause);
      if (c.readiness && c.query) readinessByKey.set(`${k}::${canonicalQueryKey(c.query)}`, c.readiness); // Readiness is a fact about ONE page and ONE EXACT SEARCH, never about a page alone.
      if (c.diagnosis && c.query) diagnosisByKey.set(`${k}::${canonicalQueryKey(c.query)}`, c.diagnosis);
    }
  }
  /** Stamp the basis, the ranking scalar, the cause the ladder named, and confidence by evidence completeness, whichever producer built it. Never invents a figure. */
  const stamp = (p: ChangeProposal): ChangeProposal => {
    const key = (p.pageUrl ?? "").trim().toLowerCase(), pathKey = (p.pagePath ?? "").trim().toLowerCase();
    const recoverable = recoverableByKey.get(key) ?? recoverableByKey.get(pathKey);
    const qk = canonicalQueryKey(p.primaryQuery); // only the readiness measured for THIS proposal's own search may set its confidence
    const readiness = readinessByKey.get(`${key}::${qk}`) ?? readinessByKey.get(`${pathKey}::${qk}`);
    const finding = causeByKey.get(key) ?? causeByKey.get(pathKey);
    return {
      ...p,
      ...(basis ? { basis } : {}),
      ...(finding && p.diagnosisCause == null ? { causeFinding: finding, diagnosisCause: finding.cause } : {}), // The ladder's own reasoning, carried rather than re-derived, and ONLY onto a proposal that brought none.
      impactScore: recoverable ?? p.impactScore,
      confidence: p.bundle ? p.confidence : readiness ? confidenceFor(readiness, diagnosisByKey.get(`${key}::${qk}`) ?? null) : p.confidence, // A BUNDLE KEEPS ITS OWN CONFIDENCE: it built its own receipt, so a coarser readiness never overwrites it.
    };
  };
  /** RECOVERY BEFORE DISCOVERY: a page that lost real clicks while its ranking held is worth what it LOST. The lost figure never lowers a proven one, and only a card that could actually win those clicks back may claim it: a duplicate heading or an engine follow-up on a page that shed 191 clicks was inheriting all 191 as its own worth and outranking the rewrite that might really recover them. A bundle qualifies outright (it rewrites the page); a single edit only in a family whose words a searcher reads. */
  const RECOVERS_A_FALL = new Set(["title", "h1", "answer_block", "thin_page", "missing_description"]);
  const lostByKey = new Map([...windows].flatMap(([url, w]) => pageKeys(url).map((k) => [k, w.lostClicks] as const)));
  const recovered = (p: ChangeProposal): ChangeProposal => {
    // AN ACCURACY DEFECT NEVER INHERITS A FALL: handed the page's lost clicks, a card about statements contradicting their own sources arrived claiming 192 clicks nothing tied it to (the merge of two separate truths the operator forbade, 2026-08-17). A cause that claims no clicks by construction is left alone.
    if ((p.causeFinding?.cause ?? p.diagnosisCause) === "factual_error") return p;
    if (!p.bundle && !RECOVERS_A_FALL.has(p.changeFamily)) return p;
    const lost = lostByKey.get((p.pageUrl ?? "").trim().toLowerCase()) ?? lostByKey.get((p.pagePath ?? "").trim().toLowerCase()) ?? 0;
    return lost > (p.impactScore ?? 0) ? { ...p, impactScore: lost, // THE NEW NUMBER SAYS WHERE IT CAME FROM, or the card's own sentence and the order disagree out loud.
      whyItMatters: `${p.whyItMatters} This page also lost ${lost.toLocaleString("en-US")} clicks against the four weeks before, and that fall is what it is ranked on here.` } : p;
  };
  const held = [...existing.values()].filter((p) => p.status !== "implemented_pending_verification");
  /** A stored row generated under THIS basis. A null basis proves nothing, so it reuses nothing. */
  const current = (p: ChangeProposal): boolean => basis != null && p.basis === basis;
  const currentById = (id: string): ChangeProposal | null => { const p = existing.get(id); return p && p.status !== "implemented_pending_verification" && current(p) ? p : null; };
  const currentBundleFor = (match: (p: ChangeProposal) => boolean): ChangeProposal | null => live.find((p) => !!p.bundle && current(p) && match(p)) ?? null;
  /** THE AUDIENCE BEHIND A CARD, as a real field off this account's own rows and never read back out of a sentence. A defect card carries no recoverable click figure, so without this the order collapsed onto how long the work takes. Only stamped where the row brought none. */
  const byPage = new Map<string, number>();
  for (const o of snapshot.ownedPages) if (o.search) for (const k of pageKeys(o.url)) byPage.set(k, o.search.impressions90d);
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
  const retired = new Set<string>();
  const retire = async (p: ChangeProposal, why: string): Promise<void> => { if (persist) await withdrawChangeProposal(p, why); existing.delete(p.id); retired.add(p.id); };
  for (const p of held) {
    if (!p.bundle || actionableProposalFailures(p, { tenantId: p.tenantId, currentBasis: p.basis ?? null, now: opts.now }).length === 0) continue;
    await retire(p, "retired: this bundle no longer passes the bar a change must clear to be offered");
  }
  const live = held.filter((p) => !retired.has(p.id));
  let persisted = 0, writeFailures = 0, reused = 0, heldForMeasurement = candidates.filter((c) => c.cause.cause === "measuring_change").length; // A HOLD HAPPENS WHERE THE DECISION IS MADE, NOT WHERE THE ROW IS WRITTEN
  /** Persist ONE material row, or nothing when the stored row already says exactly this. THE RANKING ON FILE SURVIVES A RE-STAMP: a producer mints its card before the pass has ranked anything, so dropping the stored receipt would make every pass rewrite every row twice and count it as new work each time. */
  const persistIfChanged = async (input: ChangeProposal): Promise<"saved" | "unchanged" | "refused" | "blocked" | "failed" | "not_persisted"> => {
    if (!persist) return "not_persisted";
    // THE "NOT YET" NOTE GOES ON BEFORE THE ROW IS WRITTEN, never after it. Added once the row was already stored, the next pass re-minted the card WITHOUT the note, saved it because it differed from the stored one, then appended the note and saved again: two writes a pass, for ever, on a card nobody had touched. A refresh re-pays nothing only if it also re-writes nothing.
    const note = input.researchOnly === true && !input.bundle ? pageKeys(input.pageUrl).map((k) => blocked.get(k)).find(Boolean) : null;
    const notYet = note ? `Not yet, because ${note.reason}` : "";
    const raw: ChangeProposal = note && !(input.operatorSteps ?? []).includes(note.reason) && !(input.limitations ?? []).includes(notYet)
      ? { ...input, limitations: [...(input.limitations ?? []), notYet], evidence: { ...input.evidence, hints: [...input.evidence.hints, note.reason], evidenceRefCount: input.evidence.evidenceRefCount + 1 } } : input;
    // A PASS THAT DID NOT REACH A CARD MAY NOT UNDO IT: banked copy survives a brief re-minted on the same page, the same diagnosis, the same evidence and the same lever. THE PAGE AS THIS PASS READ IT rides on the row (its four stored fields, off the snapshot the pass already holds, so this costs no read), so words written for a page since re-crawled into a different shape are retired rather than served, and a page nothing is held for stamps nothing and is decided on everything else.
    const own = snapshot.ownedPages.find((x) => pageKeys(x.url).some((k) => pageKeys(raw.pageUrl ?? raw.pagePath).includes(k)));
    const held = own?.content ?? null;
    // The words this page is PAID for right now, off the same rows the drafter's own gate reads, so banked copy answers to today's earning list and not the one that stood when it was written.
    const preserve = [...(own?.search?.topQueries ?? [])].filter((q) => q.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, 10).map((q) => q.query);
    // BANKED COPY IS RE-READ AGAINST EVERY DETERMINISTIC RULE THAT STANDS TODAY, because banking skips the drafter and every gate: a closing line telling the reader to read the page, a figure that walked away from its own qualifier, and support that was reworded underneath the words all outlived the rules that refuse them. The closing line is TRIMMED where the field still fills without it, and then the ONE re-read decides: any reason at all and the copy is not preserved, so the card goes back through the normal drafting path rather than being served on. $0, no fresh read, no re-judging. A RESEARCH CARD CARRIES NO FINISHED COPY, so it is never put through the banked-copy gate: its `after` is the SENTENCE SAYING WHAT IS STILL OWED, and reading that as words to preserve failed the gate every pass, dropped the stored row out of sight, and rewrote a settled card twice on every refresh.
    const held0 = existing.get(raw.id), copy0 = held0 && !held0.bundle && held0.researchOnly !== true && held0.recommendedChange.kind === "existing_edit" ? held0.recommendedChange : null;
    const clean = copy0 ? withoutCta(copy0.after, copy0.field) : null, trimmed = !copy0 ? held0 : clean == null ? null : clean === copy0.after ? held0 : { ...held0!, recommendedChange: { ...copy0, after: clean } };
    const why = trimmed ? staleCopyReasons(trimmed, NO_BODIES, bannedTerms, held, false, preserve) : []; if (why.length > 0) log.info("[produce-proposals] banked copy no longer passes the rules that stand today, so it is not preserved", { tenantId, id: raw.id, reasons: why.slice(0, 3) }); const prior = why.length === 0 ? trimmed : null;
    // FINISHED COPY RETIRED BY TODAY'S RULES STILL LEAVES ITS RECEIPT (review, 2026-08-22): nulling the prior took the words out of preferFinished's sight entirely, so the one loss path a rule change opens was the one
    const retired = why.length > 0 && trimmed && !trimmed.researchOnly && trimmed.recommendedChange.kind === "existing_edit" && trimmed.recommendedChange.after.trim() // loss path with no history. The receipt rides the incoming row before preservation runs.
      ? { previousCopy: { after: trimmed.recommendedChange.after, retiredBecause: why[0]!, at: (opts.now ?? new Date()).toISOString() } } : {};
    const carried = preferFinished({ ...sized(raw), ...retired, ...(held ? { copyStamp: `${held.title ?? ""}|${held.h1 ?? ""}|${held.metaDescription ?? ""}|${(held.outline ?? []).join(">")}`.slice(0, 400) } : {}) }, prior);
    const ranked: ChangeProposal = !carried.rankingReceipt && prior?.rankingReceipt ? { ...carried, rankingReceipt: prior.rankingReceipt, ...(prior.whyRankedAboveNext ? { whyRankedAboveNext: prior.whyRankedAboveNext } : {}) } : carried;
    // READY MEANS THE CHANGE TREATS THE CAUSE ITS OWN EVIDENCE NAMED. Four producers mint `ready`, each off its own drafting, and not one asked whether the lever fits the diagnosis: the ranking was discounting 25 points for exactly that mismatch on the very card it left in the paste-ready lane. Asked ONCE, here, where every producer's row and every reused row passes on its way to the store.
    const unfit = ranked.status === "ready" ? unsettledCause(ranked) ?? openHold(ranked).blocking : null; // the reason rides the ROW, not a log: the operator reads why it is held where they read the change. AND WORK NOBODY CAN RE-PLACE IS NOT READY EITHER, WITHOUT BEING DESTROYED FOR IT: banked body copy is served on without the page's own words in hand, so an anchor no banked fact carries can no longer be checked, and the words, the claims and the evidence are kept exactly as banked while the row goes back to review carrying the sentence that says why (decision/completeness's `openHold`)
    const p: ChangeProposal = unfit ? { ...ranked, status: "needs_review", limitations: [...new Set([...ranked.limitations, unfit])] } : ranked;
    const result = await saveChangeProposal(p);
    if (result === "failed") writeFailures += 1;
    else if (result === "saved") persisted += 1; // "unchanged" wrote nothing, so it counts as nothing
    else if (result === "blocked") heldForMeasurement += 1;
    // ONLY WHAT LANDED IS REMEMBERED. A row the store refused or could not take is not on file, and holding it in the pass's own map made every later reader believe it was: the reuse check, the ranking write-back and the receipt below all read this map (Codex, 2026-08-22).
    if (result === "saved" || result === "unchanged") existing.set(p.id, p);
    return result; };
  /** THE RECEIPT IS BOUND TO THE SAVE, never to the drafting. Work that was written and then could not be stored is
   *  not finished work: it is owed again. Filing `produced` before the store answered meant a pass where one save
   *  landed and another failed wrote BOTH pages off, and the second was never offered again that day. */
  const persistAndFile = async (row: ChangeProposal, key: string): Promise<void> => { const r = await persistIfChanged(row); file(key, r === "saved" || r === "unchanged" || r === "not_persisted" ? "produced" : r === "refused" ? "deterministic_refusal" : "retryable_blocked"); }; // a store that REFUSED the row settled it against this evidence; one that FAILED or HELD it settled nothing
  /** What the card builders in decision/authorization need to name a page and stamp a row. */
  const wiring = () => ({ tenantId, now: opts.now ?? new Date(), basis: basis ?? null, pages: snapshot.ownedPages });
  /** THE SPLITS THIS PASS ACTUALLY SETTLES, one card per group, strongest first. Computed BEFORE the boundary runs, because a page may only be refused a card for a split that some card here settles. */
  const ownership = ownershipCards({ ...wiring(), judged: candidates, queryKeyOf: canonicalQueryKey });
  /** THE AUTHORIZATION BOUNDARY, asked of every card an independent producer mints. A change whose lever cannot treat the winning diagnosis for its OWN page is not offered: adding copy to one of two pages splitting a search leaves them splitting it, and the ranking picking the biggest number is exactly how that card led. It is withheld with its reason on the run receipt and any row on file for it is taken back. A page with no material diagnosis authorizes everything, byte for byte as before. A BUNDLE IS NOT ASKED: it is produced BY the ladder and refuses itself when the producer does not match the cause. */
  const admit = async (p: ChangeProposal): Promise<boolean> => {
    const key = (p.pageUrl ?? "").trim().toLowerCase(), path = (p.pagePath ?? "").trim().toLowerCase();
    const cause = (judged.get(key) ?? judged.get(path))?.cause.cause;
    if (cause === "cannibalization" && !ownership.covered.has(key) && !ownership.covered.has(path)) return true; // NO CARD, NO REFUSAL: a split this pass does not settle may not silence the page it names.
    const no = withholdReason(p, cause);
    if (!no) return true;
    extraHeld.push({ pageUrl: p.pageUrl ?? p.pagePath ?? "", reason: no });
    const stored = existing.get(p.id);
    if (stored && persist) { await withdrawChangeProposal(stored, no).catch(() => false); existing.delete(p.id); }
    return false;
  };
  /** RANK, THEN WRITE THE ORDER BACK. Every card was written before the pass had ranked it, so the stored rows carried a null ranking receipt and nothing on file could say why a card sat where it sat. Written back ONLY where the order actually moved, so a settled queue still writes nothing, and never at all on a pass whose writes were already failing: a store that would not take the row will not take its order either. */
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
  const proposals: ChangeProposal[] = []; for (const card of ownership.cards) { proposals.push(card); await persistIfChanged(card); }
  /** suggested-edits reads every page's search evidence, so it may only claim to have rewritten its families when that evidence was whole. Empty is not fresh: no rows read is not every page judged. */
  const gscComplete = snapshot.sources.some((s) => s.source === "gsc" && s.status === "fresh");   /** THE GENEROUS HALF OF THE QUEUE: every concrete edit the held evidence supports, at needs_review. */
  const withSuggestions = async (strict: ChangeProposal[]): Promise<ProducerRun> => {
    const skip = new Set([...strict.flatMap((p) => [p.id, (p.pagePath ?? "").trim().toLowerCase()]), ...withdrawn]);
    for (const s of suggestedEdits(snapshot, candidates, { now: opts.now ?? new Date(), basis, skip, windows, needs: enteredBy, curve })) {
      if (existing.get(s.id)?.status === "implemented_pending_verification") { heldForMeasurement += 1; continue; }
      if (!await admit(s)) continue;
      strict.push(s);
      await persistIfChanged(s);
    }
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
      if (ids.has(id) || (!zeroDollar.test(id) && (cappedOut.has(id) || cappedOut.has((row.pagePath ?? "").trim().toLowerCase())))) continue;
      if (row.status !== "needs_review" || !pattern.test(id)) continue;
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
    if (measuringPagesEarly.has((c.pagePath ?? "").trim().toLowerCase())) continue;
    if (!(await admit(c))) continue;
    // BEACON REVIEWS ITS OWN CORRECTIONS, ON THE PLAN'S OWN TERMS: the review was priced and ranked with everything else, so it can no longer spend in front of higher-ranked completable work, and an unfunded review leaves the card exactly as minted rather than promoting anything nobody read.
    const slot = outOfTime() ? null : budget.draw(DRAFT_BUDGET.keyOf(c), DRAFT_BUDGET.DELIVERABLE_CALLS * Math.max(1, Math.ceil((c.bundle?.components.length ?? 1) / 10)));
    const card = slot ? await defects.FACTUAL_DEFECTS.review(c, { tenantId, now: opts.now ?? new Date(), attempts: slot,
      ...(opts.complete ? { complete: opts.complete } : {}), ...(opts.bypassCache ? { bypassCache: true } : {}) }).catch(() => c) : c;
    const p = { ...card, ...(basis ? { basis } : {}) }; if (slot && card === c) file(DRAFT_BUDGET.keyOf(c), "retryable_blocked");
    if (!proposals.some((x) => x.id === p.id)) { proposals.push(p); if (slot && card !== c) await persistAndFile(p, DRAFT_BUDGET.keyOf(c)); else await persistIfChanged(p); }
  }
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
    const has = currentBundleFor((p) => p.kind === "existing_edit" && keys.includes((p.pagePath ?? "").trim().toLowerCase()));
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

  const bundleOpts = { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache, authoritativeSourceDomains: allowlist, technical, curve, bannedTerms }; // ONE bundle per SELECTED page, strongest door first. A bundle REPLACES its own shallow drafts.
  const onThrow = (e: unknown): { status: "none"; reason: string; considered?: { option: string; reason: string }[] } => { log.warn("[produce-proposals] bundle threw (fail-soft)", { tenantId, error: e instanceof Error ? e.message : String(e) }); return { status: "none", reason: "threw" }; };

  for (const d of deep) {
    // Every page THIS CASE IS ABOUT gets its own words read FIRST, because a stored bundle is re-read against them before it is served again.
    const bodyByUrl = await loadOwnedPageBodies(tenantId, [...new Set([d.pageUrl, ...d.evidence.competingUrls, ...pageKeys(d.pageUrl).map((k) => judged.get(k)?.cause.payload).flatMap((c) => c?.cause === "cannibalization" ? c.competingPaths : [])])]).catch(() => null);
    // A STORED BUNDLE IS RE-READ BEFORE IT IS SERVED AGAIN. Reuse skipped the drafter AND every gate, so a piece written before a gate existed outlived the gate that would have refused it. A piece a current gate refuses sends the whole bundle back through the producer THIS pass instead of being handed over one more time.
    const heldBundle = heldDeep.get(d.pageUrl) ?? null;
    const stale = heldBundle ? staleCopyReasons(heldBundle, bodyByUrl ?? NO_BODIES, bannedTerms) : [];
    if (heldBundle && stale.length > 0) log.info("[produce-proposals] a stored bundle no longer passes its own gates, so it is drafted again", { tenantId, id: heldBundle.id, reasons: stale.slice(0, 3) });
    if (heldBundle && stale.length === 0) {
      if (!proposals.some((p) => p.id === heldBundle.id)) { const proposal = stamp(heldBundle); // A held bundle reaches the queue here, re-stamped.
        proposals.push(proposal); reused += 1; await persistIfChanged(proposal); }
      enteredBy.set(d.pageUrl, d.entry);
      continue;
    }
    doorWalked.add((d.pageUrl ?? "").trim().toLowerCase()); // THE DOOR TRAVELS WITH THE PAGE, so a page an engine skipped is never explained in the click door's words.
    for (const k of pageKeys(d.pageUrl)) doorWalked.add(k.trim().toLowerCase());
    const slot = outOfTime() ? null : budget.draw(DRAFT_BUDGET.keyOf({ pageUrl: d.pageUrl }), DRAFT_BUDGET.BUNDLE_CALLS); // A DEEP BUNDLE IS A TWELVE-CALL PROPOSAL, ranked as one above against every cheaper change it would have starved.
    if (!slot) { log.info("[produce-proposals] the pass's paid plan funded no allowance for this deep read", { tenantId, page: d.pageUrl }); continue; }
    const bundled = await produceBundleForSnapshot(snapshot, { ...bundleOpts, attempts: slot, onlyPageUrl: d.pageUrl, door: d,
      coverage, ...measuring, decline: pageKeys(d.pageUrl).map((k) => decline.get(k)).find(Boolean), ...(bodyByUrl ? { bodyByUrl } : {}) }).catch(onThrow);
    const covered = bundled.status === "bundled" ? (bundled.proposal.pageUrl ?? "").trim().toLowerCase() : "";
    const path = bundled.status === "bundled" ? (bundled.proposal.pagePath ?? "").trim().toLowerCase() : "";
    // A BUNDLE THAT DID NOT LAND WRITES NOTHING OFF: its refusals are not typed apart yet, so the safe reading is that nobody could answer for that page today, and it is offered again rather than declared impossible.
    if (bundled.status !== "bundled") file(DRAFT_BUDGET.keyOf({ pageUrl: d.pageUrl }), "retryable_blocked");
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
    const settled = existing.get(proposalId(input)); // A refresh re-pays nothing, and SETTLED WORK IS NOT REDRAFTED.
    if (settled && settled.status === "implemented_pending_verification") { heldForMeasurement += 1; continue; } // An IMPLEMENTED row is a change under measurement, so the fresh idea for that page is HELD, not dropped.
    if (withdrawn.has(proposalId(input))) { file(DRAFT_BUDGET.keyOf({ pagePath: input.page.path, pageUrl: input.page.url ?? null }), "deterministic_refusal", false); continue; } // work the operator already took back under this evidence is SETTLED, not blocked: offering it again every drive is the retry loop this repair exists to stop
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
      file(DRAFT_BUDGET.keyOf({ pagePath: input.page.path, pageUrl: input.page.url ?? null }), why === "withdrawn" || why === "not_diagnosed" ? "deterministic_refusal" : "retryable_blocked", why !== "budget_spent" && why !== "off");
      noDraft += 1;
      // A REFUSED DRAFT IS FILED, NOT FORGOTTEN: history is what stops the next pass paying to fail twice.
      if (outcome.status === "withdrawn" && persist) await withdrawChangeProposal(stamp(outcome.proposal), "refused: a safety gate rejected this draft, so it was never offered");
      continue;
    }
    const proposal = stamp(outcome.proposal); proposals.push(proposal);
    await persistAndFile(proposal, DRAFT_BUDGET.keyOf({ pagePath: input.page.path, pageUrl: input.page.url ?? null })); }
  const suggested = await withSuggestions(proposals);
  // THE COLLAPSE PRODUCER: the largest losses the account's own history can PROVE become cards before any defect sweep fills the queue; a failed history read sweeps nothing. The $0 queue rides its ONE entrance (producers/extra.extraQueuePass), which owns the unit load so both producers join the SAME audiences. THE BOUNDARY IS ASKED BEFORE THE MONEY IS SPENT: a card the diagnosis will not authorize, or that the store will refuse (a page under measurement rejects new drafts at save time), is not worth paying to write; drafting one anyway spent four charged calls a pass on copy that could never land. ONE PAGE, ONE DELIVERABLE THIS PASS. A page another family already produced a row for takes no second one-field card, and a page whose draft did NOT land still gets its cheaper card rather than nothing. This used to hold only by accident of ordering: the $0 queue ran after the drafters and skipped whatever pages already had a row on file. It runs before the pass spends anything now, so the rule says itself, over the same rows the store would have shown it.
  const coveredNow = new Set(proposals.flatMap((r) => [(r.pagePath ?? "").trim().toLowerCase(), (r.pageUrl ?? "").trim().toLowerCase()]).filter(Boolean));
  const eligible: ChangeProposal[] = []; for (const c of editorCards) { const at = [(c.pagePath ?? "").trim().toLowerCase(), (c.pageUrl ?? "").trim().toLowerCase()]; // the SAME list the manifest priced, so nothing spends outside the one plan
    if (at.some((k) => measuringPagesEarly.has(k))) continue;
    if (!(await admit(c))) continue; // asked FIRST, so a card the diagnosis refuses is refused OUT LOUD with its reason on the receipt, rather than disappearing into the page-already-covered rule
    if (!at.some((k) => coveredNow.has(k))) eligible.push(c); }
  // The editor's own cards were priced and ranked on the ONE manifest above with everything else, so this is now only the order it WALKS them in: an unfunded card is refused by the plan, never by arriving late. IT ORDERS, IT DOES NOT STAMP. The ranker returns rows carrying a receipt, and letting that provisional one ride to the store made every pass write each card twice: once with the score as it stood before the pass finished, then again with the real one. The order is taken; the cards themselves go on untouched, and rankAndStamp below is the only thing that ever writes an order down.
  const byId = new Map(eligible.map((c) => [c.id, c] as const));
  const allowed = rankProposals(eligible.map(recovered).map(sized), { ...measuring, familyHistory }).map((p) => byId.get(p.id) ?? p);
  const drafted = await applyDraftedCopy(allowed,{ tenantId, snapshot, providerFailed: new Set<string>(), refusals: gateWords, note: (k, o, why) => { if (why) gateWords.set(k, why); file(k, o); }, ...(opts.stopBy != null ? { stopBy: opts.stopBy } : {}), now: opts.now ?? new Date(), complete: opts.complete, bypassCache: opts.bypassCache, bannedTerms, budget }).catch(() => allowed); // the account's own vocabulary AND the pass's ONE paid plan reach the editor
  // THE EDITOR REPORTS THROUGH ITS OWN CARDS: one that came back with finished words produced; one that did not was refused by whoever could not answer, and is offered again.
  // A CARD THE PLAN NEVER FUNDED WAS NEVER TRIED: it reads `not_reached`, not `blocked`. Filing every unfinished editor card as blocked said the pass had attempted work it had not even paid for, which is the kind of receipt this repair exists to stop telling.
  for (const raw of drafted) { const p = { ...raw, ...(basis ? { basis } : {}) }, key = DRAFT_BUDGET.keyOf(p); proposals.push(p);
    if (p.researchOnly === false && p.status === "ready") await persistAndFile(p, key); else { if (budget.funded.some((f) => f.key === key)) file(key, "retryable_blocked"); await persistIfChanged(p); } } // Stamped with THIS pass's basis, or the actionable door refuses every one as drafted under an older bar.
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
