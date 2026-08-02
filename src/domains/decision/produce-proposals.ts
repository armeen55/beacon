/**
 * decision/produce-proposals: the ONE server path that turns a tenant's cached evidence into persisted
 * ChangeProposals - loadEvidenceSnapshot ($0, six cached sources) -> compileCandidates (the honest diagnosis:
 * act / watch / do nothing) -> candidatesToEvidenceInputs (only what EARNED an action) ->
 * proposeExistingPageChange (cold, gated, budgeted drafter plus the ONE validator) -> saveChangeProposal
 * (durable, fail-soft). BOUNDED: at most the strongest DEFAULT_MAX_DRAFTS pages by recoverable clicks. AT
 * WORST three deep bundles, each drafting up to seven sections, is about $0.45 at the drafter's documented
 * per-call estimates, and that is the number the spend cap is read against.
 *
 * THE DEEP READ HAS FIVE DOORS, NOT ONE (see deep-candidates.ts), and each page carries the door it came
 * through so the producer proves THAT door's case. Selection widened; drafting did not: the SAME producer
 * runs per selected page, still bounded to DEFAULT_MAX_DRAFTS, still refusing on thin evidence.
 *
 * Every honest ending is named on `ProducerOutcome`, so an empty queue never reads as an outage.
 *
 * ONE EVIDENCE BASIS, ONE ROW: a candidate whose current-generation proposal already exists is never
 * redrafted, and a proposal whose fingerprint is unchanged is never re-inserted, so a refresh re-pays nothing.
 * COLD by default: the drafter's `complete` fn is injectable, so tests run this path with zero paid calls.
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
import { loadChangeProposals, saveChangeProposal } from "./proposal-store";
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

/** How this pass ended. Only `persistence_failed` is a failure. `investigating` is the honest middle: proven
 *  gaps exist and what to change is not known yet, so they must be VISIBLE rather than read as a quiet day. */
export type ProducerOutcome =
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
  /** How many candidates earned an action: a page to edit, plus every consolidation this kernel cannot
   *  draft yet, which used to count nowhere at all so a proven loss read as silence. */
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

/** Bounded drafting: the strongest few, never a queue. */
export const DEFAULT_MAX_DRAFTS = 3;
/** One bounded page of this account's own inventory, never the whole site. */
const MAX_INVENTORY = 200;

/** THE ONE PAGE OF MINE A VERDICT DECIDED TO IMPROVE, as facts, out of words this pass ALREADY holds. Null
 *  for `create_new`, and null when I do not hold that page's own words: the reading is then told there is no
 *  page rather than handed an outline of nulls to write gaps against. */
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
  try {
    return [url, new URL(url.startsWith("http") ? url : `https://${url}`).pathname || "/"];
  } catch {
    return [url];
  }
};

/** The pages still being measured: what the caller passed, else the Shipment STAMPS (Decision -> Measurement is the
 *  allowed direction and that store owns the answer), else the drafted dates of the applied rows in hand. Fail-soft. */
async function measuringPaths(tenantId: string, existing: Map<string, ChangeProposal>, opts: ProduceProposalsOptions): Promise<string[]> {
  if (opts.measuringPagePaths) return [...opts.measuringPagePaths];
  const shipped = await import("@/domains/measurement/proof-gsc/shipped-change-store")
    .then((m) => m.pagesUnderMeasurementFromShipments(tenantId, opts.now)).catch(() => [] as string[]);
  return shipped.length > 0 ? shipped : pagesUnderMeasurement(existing.values(), opts.now);
}

/**
 * Produce (and by default persist) ranked ChangeProposals for one tenant from
 * cached evidence only. Never throws on a single-source outage: a failed source
 * simply narrows the snapshot.
 */
