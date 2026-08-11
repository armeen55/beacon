/**
 * decision/produce-proposals: the ONE server path that turns a tenant's cached evidence into persisted ChangeProposals. loadEvidenceSnapshot ($0) -> compileCandidates (act / watch / do nothing) ->
 * candidatesToEvidenceInputs (only what EARNED an action) -> the cold, gated, budgeted drafter plus the ONE validator -> saveChangeProposal. PAID DRAFTING IS BOUNDED to the strongest DEFAULT_MAX_DRAFTS pages.
 * The deep read has FIVE doors (deep-candidates.ts) and each page carries the door it came through. Three halves reach the operator: the strict drafts, every concrete edit the held evidence supports
 * (suggested-edits.ts) and the $0 extras (producers/extra.ts), the last two at needs_review. ONE EVIDENCE BASIS, ONE ROW: an unchanged fingerprint is never re-drafted and never re-inserted.
 * Publishing stays MANUAL: this only proposes. server-only.
 */
import "server-only";

import { log } from "@/lib/logger";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
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
import { confidenceFor, proposalId, type ActionDiagnosis, type ChangeProposal, type EvidenceReadiness } from "./contracts";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { loadOwnedPageBodies } from "@/domains/evidence/pages/owned-context";
import { buildTopicInvestigations, type TopicInvestigation } from "@/domains/evidence/topic-investigation";
import { earnedNewPage, type IntersectionEvidence } from "./coverage-adjudication";
import { extractPageFacts, readWinningPattern } from "./winning-pattern";
import { readCoverage, type DecidedTopic } from "./coverage-pass";
import { readInventory } from "@/domains/evidence/scanning/owned-pages-store";
import { readTechnicalFindings } from "./technical-findings";
import { buildNewPageProposal } from "./new-page";
import { suggestedEdits } from "./suggested-edits";

export type ProduceProposalsOptions = ProposeOptions & {
  /** A TEST SEAM ONLY: production reads the stored comparison out of the canonical evidence, nothing live passes this, and passing it skips that read. */
  intersection?: IntersectionEvidence;
  /** Hard cap on how many opportunities we draft this pass (budget guard). */
  maxDrafts?: number;
  /** The pages still being measured, when the caller knows them: preferred over any derivation here. */
  measuringPagePaths?: readonly string[];
  /** Persist each landed proposal (default true). Tests pass false to stay pure. */
  persist?: boolean;
};

/** How this pass ended. Only `persistence_failed` is a failure; `investigating` is the honest middle: proven gaps exist and what to change is not known yet, so they must be VISIBLE rather than read as a quiet day. */
export type ProducerOutcome =
  | "evidence_unreadable"
  | "no_actionable_candidate"
  | "investigating"
  | "actionable_but_no_trusted_draft"
  | "persistence_failed"
  | "proposals_persisted";

export type ProduceProposalsResult = {
  /** The ranked proposals this pass produced (may be empty and still a success). */
  proposals: ChangeProposal[];
  /** Every page and topic the diagnosis judged, act or not: the run receipt. */
  candidates: QualifiedCandidate[];
  /** Which of the four honest endings this pass reached. */
  outcome: ProducerOutcome;
  /** How many candidates earned an action: a page to edit, plus every consolidation this kernel cannot draft yet. */
  actionable: number;
  /** Proven gaps whose cause is not identified yet: real work, not silence. */
  investigating: number;
  /** How many drafts failed closed (off / budget / validation). */
  noDraft: number;
  /** Material rows actually written this pass. */
  persisted: number;
  /** Drafts the store REFUSED to file because the page already carries a change I am still measuring. */
  heldForMeasurement: number;
  /** Proposals carried forward unchanged: no draft, no write, no dollars. */
  reused: number;
  /** What I have investigated about each topic, over the SAME evidence this pass judged. Research only. */
  investigations: TopicInvestigation[];
  /** THE topic whose evidence reached a final answer this pass, read off the one canonical pass Runtime buys
   *  evidence from. Null while every topic is still an investigation, which is the normal answer. */
  coverage: DecidedTopic | null;
  /** The earliest date any page this pass could not read may be tried again, from the SAME canonical
   *  coverage pass. Null when nothing is waiting. It is what stops a surface saying "checking". */
  waitingUntil: string | null;
};

