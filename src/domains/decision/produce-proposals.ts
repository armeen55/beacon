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
import { confidenceFor, proposalId, type ActionDiagnosis, type ChangeProposal, type EvidenceReadiness } from "./contracts"; import { preferFinished } from "./completeness";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { loadOwnedPageBodies } from "@/domains/evidence/pages/owned-context";
import { buildTopicInvestigations, type TopicInvestigation } from "@/domains/evidence/topic-investigation";
import { earnedNewPage, type IntersectionEvidence } from "./coverage-adjudication";
import { extractPageFacts, readWinningPattern } from "./winning-pattern";
import { readCoverage, recordCoverageNeeds, type DecidedTopic } from "./coverage-pass";
import { applyDraftedCopy, staleBundleReasons, withoutCta, MAX_PAID_CALLS } from "./drafted-copy";
import { MAX_NEW_READS_PER_PASS } from "./producers/page-job";
import { readInventory } from "@/domains/evidence/scanning/owned-pages-store";
import { readTechnicalFindings } from "./technical-findings";
import { buildNewPageProposal } from "./new-page";
import { suggestedEdits } from "./suggested-edits";

export type ProduceProposalsOptions = ProposeOptions & {
  /** A TEST SEAM ONLY: production reads the stored comparison out of the canonical evidence, and passing this skips that read. */
  intersection?: IntersectionEvidence;
  /** Hard cap on how many opportunities this pass drafts (budget guard). */ maxDrafts?: number;
  /** The pages still being measured, when the caller knows them: preferred over any derivation here. */ measuringPagePaths?: readonly string[];
  /** Persist each landed proposal (default true). Tests pass false to stay pure. */ persist?: boolean;
};
/** How this pass ended. Only `persistence_failed` is a failure; `investigating` is the honest middle: proven gaps exist and what to change is not known yet, so they are VISIBLE rather than read as a quiet day. */
export type ProducerOutcome = "evidence_unreadable" | "no_actionable_candidate" | "investigating" | "actionable_but_no_trusted_draft" | "persistence_failed" | "proposals_persisted";

