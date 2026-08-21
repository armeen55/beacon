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
 *  parent questions, never in row totals. Unknown volume stays unknown, never zero. EVERY TRUNCATION SAYS SO. */

import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { citesOwnSite } from "./canonicalize-citation-url";

/** The minimal observation shape this projection reads: satisfied structurally by the snapshot's own
 *  CanonicalPairObservation and by the lean `fanout` projection a surface loads, so both build the SAME rows. */
export type FanoutSourceObservation = {
  observationId: string; promptId: string; promptText: string; engine: string; reportingDay: string;
  /** The instrument this answer was served on. Never merged into another: a model swap is a platform change. */
  modelServed?: string | null; observationMode?: string | null;
  fanOutQueries: readonly string[] | null;
  citations: readonly { url: string; domain: string }[] | null;
  retrievedResults: readonly { url: string; domain: string }[] | null;
};

/** WHERE THIS SITE STOOD in the answers that ran this search. Four different worlds, four different actions:
 *  cited = credited; retrieved_not_cited = read and passed over; not_retrieved = rivals were read instead;
 *  unreported = the engines that ran it never said what they read or credited. */
type FanoutOwnState = "cited" | "retrieved_not_cited" | "not_retrieved" | "unreported";

export type FanoutRow = {
  /** The most executed exact wording. Display only: identity is `key` and every wording is kept in `variants`. */
  query: string;
  /** The normalized identity variants collapse onto for counting. */
  key: string;
  /** EVERY exact wording that collapsed onto this key, most executed first. Nothing is silently dropped: a
   *  cluster shown under one wording used to lose the other four the assistants actually typed. */
  variants: { text: string; executions: number }[];
  /** DISTINCT recurrence: rows are stability, these are breadth. */
  executions: number; days: number; engines: string[];
  parents: { promptId: string; promptText: string; executions: number }[];
  /** THE DENOMINATOR THIS SHARE BELONGS TO: the answers to THESE parent questions that reported any fan-out.
   *  Dividing by the whole account made a search behind one quiet question look rare next to one behind a
   *  loud question, which is a fact about the questions and not about the search. */
  parentExecutions: number; parentShare: number;
  /** The same count against every reporting answer in the window. Labelled account wide wherever it renders. */
  windowShare: number;
  /** Concepts the assistant ADDED beyond its parent questions: the assistant's own idea of what was missing. */
  addedWords: string[];
  /** Where the owned site stood across the answers that ran this search. */
  ownState: FanoutOwnState;
  ownCitedAnswers: number; ownRetrievedAnswers: number; retrievedNotCitedAnswers: number;
  /** The answers behind this search that reported citations at all: the honest denominator. */
  reportingAnswers: number;
  /** THE PAGES OF THIS ACCOUNT the assistants reported READING on these answers. This is the landing evidence
   *  a card should stand on: the engine itself named the page, so nothing has to be guessed by word overlap. */
  ownPages: { url: string; cited: number; retrieved: number; retrievedNotCited: number }[];
  /** The rival pages repeatedly credited on this search's answers, most credited first, and how many there
   *  were in total, so the five shown never read as all there were. */
  rivalPages: { url: string; domain: string; answers: number }[]; rivalPagesTotal: number;
  /** Every instrument that ran it, never merged. */
  models: { engine: string; modelServed: string | null; mode: string; executions: number }[];
  /** The exact observations behind every number above, newest day first, bounded, and it says when it cut. */
  observationIds: string[]; observationIdsTruncated: boolean;
  /** Recurrence has earned investigation, and the reason is carried in the words the screen and the card
   *  both print, so "material" is never a bare flag nobody can argue with. */
  material: boolean; materialBecause: string;
};

export type FanoutEvidence = {
  rows: FanoutRow[];
  /** The window's own denominators, said out loud: answers held, answers that reported fan-outs at all. */
  answers: number; reportingAnswers: number; fromDay: string | null; toDay: string | null;
};

/** THE HONEST LIMIT ON EVERY FAN-OUT CLAIM, in ONE string so the screen and the card can never drift apart.
 *  No assistant reports which of its searches produced which citation. */
export const FANOUT_LINKAGE_CAVEAT =
  "Pages credited on an answer that ran this search co-occurred with it. No assistant reports which of its searches produced which citation, so this is evidence about the same answer and never proof of cause.";

/** How many observation ids one row carries before it says it cut the list. */
const IDS_SHOWN = 40, RIVALS_SHOWN = 5;

const wordsOf = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter((w) => w.length > 2));
const cleanUrl = (u: string): string => (u.split("?")[0] ?? u).replace(/\/+$/, "");

