/**
 * clone-brief (2026-07-02, master plan item 60) - PURE "their best page, our better
 * version" brief builder, the second half of the clone-and-beat engine. Takes ONE
 * traffic-weighted money page (money-pages.ts), its deterministic teardown facts
 * (the existing competitor-page-audit.ts, NOT re-implemented here), and the
 * tenant's own coverage labels, and writes an honest, first-person, dash-clean
 * brief: their structure, the demand they capture, and what we would build better.
 *
 * No I/O, no server-only, no LLM. Every sentence is templated from real numbers -
 * the same discipline as keyword-gaps.ts's gapEvidenceSentence. Unit-tested in
 * clone-brief.test.ts.
 */

import { topicTokens } from "@/domains/evidence/relevance-gate";
import type { MoneyPage } from "./money-pages";
import type { CompetitorPageFacts } from "@/domains/demand-graph/competitor-page-audit";

export type CloneBriefTeardownStatus = "torn_down" | "blocked" | "not_read";

export type CloneBrief = {
  url: string;
  competitorDomain: string;
  trafficWeight: number;
  /** Deterministic "what wins" one-liner from the teardown, or null if unread/blocked. */
  whatWins: string | null;
  teardownStatus: CloneBriefTeardownStatus;
  /** The demand this page captures - top keywords + volumes from the Labs pull. */
  demand: { keyword: string; volume: number | null }[];
  /** Topics/tokens this page covers that the tenant has NO page for yet. */
  coverageGaps: string[];
  /** The "build our better version" pointer - a candidate label + reason, feeding
   *  create-page candidates the same way keyword-gap cards do. Null only when the
   *  teardown has not run yet (nothing concrete to point at). */
  buildPointer: { label: string; reason: string } | null;
  /** First-person, dash-clean operator sentence summarizing the brief. */
  summary: string;
};

const MAX_DEMAND_KEYWORDS = 5;
const MAX_COVERAGE_GAPS = 6;

const fmt = (n: number): string => n.toLocaleString("en-US");

/** Topic tokens this competitor page leans on - title, h1, and top content terms,
 *  in that priority order (title/h1 are the strongest topic signal). */
function pageTopicTokens(facts: CompetitorPageFacts | null): string[] {
  if (!facts) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  // Route topTerms through topicTokens() too (not spread raw) so generic brand
  // words ("persian", "iran") never count as a coverage gap on their own -
  // the SAME distinguishing-token discipline as keyword-gaps.ts and relevance-gate.ts.
  for (const t of [...topicTokens(facts.title), ...topicTokens(facts.h1), ...topicTokens((facts.topTerms ?? []).join(" "))]) {
    const tok = t.toLowerCase();
    if (tok.length < 3 || seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

/**
 * Which of the competitor page's topic tokens the tenant has NO owned page for
 * yet - the coverage gap vs "what we would build better." PURE.
 *
 * @param pageTokens    tokens the competitor page covers (pageTopicTokens output,
 *                      or supply your own)
 * @param ownedTopics   labels/titles/queries of pages the tenant already owns
 */
export function computeCoverageGaps(pageTokens: readonly string[], ownedTopics: readonly string[]): string[] {
  const ownedTokens = new Set<string>();
  for (const t of ownedTopics) for (const tok of topicTokens(t)) ownedTokens.add(tok);
  const out: string[] = [];
  for (const t of pageTokens) {
    if (out.length >= MAX_COVERAGE_GAPS) break;
    if (!ownedTokens.has(t)) out.push(t);
  }
  return out;
}

export type BuildCloneBriefInput = {
  page: MoneyPage;
  /** The existing teardown result for this URL, when one has run (null = never read). */
  audit: { fetchStatus: "ok" | "blocked_robots" | "http_error" | "fetch_failed" | "empty"; facts: CompetitorPageFacts | null } | null;
  whatWins: string | null;
  /** Labels/titles of pages the tenant already owns - the coverage-gap comparison. */
  ownedTopics: readonly string[];
};

/**
 * Build ONE clone-and-beat brief from a money page + its teardown + our own
 * coverage. PURE - the caller supplies the teardown result (already fetched by
 * the bounded, cached, polite competitor-page-audit engine) and the coverage
 * labels (from the demand graph). Never fabricates a fact the teardown didn't find.
 */
export function buildCloneBrief(input: BuildCloneBriefInput): CloneBrief {
  const { page, audit, whatWins, ownedTopics } = input;

  const teardownStatus: CloneBriefTeardownStatus =
    !audit ? "not_read" : audit.fetchStatus === "ok" ? "torn_down" : audit.fetchStatus === "blocked_robots" ? "blocked" : "not_read";

  const demand = [...page.topKeywords]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_DEMAND_KEYWORDS)
    .map((k) => ({ keyword: k.keyword, volume: k.volume }));

  const facts = audit?.facts ?? null;
  const pageTokens = pageTopicTokens(facts);
  const coverageGaps = teardownStatus === "torn_down" ? computeCoverageGaps(pageTokens, ownedTopics) : [];

  const topKeyword = demand[0]?.keyword ?? null;
  const buildPointer =
    teardownStatus === "torn_down" && topKeyword
      ? {
          label: topKeyword,
          reason:
            coverageGaps.length > 0
              ? `We do not have a page covering ${coverageGaps.slice(0, 3).join(", ")} yet, and this is where the demand is.`
              : `We already have coverage here, so the win is matching their structure, not filling a gap.`,
        }
      : null;

  const who = `${page.competitorDomain} earns an estimated ${fmt(page.trafficWeight)} traffic-weighted points from this one page`;
  const demandPart =
    demand.length > 0
      ? `, led by "${demand[0].keyword}"${demand[0].volume != null ? ` at about ${fmt(demand[0].volume)} searches a month` : ""}.`
      : ".";
  const structurePart =
    teardownStatus === "torn_down"
      ? whatWins
        ? ` Their page wins on ${whatWins}.`
        : ` I read their page but it has little real structure to copy.`
      : teardownStatus === "blocked"
        ? ` I could not read their page, it blocks crawlers.`
        : ` I have not read their page yet.`;
  const gapPart =
    coverageGaps.length > 0
      ? ` We have no page covering ${coverageGaps.slice(0, 3).join(", ")} yet, that is our opening.`
      : teardownStatus === "torn_down"
        ? ` We already cover this topic, the opening is a better version, not a new page.`
        : "";

  const summary = `${who}${demandPart}${structurePart}${gapPart}`;

  return {
    url: page.url,
    competitorDomain: page.competitorDomain,
    trafficWeight: page.trafficWeight,
    whatWins: teardownStatus === "torn_down" ? whatWins : null,
    teardownStatus,
    demand,
    coverageGaps,
    buildPointer,
    summary,
  };
}
