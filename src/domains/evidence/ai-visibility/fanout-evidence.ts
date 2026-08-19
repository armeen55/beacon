import "server-only";

/** ai-visibility/fanout-evidence - THE searches assistants actually ran, as first-class evidence. Beacon
 *  stored every provider-issued fan-out and then summarized them from the LATEST DAY only, buried under
 *  "Searches they ran" and disconnected from Decision, so a search four assistants ran on six days looked the
 *  same as one somebody saw once (operator, 2026-08-19). This is the ONE derived projection of that evidence:
 *  Visibility renders it and Decision consumes it, built by the SAME pure function from the SAME canonical
 *  observations, so the counts on the screen and the counts behind a Change can never disagree.
 *
 *  NOT A SECOND CANONICAL RECORD: everything here derives from ai_observations rows already on file, keyed
 *  back to them by observation id, and is recomputed per read. RAW ROWS ARE NEVER AUDIENCE: the same tracked
 *  question asked on twenty days measures stability, so recurrence is counted in DISTINCT days, engines and
 *  parent questions, never in row totals. Unknown volume stays unknown, never zero. */

import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { citesOwnSite } from "./canonicalize-citation-url";

/** The minimal observation shape this projection reads: satisfied structurally by the snapshot's own
 *  CanonicalPairObservation and by the lean `fanout` projection a surface loads, so both build the SAME rows. */
export type FanoutSourceObservation = {
  observationId: string; promptId: string; promptText: string; engine: string; reportingDay: string;
  fanOutQueries: readonly string[] | null;
  citations: readonly { url: string; domain: string }[] | null;
  retrievedResults: readonly { url: string; domain: string }[] | null;
};

/** WHERE IRANOPEDIA STOOD in the answers that ran this search. Four different worlds, four different actions:
 *  cited = credited; retrieved_not_cited = read and passed over; not_retrieved = rivals were read instead;
 *  unreported = the engines that ran it never said what they read or credited. */
export type FanoutOwnState = "cited" | "retrieved_not_cited" | "not_retrieved" | "unreported";

export type FanoutRow = {
  /** The provider's exact wording, preserved verbatim. */
  query: string;
  /** The normalized identity variants collapse onto for counting; the exact wording always displays. */
  key: string;
  /** DISTINCT recurrence: rows are stability, these are breadth. */
  executions: number; days: number; engines: string[]; parents: { promptId: string; promptText: string }[];
  /** Share of window executions that reported ANY fan-out and ran this one. */
  share: number;
  /** Concepts the assistant ADDED beyond its parent questions: the assistant's own idea of what was missing. */
  addedWords: string[];
  /** Where the owned site stood across the answers that ran this search. */
  ownState: FanoutOwnState;
  ownCitedAnswers: number; ownRetrievedAnswers: number; retrievedNotCitedAnswers: number;
  /** The answers behind this search that reported citations at all: the honest denominator. */
  reportingAnswers: number;
  /** The rival pages repeatedly credited on this search's answers, most-credited first. */
  rivalPages: { url: string; domain: string; answers: number }[];
  /** The exact observations behind every number above, newest day first, bounded. */
  observationIds: string[];
  /** Recurrence has earned investigation: distinct days, engines or parent questions, never one sighting. */
  material: boolean;
};

export type FanoutEvidence = {
  rows: FanoutRow[];
  /** The window's own denominators, said out loud: answers held, answers that reported fan-outs at all. */
  answers: number; reportingAnswers: number; fromDay: string | null; toDay: string | null;
};

/** MATERIALITY: what a fan-out must show before it may earn work. One sighting is noise; recurrence across
 *  independent days, engines or parent questions is a pattern (Profound/Peec adapted, tested on own evidence). */
export const FANOUT_MATERIAL = { minDays: 3, minEngines: 2, minParents: 2 } as const;

const wordsOf = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter((w) => w.length > 2));

/** PURE: canonical observations in, the one fan-out projection out. A fan-out equal to its own parent
 *  question is an echo of the prompt, evidence of retrieval behavior and never a search the assistant
 *  thought of, so it is excluded here exactly as the membership predicate excludes it. */
