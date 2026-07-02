/**
 * citation-outcome (2026-07-01, master plan item 5) - the AI-citation verdict lane
 * for the proof ledger. PURE, deterministic, $0 (no I/O, no LLM).
 *
 * The GSC diff-in-diff judges a shipped change on Search metrics only. But an
 * answer-block / FAQ / schema / new-page change has a SECOND goal: getting AI
 * answers (ChatGPT, Perplexity, Gemini, Claude via the nightly poll, plus the
 * Profound import) to cite the page. This module turns pre-ship and post-ship
 * citation observations for the treated page AND its comparison pages into a
 * control-adjusted "did the change win AI mentions?" outcome that sits ALONGSIDE
 * the GSC verdict, exactly like traffic-outcome.ts does for GA4.
 *
 *   adjusted = (treatedPost - treatedPre*scale) - mean(controlPost - controlPre*scale)
 *
 * Same observational honesty rules as the GSC lane:
 *   - the pre window (28d) is pro-rated to the post window length so unequal
 *     windows are never subtracted raw;
 *   - comparison pages absorb the tide (a nightly poll expanding coverage lifts
 *     every page's counts; that is not the change's doing);
 *   - a page with zero citation evidence in BOTH windows is insufficient_data
 *     (we cannot tell "AI ignores it" from "nothing measured it"), and the UI
 *     stays SILENT for insufficient_data - silence, not noise;
 *   - a window with no measurement activity at all (no poll ran, no import
 *     synced) is insufficient_data, never a fake "lost everything".
 *
 * URL-matching + first-citation semantics mirror the locked
 * citation-lifecycle/compute-time-to-citation module (canonical URL comparison,
 * UTC day boundaries, per-answer URL dedupe); this module exists because that
 * one is hard-locked to RecommendedEditRow eligibility + the chatgpt/perplexity
 * pair, and the proof lane must also count the item-4 gemini/claude engines and
 * Profound day-count rows, with comparison pages as the drift adjuster.
 *
 * NO em or en dashes in any sentence (guard-tested). No lab words on operator
 * copy ("comparison pages", never "controls"; "AI mentions" / "questions I
 * check", never raw "citations"/"prompts" jargon-dumping).
 */

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { normalizePlatform } from "@/lib/platform";

/** One citation observation event for a page, already URL-matched by the loader. */
export type CitationEvent = {
  /** YYYY-MM-DD (UTC) the AI answer / imported citation row was observed. */
  date: string;
  /** Engine slug ("chatgpt", "perplexity", "gemini", "claude") or import model name. */
  platform: string;
  /** The tracked question's text when known (native poll rows); null for
   *  imported Profound day-count rows (they carry no question identity). */
  promptText: string | null;
  /** Citation events this row represents. Native rows are 1; imported rows are
   *  at least 1 per model-day (fractional import shares round UP to presence,
   *  see matchCitationEvents). */
  count: number;
};

export type CitationOutcomeVerdict = "gained" | "lost" | "no_change" | "insufficient_data";

export type CitationOutcome = {
  verdict: CitationOutcomeVerdict;
  /** Raw citation events on the treated page in the pre window (not pro-rated). */
  treatedPreCount: number;
  /** Raw citation events on the treated page in the post window. */
  treatedPostCount: number;
  /** Mean comparison-page citation delta (post minus pro-rated pre). 0 when none usable. */
  controlDelta: number;
  /** Distinct tracked questions whose AI answers cite the page in the post window,
   *  ordered by first appearance. Empty when only import rows (no question identity). */
  promptsNowCiting: string[];
  /** Days from ship to the first post-ship citation; null when uncited post-ship. */
  daysToFirstCitation: number | null;
  /** True when the treated gain was discounted because comparison pages rose about as much. */
  tideLifted: boolean;
  /** Post window length in days (elapsed, capped at the proof max). */
  postWindowDays: number;
  /** Plain-language one-liner. Present for every verdict (diagnostics), but the UI
   *  renders it ONLY via citationLineFor, which is silent on insufficient_data. */
  sentence: string;
};

export type CitationOutcomeInput = {
  /** Ship date (ISO or YYYY-MM-DD). Day math is UTC. */
  shippedAt: string;
  /** Pre window length in days (the recorder's 28d). */
  preWindowDays: number;
  /** Elapsed post window length in days (0 = no post day yet). */
  postWindowDays: number;
  treatedPre: CitationEvent[];
  treatedPost: CitationEvent[];
  /** Pre/post events per comparison page (pages the operator did not change). */
  controls: Array<{ pre: CitationEvent[]; post: CitationEvent[] }>;
  /** True when ANY citation measurement (nightly poll row or import row, any page)
   *  landed inside the pre window. Distinguishes "uncited" from "unmeasured". */
  sourceActiveInPre: boolean;
  /** Same for the post window. */
  sourceActiveInPost: boolean;
};