/** PURE: canonical observations in, the one fan-out projection out. A fan-out equal to its own parent
 *  question is an echo of the prompt, evidence of retrieval behavior and never a search the assistant
 *  thought of, so it is excluded here exactly as the membership predicate excludes it. */
export function buildFanoutEvidence(observations: readonly FanoutSourceObservation[], site: string): FanoutEvidence {
  const rows = new Map<string, { obs: FanoutSourceObservation[]; wordings: Map<string, number> }>();
  /** How many answers to EACH tracked question reported a fan-out at all: the parent-specific denominator. */
  const reportingByPrompt = new Map<string, number>();
  let reporting = 0;
  const daysSeen: string[] = [];
  for (const o of observations) {
    daysSeen.push(o.reportingDay);
    const fans = (o.fanOutQueries ?? []).map((q) => q.trim()).filter(Boolean);
    if (o.fanOutQueries != null) { reporting += 1; reportingByPrompt.set(o.promptId, (reportingByPrompt.get(o.promptId) ?? 0) + 1); }
    const asked = canonicalQueryKey(o.promptText);
    for (const q of new Set(fans)) {
      const key = canonicalQueryKey(q);
      if (!key || key === asked) continue; // the echo of the prompt is not the assistant's own search
      const held = rows.get(key) ?? { obs: [], wordings: new Map<string, number>() };
      held.obs.push(o);
      held.wordings.set(q, (held.wordings.get(q) ?? 0) + 1);
      rows.set(key, held);
    }
  }
  const out: FanoutRow[] = [...rows.entries()].map(([key, r]) => {
    const days = new Set(r.obs.map((o) => o.reportingDay));
    const engines = new Set(r.obs.map((o) => o.engine));
    const parentRuns = new Map<string, { promptText: string; executions: number }>();
    for (const o of r.obs) {
      const held = parentRuns.get(o.promptId) ?? { promptText: o.promptText, executions: 0 };
      held.executions += 1; parentRuns.set(o.promptId, held);
    }
    const parentWords = new Set([...parentRuns.values()].flatMap((p) => [...wordsOf(p.promptText)]));
    const reportingObs = r.obs.filter((o) => o.citations != null);
    const ownCited = reportingObs.filter((o) => citesOwnSite(o.citations, site));
    const retrievedOwn = r.obs.filter((o) => citesOwnSite(o.retrievedResults, site));
    const rnc = retrievedOwn.filter((o) => !citesOwnSite(o.citations, site));
    // THE PAGES OF THIS ACCOUNT THE ENGINE ITSELF NAMED, counted per answer so a page listed twice in one
    // journey is still one answer having read it.
    const ownPages = new Map<string, { url: string; cited: number; retrieved: number; retrievedNotCited: number }>();
    for (const o of r.obs) {
      const citedOwn = new Set((o.citations ?? []).filter((c) => citesOwnSite([c], site)).map((c) => cleanUrl(c.url)));
      const readOwn = new Set((o.retrievedResults ?? []).filter((c) => citesOwnSite([c], site)).map((c) => cleanUrl(c.url)));
      for (const u of new Set([...citedOwn, ...readOwn])) {
        const held = ownPages.get(u) ?? { url: u, cited: 0, retrieved: 0, retrievedNotCited: 0 };
        if (citedOwn.has(u)) held.cited += 1;
        if (readOwn.has(u)) { held.retrieved += 1; if (!citedOwn.has(u)) held.retrievedNotCited += 1; }
        ownPages.set(u, held);
      }
    }
    const rivals = new Map<string, { url: string; domain: string; answers: number }>();
    for (const o of reportingObs) for (const c of new Map((o.citations ?? []).map((c) => [cleanUrl(c.url), c])).values()) {
      if (citesOwnSite([c], site)) continue;
      const u = cleanUrl(c.url);
      const held = rivals.get(u) ?? { url: u, domain: c.domain, answers: 0 };
      held.answers += 1; rivals.set(u, held);
    }
    const instruments = new Map<string, { engine: string; modelServed: string | null; mode: string; executions: number }>();
    for (const o of r.obs) {
      const mode = o.observationMode ?? "";
      const k = `${o.engine}|${o.modelServed ?? ""}|${mode}`;
      const held = instruments.get(k) ?? { engine: o.engine, modelServed: o.modelServed ?? null, mode, executions: 0 };
      held.executions += 1; instruments.set(k, held);
    }
    const ownState: FanoutOwnState = ownCited.length > 0 ? "cited"
      : rnc.length > 0 ? "retrieved_not_cited"
        : reportingObs.length > 0 ? "not_retrieved" : "unreported";
    const parentExecutions = [...parentRuns.keys()].reduce((a, id) => a + (reportingByPrompt.get(id) ?? 0), 0);
    const ids = [...new Set(r.obs.map((o) => o.observationId))];
    // MATERIALITY IS TIME, OR BREADTH THAT HAS ALREADY COST SOMETHING. Three days is a pattern. Two days with
    // a second assistant or a second parent question is a pattern. ONE day on two assistants is a coincidence
    // unless it already has a consequence here: a page of this account was read for it and passed over. A bare
    // OR called that coincidence material and put it in front of the operator as work (operator, 2026-08-19).
    const nDays = days.size, nEngines = engines.size, nParents = parentRuns.size;
    const recurred = nDays >= 3 || (nDays >= 2 && (nEngines >= 2 || nParents >= 2));
    const consequential = rnc.length > 0;
    const material = recurred || (nEngines >= 2 && consequential);
    const materialBecause = nDays >= 3 ? `ran on ${nDays} separate days`
      : nDays >= 2 && nEngines >= 2 ? `ran on ${nDays} days across ${nEngines} assistants`
        : nDays >= 2 && nParents >= 2 ? `ran on ${nDays} days behind ${nParents} tracked questions`
          : material ? `ran on ${nEngines} assistants the same day, and a page here was read for it and passed over ${rnc.length} ${rnc.length === 1 ? "time" : "times"}`
            : `seen ${r.obs.length} ${r.obs.length === 1 ? "time" : "times"} on one day, which is not a pattern yet`;
    return {
      query: [...r.wordings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "",
      key,
      variants: [...r.wordings.entries()].map(([text, executions]) => ({ text, executions }))
        .sort((a, b) => b.executions - a.executions || a.text.localeCompare(b.text)),
      executions: r.obs.length, days: nDays, engines: [...engines].sort(),
      parents: [...parentRuns.entries()].map(([promptId, p]) => ({ promptId, promptText: p.promptText, executions: p.executions })),
      parentExecutions, parentShare: parentExecutions > 0 ? r.obs.length / parentExecutions : 0,
      windowShare: reporting > 0 ? r.obs.length / reporting : 0,
      addedWords: [...wordsOf([...r.wordings.keys()][0] ?? "")].filter((w) => !parentWords.has(w)).slice(0, 8),
      ownState, ownCitedAnswers: ownCited.length, ownRetrievedAnswers: retrievedOwn.length,
      retrievedNotCitedAnswers: rnc.length, reportingAnswers: reportingObs.length,
      ownPages: [...ownPages.values()].sort((a, b) => b.retrievedNotCited - a.retrievedNotCited || b.retrieved - a.retrieved || a.url.localeCompare(b.url)),
      rivalPages: [...rivals.values()].sort((a, b) => b.answers - a.answers || a.url.localeCompare(b.url)).slice(0, RIVALS_SHOWN),
      rivalPagesTotal: rivals.size,
      models: [...instruments.values()].sort((a, b) => b.executions - a.executions || a.engine.localeCompare(b.engine)),
      observationIds: ids.slice(0, IDS_SHOWN), observationIdsTruncated: ids.length > IDS_SHOWN,
      material, materialBecause,
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
  const pages = new Map<string, { cited: number; retrieved: number; rnc: number; engines: Set<string>; prompts: Set<string>; days: Set<string> }>();
  const touch = (url: string, o: FanoutSourceObservation, kind: "cited" | "retrieved" | "rnc") => {
    const held = pages.get(url) ?? { cited: 0, retrieved: 0, rnc: 0, engines: new Set<string>(), prompts: new Set<string>(), days: new Set<string>() };
    held[kind === "rnc" ? "rnc" : kind] += 1;
    held.engines.add(o.engine); held.prompts.add(o.promptId); held.days.add(o.reportingDay);
    pages.set(url, held);
  };
  for (const o of observations) {
    const citedOwn = new Set((o.citations ?? []).filter((c) => citesOwnSite([c], site)).map((c) => cleanUrl(c.url)));
    const retrievedOwn = new Set((o.retrievedResults ?? []).filter((c) => citesOwnSite([c], site)).map((c) => cleanUrl(c.url)));
    for (const u of citedOwn) touch(u, o, "cited");
    for (const u of retrievedOwn) { touch(u, o, "retrieved"); if (!citedOwn.has(u)) touch(u, o, "rnc"); }
  }
  return [...pages.entries()].map(([url, p]) => ({ url, cited: p.cited, retrieved: p.retrieved,
    retrievedNotCited: p.rnc, engines: [...p.engines].sort(), prompts: p.prompts.size, days: p.days.size }))
    .sort((a, b) => b.cited - a.cited || b.retrieved - a.retrieved || a.url.localeCompare(b.url));
}
