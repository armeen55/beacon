/**
 * decision/produce-proposals: the ONE server path that turns a tenant's cached evidence into
 * persisted ChangeProposals - loadEvidenceSnapshot ($0, six cached sources) -> compileCandidates
 * (the honest diagnosis: act / watch / do nothing) -> candidatesToEvidenceInputs (only what
 * EARNED an action) -> proposeExistingPageChange (cold, gated, budgeted drafter plus the ONE
 * validator) -> saveChangeProposal (durable, fail-soft). BOUNDED: at most the strongest
 * DEFAULT_MAX_DRAFTS pages by recoverable clicks, and a page with no proven gap costs nothing.
 *
 * Every honest ending this pass can reach is named on `ProducerOutcome` below, so a surface never
 * reads an empty queue as an outage or a failed write as a quiet day.
 *
 * ONE EVIDENCE BASIS, ONE ROW: a candidate whose current-generation proposal already exists is
 * never redrafted, and a proposal whose material fingerprint is unchanged is never re-inserted,
 * so a refresh re-pays nothing.
 *
 * COLD by default: the drafter's `complete` fn is injectable, so tests run this whole path with
 * zero paid calls. Publishing stays MANUAL: this only proposes. server-only.
 */
import "server-only";

import { log } from "@/lib/logger";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { loadBusinessProfile } from "@/domains/account";
import { pagesUnderMeasurement, resolveCurrentBasis } from "./load-proposals";
import { candidatesToEvidenceInputs, compileCandidates, type QualifiedCandidate } from "./opportunities";
import type { CauseFinding } from "./diagnosis";
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

/** How this pass ended. Only `persistence_failed` is a failure. `investigating`
 *  is the honest middle: proven gaps exist, and what to change about them is not
 *  known yet, so they must be VISIBLE rather than read as a quiet day. */
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
  /** How many candidates earned an action: a page to edit, plus every consolidation this kernel
   *  cannot draft yet. A consolidation counted nowhere at all before, so a proven loss read as silence. */
  actionable: number;
  /** Proven gaps whose cause is not identified yet: real work, not silence. */
  investigating: number;
  /** How many drafts failed closed (off / budget / validation). */
  noDraft: number;
  /** Material rows actually written this pass. */
  persisted: number;
  /** Drafts the store REFUSED to file because the page already carries a change the operator
   *  applied and I am still measuring. The store has always answered this; it used to be
   *  dropped on the floor, so a page holding a held-back idea looked forgotten on Today. */
  heldForMeasurement: number;
  /** Proposals carried forward unchanged: no draft, no write, no dollars. */
  reused: number;
  /** What I have investigated about each topic, over the SAME evidence this pass judged.
   *  Research only: nothing here is a change, a draft or a queue row. */
  investigations: TopicInvestigation[];
  /** THE topic whose evidence reached a final answer this pass, and that answer, read off
   *  the one canonical pass Runtime buys evidence from. Null while every topic is still an
   *  investigation, which is the normal answer. */
  coverage: DecidedTopic | null;
  /** The earliest date any page this pass could not read may be tried again, from the SAME canonical
   *  coverage pass. Null when nothing is waiting. It is what stops a surface saying "checking". */
  waitingUntil: string | null;
};

/** Bounded drafting: the strongest few, never a queue. */
export const DEFAULT_MAX_DRAFTS = 3;