/** Action types whose success includes winning AI mentions. A title/meta change
 *  is judged on CTR alone and does not get this lane. */
const CITATION_RELEVANT_ACTIONS = new Set([
  "add_answer_block",
  "answer_block",
  "intro_answer_block",
  "add_faq",
  "faq",
  "create_page",
  "add_schema",
  "fix_schema",
  "schema",
]);

export function isCitationRelevantAction(actionType: string): boolean {
  return CITATION_RELEVANT_ACTIONS.has((actionType || "").toLowerCase());
}

/** A net move of at least one citation event (raw AND comparison-adjusted) is
 *  required before the lane names a gained/lost. Citations are sparse; one real
 *  net mention is meaningful, anything under it is noise. */
const MIN_NET_EVENTS = 1;

const MS_PER_DAY = 86_400_000;

function dateOnly(iso: string): string {
  return iso.length > 10 ? iso.slice(0, 10) : iso;
}

/** Whole UTC days from startIso to endIso (YYYY-MM-DD each). Negative when end < start. */
function utcDaysBetween(startIso: string, endIso: string): number {
  const s = Date.UTC(
    Number(startIso.slice(0, 4)),
    Number(startIso.slice(5, 7)) - 1,
    Number(startIso.slice(8, 10)),
  );
  const e = Date.UTC(
    Number(endIso.slice(0, 4)),
    Number(endIso.slice(5, 7)) - 1,
    Number(endIso.slice(8, 10)),
  );
  return Math.floor((e - s) / MS_PER_DAY);
}

const sum = (events: ReadonlyArray<CitationEvent>): number =>
  events.reduce((s, e) => s + Math.max(0, e.count || 0), 0);

