/**
 * evidence/case-receipt (V1 Truth Convergence Phase 3) - THE inspectable receipt for ONE case: every keyword
 * it holds and how that keyword was found, every provider call its evidence came from, and why no further
 * research was bought for it. A PURE projection over the EvidenceSnapshot that introduces no store:
 * everything below was persisted by the executor that bought it, and this only joins it to the case.
 *
 * CACHE VERSUS PAID IS REPORTED, NOT GUESSED. Exactly one call kind records which it was at the moment it
 * happened (the recurring winning domains bought per case set), and the page by page comparison records the
 * money core's own cache identity. A search look and an AI answer record WHEN they landed and nothing about
 * how they were served, so they read as unknown rather than as assumed warm or assumed paid. The run's own
 * money receipt sits beside the list, so a reader can always see what the whole pass actually spent.
 */

import { caseIdByAnchor } from "./case-identity";
import { isCurrent } from "./freshness";
import { canonicalQueryKey } from "./relevance-gate";
import type { EvidenceSnapshot } from "./snapshot";

/** ONE provider call this case's evidence came from. `identity` is the money core's cache identity when the
 *  row carries one, which is what makes a claim about spending checkable rather than merely stated, and
 *  `served` is "unknown" wherever nothing on file records how that call kind was served. */
type CaseResearchCall = {
  kind: "search_results" | "ai_answer" | "page_comparison" | "competitor_domains";
  subject: string; identity: string | null; served: "paid" | "cache" | "unknown"; observedAt: string | null;
};

type CaseResearchKeyword = {
  query: string; discoveredVia: string | null;
  /** true = this keyword's search volume was actually bought and is on file. */
  metricsHeld: boolean;
  searchVolume: number | null; difficulty: number | null; intent: string | null;
  ownedRankingUrl: string | null; ownedPosition: number | null;
  supports: "existing_page" | "consolidation" | "new_page" | null;
};

type CaseResearchReceipt = {
  caseId: string;
  /** Every id this case still answers to, so a reader can join evidence filed under an absorbed one. */
  aliasKeys: string[];
  keywords: CaseResearchKeyword[]; calls: CaseResearchCall[];
  /** THIS run's money, from the funnel's own receipt: never a lifetime total. */
  spend: { spentUsd: number; cachedCalls: number };
  /** Why nothing further was bought for this case, in the file's own words. Empty = research is still owed. */
  notBought: { reason: "fresh" | "capped" | "parked"; detail: string }[];
};

const MAX_CALLS = 40;
const day = (at: string | null): string => (at ?? "").slice(0, 10);

/**
 * The receipt for ONE case, resolved through the case identity on file so an absorbed id answers with the
 * case that answers for it now. Returns null when nothing on file is about that id at all. Pure.
 */
export function caseResearchReceipt(snapshot: EvidenceSnapshot, caseId: string): CaseResearchReceipt | null {
  const research = snapshot.research;
  const cases = research.cases ?? [];
  const index = caseIdByAnchor(cases);
  const id = index.get(caseId) ?? caseId;
  const row = cases.find((c) => c.id === id) ?? null;
  const keywords = research.retainedKeywords.filter((k) => k.parentCaseId === id);
  if (!row && keywords.length === 0) return null;
  const aliasKeys = cases.filter((c) => c.aliasOf === id).map((c) => c.id).sort();
  const owns = new Set([...(row?.anchors ?? []), ...keywords.map((k) => canonicalQueryKey(k.query))].filter(Boolean));
  const mine = new Set([id, ...aliasKeys]);
  const now = Date.parse(snapshot.scope.builtAt);

  const calls: CaseResearchCall[] = [];
  const serps = research.serpEvidence.filter((s) => owns.has(canonicalQueryKey(s.query)));
  for (const s of serps) calls.push({ kind: "search_results", subject: s.query, identity: null, served: "unknown", observedAt: s.observedAt });
  for (const o of research.aiObservations) {
    const asked = canonicalQueryKey(o.promptText);
    const fans = (o.fanOutQueries ?? []).map(canonicalQueryKey);
    if (!owns.has(asked) && !fans.some((f) => owns.has(f))) continue;
    calls.push({ kind: "ai_answer", subject: `${o.promptText} (${o.engine})`, identity: null, served: "unknown", observedAt: o.observedAt });
  }
  const comparisons = (research.pageComparisons ?? []).filter((c) => mine.has(c.topicKey));
  for (const c of comparisons) calls.push({ kind: "page_comparison", subject: c.pages.join(" vs "), identity: c.receipt, served: "unknown", observedAt: c.observedAt });
  const competitors = (research.caseCompetitors ?? []).filter((c) => mine.has(c.caseId));
  for (const c of competitors) calls.push({ kind: "competitor_domains", subject: `${c.keywordsAsked} keywords, ${c.domains.length} domains`, identity: c.receipt, served: c.served, observedAt: c.observedAt });

  // ── why nothing further was bought, from what is actually persisted ──
  const notBought: CaseResearchReceipt["notBought"] = [];
  if (comparisons.some((c) => c.unavailable === "capped")) notBought.push({ reason: "capped", detail: "I stopped before comparing the winning pages because this account's spending ceiling was reached. I will finish it on your next visit." });
  const parked = comparisons.find((c) => c.unavailable === "waiting" || c.unavailable === "blocked" || c.unavailable === "quarantined");
  if (parked) notBought.push({ reason: "parked", detail: `I am waiting on the page by page comparison I started on ${day(parked.observedAt)}, so I did not order it again.` });
  const held = research.winningPages.filter((w) => w.appearances.some((a) => !!a.query && owns.has(canonicalQueryKey(a.query))))
    .map((w) => w.readOutcome).filter((o) => !!o && Date.parse(o.retryAfter) > now);
  if (held.length > 0) notBought.push({ reason: "parked", detail: `I am holding off on ${held.length} of the winning pages here until ${day(held[0]!.retryAfter)}, which is the date I promised for them.` });
  if (serps.length > 0 && serps.every((s) => isCurrent("serp_cold", s.observedAt, now)) && competitors.every((c) => isCurrent("serp_cold", c.observedAt, now))) {
    notBought.push({ reason: "fresh", detail: `I checked all ${serps.length} of this case's searches within the last week, so I bought nothing for it again this pass.` });
  }

  return {
    caseId: id,
    aliasKeys,
    keywords: keywords.map((k) => ({
      query: k.query, discoveredVia: k.discoveredVia ?? null, metricsHeld: k.searchVolume != null,
      searchVolume: k.searchVolume, difficulty: k.difficulty, intent: k.intent,
      ownedRankingUrl: k.ownedRankingUrl ?? null, ownedPosition: k.ownedPosition ?? null, supports: k.supports ?? null,
    })),
    calls: calls.sort((a, b) => (b.observedAt ?? "").localeCompare(a.observedAt ?? "") || a.subject.localeCompare(b.subject)).slice(0, MAX_CALLS),
    spend: { spentUsd: research.receipt.spentUsd, cachedCalls: research.receipt.cached },
    notBought,
  };
}