/** THE ONE PAGE OF MINE A VERDICT DECIDED TO IMPROVE, as facts, out of words this pass ALREADY holds.
 *  Nothing is fetched and nothing is inferred. Null for `create_new`, and null when I do not hold that
 *  page's own words: the reading must then be told there is no page rather than handed an outline of
 *  nulls to write gaps against. */
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

  // ONE read of what is already durable, taken BEFORE anything is judged. It answers three questions:
  // which pages are still measuring an applied change (the diagnosis and both rankings read that fact),
  // may I skip the DRAFT, and may I skip the WRITE.
  const existing = persist
    ? await loadChangeProposals(tenantId).catch(() => new Map<string, ChangeProposal>())
    : new Map<string, ChangeProposal>();
  /** THE measurement context, derived once and shared by the diagnosis and both rankings. THE STAMP IS WHAT
   *  RANKS: a Shipment holds the moment the operator implemented the change, which is what the 28-day window
   *  is read from, while a proposal's `createdAt` is only the day it was drafted and can be weeks off. */
  const measuring = { measuringPagePaths: await measuringPaths(tenantId, existing, opts) };

  // THE RESEARCH PACKETS, over the same evidence this pass judges. Non-actionable by
  // construction, so building them here cannot add a candidate, a proposal or a draft: they
  // only say what I know about a topic and what is still missing. Fail-soft to none.
  let investigations: TopicInvestigation[] = [];
  try {
    investigations = buildTopicInvestigations(snapshot);
  } catch (e) {
    log.warn("[produce-proposals] investigations failed (fail-soft)", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  // THE ONE CANONICAL COVERAGE PASS, the same one Runtime buys evidence off, so the topic
  // this pass acts on is the topic the run paid for. It ranks every investigation once,
  // gives each the comparison IT owns, and hands back the highest-ranked topic that reached
  // a real verdict. Every call inside is $0 and deterministic. Fail-soft to null: a judgment
  // I cannot make must never break the pass that produces the operator's actual work.
  let coverage: DecidedTopic | null = null;
  let waitingUntil: string | null = null;
  try {
    const read = await readCoverage(snapshot, tenantId, { basis, profile, now: opts.now, intersection: opts.intersection });
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
  /** Stamp the basis, the ONE ranking scalar (recoverable clicks), the cause the ladder named,
   *  and CONFIDENCE BY EVIDENCE COMPLETENESS onto a proposal, whichever producer built it. A
   *  drafter used to hand itself "high" on a change whose receipt was empty; now the readiness
   *  the diagnosis measured decides it. Never invents a figure. */
  const stamp = (p: ChangeProposal): ChangeProposal => {
    const key = (p.pageUrl ?? "").trim().toLowerCase();
    const pathKey = (p.pagePath ?? "").trim().toLowerCase();
    const recoverable = recoverableByKey.get(key) ?? recoverableByKey.get(pathKey);
    // Only the readiness measured for THIS proposal's own search may set its confidence. No
    // match means the diagnosis judged a different search here, so the producer's own honest
    // value stands rather than a neighbour's.
    const qk = canonicalQueryKey(p.primaryQuery);
    const readiness = readinessByKey.get(`${key}::${qk}`) ?? readinessByKey.get(`${pathKey}::${qk}`);
    const finding = causeByKey.get(key) ?? causeByKey.get(pathKey);
    return {
      ...p,
      ...(basis ? { basis } : {}),
      // The reasoning the ladder already did, carried rather than re-derived. A proposal for a
      // page no ladder judged keeps whatever it arrived with, which is usually nothing.
      ...(finding ? { causeFinding: finding, diagnosisCause: finding.cause } : {}),
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

  // A HOLD HAPPENS WHERE THE DECISION IS MADE, NOT WHERE THE ROW IS WRITTEN. This counted only the
  // store's "blocked" and read zero: the real holds are two rungs earlier and reach no store at all.
  // The ladder fires `measuring_change` on a page carrying an applied change (so nothing is drafted),
  // and the loop below skips a candidate whose stored row is applied. Both are held ideas, so both
  // are counted here, and the store's answer stays as the third increment.
  const heldByDiagnosis = candidates.filter((c) => c.cause.cause === "measuring_change").length;
  let persisted = 0, writeFailures = 0, reused = 0, heldForMeasurement = heldByDiagnosis;
  /** Persist ONE material row, or nothing at all when the stored row already says exactly this.
   *  An unchanged proposal must not get a new timestamp: a refreshed surface would read
   *  yesterday's thinking as today's work. THE STORE decides that against the canonical row it
   *  actually holds, and this pass records the four answers it can get back. */
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

  const inputs = candidatesToEvidenceInputs(snapshot, acted).slice(0, Math.min(DEFAULT_MAX_DRAFTS, maxDrafts));

  const investigating = candidates.filter((c) => c.action === "research_needed").length;
  // A CONSOLIDATION IS WORK, NOT SILENCE. The ladder names two of your own pages splitting one search and
  // no producer here can write that change yet, so it used to count as nothing at all and the pass reported
  // a quiet day over a proven loss. It is counted with what I am watching and carries its own reason onto
  // the run receipt, so the operator reads the consolidation even while nothing drafts it.
  const consolidating = candidates.filter((c) => c.action === "consolidate").length;
  if (acted.length === 0) {
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

  // THE STRONGEST PROVEN PAGE, never the first one the snapshot happened to list.
  // `find` handed the deep bundle to whichever actionable page came back first, so
  // a 58-click page got the deep work while an 824-click gap sat untouched.
  // Deterministic: most recoverable clicks, then page address.
  const provenPage = [...acted]
    .sort((a, b) => b.recoverableClicks - a.recoverableClicks || (a.pageUrl ?? "").localeCompare(b.pageUrl ?? ""))[0]?.pageUrl ?? null;
  const provenKeys = pageKeys(provenPage);
  /** The deep bundle this page already has under the current basis, if any. */
  const heldBundle = currentBundleFor((p) => p.kind === "existing_edit" && provenKeys.includes((p.pagePath ?? "").trim().toLowerCase()));

  // A READY CHANGE MAY NOT OUTLIVE ITS OWN EXPLANATION. The basis fingerprints the account,
  // not the evidence, so a stored row kept rendering Ready while today's diagnosis no longer
  // supported it (Google rewrites the line it displays, a rival retitles, the page slips off
  // the results page I check). Every live bundle whose page no longer earns an action this
  // pass is set aside, in the queue and in the store, with the reason the operator reads.
  const provenNow = new Set(acted.flatMap((c) => pageKeys(c.pageUrl)));
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
      ?? (heldBundle && input.opportunity.kind === "existing_edit" && heldBundle.pagePath === input.page.path ? heldBundle : null);
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
    const outcome = await proposeExistingPageChange(input, {
      complete: opts.complete,
      now: opts.now,
      bypassCache: opts.bypassCache,
      authoritativeSourceDomains: allowlist,
    }).catch((e) => {
      log.warn("[produce-proposals] propose threw (fail-soft)", {
        tenantId,
        id: input.opportunity.query,
        error: e instanceof Error ? e.message : String(e),
      });
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

  // ONE bundle per pass (the strongest proven page). A bundle REPLACES its own shallow
  // drafts (never the same change twice); a refusal is honest and silent and the shallow
  // drafts stand. A bundle for a page NO candidate proved is dropped: the deep form of a
  // change nobody needs is still a change nobody needs.
  const bundleOpts = {
    complete: opts.complete,
    now: opts.now,
    bypassCache: opts.bypassCache,
    authoritativeSourceDomains: allowlist,
  };
  const onThrow = (e: unknown) => {
    log.warn("[produce-proposals] bundle threw (fail-soft)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { status: "none" as const, reason: "threw" };
  };

  if (provenPage && !heldBundle) {
    // The ONE page under investigation gets its own words read, through the targeted
    // Evidence reader (explicit tenant, this URL only). A diagnosis written from a
    // title and a word count is a guess; fail-soft to none, which stays honest.
    const bodyByUrl = await loadOwnedPageBodies(tenantId, [provenPage]).catch(() => null);
    const bundled = await produceBundleForSnapshot(snapshot, { ...bundleOpts, onlyPageUrl: provenPage,
      ...(bodyByUrl ? { bodyByUrl } : {}) }).catch(onThrow);
    const covered = bundled.status === "bundled" ? (bundled.proposal.pageUrl ?? "").trim().toLowerCase() : "";
    const proven = bundled.status === "bundled"
      && (recoverableByKey.has(covered) || recoverableByKey.has((bundled.proposal.pagePath ?? "").trim().toLowerCase()));
    if (bundled.status === "bundled" && proven) {
      const page = bundled.proposal.pagePath;
      for (let i = proposals.length - 1; i >= 0; i--) {
        const p = proposals[i]!;
        if (p.kind === "existing_edit" && p.pagePath === page) proposals.splice(i, 1);
      }
      const proposal = stamp(bundled.proposal);
      proposals.push(proposal);
      await persistIfChanged(proposal);
    } else {
      log.info("[produce-proposals] no bundle this pass", {
        tenantId,
        reason: bundled.status === "bundled" ? "page has no proven gap" : bundled.reason,
      });
    }
  } else if (heldBundle && !proposals.some((p) => p.id === heldBundle.id)) {
    // The held bundle used to reach the queue only through the atomic-input loop,
    // and that loop is empty whenever the proven page needs no atomic edit. The
    // pass then reported "no trusted draft" while a judged, current bundle sat in
    // the store. It is carried here, re-stamped, whether or not the loop ran.
    const proposal = stamp(heldBundle);
    proposals.push(proposal);
    reused += 1;
    await persistIfChanged(proposal);
  }

  // The honest ending. A write that failed on EVERY attempt is a failure, not a
  // quiet day: the caller must keep the previous release rather than stamp a fresh
  // timestamp on work nobody can load back.
  const outcome: ProducerOutcome =
    writeFailures > 0 && persisted === 0 ? "persistence_failed"
      : proposals.length === 0 ? "actionable_but_no_trusted_draft"
        : "proposals_persisted";
  if (outcome !== "proposals_persisted") {
    log.warn("[produce-proposals] pass produced no durable work", { tenantId, outcome, actionable: acted.length, noDraft, writeFailures });
  }
  return {
    proposals: rankProposals(proposals, measuring),
    candidates,
    outcome,
    actionable: acted.length + consolidating,
    investigating,
    noDraft,
    persisted,
    reused,
    heldForMeasurement,
    ...research,
  };
}