/** Bounded drafting: the strongest few, never a queue. */ export const DEFAULT_MAX_DRAFTS = 5;
const MAX_INVENTORY = 200; // one bounded page of this account's own inventory, never the whole site

/** THE ONE PAGE OF MINE A VERDICT DECIDED TO IMPROVE, as facts, out of words this pass ALREADY holds. Null for `create_new`, and null when I do not hold its own words. */
function ownedFactsFor(snapshot: EvidenceSnapshot, decided: DecidedTopic): ReturnType<typeof extractPageFacts>[number] | null {
  if (decided.decision.verdict !== "improve_existing") return null;
  const url = decided.decision.ownedUrls[0];
  const held = decided.candidates.find((c) => c.url === url && c.bodyHeld);
  if (!held) return null;
  const at = (u: string): string => { try { return new URL(u.startsWith("http") ? u : `https://${u}`).pathname.replace(/\/+$/, "") || "/"; } catch { return u; } };
  const row = snapshot.ownedPages.find((p) => at(p.url) === at(held.url))?.content ?? null;
  return extractPageFacts([{ url: held.url, extract: { title: held.title, h1: held.h1, wordCount: held.wordCount,
    headings: row?.outline ?? null, faqCount: row?.faqCount ?? null, openingSample: held.openingSample, entityNames: held.entities } }])[0] ?? null;
}

/** Normalized keys a candidate and a proposal can be matched on. */
const pageKeys = (pageUrl: string | null | undefined): string[] => {
  const url = (pageUrl ?? "").trim().toLowerCase();
  if (!url) return [];
  try { return [url, new URL(url.startsWith("http") ? url : `https://${url}`).pathname || "/"]; } catch { return [url]; }
};

/** The pages still being measured: what the caller passed, else the Shipment STAMPS (Decision -> Measurement is
 *  the allowed direction), else the drafted dates of the applied rows in hand. Fail-soft. */
async function measuringPaths(tenantId: string, existing: Map<string, ChangeProposal>, opts: ProduceProposalsOptions): Promise<string[]> {
  if (opts.measuringPagePaths) return [...opts.measuringPagePaths];
  const shipped = await import("@/domains/measurement/proof-gsc/shipped-change-store")
    .then((m) => m.pagesUnderMeasurementFromShipments(tenantId, opts.now)).catch(() => [] as string[]);
  return shipped.length > 0 ? shipped : pagesUnderMeasurement(existing.values(), opts.now);
}

/** TWO CONSECUTIVE 28-DAY WINDOWS PER PAGE, Google's and GA4's side by side. It is the only read that can tell
 *  "Google moved this page" apart from "something on this page stopped working", and it is $0: both halves are
 *  already-synced rows. Fail-soft to an empty map, which means no diagnostic is written rather than a guess. */
async function twoWindows(tenantId: string, now: Date | undefined): Promise<Map<string, { positionNow: number; positionPrior: number; sessionsNow: number; sessionsPrior: number; lostClicks: number }>> {
  const out = new Map<string, { positionNow: number; positionPrior: number; sessionsNow: number; sessionsPrior: number; lostClicks: number }>();
  const [decay, visits] = await Promise.all([
    import("@/domains/evidence/readers/gsc-page-signals").then((m) => m.loadGscDecaySignalsForTenant(tenantId, now ?? new Date())).catch(() => null),
    import("@/domains/evidence/readers/ga4-page-values").then((m) => m.loadGa4SessionSplitForTenant(tenantId, now ?? new Date())).catch(() => null),
  ]);
  if (!decay) return out;
  for (const [url, d] of decay) {
    const v = visits?.get(url);
    out.set(url, { positionNow: d.positionNow, positionPrior: d.positionPrior,
      sessionsNow: v?.now ?? 0, sessionsPrior: v?.prior ?? 0, lostClicks: Math.max(0, d.clicksPrior - d.clicksNow) });
  }
  return out;
}