export function buildFanoutEvidence(observations: readonly FanoutSourceObservation[], site: string): FanoutEvidence {
  const rows = new Map<string, { query: string; obs: FanoutSourceObservation[] }>();
  let reporting = 0;
  const daysSeen: string[] = [];
  for (const o of observations) {
    daysSeen.push(o.reportingDay);
    const fans = (o.fanOutQueries ?? []).map((q) => q.trim()).filter(Boolean);
    if (o.fanOutQueries != null) reporting += 1;
    const asked = canonicalQueryKey(o.promptText);
    for (const q of new Set(fans)) {
      const key = canonicalQueryKey(q);
      if (!key || key === asked) continue; // the echo of the prompt is not the assistant's own search
      const held = rows.get(key) ?? { query: q, obs: [] };
      held.obs.push(o);
      rows.set(key, held);
    }
  }
  const out: FanoutRow[] = [...rows.entries()].map(([key, r]) => {
    const days = new Set(r.obs.map((o) => o.reportingDay));
    const engines = new Set(r.obs.map((o) => o.engine));
    const parents = new Map(r.obs.map((o) => [o.promptId, o.promptText]));
    const parentWords = new Set([...parents.values()].flatMap((t) => [...wordsOf(t)]));
    const reportingObs = r.obs.filter((o) => o.citations != null);
    const ownCited = reportingObs.filter((o) => citesOwnSite(o.citations, site));
    const retrievedOwn = r.obs.filter((o) => citesOwnSite(o.retrievedResults, site));
    const rnc = retrievedOwn.filter((o) => !citesOwnSite(o.citations, site));
    const rivals = new Map<string, { url: string; domain: string; answers: number }>();
    for (const o of reportingObs) for (const c of new Map((o.citations ?? []).map((c) => [c.url.split("?")[0] ?? c.url, c])).values()) {
      if (citesOwnSite([c], site)) continue;
      const u = c.url.split("?")[0] ?? c.url;
      const held = rivals.get(u) ?? { url: u, domain: c.domain, answers: 0 };
      held.answers += 1; rivals.set(u, held);
    }
    const ownState: FanoutOwnState = ownCited.length > 0 ? "cited"
      : rnc.length > 0 ? "retrieved_not_cited"
        : reportingObs.length > 0 ? "not_retrieved" : "unreported";
    return {
      query: r.query, key,
      executions: r.obs.length, days: days.size, engines: [...engines].sort(),
      parents: [...parents.entries()].map(([promptId, promptText]) => ({ promptId, promptText })),
      share: reporting > 0 ? r.obs.length / reporting : 0,
      addedWords: [...wordsOf(r.query)].filter((w) => !parentWords.has(w)).slice(0, 8),
      ownState, ownCitedAnswers: ownCited.length, ownRetrievedAnswers: retrievedOwn.length,
      retrievedNotCitedAnswers: rnc.length, reportingAnswers: reportingObs.length,
      rivalPages: [...rivals.values()].sort((a, b) => b.answers - a.answers).slice(0, 5),
      observationIds: [...new Set(r.obs.map((o) => o.observationId))].slice(0, 40),
      material: days.size >= FANOUT_MATERIAL.minDays || engines.size >= FANOUT_MATERIAL.minEngines
        || parents.size >= FANOUT_MATERIAL.minParents,
    };
  }).sort((a, b) => b.days - a.days || b.engines.length - a.engines.length || b.executions - a.executions || a.query.localeCompare(b.query));
  const sortedDays = [...new Set(daysSeen)].sort();
  return { rows: out, answers: observations.length, reportingAnswers: reporting,
    fromDay: sortedDays[0] ?? null, toDay: sortedDays.at(-1) ?? null };
}

/** ONE OWNED PAGE'S AI STANDING over the same window: how often the assistants read it, credited it, or read
 *  it and passed it over, from the same canonical rows the fan-out view is built from. */
export type OwnedPageAiRow = { url: string; cited: number; retrieved: number; retrievedNotCited: number;
  engines: string[]; prompts: number; days: number };

export function ownedPageAiRollup(observations: readonly FanoutSourceObservation[], site: string): OwnedPageAiRow[] {
  const clean = (u: string): string => (u.split("?")[0] ?? u).replace(/\/+$/, "");
  const pages = new Map<string, { cited: number; retrieved: number; rnc: number; engines: Set<string>; prompts: Set<string>; days: Set<string> }>();
  const touch = (url: string, o: FanoutSourceObservation, kind: "cited" | "retrieved" | "rnc") => {
    const held = pages.get(url) ?? { cited: 0, retrieved: 0, rnc: 0, engines: new Set<string>(), prompts: new Set<string>(), days: new Set<string>() };
    held[kind === "rnc" ? "rnc" : kind] += 1;
    held.engines.add(o.engine); held.prompts.add(o.promptId); held.days.add(o.reportingDay);
    pages.set(url, held);
  };
  for (const o of observations) {
    const citedOwn = new Set((o.citations ?? []).filter((c) => citesOwnSite([c], site)).map((c) => clean(c.url)));
    const retrievedOwn = new Set((o.retrievedResults ?? []).filter((c) => citesOwnSite([c], site)).map((c) => clean(c.url)));
    for (const u of citedOwn) touch(u, o, "cited");
    for (const u of retrievedOwn) { touch(u, o, "retrieved"); if (!citedOwn.has(u)) touch(u, o, "rnc"); }
  }
  return [...pages.entries()].map(([url, p]) => ({ url, cited: p.cited, retrieved: p.retrieved,
    retrievedNotCited: p.rnc, engines: [...p.engines].sort(), prompts: p.prompts.size, days: p.days.size }))
    .sort((a, b) => b.cited - a.cited || b.retrieved - a.retrieved || a.url.localeCompare(b.url));
}