const mean = (xs: number[]): number => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** "3" for integers, "about 1.5" for fractions (pro-rated pre counts). */
function approx(n: number): string {
  const r = round1(n);
  return Number.isInteger(r) ? String(r) : `about ${r}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Distinct question texts citing the page post-ship, ordered by first appearance date. */
function promptsFrom(events: ReadonlyArray<CitationEvent>): string[] {
  const sorted = [...events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of sorted) {
    const text = (e.promptText ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** "the same day it shipped" / "1 day after the change" / "11 days after the change". */
function afterShipPhrase(days: number | null): string {
  if (days == null) return "after the change";
  if (days <= 0) return "the same day it shipped";
  return `${plural(days, "day")} after the change`;
}

export function computeCitationOutcome(input: CitationOutcomeInput): CitationOutcome {
  const shipDate = dateOnly(input.shippedAt);
  const preDays = input.preWindowDays;
  const postDays = input.postWindowDays;

  const treatedPreCount = sum(input.treatedPre);
  const treatedPostCount = sum(input.treatedPost);

  // Pro-rate the (longer) pre window to the post window length so a 28d sum is
  // never subtracted from a 7d one (same rule as the clicks diff-in-diff).
  const scale = preDays > 0 ? postDays / preDays : 1;
  const scaledPre = treatedPreCount * scale;
  const treatedDelta = treatedPostCount - scaledPre;

  const controlDeltas = input.controls.map((c) => sum(c.post) - sum(c.pre) * scale);
  const controlDelta = round1(mean(controlDeltas));
  const adjusted = treatedDelta - controlDelta;

  const promptsNowCiting = promptsFrom(input.treatedPost);

  // First post-ship citation day (UTC), clamped at 0 for same-day observations.
  let daysToFirstCitation: number | null = null;
  if (input.treatedPost.length > 0) {
    const first = input.treatedPost.reduce(
      (min, e) => (e.date < min ? e.date : min),
      input.treatedPost[0]!.date,
    );
    daysToFirstCitation = Math.max(0, utcDaysBetween(shipDate, first));
  }

  let verdict: CitationOutcomeVerdict;
  let tideLifted = false;

  if (postDays <= 0) {
    // No post day elapsed yet: nothing to judge.
    verdict = "insufficient_data";
  } else if (!input.sourceActiveInPost) {
    // No poll ran and no import synced since the ship: absence of citations is
    // absence of MEASUREMENT, never a loss.
    verdict = "insufficient_data";
  } else if (treatedPreCount === 0 && treatedPostCount === 0) {
    // Page never observed in either window: cannot tell "AI ignores it" from
    // "the checks never surfaced it". Silent lane.
    verdict = "insufficient_data";
  } else if (treatedDelta >= MIN_NET_EVENTS && treatedPostCount > 0) {
    if (!input.sourceActiveInPre) {
      // Cited now, but the pre window had no measurement at all, so "up from
      // zero" would overstate what we know. Do not credit the change.
      verdict = "insufficient_data";
    } else if (adjusted >= MIN_NET_EVENTS) {
      verdict = "gained";
    } else {
      // The page rose, but comparison pages rose about as much: the tide
      // lifted all boats (poll coverage grew, topic got hotter). No credit.
      verdict = "no_change";
      tideLifted = controlDelta > 0;
    }
  } else if (treatedDelta <= -MIN_NET_EVENTS && adjusted <= -MIN_NET_EVENTS) {
    // Down in raw terms AND vs comparisons: a real drop, not a receding tide.
    verdict = "lost";
  } else {
    verdict = "no_change";
  }

  const sentence = buildSentence({
    verdict,
    tideLifted,
    // Raw drop absorbed by comparison pages (a receding tide, not the change):
    // said plainly instead of a misleading "about the same".
    rawDropped: treatedDelta <= -MIN_NET_EVENTS,
    treatedPreCount,
    treatedPostCount,
    scaledPre,
    preDays,
    postDays,
    promptsNowCiting,
    daysToFirstCitation,
  });

  return {
    verdict,
    treatedPreCount,
    treatedPostCount,
    controlDelta,
    promptsNowCiting,
    daysToFirstCitation,
    tideLifted,
    postWindowDays: postDays,
    sentence,
  };
}

function buildSentence(a: {
  verdict: CitationOutcomeVerdict;
  tideLifted: boolean;
  rawDropped: boolean;
  treatedPreCount: number;
  treatedPostCount: number;
  scaledPre: number;
  preDays: number;
  postDays: number;
  promptsNowCiting: string[];
  daysToFirstCitation: number | null;
}): string {
  if (a.verdict === "insufficient_data") {
    return "I do not have enough AI answer data around this change to judge it yet.";
  }
  if (a.verdict === "gained") {
    const when = afterShipPhrase(a.daysToFirstCitation);
    if (a.promptsNowCiting.length > 0) {
      const n = a.promptsNowCiting.length;
      // Sparse-data honesty: one answer is an early signal, said plainly.
      const early = a.treatedPostCount <= 1 ? " One answer so far, I am watching for repeats." : "";
      return `AI now recommends this page on ${n} of the questions I check, starting ${when}.${early}`;
    }
    // Import rows only (no question identity): report the count movement.
    const before = a.treatedPreCount === 0 ? "none" : `${approx(a.scaledPre)}`;
    const early = a.treatedPostCount <= 1 ? " Early, I am watching for repeats." : "";
    return `AI answers mention this page more since the change: ${plural(a.treatedPostCount, "mention")} in the ${a.postDays} days after, up from ${before} in a typical stretch that long before.${early}`;
  }
  if (a.verdict === "lost") {
    const since =
      a.treatedPostCount === 0 ? "none since" : `only ${plural(a.treatedPostCount, "mention")} since`;
    return `AI answers mentioned this page ${plural(a.treatedPreCount, "time")} in the ${a.preDays} days before the change but ${since}. I am watching to see if it comes back.`;
  }
  if (a.tideLifted) {
    return "AI mentions of this page rose after the change, but similar pages I did not touch rose about as much, so I am not crediting this change yet.";
  }
  if (a.rawDropped) {
    // Down in raw terms but comparison pages fell about as much: the tide went
    // out everywhere. Not this change's fault, and saying "about the same"
    // would misread a visible dip.
    return "AI mentions of this page dipped after the change, but similar pages I did not touch dipped about as much, so I am not blaming this change.";
  }
  return `AI mentions of this page look about the same since the change: ${plural(a.treatedPostCount, "mention")} in the ${a.postDays} days after. I keep checking every night.`;
}

/**
 * The ONE presentation gate: the row line to render, or null for silence.
 * Silent when the outcome is missing (not a citation-relevant change, loader
 * failed) or insufficient_data (no data = nothing, not noise).
 */
export function citationLineFor(outcome: CitationOutcome | null | undefined): string | null {
  if (outcome == null) return null;
  if (outcome.verdict === "insufficient_data") return null;
  return outcome.sentence || null;
}

// ── Pure URL matching (loader-independent, unit-tested) ──────────────────────

/** Lean native poll row (a `prompt_answer_observations` projection). */
export type NativeCitationRow = {
  prompt_id: string;
  /** ISO timestamp (or YYYY-MM-DD). */
  observed_at: string;
  platform: string;
  citation_urls?: string[] | null;
};

/** Lean imported citation row (a `profound_citation_rows` projection). */
export type ImportedCitationRow = {
  /** YYYY-MM-DD (or ISO). */
  date: string;
  model: string | null;
  url: string;
  /** Real prod data carries a FRACTIONAL citation share here (e.g. 0.0007),
   *  not an integer count. The matcher converts any positive value to at
   *  least one presence event (see below). */
  citation_count: number | null;
};

/**
 * Canonicalize a citation URL, tolerating the scheme-less "host/path" form the
 * Profound import stores ("iranopedia.com/appetizers"). Real prod finding
 * (2026-07-02 probe): every profound_citation_rows.url lacks a scheme, so the
 * strict canonicalizer alone would silently zero the whole import lane. A bare
 * path ("/foo") still returns null (single-label host is rejected). PURE.
 */
export function canonicalizeCitationUrlLoose(raw: string | null | undefined): string | null {
  const strict = canonicalizeCitationUrl(raw);
  if (strict != null) return strict;
  if (raw == null) return null;
  const trimmed = raw.trim();
  // Only retry things that look like "host.tld/..." or "host.tld" without a
  // scheme; anything else (paths, fragments, other schemes) stays rejected.
  if (trimmed === "" || /^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(trimmed) || trimmed.startsWith("/")) {
    return null;
  }
  const head = trimmed.split("/")[0] ?? "";
  if (!head.includes(".")) return null;
  return canonicalizeCitationUrl(`https://${trimmed}`);
}