export async function produceProposalsForTenant(
  tenantId: string,
  opts: ProduceProposalsOptions = {},
): Promise<ProduceProposalsResult> {
  const maxDrafts = opts.maxDrafts ?? DEFAULT_MAX_DRAFTS;
  const persist = opts.persist ?? true;

  const snapshot = await loadEvidenceSnapshot(tenantId, { now: opts.now });
  // The account-curated trusted-source domains are BusinessProfile DATA
  // (the account's own row), never code. Unset = only the universal
  // source-authority set applies.
  const profile = await loadBusinessProfile(tenantId).catch(() => null);
  const allowlist =
    opts.authoritativeSourceDomains ?? profile?.trustedSourceDomains.value ?? [];

  // The basis this pass generates under: the SAME fingerprint Runtime and the Evidence funnel scope
  // their derived work with, plus this kernel's decision generation. Every proposal is stamped with
  // it, so one manufactured under rules the evidence no longer has to satisfy becomes history rather
  // than staying silently current. Fail-soft to null: an unreadable account stamps nothing.
  const basis = await resolveCurrentBasis(tenantId, profile);

  // ONE read of what is already durable, taken BEFORE anything is judged: which pages are still measuring an
  // applied change (the diagnosis and both rankings read that), may I skip the DRAFT, may I skip the WRITE.
  const existing = persist
    ? await loadChangeProposals(tenantId).catch(() => new Map<string, ChangeProposal>())
    : new Map<string, ChangeProposal>();
  /** THE measurement context, derived once and shared by the diagnosis and both rankings. THE STAMP IS WHAT
   *  RANKS: a Shipment holds the moment the operator implemented the change, which is what the 28-day window
   *  is read from, while a proposal's `createdAt` is only the day it was drafted and can be weeks off. */
  const measuring = { measuringPagePaths: await measuringPaths(tenantId, existing, opts) };

  // THE RESEARCH PACKETS, over the same evidence this pass judges. Non-actionable by construction: they only
  // say what I know about a topic and what is still missing. Fail-soft to none.
  let investigations: TopicInvestigation[] = [];
  try {
    investigations = buildTopicInvestigations(snapshot);
  } catch (e) {
    log.warn("[produce-proposals] investigations failed (fail-soft)", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  // THE ONE CANONICAL COVERAGE PASS, the same one Runtime buys evidence off, so the topic this pass acts on
  // is the topic the run paid for. It ranks every investigation once, gives each the comparison IT owns, and
  // hands back the highest-ranked topic that reached a real verdict. Every call inside is $0 and
  // deterministic. Fail-soft to null: a judgment I cannot make must never break the operator's actual work.
  // WHAT IS WRONG WITH HOW THESE PAGES ARE SERVED, read ONCE off the inventory and capture already held.
  // Fail-soft to nothing: an unreadable inventory means I never looked, never a clean bill.
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
    // THE PATTERN IS COMPUTED HERE, IN THE DRAFTING PASS, never inside readCoverage: the reading is a
    // render-path function and a model call has no business on it. One bounded, cached call for the ONE
    // topic that earned an actionable verdict with enough read publishers, then one free re-read so the
    // verdict's receipt carries what the winning pages have in common. Fail-soft: no pattern, same verdict.
    if (coverage && (coverage.decision.verdict === "create_new" || coverage.decision.verdict === "improve_existing")
      && coverage.investigation.currentReadableWinners >= 3 && !coverage.decision.pattern) {
      // ONLY THE WINNERS I CURRENTLY HOLD A READ OF. Every row matching by address went in before, and the
      // facts honestly accept a title-only page, so a receipt line said "3 of the 5" while the 5 counted a
      // months-old title nobody has re-read. The denominator is now exactly what I read and still hold.
      const mine = new Set(coverage.investigation.winners.filter((w) => w.extractState === "current").map((w) => w.url));
      const facts = extractPageFacts((snapshot.research.winningPages ?? []).filter((r) => mine.has(r.url)));
      // THE PAGE I AM COMPARING AGAINST IS SHOWN, OR NO GAP MAY BE WRITTEN. improve_existing names a page of
      // my own and this handed the reading nothing at all, so the model invented what "your page" does not do
      // about a page it had never seen, and that invention rendered as an operator-facing claim.
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

  // THE DIAGNOSIS FIRST. Doing nothing is the default; only a proven gap is work. The decided topic rides
  // in so the cause ladder can ask the page that verdict NAMES what the winning pages do that it does not.
  const candidates = compileCandidates(snapshot, { coverage, ...measuring });
  const acted = candidates.filter((c) => c.action === "act_existing_page");
  const recoverableByKey = new Map<string, number>();
  const readinessByKey = new Map<string, EvidenceReadiness>();
  const diagnosisByKey = new Map<string, ActionDiagnosis>();
  /** THE CAUSE LADDER'S WHOLE FINDING, indexed by page so the proposal built for that page can
   *  carry it to the operator. Keyed by page alone, not by query: one page gets one reading. */
  const causeByKey = new Map<string, CauseFinding>();
  for (const c of acted) {
    for (const k of pageKeys(c.pageUrl)) {
      recoverableByKey.set(k, c.recoverableClicks);
      causeByKey.set(k, c.cause);
      // Readiness is a fact about ONE page and ONE EXACT SEARCH. Keyed by page alone, a page
      // whose strongest gap had a results page handed its confidence to a draft written for a
      // DIFFERENT search on it, so a card read "high" above a receipt saying I never looked.
      if (c.readiness && c.query) readinessByKey.set(`${k}::${canonicalQueryKey(c.query)}`, c.readiness);
      if (c.diagnosis && c.query) diagnosisByKey.set(`${k}::${canonicalQueryKey(c.query)}`, c.diagnosis);
    }
  }
  /** Stamp the basis, the ONE ranking scalar (recoverable clicks), the cause the ladder named, and CONFIDENCE
   *  BY EVIDENCE COMPLETENESS onto a proposal, whichever producer built it: a drafter used to hand itself
   *  "high" on a change whose receipt was empty. Never invents a figure. */
  const stamp = (p: ChangeProposal): ChangeProposal => {
    const key = (p.pageUrl ?? "").trim().toLowerCase();
    const pathKey = (p.pagePath ?? "").trim().toLowerCase();
    const recoverable = recoverableByKey.get(key) ?? recoverableByKey.get(pathKey);
    // Only the readiness measured for THIS proposal's own search may set its confidence. No match
    // means the diagnosis judged a different search here, so the producer's own value stands.
    const qk = canonicalQueryKey(p.primaryQuery);
    const readiness = readinessByKey.get(`${key}::${qk}`) ?? readinessByKey.get(`${pathKey}::${qk}`);
    const finding = causeByKey.get(key) ?? causeByKey.get(pathKey);
    return {
      ...p,
      ...(basis ? { basis } : {}),
      // The ladder's own reasoning, carried rather than re-derived, and ONLY onto a proposal that brought
      // none. This ladder reads the opportunities query; a bundle's reads the exact search it drafted for.
      // They disagree, and overwriting made /changes name a cause that produced no component on the page.
      ...(finding && p.diagnosisCause == null ? { causeFinding: finding, diagnosisCause: finding.cause } : {}),
      impactScore: recoverable ?? p.impactScore,
      // A BUNDLE KEEPS ITS OWN CONFIDENCE. It read the page's body and built its own
      // receipt, so the candidate's coarser readiness must not overwrite it (that
      // capped every deep change at medium forever). The shallow path has no receipt
      // of its own, so the diagnosis-aware value stands there.
      confidence: p.bundle ? p.confidence : readiness ? confidenceFor(readiness, diagnosisByKey.get(`${key}::${qk}`) ?? null) : p.confidence,
    };
  };

  const live = [...existing.values()].filter((p) => p.status !== "rejected" && p.status !== "applied");
  /** A stored row generated under THIS basis. Null basis proves nothing, so it
   *  reuses nothing: an account I cannot read must never freeze its own queue. */
  const current = (p: ChangeProposal): boolean => basis != null && p.basis === basis;
  const currentById = (id: string): ChangeProposal | null => {
    const p = existing.get(id);
    return p && p.status !== "rejected" && p.status !== "applied" && current(p) ? p : null;
  };
  const currentBundleFor = (match: (p: ChangeProposal) => boolean): ChangeProposal | null =>
    live.find((p) => !!p.bundle && current(p) && match(p)) ?? null;

  // A HOLD HAPPENS WHERE THE DECISION IS MADE, NOT WHERE THE ROW IS WRITTEN: the ladder's
  // `measuring_change` and the skipped applied row are both held ideas, counted here beside the store's.
  const heldByDiagnosis = candidates.filter((c) => c.cause.cause === "measuring_change").length;
  let persisted = 0, writeFailures = 0, reused = 0, heldForMeasurement = heldByDiagnosis;
  /** Persist ONE material row, or nothing when the stored row already says exactly this: an unchanged proposal
   *  must not get a new timestamp. THE STORE decides that against the canonical row it holds, and this pass
   *  records the four answers it can get back. */
  const persistIfChanged = async (p: ChangeProposal): Promise<void> => {
    if (!persist) return;
    const result = await saveChangeProposal(p);
    if (result === "failed") writeFailures += 1;
    else if (result === "saved") persisted += 1; // "unchanged" wrote nothing, so it counts as nothing
    else if (result === "blocked") heldForMeasurement += 1;
    existing.set(p.id, p);
  };

  const proposals: ChangeProposal[] = [];
  // A SUBJECT THIS ACCOUNT HAS NO PAGE FOR, and the ONLY road to one: an EARNED create_new
  // verdict, which the coverage ladder reaches only once the page by page comparison has
  // proved the winning pages share searches no page of yours comes up for. A keyword, a
  // tracked question, a rival's page and an engine's fan-out reach none of this. One reuse
  // rule, the same as every other change: a current-basis row for this topic is carried
  // forward untouched, so a refresh re-pays nothing.
  const decided = coverage;
  if (decided && earnedNewPage(decided.decision)) {
    // An id this case ABSORBED still names this case's page. Matching the current key alone built a
    // SECOND live page for one subject the first time two investigations merged.
    const ids = [decided.investigation.key, ...decided.investigation.aliasKeys];
    const heldPage = live.find((p) => p.kind === "new_page" && current(p) && ids.some((k) => p.id.includes(`::${k}::`))) ?? null;
    if (heldPage) {
      proposals.push(heldPage);
      reused += 1;
    } else {
      const built = await buildNewPageProposal(decided, tenantId, { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache })
        .catch((e) => ({ status: "none" as const, reason: e instanceof Error ? e.message : String(e) }));
      if (built.status === "built") {
        const page = { ...built.proposal, ...(basis ? { basis } : {}) };
        proposals.push(page);
        await persistIfChanged(page);
      } else log.info("[produce-proposals] no new page this pass", { tenantId, reason: built.reason });
    }
  }

  const bound = Math.min(DEFAULT_MAX_DRAFTS, maxDrafts);
  const inputs = candidatesToEvidenceInputs(snapshot, acted).slice(0, bound);
  // WHICH PAGES EARN THE DEEP READ, off every door the evidence already proves rather than off a click
  // gap alone. SELECTION ONLY: nothing here drafts, buys, or invents a figure.
  const deep = selectDeepCandidates({ snapshot, candidates, coverage, limit: bound });

  const investigating = candidates.filter((c) => c.action === "research_needed").length;
  // A CONSOLIDATION IS WORK, NOT SILENCE. The ladder names two of your own pages splitting one search and
  // no producer here can write that change yet, so it used to count as nothing at all and the pass reported
  // a quiet day over a proven loss. It is counted with what I am watching and carries its own reason onto
  // the run receipt, so the operator reads the consolidation even while nothing drafts it.
  const consolidating = candidates.filter((c) => c.action === "consolidate").length;
  if (acted.length === 0 && deep.length === 0) {
    log.info("[produce-proposals] nothing earned an action this pass", { tenantId, judged: candidates.length,
      watching: candidates.filter((c) => c.action === "watch").length + consolidating, researching: investigating });
    // A proven gap I cannot yet explain is NOT a quiet day, and neither is one I CAN explain and cannot
    // draft. Saying so here keeps "Nothing needs a decision today" off a screen with real losses behind it.
    return { proposals: rankProposals(proposals, measuring), candidates,
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

  // A READY CHANGE MAY NOT OUTLIVE ITS OWN EXPLANATION. The basis fingerprints the account,
  // not the evidence, so a stored row kept rendering Ready while today's diagnosis no longer
  // supported it (Google rewrites the line it displays, a rival retitles, the page slips off
  // the results page I check). Every live bundle whose page no longer earns an action this
  // pass is set aside, in the queue and in the store, with the reason the operator reads.
  const provenNow = new Set([...acted.flatMap((c) => pageKeys(c.pageUrl)), ...selectedKeys]);
  for (const p of live) {
    if (!p.bundle || p.kind !== "existing_edit" || p.status !== "proposed" || !current(p)) continue;
    if (provenNow.has((p.pagePath ?? "").trim().toLowerCase())) continue;
    const why = candidates.find((c) => pageKeys(c.pageUrl).includes((p.pagePath ?? "").trim().toLowerCase()))?.diagnosis?.explanation;
    await persistIfChanged({ ...p, status: "needs_review", confidence: "low",
      limitations: [...new Set([...p.limitations, why ?? "My evidence no longer shows that this change is the fix, so I set it aside instead of leaving it on your list."])] });
  }

  let noDraft = 0;
  for (const input of inputs) {
    // A refresh re-pays nothing. A current-generation row already covering this
    // candidate (its own row, or the deep bundle that replaced it) is carried
    // forward as-is: no drafter call, no write, no new timestamp.
    // SETTLED WORK IS NOT REDRAFTED. The newest row wins on read, so redrafting an
    // APPLIED change would overwrite the record of something already shipped. A
    // REJECTED row is the safety gate's verdict on that draft, so under the SAME
    // basis the same evidence would fail the same way and re-paying the drafter buys
    // nothing; once the basis moves the evidence really is different, and the page
    // gets its fair second attempt.
    const settled = existing.get(proposalId(input));
    // An APPLIED row is a change I am measuring, so the fresh idea for that page is HELD, not
    // dropped, and it is counted here rather than left to a store call this loop never makes.
    if (settled && settled.status === "applied") { heldForMeasurement += 1; continue; }
    if (settled && settled.status === "rejected" && current(settled)) continue;
    const held = currentById(proposalId(input))
      ?? (input.opportunity.kind === "existing_edit"
        ? [...heldDeep.values()].find((b) => b.pagePath === input.page.path) ?? null : null);
    if (held) {
      if (!proposals.some((p) => p.id === held.id)) {
        // Reuse skips the DRAFTER, never the judgment. A stored row keeps its words
        // and its history, and is re-stamped against today's evidence, so a change
        // whose search I still have not looked at stops claiming confidence it lost.
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
    if (outcome.status !== "proposed") {
      noDraft += 1;
      continue;
    }
    const proposal = stamp(outcome.proposal);
    proposals.push(proposal);
    await persistIfChanged(proposal);
  }

  // ONE bundle per SELECTED page, strongest door first and never more than the bound. A bundle
  // REPLACES its own shallow drafts (never the same change twice); a refusal is honest and silent
  // and the shallow drafts stand. A bundle for a page NO door selected is dropped: the deep form of
  // a change nobody needs is still a change nobody needs.
  const bundleOpts = { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache, authoritativeSourceDomains: allowlist, technical };
  const onThrow = (e: unknown) => {
    log.warn("[produce-proposals] bundle threw (fail-soft)", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return { status: "none" as const, reason: "threw" };
  };

  for (const d of deep) {
    const heldBundle = heldDeep.get(d.pageUrl) ?? null;
    if (heldBundle) {
      // A held bundle used to reach the queue only through the atomic-input loop, and that loop is
      // empty whenever the selected page needs no atomic edit. The pass then reported "no trusted
      // draft" while a judged, current bundle sat in the store. It is carried here, re-stamped.
      if (!proposals.some((p) => p.id === heldBundle.id)) {
        const proposal = stamp(heldBundle);
        proposals.push(proposal);
        reused += 1;
        await persistIfChanged(proposal);
      }
      enteredBy.set(d.pageUrl, d.entry);
      continue;
    }
    // The page a door selected gets its own words read, through the targeted Evidence reader
    // (explicit tenant, this URL only). A diagnosis written from a title and a word count is a
    // guess; fail-soft to none, which stays honest.
    const bodyByUrl = await loadOwnedPageBodies(tenantId, [d.pageUrl]).catch(() => null);
    // THE DOOR TRAVELS WITH THE PAGE. Selection knows why this page is here and the producer has to prove
    // THAT case, so a page an engine skipped is never refused, or explained, in the click door's words.
    const bundled = await produceBundleForSnapshot(snapshot, { ...bundleOpts, onlyPageUrl: d.pageUrl, door: d,
      coverage, ...measuring, ...(bodyByUrl ? { bodyByUrl } : {}) }).catch(onThrow);
    const covered = bundled.status === "bundled" ? (bundled.proposal.pageUrl ?? "").trim().toLowerCase() : "";
    const path = bundled.status === "bundled" ? (bundled.proposal.pagePath ?? "").trim().toLowerCase() : "";
    if (bundled.status !== "bundled" || (!selectedKeys.has(covered) && !selectedKeys.has(path))) {
      log.info("[produce-proposals] no bundle this pass", { tenantId, page: d.pageUrl, door: d.door,
        reason: bundled.status === "bundled" ? "page no door selected" : bundled.reason });
      // THE REFUSAL BELONGS ON THE RECEIPT, not only in a log. Beacon started writing this page, stopped for a
      // reason it can say out loud, and resumes free, so the operator reads that beside the door it came through.
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

  // The honest ending. A write that failed on EVERY attempt is a failure, not a
  // quiet day: the caller must keep the previous release rather than stamp a fresh
  // timestamp on work nobody can load back.
  // A pass that reached here through a door OTHER than a proven click gap can still have nothing in
  // `acted`, and calling that "no trusted draft" would name work nobody proved, so it falls back to
  // the same three honest endings the empty-diagnosis path reports.
  const outcome: ProducerOutcome =
    writeFailures > 0 && persisted === 0 ? "persistence_failed"
      : proposals.length > 0 ? "proposals_persisted"
        : acted.length + consolidating > 0 ? "actionable_but_no_trusted_draft"
          : investigating > 0 ? "investigating" : "no_actionable_candidate";
  if (outcome !== "proposals_persisted") {
    log.warn("[produce-proposals] pass produced no durable work", { tenantId, outcome, actionable: acted.length, noDraft, writeFailures });
  }
  // THE RUN RECEIPT SAYS WHICH DOOR EACH DRAFTED PAGE CAME THROUGH, in the same first-person line every
  // surface already renders for a candidate. A deep change nobody can trace back to its own evidence
  // reads as a machine picking favourites.
  const receipt = enteredBy.size === 0 ? candidates
    : candidates.map((c) => { const entry = enteredBy.get(c.pageUrl ?? ""); return entry ? { ...c, reason: `${c.reason} ${entry}` } : c; });
  return { proposals: rankProposals(proposals, measuring), candidates: receipt, outcome,
    actionable: acted.length + consolidating, investigating, noDraft, persisted, reused, heldForMeasurement, ...research };
}