export type ProduceProposalsResult = {
  /** The ranked proposals this pass produced (may be empty and still a success). */ proposals: ChangeProposal[]; candidates: QualifiedCandidate[]; /** Which of the honest endings this pass reached. */ outcome: ProducerOutcome;
  /** Candidates that earned an action: a page to edit, plus every consolidation this kernel cannot draft yet. */ actionable: number;
  /** Proven gaps whose cause is not identified yet: real work, not silence. */ investigating: number; noDraft: number; persisted: number; /** Drafts the store REFUSED to file because that page already carries a change under measurement. */ heldForMeasurement: number;
  /** Proposals carried forward unchanged: no draft, no write, no dollars. */ reused: number; /** What has been investigated about each topic, over the SAME evidence this pass judged. Research only. */ investigations: TopicInvestigation[];
  coverage: DecidedTopic | null; waitingUntil: string | null; // the earliest date any page this pass could not read may be tried again; null when nothing is waiting, which is what stops a surface saying "checking"
  /** Cards a producer would have minted and HELD instead, each with the typed reason. Refused work is on the receipt, never a silent absence. */ held: { pageUrl: string; reason: string }[];
};
/** Bounded drafting: the strongest few, never a queue. */ export const DEFAULT_MAX_DRAFTS = 5;
const MAX_INVENTORY = 200; // one bounded page of this account's own inventory, never the whole site
/** The card families each $0 producer rewrites IN FULL every pass. A family outside its producer's list is somebody else's work and is never swept. `divergence` is listed with nothing writing it any more, and that is the point: it stays under its producer's sweep, so every diagnose-it-yourself card on file is retired the next time that producer finishes. */
const SUGGESTED_FAMILIES = ["title", "h1", "answer_block", "divergence"] as const;
const EXTRA_FAMILIES = ["ai_answer_gap", "engine_followup", "internal_link", "missing_description", "duplicate_heading", "thin_page"] as const;
/** WHAT A PRODUCER REWROTE, AND WHETHER IT FINISHED. The sweep used to infer both from the length of one producer's output. A producer that read nothing and a producer that found nothing hand back the same empty list and mean opposite things, and on the night the search read timed out that inference retired cards out from under the operator mid-edit. Completeness is STATED, never read off an output length. */
type ProducerRun = { families: readonly string[]; complete: boolean };
/** THE ONE PAGE A VERDICT DECIDED TO IMPROVE, as facts out of words this pass ALREADY holds. Null for `create_new`, and null when its own words are not held. */
function ownedFactsFor(snapshot: EvidenceSnapshot, decided: DecidedTopic): ReturnType<typeof extractPageFacts>[number] | null {
  if (decided.decision.verdict !== "improve_existing") return null;
  const url = decided.decision.ownedUrls[0];
  const held = decided.candidates.find((c) => c.url === url && c.bodyHeld);
  if (!held) return null;
  const at = (u: string): string => { try { return new URL(u.startsWith("http") ? u : `https://${u}`).pathname.replace(/\/+$/, "") || "/"; } catch { return u; } };
  const row = snapshot.ownedPages.find((p) => at(p.url) === at(held.url))?.content ?? null;
  return extractPageFacts([{ url: held.url, extract: { title: held.title, h1: held.h1, wordCount: held.wordCount, headings: row?.outline ?? null, faqCount: row?.faqCount ?? null, openingSample: held.openingSample, entityNames: held.entities } }])[0] ?? null;
}
/** Normalized keys a candidate and a proposal can be matched on. */
const pageKeys = (pageUrl: string | null | undefined): string[] => {
  const url = (pageUrl ?? "").trim().toLowerCase();
  if (!url) return [];
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
  const maxDrafts = opts.maxDrafts ?? DEFAULT_MAX_DRAFTS, persist = opts.persist ?? true;
  const snapshot = await loadEvidenceSnapshot(tenantId, { now: opts.now });
  // A SOURCE THAT DID NOT ANSWER IS NOT AN ACCOUNT WITH NOTHING IN IT: a GSC read that threw makes every page read clean, so the pass ENDS HERE rather than retiring the whole queue. Empty is not failed. AND THE SAME FOR THE PAGE READ: an account whose own pages could not be read presents as an account that owns NO PAGE AT ALL, which is the one condition that earns a brand new page, so a storage outage could talk this pass into building a page for a subject the operator already covers.
  const blind = snapshot.sources.find((s) => (s.source === "gsc" || s.source === "wix") && s.status === "failed");
  if (blind) {
    log.warn(`[produce-proposals] the ${blind.source === "gsc" ? "search data" : "page inventory"} did not answer, so this pass changes nothing`, { tenantId });
    return { proposals: [], candidates: [], outcome: "evidence_unreadable", actionable: 0, investigating: 0, noDraft: 0, persisted: 0, reused: 0, heldForMeasurement: 0, investigations: [], coverage: null, waitingUntil: null, held: [] }; }
  const profile = await loadBusinessProfile(tenantId).catch(() => null), allowlist = opts.authoritativeSourceDomains ?? profile?.trustedSourceDomains.value ?? [];
  const bannedTerms = profile?.constraints.value.bannedTerms ?? []; // the account's own vocabulary, read ONCE: every editor in the pass is held to the same words
  /** TWO HARD BUDGETS, BOTH BORN HERE, and every paid Decision call this pass can reach decrements one of them BEFORE the call, whether it succeeded, refused or threw. 1. `attempts` (MAX_PAID_CALLS): the reading of the winning pages, the new page brief, the shallow field drafts, every deep bundle piece (title, section, link, opening), the sibling pages a differentiation writes on, the descriptions and answers below, and every judging of any of them. 2. `pageReads` (MAX_NEW_READS_PER_PASS): the durable page readings the $0 producers buy to place their cards (producers/page-job). These are a DIFFERENT thing bought at a different rate and they are not folded into the attempt pool, where sixty of them would starve every drafter; they are named, counted and reported instead. "One pool pays every attempt" was untrue by the winning-pattern read, four bundle drafters and every page reading, so it is not said any more: two pools, both countable, both on the receipt. */
  const attempts = { left: MAX_PAID_CALLS }, pageReads = { left: MAX_NEW_READS_PER_PASS };
  // The basis this pass generates under: the SAME fingerprint Runtime scopes derived work with. Fail-soft.
  const basis = await resolveCurrentBasis(tenantId, profile);
  // ONE CURVE FOR THE WHOLE PASS, fitted once and handed to every surface that measures a gap, so the diagnosis, the coverage walk, the bundle and the suggestions cannot judge one page by four bars.
  const curve = fitCurveForOwnedPages(snapshot.ownedPages, { name: profile?.name.value ?? null, domain: snapshot.scope.site }, opts.now);

  const existing = persist ? await loadChangeProposals(tenantId).catch(() => new Map<string, ChangeProposal>()) : new Map<string, ChangeProposal>();
  /** The drafts already taken back under this basis: without this read the next pass repays every failure. */
  const withdrawn = persist ? await withdrawnProposalIds(tenantId, basis) : new Set<string>();
  /** THE measurement context, derived once and shared by the diagnosis and both rankings. */
  const measuring = { measuringPagePaths: await measuringPaths(tenantId, existing, opts) };
  // THE TWO WINDOWS, AND WHAT THIS ACCOUNT'S OWN FINISHED READINGS SAY. Both $0, both fail soft, neither creates work: one names a fall Google did not cause, the other ranks a losing kind of change below a winning one.
  const [windows, familyHistory] = await Promise.all([twoWindows(tenantId, opts.now), familyHistoryOf(tenantId)]);

  // THE RESEARCH PACKETS, over the same evidence this pass judges. Non-actionable by construction.
  let investigations: TopicInvestigation[] = [];
  try { investigations = buildTopicInvestigations(snapshot); }
  catch (e) { log.warn("[produce-proposals] investigations failed (fail-soft)", { tenantId, error: e instanceof Error ? e.message : String(e) }); }
  // THE ONE CANONICAL COVERAGE PASS, the same one Runtime buys evidence off. $0, deterministic, fail-soft.
  const technical = readTechnicalFindings({ inventory: await readInventory(tenantId, { limit: MAX_INVENTORY }).catch(() => []),
    pages: snapshot.ownedPages.filter((p) => !!p.content).map((p) => ({ url: p.url, title: p.content!.title, h1: p.content!.h1, internal_links: p.content!.internalLinks.map((l) => l.href), canonical_url: p.content!.canonicalUrl ?? null, has_canonical_mismatch: p.content!.hasCanonicalMismatch ?? null, robots_meta: p.content!.robotsMeta ?? null })) });
  let coverage: DecidedTopic | null = null, waitingUntil: string | null = null;
  // Filled once the $0 producers run; the same array rides the result so held work reaches the receipt.
  const extraHeld: { pageUrl: string; reason: string }[] = [];
  try {
    const read = await readCoverage(snapshot, tenantId, { basis, profile, now: opts.now, intersection: opts.intersection, technical, curve });
    coverage = read.decided;
    waitingUntil = read.waitingUntil;
    // THE PATTERN IS COMPUTED HERE, never inside readCoverage, which is a render path. One bounded cached call for the ONE topic that earned a verdict, then one free re-read. Fail-soft: no pattern, same verdict.
    if (coverage && (coverage.decision.verdict === "create_new" || coverage.decision.verdict === "improve_existing")
      && coverage.investigation.currentReadableWinners >= 2 && !coverage.decision.pattern) {
      // ONLY THE WINNERS I CURRENTLY HOLD A READ OF: the denominator is exactly what I read and still hold.
      const mine = new Set(coverage.investigation.winners.filter((w) => w.extractState === "current").map((w) => w.url));
      const facts = extractPageFacts((snapshot.research.winningPages ?? []).filter((r) => mine.has(r.url)));
      // THE PAGE BEING COMPARED AGAINST IS SHOWN, OR NO GAP MAY BE WRITTEN.
      const owned = ownedFactsFor(snapshot, coverage);
      const pattern = await readWinningPattern(facts, owned, tenantId, { complete: opts.complete, now: opts.now, pageType: coverage.investigation.pageType, label: coverage.investigation.label, attempts }).catch(() => null);
      if (pattern) {
        const again = await readCoverage(snapshot, tenantId, { basis, profile, now: opts.now, intersection: opts.intersection, curve,
          patternFor: { topicKey: coverage.investigation.key, pattern } }).catch(() => null);
        if (again?.decided) { coverage = again.decided; waitingUntil = again.waitingUntil; }
      }
    }
  } catch (e) { log.warn("[produce-proposals] coverage verdict failed (fail-soft)", { tenantId, error: e instanceof Error ? e.message : String(e) }); }
  const research = { investigations, coverage, waitingUntil, held: extraHeld };

  // THE PAGE'S OWN TWO WINDOWS REACH THE DIAGNOSIS, keyed every way a candidate can be matched. Without this a fall was loaded, rendered on a lane, and never once weighed by the kernel that decides what to do.
  const decline = new Map<string, NonNullable<ReturnType<Windows["get"]>>>();
  for (const [url, w] of windows) for (const k of pageKeys(url)) decline.set(k, w);
  const candidates = compileCandidates(snapshot, { coverage, ...measuring, decline, curve });
  const acted = candidates.filter((c) => c.action === "act_existing_page");
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
      // Readiness is a fact about ONE page and ONE EXACT SEARCH, never about a page alone.
      if (c.readiness && c.query) readinessByKey.set(`${k}::${canonicalQueryKey(c.query)}`, c.readiness);
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
      // The ladder's own reasoning, carried rather than re-derived, and ONLY onto a proposal that brought none.
      ...(finding && p.diagnosisCause == null ? { causeFinding: finding, diagnosisCause: finding.cause } : {}),
      impactScore: recoverable ?? p.impactScore,
      // A BUNDLE KEEPS ITS OWN CONFIDENCE: it built its own receipt, so a coarser readiness never overwrites it.
      confidence: p.bundle ? p.confidence : readiness ? confidenceFor(readiness, diagnosisByKey.get(`${key}::${qk}`) ?? null) : p.confidence,
    };
  };

  /** RECOVERY BEFORE DISCOVERY: a page that lost real clicks while its ranking held is worth what it LOST. The lost figure never lowers a proven one, and only a card that could actually win those clicks back may claim it: a duplicate heading or an engine follow-up on a page that shed 191 clicks was inheriting all 191 as its own worth and outranking the rewrite that might really recover them. A bundle qualifies outright (it rewrites the page); a single edit only in a family whose words a searcher reads. */
  const RECOVERS_A_FALL = new Set(["title", "h1", "answer_block", "thin_page", "missing_description"]);
  const lostByKey = new Map([...windows].flatMap(([url, w]) => pageKeys(url).map((k) => [k, w.lostClicks] as const)));
  const recovered = (p: ChangeProposal): ChangeProposal => {
    if (!p.bundle && !RECOVERS_A_FALL.has(p.changeFamily)) return p;
    const lost = lostByKey.get((p.pageUrl ?? "").trim().toLowerCase()) ?? lostByKey.get((p.pagePath ?? "").trim().toLowerCase()) ?? 0;
    // THE NEW NUMBER SAYS WHERE IT CAME FROM, or the card's own sentence and the order disagree out loud.
    return lost > (p.impactScore ?? 0) ? { ...p, impactScore: lost,
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
  // A HOLD HAPPENS WHERE THE DECISION IS MADE, NOT WHERE THE ROW IS WRITTEN.
  const heldByDiagnosis = candidates.filter((c) => c.cause.cause === "measuring_change").length;
  let persisted = 0, writeFailures = 0, reused = 0, heldForMeasurement = heldByDiagnosis;
  /** Persist ONE material row, or nothing when the stored row already says exactly this. THE RANKING ON FILE SURVIVES A RE-STAMP: a producer mints its card before the pass has ranked anything, so dropping the stored receipt would make every pass rewrite every row twice and count it as new work each time. */
  const persistIfChanged = async (raw: ChangeProposal): Promise<void> => {
    if (!persist) return;
    // A PASS THAT DID NOT REACH A CARD MAY NOT UNDO IT: banked copy survives a brief re-minted on the same page, the same diagnosis, the same evidence and the same lever. THE PAGE AS THIS PASS READ IT rides on the row (its four stored fields, off the snapshot the pass already holds, so this costs no read), so words written for a page since re-crawled into a different shape are retired rather than served, and a page nothing is held for stamps nothing and is decided on everything else.
    const held = snapshot.ownedPages.find((x) => pageKeys(x.url).some((k) => pageKeys(raw.pageUrl ?? raw.pagePath).includes(k)))?.content ?? null;
    // BANKED COPY IS RE-READ AGAINST THE CONTRACT THAT STANDS TODAY, because banking skips every gate: a closing line telling the reader to read the page outlived the rule that refuses one. Trimmed where the field still fills without it, and NOT BANKED AT ALL where it does not, so a stale call to action can never be served on while the drafter keeps missing. $0 and deterministic.
    const held0 = existing.get(raw.id), copy0 = held0 && !held0.bundle && held0.recommendedChange.kind === "existing_edit" ? held0.recommendedChange : null;
    const clean = copy0 ? withoutCta(copy0.after, copy0.field === "meta" ? "meta" : copy0.field === "title" ? "title" : copy0.field === "h1" ? "h1" : "answer_block") : null;
    const prior = !copy0 ? held0 : clean == null ? null : clean === copy0.after ? held0 : { ...held0!, recommendedChange: { ...copy0, after: clean } };
    const carried = preferFinished({ ...sized(raw), ...(held ? { copyStamp: `${held.title ?? ""}|${held.h1 ?? ""}|${held.metaDescription ?? ""}|${(held.outline ?? []).join(">")}`.slice(0, 400) } : {}) }, prior);
    const ranked: ChangeProposal = !carried.rankingReceipt && prior?.rankingReceipt ? { ...carried, rankingReceipt: prior.rankingReceipt, ...(prior.whyRankedAboveNext ? { whyRankedAboveNext: prior.whyRankedAboveNext } : {}) } : carried;
    // READY MEANS THE CHANGE TREATS THE CAUSE ITS OWN EVIDENCE NAMED. Four producers mint `ready`, each off its own drafting, and not one asked whether the lever fits the diagnosis: the ranking was discounting 25 points for exactly that mismatch on the very card it left in the paste-ready lane. Asked ONCE, here, where every producer's row and every reused row passes on its way to the store.
    const unfit = ranked.status === "ready" ? unsettledCause(ranked) : null; // the reason rides the ROW, not a log: the operator reads why it is held where they read the change
    const p: ChangeProposal = unfit ? { ...ranked, status: "needs_review", limitations: [...new Set([...ranked.limitations, unfit])] } : ranked;
    const result = await saveChangeProposal(p);
    if (result === "failed") writeFailures += 1;
    else if (result === "saved") persisted += 1; // "unchanged" wrote nothing, so it counts as nothing
    else if (result === "blocked") heldForMeasurement += 1;
    existing.set(p.id, p);
  };
  /** What the card builders in decision/authorization need to name a page and stamp a row. */
  const wiring = () => ({ tenantId, now: opts.now ?? new Date(), basis: basis ?? null, pages: snapshot.ownedPages });
  /** THE SPLITS THIS PASS ACTUALLY SETTLES, one card per group, strongest first. Computed BEFORE the boundary runs, because a page may only be refused a card for a split that some card here settles. */
  const ownership = ownershipCards({ ...wiring(), judged: candidates, queryKeyOf: canonicalQueryKey });
  /** THE AUTHORIZATION BOUNDARY, asked of every card an independent producer mints. A change whose lever cannot treat the winning diagnosis for its OWN page is not offered: adding copy to one of two pages splitting a search leaves them splitting it, and the ranking picking the biggest number is exactly how that card led. It is withheld with its reason on the run receipt and any row on file for it is taken back. A page with no material diagnosis authorizes everything, byte for byte as before. A BUNDLE IS NOT ASKED: it is produced BY the ladder and refuses itself when the producer does not match the cause. */
  const admit = async (p: ChangeProposal): Promise<boolean> => {
    const key = (p.pageUrl ?? "").trim().toLowerCase(), path = (p.pagePath ?? "").trim().toLowerCase();
    const cause = (judged.get(key) ?? judged.get(path))?.cause.cause;
    // NO CARD, NO REFUSAL: a split this pass does not settle may not silence the page it names.
    if (cause === "cannibalization" && !ownership.covered.has(key) && !ownership.covered.has(path)) return true;
    const no = withholdReason(p, cause);
    if (!no) return true;
    extraHeld.push({ pageUrl: p.pageUrl ?? p.pagePath ?? "", reason: no });
    const stored = existing.get(p.id);
    if (stored && persist) { await withdrawChangeProposal(stored, no).catch(() => false); existing.delete(p.id); }
    return false;
  };
  /** RANK, THEN WRITE THE ORDER BACK. Every card was written before the pass had ranked it, so the stored rows carried a null ranking receipt and nothing on file could say why a card sat where it sat. Written back ONLY where the order actually moved, so a settled queue still writes nothing, and never at all on a pass whose writes were already failing: a store that would not take the row will not take its order either. */
  const rankAndStamp = async (rows: readonly ChangeProposal[]): Promise<ChangeProposal[]> => {
    // WHAT WAS PERSISTED IS WHAT GETS RANKED, or a card whose banked copy was kept above would rank as a brief the store no longer holds.
    const ranked = rankProposals(rows.map((p) => existing.get(p.id) ?? p).map(recovered).map(sized), { ...measuring, familyHistory });
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
  const gscComplete = snapshot.sources.some((s) => s.source === "gsc" && s.status === "fresh");
  /** THE GENEROUS HALF OF THE QUEUE: every concrete edit the held evidence supports, at needs_review. */
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
  const sweepStale = async (runs: readonly ProducerRun[]): Promise<void> => {
    if (!persist) return;
    const families = runs.filter((r) => r.complete).flatMap((r) => [...r.families]);
    if (families.length === 0) return void log.warn("[produce-proposals] no producer finished, so no card is taken back", { tenantId });
    const pattern = new RegExp(`::existing_edit::(${families.join("|")})$`), ids = new Set(proposals.map((p) => p.id));
    let taken = 0;
    for (const [id, row] of existing) {
      if (ids.has(id) || cappedOut.has(id) || cappedOut.has((row.pagePath ?? "").trim().toLowerCase())) continue;
      if (row.status !== "needs_review" || row.bundle || !pattern.test(id)) continue;
      if (await withdrawChangeProposal(row, "swept: the producer that owns this family rewrote it and did not re-emit this card").catch(() => false)) taken += 1;
    }
    if (taken > 0) log.info("[produce-proposals] stale cards withdrawn", { tenantId, taken, families });
  };
  // A SUBJECT THIS ACCOUNT HAS NO PAGE FOR: an EARNED create_new verdict is the only road to one.
  const decided = coverage;
  if (decided && earnedNewPage(decided.decision)) {
    // An id this case ABSORBED still names this case's page, or a merge builds a second page for one subject.
    const ids = [decided.investigation.key, ...decided.investigation.aliasKeys];
    const heldPage = live.find((p) => p.kind === "new_page" && current(p) && ids.some((k) => p.id.includes(`::${k}::`))) ?? null;
    if (heldPage) { proposals.push(heldPage); reused += 1; }
    else {
      const built = await buildNewPageProposal(decided, tenantId, { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache, attempts }).catch((e) => ({ status: "none" as const, reason: e instanceof Error ? e.message : String(e) }));
      if (built.status === "built") { const page = { ...built.proposal, ...(basis ? { basis } : {}) }; proposals.push(page); await persistIfChanged(page); }
      else log.info("[produce-proposals] no new page this pass", { tenantId, reason: built.reason });
    }
  }

  const bound = Math.min(DEFAULT_MAX_DRAFTS, maxDrafts), earned = candidatesToEvidenceInputs(snapshot, acted), inputs = earned.slice(0, bound);
  /** THE PAGES THIS PASS NEVER REACHED, because paid drafting stops at `bound`. NOT RE-EMITTED BY A CAP IS NOT NOT RE-EMITTED: the sweep read the budget's silence as the generator withdrawing its own work, and took back a draft already PAID for on the sixth strongest page of every pass. */
  const cappedOut = new Set(earned.slice(bound).flatMap((i) => [proposalId(i), ...pageKeys(i.page.url ?? "")]));
  const deep = selectDeepCandidates({ snapshot, candidates, coverage, limit: bound }); // SELECTION ONLY: nothing here drafts, buys, or invents a figure.

  const investigating = candidates.filter((c) => c.action === "research_needed").length;
  const consolidating = candidates.filter((c) => c.action === "consolidate").length; // A CONSOLIDATION IS WORK, NOT SILENCE: a split nothing can draft yet is counted, not passed over
  if (acted.length === 0 && deep.length === 0) {
    log.info("[produce-proposals] nothing earned an action this pass", { tenantId, judged: candidates.length, watching: candidates.filter((c) => c.action === "watch").length + consolidating, researching: investigating });
    // A proven gap with no explanation yet is NOT a quiet day, and neither is one that cannot be drafted.
    await sweepStale([await withSuggestions(proposals)]);
    return { proposals: await rankAndStamp(proposals), candidates: runReceipt(),
      outcome: proposals.length > 0 ? "proposals_persisted" : investigating > 0 ? "investigating"
        : consolidating > 0 ? "actionable_but_no_trusted_draft" : "no_actionable_candidate",
      actionable: consolidating, investigating, noDraft: 0, persisted, reused, heldForMeasurement, ...research };
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
  // A CHANGE MAY NOT OUTLIVE ITS OWN EXPLANATION, and only about a page this pass ACTUALLY READ.
  const readNow = new Set(snapshot.ownedPages.flatMap((o) => pageKeys(o.url)));
  const provenNow = new Set([...acted.flatMap((c) => pageKeys(c.pageUrl)), ...selectedKeys]);
  for (const p of live) {
    const key = (p.pagePath ?? "").trim().toLowerCase();
    if (!p.bundle || p.kind !== "existing_edit" || !current(p) || retired.has(p.id) || !readNow.has(key) || provenNow.has(key)) continue;
    await retire(p, "retired: this page was read again this pass and nothing on it earned a change");
  }
  // AND THE PAGE NOBODY EARNED: only a pass that REACHED a verdict may retire one.
  if (decided) for (const p of live) {
    if (p.kind !== "new_page" || !current(p) || retired.has(p.id)) continue;
    if (earnedNewPage(decided.decision) && [decided.investigation.key, ...decided.investigation.aliasKeys].some((k) => p.id.includes(`::${k}::`))) continue;
    await retire(p, "retired: this pass reached a verdict and no case still asks for this new page");
  }

  let noDraft = 0;
  for (const input of inputs) {
    // A refresh re-pays nothing, and SETTLED WORK IS NOT REDRAFTED.
    const settled = existing.get(proposalId(input));
    // An IMPLEMENTED row is a change under measurement, so the fresh idea for that page is HELD, not dropped.
    if (settled && settled.status === "implemented_pending_verification") { heldForMeasurement += 1; continue; }
    if (withdrawn.has(proposalId(input))) continue;
    const held = currentById(proposalId(input))
      ?? (input.opportunity.kind === "existing_edit"
        ? [...heldDeep.values()].find((b) => b.pagePath === input.page.path) ?? null : null);
    if (held) {
      if (!proposals.some((p) => p.id === held.id)) {
        // Reuse skips the DRAFTER, never the judgment: a stored row is re-stamped against today's evidence.
        const restamped = stamp(held);
        proposals.push(restamped);
        reused += 1;
        await persistIfChanged(restamped);
      }
      continue;
    }
    const outcome = await proposeExistingPageChange(input, { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache, authoritativeSourceDomains: allowlist, attempts }).catch((e) => {
      log.warn("[produce-proposals] propose threw (fail-soft)", { tenantId, id: input.opportunity.query, error: e instanceof Error ? e.message : String(e) });
      return { status: "no_draft" as const, reason: "threw", drafterStatus: "error" }; });
    if (outcome.status !== "ready") {
      noDraft += 1;
      // A REFUSED DRAFT IS FILED, NOT FORGOTTEN: history is what stops the next pass paying to fail twice.
      if (outcome.status === "withdrawn" && persist) await withdrawChangeProposal(stamp(outcome.proposal), "refused: a safety gate rejected this draft, so it was never offered");
      continue;
    }
    const proposal = stamp(outcome.proposal);
    proposals.push(proposal);
    await persistIfChanged(proposal);
  }

  // ONE bundle per SELECTED page, strongest door first. A bundle REPLACES its own shallow drafts.
  const bundleOpts = { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache, authoritativeSourceDomains: allowlist, technical, curve, bannedTerms, attempts };
  const onThrow = (e: unknown): { status: "none"; reason: string; considered?: { option: string; reason: string }[] } => { log.warn("[produce-proposals] bundle threw (fail-soft)", { tenantId, error: e instanceof Error ? e.message : String(e) }); return { status: "none", reason: "threw" }; };

  for (const d of deep) {
    // Every page THIS CASE IS ABOUT gets its own words read FIRST, because a stored bundle is re-read against them before it is served again.
    const bodyByUrl = await loadOwnedPageBodies(tenantId, [...new Set([d.pageUrl, ...d.evidence.competingUrls, ...pageKeys(d.pageUrl).map((k) => judged.get(k)?.cause.payload).flatMap((c) => c?.cause === "cannibalization" ? c.competingPaths : [])])]).catch(() => null);
    // A STORED BUNDLE IS RE-READ BEFORE IT IS SERVED AGAIN. Reuse skipped the drafter AND every gate, so a piece written before a gate existed outlived the gate that would have refused it. A piece a current gate refuses sends the whole bundle back through the producer THIS pass instead of being handed over one more time.
    const heldBundle = heldDeep.get(d.pageUrl) ?? null;
    const stale = heldBundle ? staleBundleReasons(heldBundle, bodyByUrl ?? new Map(), bannedTerms) : [];
    if (heldBundle && stale.length > 0) log.info("[produce-proposals] a stored bundle no longer passes its own gates, so it is drafted again", { tenantId, id: heldBundle.id, reasons: stale.slice(0, 3) });
    if (heldBundle && stale.length === 0) {
      // A held bundle reaches the queue here, re-stamped.
      if (!proposals.some((p) => p.id === heldBundle.id)) {
        const proposal = stamp(heldBundle);
        proposals.push(proposal);
        reused += 1;
        await persistIfChanged(proposal);
      }
      enteredBy.set(d.pageUrl, d.entry);
      continue;
    }
    // THE DOOR TRAVELS WITH THE PAGE, so a page an engine skipped is never explained in the click door's words.
    const bundled = await produceBundleForSnapshot(snapshot, { ...bundleOpts, onlyPageUrl: d.pageUrl, door: d,
      coverage, ...measuring, decline: pageKeys(d.pageUrl).map((k) => decline.get(k)).find(Boolean), ...(bodyByUrl ? { bodyByUrl } : {}) }).catch(onThrow);
    const covered = bundled.status === "bundled" ? (bundled.proposal.pageUrl ?? "").trim().toLowerCase() : "";
    const path = bundled.status === "bundled" ? (bundled.proposal.pagePath ?? "").trim().toLowerCase() : "";
    if (bundled.status !== "bundled" || (!selectedKeys.has(covered) && !selectedKeys.has(path))) {
      log.info("[produce-proposals] no bundle this pass", { tenantId, page: d.pageUrl, door: d.door,
        reason: bundled.status === "bundled" ? "page no door selected" : bundled.reason });
      // THE REFUSAL BELONGS ON THE RECEIPT, beside the door the page came through, not only in a log. A REFUSAL IS NOT COPY, though: a split's own card is minted from the diagnosis above, in this file's own words, so an internal refusal string never reaches an operator and never churns a stored row.
      if (bundled.status !== "bundled") { enteredBy.set(d.pageUrl, `${d.entry} ${bundled.reason}`); for (const k of pageKeys(d.pageUrl)) blocked.set(k, { reason: bundled.reason, ...(bundled.considered?.length ? { considered: bundled.considered } : {}) }); }
      continue;
    }
    const page = bundled.proposal.pagePath;
    for (let i = proposals.length - 1; i >= 0; i--) if (proposals[i]!.kind === "existing_edit" && proposals[i]!.pagePath === page) proposals.splice(i, 1);
    const proposal = stamp(bundled.proposal);
    proposals.push(proposal);
    await persistIfChanged(proposal);
    enteredBy.set(d.pageUrl, d.entry);
  }

  const suggested = await withSuggestions(proposals);
  // EVERY OTHER WAY THE QUEUE FILLS ITSELF, off stored evidence and no dollars. Guarded on purpose: a producer that is not there, or throws, narrows this pass rather than failing it.
  const extra = await import("./producers/extra").then((m) => m.extraQueueCards({ tenantId, snapshot, now: opts.now ?? new Date(), curve, reads: pageReads }))
    .catch(() => ({ cards: [] as ChangeProposal[], complete: false, held: [], needsOwnPage: [], families: [] as string[] }));
  // A SEARCH NO PAGE OF THIS ACCOUNT IS FOR IS BANKED, NOT LOGGED: the producers own the verdict, the coverage walk owns what happens next, and it happens only once the search has earned it. Read defensively, so a producer not surfacing them yet banks nothing. THEN THE WORDS GO ON THE CARDS, after the $0 producers and never inside one, so a budget block changes which cards CARRY COPY, never which exist or which are swept.
  const owed = (extra as { needsOwnPage?: Array<{ query: string; refusedPages?: string[] }> }).needsOwnPage ?? [];
  if (persist && owed.length > 0) await recordCoverageNeeds(tenantId, owed, opts.now ?? new Date()).catch(() => undefined);
  // THE BOUNDARY IS ASKED BEFORE THE MONEY IS SPENT: a card the diagnosis will not authorize is not worth paying to write.
  const allowed: ChangeProposal[] = []; for (const c of extra.cards) if (await admit(c)) allowed.push(c);
  const drafted = await applyDraftedCopy(allowed,{ tenantId, snapshot, now: opts.now ?? new Date(), complete: opts.complete, bypassCache: opts.bypassCache, bannedTerms, attempts }).catch(() => allowed); // the account's own vocabulary AND the pass's one attempt budget reach the editor
  // Stamped with THIS pass's basis, or the actionable door refuses every one as drafted under an older bar.
  for (const raw of drafted) { const p = { ...raw, ...(basis ? { basis } : {}) }; proposals.push(p); await persistIfChanged(p); }
  // THE ONE READ A DEEP PASS SAID IT NEEDED, ONTO THE CARD THAT ALREADY SPEAKS FOR THAT PAGE, because a card for a page whose work is not written yet is minted BEFORE that read runs. Only a research card, never a change with copy on it. A REFUSAL IS NOT AN INSTRUCTION, though: numbered under "Read this twice, then:" it read as the thing to go and do, which is the one thing it says nobody can do yet, so it lands as the "not yet" line under the card. A REFUSAL THAT RULES OUT AN ACTION IS THE MOST USEFUL THING ON THE CARD, and it is shown: the ownership card names which page the figures keep and never what settling it takes, so the producer's structural "no merge here, and here are the sections that rule it out" is the answer rather than a contradiction (2026-08-14, when suppressing it hid the truth and left the falsehood standing).
  for (let i = 0; i < proposals.length; i += 1) {
    const p = proposals[i]!, block = pageKeys(p.pageUrl).map((k) => blocked.get(k)).find(Boolean), notYet = block ? `Not yet, because ${block.reason}` : "";
    if (!block || p.bundle || p.researchOnly !== true || (p.operatorSteps ?? []).includes(block.reason) || (p.limitations ?? []).includes(notYet)) continue;
    proposals[i] = { ...p, limitations: [...(p.limitations ?? []), notYet], evidence: { ...p.evidence, hints: [...p.evidence.hints, block.reason], evidenceRefCount: p.evidence.evidenceRefCount + 1 } };
    await persistIfChanged(proposals[i]!); }
  // A PROVEN FALL WITH NO DRAFTING EVIDENCE IS STILL WORK: no door reaches it and no producer can write for it, so the loss was invisible. It gets the ONE card naming what is missing, ranked on what it LOST.
  for (const card of researchingCards({ ...wiring(), judged: candidates, queryKeyOf: canonicalQueryKey, blocked,
    serpQueryKeys: new Set(snapshot.research.serpEvidence.map((e) => canonicalQueryKey(e.query))),
    skip: new Set(proposals.flatMap((p) => [(p.pagePath ?? "").toLowerCase(), (p.pageUrl ?? "").toLowerCase()])) })) {
    proposals.push(card); await persistIfChanged(card);
  }
  // EACH PRODUCER SWEEPS ITS OWN FAMILIES, and only the one that finished sweeps at all.
  extraHeld.push(...(extra.held ?? []));
  // Per-family precision: a dead evidence source holds ITS families out of the sweep without freezing the rest.
  await sweepStale([suggested, { families: (extra as { families?: string[] }).families ?? [...EXTRA_FAMILIES], complete: extra.complete },
    { families: ["ownership", "researching"], complete: gscComplete }]);
  // The honest ending. A write that failed on EVERY attempt is a failure, not a quiet day.
  const outcome: ProducerOutcome =
    writeFailures > 0 && persisted === 0 ? "persistence_failed"
      : proposals.length > 0 ? "proposals_persisted"
        : acted.length + consolidating > 0 ? "actionable_but_no_trusted_draft"
          : investigating > 0 ? "investigating" : "no_actionable_candidate";
  // WHAT THIS PASS SPENT, OFF THE BUDGET OBJECTS THEMSELVES, so the receipt is arithmetic rather than a claim: attempts made against the pool, and page readings bought against theirs.
  log.info("[produce-proposals] paid work this pass", { tenantId, attemptsMade: MAX_PAID_CALLS - Math.max(0, attempts.left), attemptsLeft: Math.max(0, attempts.left), pageReadsMade: MAX_NEW_READS_PER_PASS - Math.max(0, pageReads.left), pageReadsLeft: Math.max(0, pageReads.left) });
  if (outcome !== "proposals_persisted") log.warn("[produce-proposals] pass produced no durable work", { tenantId, outcome, actionable: acted.length, noDraft, writeFailures });
  return { proposals: await rankAndStamp(proposals), candidates: runReceipt(), outcome,
    actionable: acted.length + consolidating, investigating, noDraft, persisted, reused, heldForMeasurement, ...research };
}