/**
 * Join citation observations to the proof record's pages. PURE. Matching is
 * canonical-URL equality (host-aware, via canonicalizeCitationUrl, same
 * semantics as the citation-lifecycle first-citation matcher) so
 * "demattei.com/services" never credits "ritzbuilders.com/services". A page
 * stored as a bare path cannot canonicalize and simply matches nothing (the
 * lane then reads insufficient_data and stays silent; ledger pages are
 * canonical URLs in practice, see captureChangeMeta).
 *
 *   - Native rows: one event per DISTINCT matched URL per answer (per-answer
 *     dedupe, mirroring buildNativeDayBuckets invariant 1), promptText joined
 *     from the tracked-prompt map when known.
 *   - Imported rows: per-day count events, no question identity (promptText
 *     null). Zero/negative counts are dropped.
 *
 * Returns a map keyed by the SAME page strings passed in.
 */
export function matchCitationEvents(args: {
  pages: ReadonlyArray<string>;
  observations: ReadonlyArray<NativeCitationRow>;
  importedRows: ReadonlyArray<ImportedCitationRow>;
  promptTextById?: ReadonlyMap<string, string>;
}): Map<string, CitationEvent[]> {
  const out = new Map<string, CitationEvent[]>();
  const canonToPages = new Map<string, string[]>();
  for (const page of args.pages) {
    out.set(page, []);
    const canon = canonicalizeCitationUrlLoose(page);
    if (canon == null) continue;
    const arr = canonToPages.get(canon) ?? [];
    arr.push(page);
    canonToPages.set(canon, arr);
  }
  if (canonToPages.size === 0) return out;

  const push = (canon: string, event: CitationEvent): void => {
    const pages = canonToPages.get(canon);
    if (!pages) return;
    for (const page of pages) out.get(page)!.push(event);
  };

  for (const obs of args.observations) {
    const urls = obs.citation_urls;
    if (!urls || urls.length === 0) continue;
    const date = dateOnly(obs.observed_at);
    // Per-answer dedupe: the same URL cited twice in ONE answer is one event.
    const matchedInAnswer = new Set<string>();
    for (const raw of urls) {
      const canon = canonicalizeCitationUrlLoose(raw);
      if (canon == null || !canonToPages.has(canon) || matchedInAnswer.has(canon)) continue;
      matchedInAnswer.add(canon);
      push(canon, {
        date,
        platform: normalizePlatform(obs.platform || "unknown"),
        promptText: args.promptTextById?.get(obs.prompt_id) ?? null,
        count: 1,
      });
    }
  }

  for (const row of args.importedRows) {
    if (!row.url || !row.date) continue;
    const rawCount = row.citation_count ?? 0;
    if (rawCount <= 0) continue;
    const canon = canonicalizeCitationUrlLoose(row.url);
    if (canon == null || !canonToPages.has(canon)) continue;
    // Prod citation_count is a fractional SHARE (0.0007), not a count; summing
    // shares against the 1-net-event threshold would zero the lane. Any
    // positive value = at least ONE "this model cited this page this day"
    // event; a genuine integer count (>= 1) passes through unchanged.
    const count = Math.max(1, Math.round(rawCount));
    push(canon, {
      date: dateOnly(row.date),
      platform: (row.model || "unknown").trim() || "unknown",
      promptText: null,
      count,
    });
  }

  return out;
}

/** Events with `start <= date < end` (YYYY-MM-DD bounds). PURE. */
export function eventsInWindow(
  events: ReadonlyArray<CitationEvent>,
  start: string,
  end: string,
): CitationEvent[] {
  return events.filter((e) => e.date >= start && e.date < end);
}