/** WHAT EACH KIND OF CHANGE HAS ACTUALLY DONE ON THIS SITE, off the finished readings in its own ledger: how
 *  many finished, and the net clicks they moved against the pages nobody changed. Fail-soft to nothing. */
async function familyHistoryOf(tenantId: string, now: Date | undefined): Promise<Map<string, { readings: number; netLift: number }>> {
  const out = new Map<string, { readings: number; netLift: number }>();
  const ledger = await import("@/domains/measurement/proof-gsc/load-ledger").then((m) => m.loadProofLedgerPersisted(tenantId)).catch(() => null);
  if (!ledger) return out;
  const { actionFamilyOf } = await import("@/domains/measurement/proof-gsc/change-family");
  for (const r of ledger) {
    const read = [...r.windows].filter((w) => w.ran && (w.controlsUsed ?? 0) > 0 && w.adjustedLift != null && w.day >= 28)
      .sort((a, b) => b.day - a.day)[0];
    if (!read) continue;
    const key = actionFamilyOf(r.actionType);
    const cur = out.get(key) ?? { readings: 0, netLift: 0 };
    out.set(key, { readings: cur.readings + 1, netLift: cur.netLift + Math.round(read.adjustedLift!) });
  }
  return out;
}

/**
 * Produce (and by default persist) ranked ChangeProposals for one tenant from cached evidence only. Never throws on a single-source outage: a failed source simply narrows the snapshot.
 */
