/**
 * Pure bridge from one native AI prompt's cited-page teardown result into the
 * same AeoEvidence shape Profound-backed graph moves already use. No I/O.
 */

import { rollUpNativeQuestions, type NativeObservationInput } from "@/domains/ai-visibility/native-intel";
import type { NativePromptTeardownTarget } from "./competitor-page-audit";
import type { CommonalityBrief } from "./teardown-commonality";
import type { AeoEvidence } from "./profound-evidence-fusion";

function hostOf(value: string): string {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function urlKey(value: string): string {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return value.trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function isOwnedHost(host: string, ownedRoot: string): boolean {
  return !!host && !!ownedRoot && (host === ownedRoot || host.endsWith(`.${ownedRoot}`));
}

/** Exact native questions raised inside this prompt's answers, unioned with
 * any topic-matched Profound/native fanouts loaded by the caller. */
export function fanoutQuestionsForNativePrompt(
  observations: readonly NativeObservationInput[],
  promptId: string,
  relatedFanouts: readonly string[] = [],
): string[] {
  const exactNative = rollUpNativeQuestions(
    observations.filter((row) => row.promptId === promptId),
    { limit: 12 },
  ).map((question) => question.text);
  return [...new Set([...exactNative, ...relatedFanouts].map((value) => value.trim()).filter(Boolean))].slice(0, 12);
}

export function buildNativeAeoEvidence(input: {
  target: NativePromptTeardownTarget;
  observations: readonly NativeObservationInput[];
  brief: CommonalityBrief;
  fanoutQuestions: readonly string[];
  ownedRoot?: string;
}): AeoEvidence {
  const promptRows = input.observations.filter((row) => row.promptId === input.target.promptId);
  const ownedRoot = (input.ownedRoot ?? "").trim().toLowerCase().replace(/^www\./, "");
  const targetKeys = new Map(input.target.urls.map((url) => [urlKey(url), url] as const));
  const pageCounts = new Map<string, number>();
  let ownCitationCount = 0;
  let competitorCitationCount = 0;

  for (const row of promptRows) {
    let citesOwned = row.trackedBrandCited === true;
    let citesCompetitor = false;
    const seenPages = new Set<string>();
    for (const citedUrl of row.citationUrls) {
      const host = hostOf(citedUrl);
      if (isOwnedHost(host, ownedRoot)) citesOwned = true;
      const key = urlKey(citedUrl);
      if (targetKeys.has(key)) {
        seenPages.add(key);
        citesCompetitor = true;
      }
    }
    if (citesOwned) ownCitationCount += 1;
    if (citesCompetitor) competitorCitationCount += 1;
    for (const key of seenPages) pageCounts.set(key, (pageCounts.get(key) ?? 0) + 1);
  }

  const topCitedPages = input.target.urls.map((url) => ({
    url,
    hostname: hostOf(url),
    isOwned: false,
    answers: pageCounts.get(urlKey(url)) ?? 0,
  }));
  const byDomain = new Map<string, number>();
  for (const page of topCitedPages) {
    if (!page.hostname) continue;
    byDomain.set(page.hostname, (byDomain.get(page.hostname) ?? 0) + page.answers);
  }

  return {
    source: "native",
    prompts: [input.target.promptText],
    promptCount: 1,
    fanoutQueries: [...new Set(input.fanoutQuestions)].slice(0, 12),
    topCitedPages,
    topCitedDomains: [...byDomain.entries()]
      .map(([hostname, answers]) => ({ hostname, answers }))
      .sort((a, b) => b.answers - a.answers || a.hostname.localeCompare(b.hostname)),
    ownCitationCount,
    competitorCitationCount,
    recommendedContentShape: input.brief.answerShape.replace(/_/g, " "),
    confidence: input.brief.sourceCount >= 3 ? "high" : "medium",
    matchBasis: "same native AI prompt, cited winner pages, and multi-winner teardown",
    winnerConsensus: {
      sourceCount: input.brief.sourceCount,
      sharedHeadings: input.brief.sharedHeadings.map((heading) => heading.label).slice(0, 10),
      answerShape: input.brief.answerShape,
      wordBand: input.brief.wordBand,
      schemaTypes: input.brief.schemaTypes.slice(0, 8),
      openingPattern: input.brief.openingPattern,
      hasFaqConsensus: input.brief.hasFaqConsensus,
      hasToolConsensus: input.brief.hasToolConsensus,
    },
  };
}