export async function produceProposalsForTenant(
  tenantId: string,
  opts: ProduceProposalsOptions = {},
): Promise<ProduceProposalsResult> {
  const maxDrafts = opts.maxDrafts ?? DEFAULT_MAX_DRAFTS;
  const persist = opts.persist ?? true;

  const snapshot = await loadEvidenceSnapshot(tenantId, { now: opts.now });
  // A SOURCE THAT DID NOT ANSWER IS NOT AN ACCOUNT WITH NOTHING IN IT: a GSC read that threw makes every page read clean, so the pass ENDS HERE rather than retiring the whole queue. Empty is not failed.
  if (snapshot.sources.some((s) => s.source === "gsc" && s.status === "failed")) {
    log.warn("[produce-proposals] the search data did not answer, so this pass changes nothing", { tenantId });
    return { proposals: [], candidates: [], outcome: "evidence_unreadable", actionable: 0, investigating: 0,
      noDraft: 0, persisted: 0, reused: 0, heldForMeasurement: 0, investigations: [], coverage: null, waitingUntil: null };
  }
  // The account-curated trusted-source domains are BusinessProfile DATA, never code.
  const profile = await loadBusinessProfile(tenantId).catch(() => null);
  const allowlist =
    opts.authoritativeSourceDomains ?? profile?.trustedSourceDomains.value ?? [];

  // The basis this pass generates under: the SAME fingerprint Runtime and the Evidence funnel scope their derived work with, so a proposal the evidence no longer satisfies becomes history. Fail-soft to null.
  const basis = await resolveCurrentBasis(tenantId, profile);

  // ONE read of what is already durable, taken BEFORE anything is judged.
  const existing = persist
    ? await loadChangeProposals(tenantId).catch(() => new Map<string, ChangeProposal>())
    : new Map<string, ChangeProposal>();
  /** The drafts I already took back under this basis: history, so not in the map above, and without this read the next pass would pay to redraft every safety failure. */
  const withdrawn = persist ? await withdrawnProposalIds(tenantId, basis) : new Set<string>();
  /** THE measurement context, derived once and shared by the diagnosis and both rankings. THE STAMP IS WHAT
   *  RANKS: a Shipment holds the moment the change was implemented, which the 28-day window is read from. */
  const measuring = { measuringPagePaths: await measuringPaths(tenantId, existing, opts) };
  // THE TWO WINDOWS, AND WHAT THIS ACCOUNT'S OWN FINISHED READINGS SAY. Both are $0 reads of stored rows, both
  // fail soft to nothing, and neither can create work: one lets a page name a fall Google did not cause, the other lets a kind of change that has lost three times running rank below one that has been winning.
  const [windows, familyHistory] = await Promise.all([twoWindows(tenantId, opts.now), familyHistoryOf(tenantId, opts.now)]);

  // THE RESEARCH PACKETS, over the same evidence this pass judges. Non-actionable by construction.
  let investigations: TopicInvestigation[] = [];
  try { investigations = buildTopicInvestigations(snapshot); } catch (e) {
    log.warn("[produce-proposals] investigations failed (fail-soft)", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  // THE ONE CANONICAL COVERAGE PASS, the same one Runtime buys evidence off. $0, deterministic, fail-soft.
  const technical = readTechnicalFindings({
    inventory: await readInventory(tenantId, { limit: MAX_INVENTORY }).catch(() => []),
    pages: snapshot.ownedPages.filter((p) => !!p.content).map((p) => ({ url: p.url, title: p.content!.title,
      h1: p.content!.h1, internal_links: p.content!.internalLinks.map((l) => l.href),
      canonical_url: p.content!.canonicalUrl ?? null, has_canonical_mismatch: p.content!.hasCanonicalMismatch ?? null,
      robots_meta: p.content!.robotsMeta ?? null })),
  });
  let coverage: DecidedTopic | null = null;
  let waitingUntil: string | null = null;
  try {
    const read = await readCoverage(snapshot, tenantId, { basis, profile, now: opts.now, intersection: opts.intersection, technical });
    coverage = read.decided;
    waitingUntil = read.waitingUntil;
    // THE PATTERN IS COMPUTED HERE, never inside readCoverage, which is a render path. One bounded cached
    // call for the ONE topic that earned a verdict, then one free re-read. Fail-soft: no pattern, same verdict.
    if (coverage && (coverage.decision.verdict === "create_new" || coverage.decision.verdict === "improve_existing")
      && coverage.investigation.currentReadableWinners >= 2 && !coverage.decision.pattern) {
      // ONLY THE WINNERS I CURRENTLY HOLD A READ OF: the denominator is exactly what I read and still hold.
      const mine = new Set(coverage.investigation.winners.filter((w) => w.extractState === "current").map((w) => w.url));
      const facts = extractPageFacts((snapshot.research.winningPages ?? []).filter((r) => mine.has(r.url)));
      // THE PAGE BEING COMPARED AGAINST IS SHOWN, OR NO GAP MAY BE WRITTEN.
      const owned = ownedFactsFor(snapshot, coverage);
      const pattern = await readWinningPattern(facts, owned, tenantId,
        { complete: opts.complete, now: opts.now, pageType: coverage.investigation.pageType, label: coverage.investigation.label }).catch(() => null);
      if (pattern) {
        const again = await readCoverage(snapshot, tenantId, { basis, profile, now: opts.now, intersection: opts.intersection,
          patternFor: { topicKey: coverage.investigation.key, pattern } }).catch(() => null);
        if (again?.decided) { coverage = again.decided; waitingUntil = again.waitingUntil; }
      }
    }
  } catch (e) {
    log.warn("[produce-proposals] coverage verdict failed (fail-soft)", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  const research = { investigations, coverage, waitingUntil };

  // THE DIAGNOSIS FIRST: doing nothing is the default and only a proven gap is work.
  const candidates = compileCandidates(snapshot, { coverage, ...measuring });
  const acted = candidates.filter((c) => c.action === "act_existing_page");
  const recoverableByKey = new Map<string, number>();
  const readinessByKey = new Map<string, EvidenceReadiness>();
  const diagnosisByKey = new Map<string, ActionDiagnosis>();
  /** THE CAUSE LADDER'S WHOLE FINDING, indexed by page alone, not by query: one page gets one reading. */
  const causeByKey = new Map<string, CauseFinding>();
  for (const c of acted) {
    for (const k of pageKeys(c.pageUrl)) {
      recoverableByKey.set(k, c.recoverableClicks);
      causeByKey.set(k, c.cause);
      // Readiness is a fact about ONE page and ONE EXACT SEARCH, never about a page alone.
      if (c.readiness && c.query) readinessByKey.set(`${k}::${canonicalQueryKey(c.query)}`, c.readiness);
      if (c.diagnosis && c.query) diagnosisByKey.set(`${k}::${canonicalQueryKey(c.query)}`, c.diagnosis);
    }
  }
  /** Stamp the basis, the ONE ranking scalar (recoverable clicks), the cause the ladder named, and CONFIDENCE
   *  BY EVIDENCE COMPLETENESS, whichever producer built it. Never invents a figure. */
  const stamp = (p: ChangeProposal): ChangeProposal => {
    const key = (p.pageUrl ?? "").trim().toLowerCase();
    const pathKey = (p.pagePath ?? "").trim().toLowerCase();
    const recoverable = recoverableByKey.get(key) ?? recoverableByKey.get(pathKey);
    // Only the readiness measured for THIS proposal's own search may set its confidence.
    const qk = canonicalQueryKey(p.primaryQuery);
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

  /** RECOVERY BEFORE DISCOVERY. A page that lost real clicks while its ranking held is worth what it LOST, and
   *  a guess about a page that never had those clicks is not. The lost figure never lowers a proven one. */
  const lostByKey = new Map([...windows].flatMap(([url, w]) => pageKeys(url).map((k) => [k, w.lostClicks] as const)));
  const recovered = (p: ChangeProposal): ChangeProposal => {
    const lost = lostByKey.get((p.pageUrl ?? "").trim().toLowerCase()) ?? lostByKey.get((p.pagePath ?? "").trim().toLowerCase()) ?? 0;
    // THE NEW NUMBER SAYS WHERE IT CAME FROM, or the card's own sentence and the order disagree out loud.
    return lost > (p.impactScore ?? 0) ? { ...p, impactScore: lost,
      whyItMatters: `${p.whyItMatters} This page also lost ${lost.toLocaleString("en-US")} clicks against the four weeks before, and that fall is what it is ranked on here.` } : p;
  };

  const held = [...existing.values()].filter((p) => p.status !== "implemented_pending_verification");
  /** A stored row generated under THIS basis. Null basis proves nothing, so it reuses nothing: an account I cannot read must never freeze its own queue. */
  const current = (p: ChangeProposal): boolean => basis != null && p.basis === basis;
  const currentById = (id: string): ChangeProposal | null => {
    const p = existing.get(id);
    return p && p.status !== "implemented_pending_verification" && current(p) ? p : null;
  };
  const currentBundleFor = (match: (p: ChangeProposal) => boolean): ChangeProposal | null =>
    live.find((p) => !!p.bundle && current(p) && match(p)) ?? null;

  // A CHANGE THAT CANNOT SHOW ITS WORK, OR WHOSE READINGS WENT COLD, IS TAKEN BACK, on the SAME verdict every door asks.
  const retired = new Set<string>();
  /** THE ONE WAY A CHANGE LEAVES: a change nothing supports is not a change to look at more carefully. */
  const retire = async (p: ChangeProposal): Promise<void> => { if (persist) await withdrawChangeProposal(p); existing.delete(p.id); retired.add(p.id); };
  for (const p of held) {
    if (!p.bundle || actionableProposalFailures(p, { tenantId: p.tenantId, currentBasis: p.basis ?? null, now: opts.now }).length === 0) continue;
    await retire(p);
  }
  const live = held.filter((p) => !retired.has(p.id));
  // A HOLD HAPPENS WHERE THE DECISION IS MADE, NOT WHERE THE ROW IS WRITTEN.
  const heldByDiagnosis = candidates.filter((c) => c.cause.cause === "measuring_change").length;
  let persisted = 0, writeFailures = 0, reused = 0, heldForMeasurement = heldByDiagnosis;
  /** Persist ONE material row, or nothing when the stored row already says exactly this. THE STORE decides
   *  that against the canonical row it holds, and this pass records the four answers it can get back. */
  const persistIfChanged = async (p: ChangeProposal): Promise<void> => {
    if (!persist) return;
    const result = await saveChangeProposal(p);
    if (result === "failed") writeFailures += 1;
    else if (result === "saved") persisted += 1; // "unchanged" wrote nothing, so it counts as nothing
    else if (result === "blocked") heldForMeasurement += 1;
    existing.set(p.id, p);
  };

  const proposals: ChangeProposal[] = [];
  /** THE GENEROUS HALF OF THE QUEUE: every concrete edit the held evidence supports, at needs_review. Ready is
   *  untouched, and nothing here re-drafts a page the strict path already covered. */
  const withSuggestions = async (strict: ChangeProposal[]): Promise<ChangeProposal[]> => {
    const skip = new Set([...strict.flatMap((p) => [p.id, (p.pagePath ?? "").trim().toLowerCase()]), ...withdrawn]);
    for (const s of suggestedEdits(snapshot, candidates, { now: opts.now ?? new Date(), basis, skip, windows })) {
      if (existing.get(s.id)?.status === "implemented_pending_verification") { heldForMeasurement += 1; continue; }
      strict.push(s);
      await persistIfChanged(s);
    }
    // A GUESS THE GENERATOR NO LONGER STANDS BEHIND IS TAKEN BACK: after the rules changed, a stored
    // suggestion this pass did not re-emit is stale advice, and serving it beside the card that replaced
    // it is how a query-pasted title outlived its own fix. Only untouched needs_review guess rows with no
    // deep bundle qualify; anything the operator acted on, and every other producer's work, stays.
    const emitted = new Set(strict.map((p) => p.id));
    let staleTakenBack = 0;
    for (const [id, row] of existing) {
      if (emitted.has(id) || row.status !== "needs_review" || row.bundle) continue;
      if (!/::existing_edit::(title|h1)$/.test(id)) continue;
      if (persist && (await withdrawChangeProposal(row).catch(() => false))) staleTakenBack += 1;
    }
    if (staleTakenBack > 0) log.info("[produce-proposals] stale guesses withdrawn", { tenantId, staleTakenBack });
    return strict;
  };
  // A SUBJECT THIS ACCOUNT HAS NO PAGE FOR: an EARNED create_new verdict is the only road to one.
  const decided = coverage;
  if (decided && earnedNewPage(decided.decision)) {
    // An id this case ABSORBED still names this case's page, or a merge builds a second page for one subject.
    const ids = [decided.investigation.key, ...decided.investigation.aliasKeys];
    const heldPage = live.find((p) => p.kind === "new_page" && current(p) && ids.some((k) => p.id.includes(`::${k}::`))) ?? null;
    if (heldPage) { proposals.push(heldPage); reused += 1; }
    else {
      const built = await buildNewPageProposal(decided, tenantId, { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache })
        .catch((e) => ({ status: "none" as const, reason: e instanceof Error ? e.message : String(e) }));
      if (built.status === "built") { const page = { ...built.proposal, ...(basis ? { basis } : {}) }; proposals.push(page); await persistIfChanged(page); }
      else log.info("[produce-proposals] no new page this pass", { tenantId, reason: built.reason });
    }
  }

  const bound = Math.min(DEFAULT_MAX_DRAFTS, maxDrafts);
  const inputs = candidatesToEvidenceInputs(snapshot, acted).slice(0, bound);
  // WHICH PAGES EARN THE DEEP READ. SELECTION ONLY: nothing here drafts, buys, or invents a figure.
  const deep = selectDeepCandidates({ snapshot, candidates, coverage, limit: bound });

  const investigating = candidates.filter((c) => c.action === "research_needed").length;
  // A CONSOLIDATION IS WORK, NOT SILENCE: a split nothing can draft yet is counted here, not passed over.
  const consolidating = candidates.filter((c) => c.action === "consolidate").length;
  if (acted.length === 0 && deep.length === 0) {
    log.info("[produce-proposals] nothing earned an action this pass", { tenantId, judged: candidates.length,
      watching: candidates.filter((c) => c.action === "watch").length + consolidating, researching: investigating });
    // A proven gap with no explanation yet is NOT a quiet day, and neither is one that cannot be drafted.
    await withSuggestions(proposals);
    return { proposals: rankProposals(proposals.map(recovered), { ...measuring, familyHistory }), candidates,
      outcome: proposals.length > 0 ? "proposals_persisted"
        : investigating > 0 ? "investigating"
          : consolidating > 0 ? "actionable_but_no_trusted_draft" : "no_actionable_candidate",
      actionable: consolidating, investigating, noDraft: 0, persisted, reused, heldForMeasurement, ...research };
  }

  /** Every page a door selected, by both of its keys, so a bundle for a page THIS PASS DID NOT SELECT
   *  is dropped exactly as the single-door pass dropped one for a page nothing proved. */
  const selectedKeys = new Set(deep.flatMap((d) => pageKeys(d.pageUrl)));
  /** The deep bundle each selected page already holds under the current basis, keyed by that page. */
  const heldDeep = new Map<string, ChangeProposal>();
  for (const d of deep) {
    const keys = pageKeys(d.pageUrl);
    const has = currentBundleFor((p) => p.kind === "existing_edit" && keys.includes((p.pagePath ?? "").trim().toLowerCase()));
    if (has) heldDeep.set(d.pageUrl, has);
  }
  const enteredBy = new Map<string, string>(); // which door each page that got a deep change came through

  // A CHANGE MAY NOT OUTLIVE ITS OWN EXPLANATION, and ONLY about a page this pass ACTUALLY READ, or a half-read site retires every change on the half it never saw.
  const readNow = new Set(snapshot.ownedPages.flatMap((o) => pageKeys(o.url)));
  const provenNow = new Set([...acted.flatMap((c) => pageKeys(c.pageUrl)), ...selectedKeys]);
  for (const p of live) {
    const key = (p.pagePath ?? "").trim().toLowerCase();
    if (!p.bundle || p.kind !== "existing_edit" || !current(p) || retired.has(p.id) || !readNow.has(key) || provenNow.has(key)) continue;
    await retire(p);
  }
  // AND THE PAGE NOBODY EARNED. A new page rests on ONE coverage verdict, and only a pass that actually REACHED a verdict may retire one, so a research gap never destroys real work.
  if (decided) for (const p of live) {
    if (p.kind !== "new_page" || !current(p) || retired.has(p.id)) continue;
    if (earnedNewPage(decided.decision) && [decided.investigation.key, ...decided.investigation.aliasKeys].some((k) => p.id.includes(`::${k}::`))) continue;
    await retire(p);
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
    const outcome = await proposeExistingPageChange(input,
      { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache, authoritativeSourceDomains: allowlist }).catch((e) => {
      log.warn("[produce-proposals] propose threw (fail-soft)", { tenantId, id: input.opportunity.query, error: e instanceof Error ? e.message : String(e) });
      return { status: "no_draft" as const, reason: "threw", drafterStatus: "error" };
    });
    if (outcome.status !== "ready") {
      noDraft += 1;
      // A REFUSED DRAFT IS FILED, NOT FORGOTTEN: history is what stops the next pass paying to fail twice.
      if (outcome.status === "withdrawn" && persist) await withdrawChangeProposal(stamp(outcome.proposal));
      continue;
    }
    const proposal = stamp(outcome.proposal);
    proposals.push(proposal);
    await persistIfChanged(proposal);
  }

  // ONE bundle per SELECTED page, strongest door first. A bundle REPLACES its own shallow drafts.
  const bundleOpts = { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache, authoritativeSourceDomains: allowlist, technical };
  const onThrow = (e: unknown) => {
    log.warn("[produce-proposals] bundle threw (fail-soft)", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return { status: "none" as const, reason: "threw" };
  };

  for (const d of deep) {
    // What reaches here is a stored bundle that still shows its work, carried forward.
    const heldBundle = heldDeep.get(d.pageUrl) ?? null;
    if (heldBundle) {
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
    // Every page THIS CASE IS ABOUT gets its own words read, through the targeted Evidence reader. Fail-soft.
    const bodyByUrl = await loadOwnedPageBodies(tenantId, [d.pageUrl, ...d.evidence.competingUrls]).catch(() => null);
    // THE DOOR TRAVELS WITH THE PAGE, so a page an engine skipped is never explained in the click door's words.
    const bundled = await produceBundleForSnapshot(snapshot, { ...bundleOpts, onlyPageUrl: d.pageUrl, door: d,
      coverage, ...measuring, ...(bodyByUrl ? { bodyByUrl } : {}) }).catch(onThrow);
    const covered = bundled.status === "bundled" ? (bundled.proposal.pageUrl ?? "").trim().toLowerCase() : "";
    const path = bundled.status === "bundled" ? (bundled.proposal.pagePath ?? "").trim().toLowerCase() : "";
    if (bundled.status !== "bundled" || (!selectedKeys.has(covered) && !selectedKeys.has(path))) {
      log.info("[produce-proposals] no bundle this pass", { tenantId, page: d.pageUrl, door: d.door,
        reason: bundled.status === "bundled" ? "page no door selected" : bundled.reason });
      // THE REFUSAL BELONGS ON THE RECEIPT, beside the door the page came through, not only in a log.
      if (bundled.status !== "bundled") enteredBy.set(d.pageUrl, `${d.entry} ${bundled.reason}`);
      continue;
    }
    const page = bundled.proposal.pagePath;
    for (let i = proposals.length - 1; i >= 0; i--) {
      const p = proposals[i]!;
      if (p.kind === "existing_edit" && p.pagePath === page) proposals.splice(i, 1);
    }
    const proposal = stamp(bundled.proposal);
    proposals.push(proposal);
    await persistIfChanged(proposal);
    enteredBy.set(d.pageUrl, d.entry);
  }

  await withSuggestions(proposals);
  // EVERY OTHER WAY THE QUEUE FILLS ITSELF, off stored evidence and no dollars. Guarded on purpose: a producer that is not there, or throws, narrows this pass rather than failing it.
  const extra = await import("./producers/extra").then((m) => m.extraQueueCards({ tenantId, snapshot, now: opts.now ?? new Date() })).catch(() => [] as ChangeProposal[]);
  // Stamped with THIS pass's basis, or the actionable door refuses every one as drafted under an older bar.
  for (const raw of extra) { const p = { ...raw, ...(basis ? { basis } : {}) }; proposals.push(p); await persistIfChanged(p); }
  // The honest ending. A write that failed on EVERY attempt is a failure, not a quiet day.
  const outcome: ProducerOutcome =
    writeFailures > 0 && persisted === 0 ? "persistence_failed"
      : proposals.length > 0 ? "proposals_persisted"
        : acted.length + consolidating > 0 ? "actionable_but_no_trusted_draft"
          : investigating > 0 ? "investigating" : "no_actionable_candidate";
  if (outcome !== "proposals_persisted") {
    log.warn("[produce-proposals] pass produced no durable work", { tenantId, outcome, actionable: acted.length, noDraft, writeFailures });
  }
  // THE RUN RECEIPT SAYS WHICH DOOR EACH DRAFTED PAGE CAME THROUGH.
  const receipt = enteredBy.size === 0 ? candidates
    : candidates.map((c) => { const entry = enteredBy.get(c.pageUrl ?? ""); return entry ? { ...c, reason: `${c.reason} ${entry}` } : c; });
  return { proposals: rankProposals(proposals.map(recovered), { ...measuring, familyHistory }), candidates: receipt, outcome,
    actionable: acted.length + consolidating, investigating, noDraft, persisted, reused, heldForMeasurement, ...research };
}
