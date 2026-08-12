/**
 * decision/suggested-edits: THE GENEROUS HALF OF THE QUEUE. Ready stays strict and is untouched by this file; everything here lands at `needs_review`: something concrete to try that deserves a read first.
 *
 * A SUGGESTION MERGES, IT NEVER REPLACES. The old generator put the search itself, title cased, in place of the
 * whole line, so a city guide was renamed "Tabriz Population" and a Danish search became an English title. The
 * new line keeps the words the page already earns on and leads with the words the search adds, or no card is
 * written at all. Four gates stand in front of that: the search has to be English, it has to carry at least
 * MIN_IMPRESSIONS views in 90 days, the merge has to fit inside a title Google will show whole, and the words this page earns clicks on are never dropped to make it fit.
 *
 * A SEARCH THAT ASKS FOR A FACT IS NOT A TITLE PROBLEM. "<city> population" on a city guide is a missing line,
 * not a missing headline, so it earns an answer line at the top of the page with the figure left for the operator to paste. No figure is ever invented here.
 *
 * PURE: no model call, no store, no clock of its own, no I/O. */

import { canonicalQueryKey, topicTokens } from "@/domains/evidence/relevance-gate";
import { defaultExpectedCtrAt } from "@/domains/evidence/forecast/tenant-ctr-curve";
import { canonicalUrlKey, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { answerIntelOf } from "@/domains/evidence/answer-intel";
import { observationJoinsCase } from "./membership";
import { effortForFamily, type ChangeProposal } from "./contracts";
import type { QualifiedCandidate } from "./opportunities";

/** How many hand-testable suggestions one pass may put in front of one operator. */
const MAX_SUGGESTIONS = 150;
/** TITLE_SOFT is how much of a title Google shows before it cuts, so the search has to land inside it. */
const TITLE_MIN = 15, TITLE_SOFT = 60, TITLE_MAX = 65;
/** Under this many views in 90 days a search is too small to rename a page over. */
const MIN_IMPRESSIONS = 100;
/** Above this many clicks in 90 days a page is earning, and what it earns on is protected. */
const EARNING_CLICKS = 50;
/** How far visits have to fall, against a ranking that held, before the fall is about the page. */
const VISIT_FALL = 0.3, POSITION_HELD = 1;
/** Anything that would make a suggestion unsafe to paste: a dash nobody writes, a bracket nobody filled in. */
const UNSAFE = /[–—]|\[|\]|\{|\}|lorem ipsum/i;
/** Causes that mean a suggestion here would be wrong work, not weak work. */
const NEVER = new Set(["measuring_change", "cannibalization", "technical_indexability"]);
/** Readings where the results page ITSELF cleared the wording: Google already shows the searcher's words, or the
 *  pages beating this one share nothing it is missing. A sharper line is disproved work, not a cheap test. */
const DISPROVED = new Set(["google_rewrite_already_matches", "ambiguous_search_intent"]);
/** The causes an assistant's own behaviour proves, so the limitation can name what was watched. */
const AEO = new Set(["ai_citation_gap", "retrieved_not_cited"]);
/** A search asking for one countable fact about a subject. These read cleanly as "X has a POPULATION of N". */
const FACT = /\b(population|area|elevation|altitude|height|depth|length|size|weight|distance)\b/i;
/** A search asking what something is CALLED in another language. The answer is a word, so an English headline
 *  merge answers nothing: "Hyena in Farsi: Meet the Striped Hyena" renames a page and still never says the word. */
const TRANSLATION = /\bin (farsi|persian|english)\b/i;
/** Function words a search in another language leans on. None of these is also an English word. */
const FOREIGN = new Set(["och", "der", "die", "das", "und", "les", "des", "une", "del", "los", "las", "por",
  "para", "que", "van", "het", "een", "til", "bir", "aus", "mit", "auf", "yang", "ein", "eine", "dei", "hvad"]);
/** English a searcher uses that a page may never print itself. */
const ENGLISH = new Set(["best", "top", "cheap", "cost", "price", "near", "how", "what", "where", "when", "why",
  "who", "which", "guide", "list", "map", "and", "the", "of", "in", "for", "to", "with", "a", "an", "is", "are",
  "do", "does", "new", "old", "free", "full", "male", "female", "people", "famous", "facts", "meaning", "name"]);
/** English words that end the way a Scandinavian or German adjective does, so the ending never accuses them. */
const ENGLISH_SK = new Set(["kiosk", "asterisk", "obelisk", "basilisk", "damask", "whisk", "brisk"]);
/** Words a title loses without losing its meaning, when the merge needs the room. */
const FILLER = new Set(["complete", "ultimate", "official", "list"]);

const pathOf = (url: string): string => {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname || "/"; } catch { return url; }
};
const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
const bare = (w: string): string => w.toLowerCase().replace(/[^a-z0-9']+/g, "");
/** Title casing for a search phrase: the joining words stay small, the first word never does, nothing else
 *  about the phrase is touched, so the line still says exactly what was searched. */
const SMALL = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "with"]);
const cased = (q: string): string => q.trim().split(/\s+/)
  .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
/** The name already at the end of this page's own title, READ off it, never invented. */
const brandOf = (title: string, parts = title.split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean)): string | null =>
  parts.length > 1 ? parts[parts.length - 1]! : null;
/** The search's own words this text never says. Empty = the text already names the search. */
const absent = (query: string, text: string | null, has = new Set(topicTokens(text))): string[] =>
  topicTokens(query).filter((t) => !has.has(t));

/** THE LANGUAGE GATE. A search whose words are not English never becomes a card, because merging a word this
 *  page cannot carry into its title is a rename in a language the page is not written in. Three deterministic
 *  tests, no dictionary: every character is plain ASCII, no word is a foreign function word or carries a
 *  foreign adjective ending, and at least one word is one this account's own pages or addresses already use. */
function english(query: string, corpus: ReadonlySet<string>): boolean {
  if (/[^\x20-\x7E]/.test(query)) return false;
  const ws = words(query);
  const foreign = (w: string): boolean => FOREIGN.has(w)
    || (w.length >= 6 && /(sk|ske|isch|ische|ski|cion|cao)$/.test(w) && !ENGLISH_SK.has(w));
  return ws.length > 0 && !ws.some(foreign) && ws.some((w) => corpus.has(w));
}

/** A page that ALREADY EARNS MORE clicks than its own positions predict is never handed a rewrite: one line
 *  serves every search a page wins, so chasing its softest one bets the searches that are working. ONE
 *  MEASURED SEARCH IS STILL A MEASUREMENT, or the AEO clause waives the click test on a page that is winning. */
function beatsItsCurve(page: OwnedPageEvidence): boolean {
  let earned = 0, predicted = 0;
  for (const q of page.search?.topQueries ?? []) {
    if (!(q.impressions > 0) || q.position == null || !(q.position > 0)) continue;
    earned += q.clicks; predicted += defaultExpectedCtrAt(q.position) * q.impressions;
  }
  return predicted > 0 && earned >= predicted;
}

/** THE WORDS THIS PAGE IS PAID FOR. Any word of the current title that its own earning searches contain is
 *  never dropped to make a merge fit: the merge is meant to add a search, never to trade one away. */
function earningWords(page: OwnedPageEvidence): Set<string> {
  const clicks = new Map<string, number>();
  for (const q of page.search?.topQueries ?? []) {
    for (const w of new Set(words(q.query))) clicks.set(w, (clicks.get(w) ?? 0) + Math.max(0, q.clicks));
  }
  return new Set([...clicks.entries()].filter(([, c]) => c > EARNING_CLICKS).map(([w]) => w));
}

/** WHY THIS SEARCH AND NOT THE BIGGER ONE ON THE SAME PAGE, the first thing a reader asks when a card targets the smaller of a page's searches. The rows answer it: a bigger search already earning what its own position pays is not the one leaving clicks. Null when the target IS the biggest, when no bigger search clears its own curve, or when one search is all there is. */
export function biggerSearchesLine(page: OwnedPageEvidence, primary: string, wording: boolean): string | null {
  const rows = (page.search?.topQueries ?? []).filter((q) => q.impressions > 0 && q.position != null && q.position > 0); const target = rows.find((q) => canonicalQueryKey(q.query) === canonicalQueryKey(primary));
  if (!target || rows.length < 2) return null;
  const top = rows.filter((q) => q.impressions > target.impressions && q.clicks / q.impressions >= defaultExpectedCtrAt(q.position!))
    .sort((a, b) => b.clicks - a.clicks || a.query.localeCompare(b.query))[0];
  return !top ? null : `The bigger searches on this page ("${top.query}": ${top.clicks.toLocaleString()} clicks) already earn what their positions usually get; "${primary}" is the one leaving clicks, and ${wording ? "the new title adds its words without dropping the ones the bigger searches match" : "this change answers it without touching what the bigger searches match"}.`;
}

type Suggestion = { field: "title" | "h1"; before: string; after: string; label: string; modeled: string | null };

/** ONE MERGED line: the search's words in front, this line's own words behind them, the name at the end kept
 *  when it still fits. Null whenever the merge would say nothing new, would lose a word this page earns on, or
 *  would not survive being pasted. A merge that cannot be built is NO CARD, never a replacement. */
function mergeLine(field: "title" | "h1", before: string | null | undefined, query: string,
  earns: ReadonlySet<string>, modeled: string | null): Suggestion | null {
  const now = (before ?? "").trim();
  if (!now || absent(query, now).length === 0) return null;
  const brand = field === "title" ? brandOf(now) : null;
  const core = brand ? now.split(/\s*\|\s*/).slice(0, -1).join(" ").trim() : now;
  // A line that already carries a colon cannot take a second one, and "Karaj Weather: Karaj, Iran: You Have to
  // Know" is what a second one reads like. Nothing is merged into it here, and the heading gets the chance.
  if (core.includes(":")) return null;
  // A SEARCH THAT MOSTLY REPEATS THE LINE IS NOT A LINE PROBLEM: "Balochistan Black Bear: Baluchistan Black
  // Bear" adds a spelling and nothing else, so a tail already half inside the search earns no card at all.
  const asked = new Set(topicTokens(query));
  const tailTokens = topicTokens(core);
  if (tailTokens.length > 0 && tailTokens.filter((t) => asked.has(t)).length * 2 >= tailTokens.length) return null;
  const head = cased(query);
  const tail = core.split(/\s+/).filter(Boolean);
  // Room is made ONLY out of filler, and never out of a word this page's own searches earn clicks on.
  while (tail.length > 1 && `${head}: ${tail.join(" ")}`.length > TITLE_SOFT) {
    const back = [...tail].reverse().findIndex((w) => FILLER.has(bare(w)) && !earns.has(bare(w)));
    if (back < 0) break;
    tail.splice(tail.length - 1 - back, 1);
  }
  if (tail.length === 0) return null;
  let after = `${head}: ${tail.join(" ")}`;
  if (brand && `${after} | ${brand}`.length <= TITLE_MAX) after = `${after} | ${brand}`;
  if (after.toLowerCase() === now.toLowerCase() || after.length < TITLE_MIN || after.length > TITLE_MAX || UNSAFE.test(after)) return null;
  return { field, before: now, after, modeled, label: field === "title"
    ? `Lead the title with "${query}" and keep the words this page already earns on`
    : `Open the page heading with "${query}" and keep the words it already earns on` };
}

/** WHAT THE PAGES WINNING THIS SEARCH CALL THEMSELVES, off the stored results page and nobody else's page.
 *  Only a shape they AGREE on is imitated, and the only shape this merge can honestly claim is the one it
 *  already writes: the search in front, then a colon. Null means the winners were never read, or they disagree. */
function modeledOnWinners(snapshot: EvidenceSnapshot, query: string, ownUrl: string): { label: string; note: string | null } | null {
  const key = canonicalQueryKey(query);
  const row = (snapshot.research?.serpEvidence ?? []).find((s) => canonicalQueryKey(s.query) === key);
  if (!row) return null;
  const own = canonicalUrlKey(ownUrl);
  const titles = [...row.organic].sort((a, b) => a.rank - b.rank)
    .filter((o) => canonicalUrlKey(o.url) !== own).map((o) => (o.title ?? "").trim()).filter(Boolean).slice(0, 5);
  if (titles.length < 3) return null;
  const first = topicTokens(query)[0];
  // THE ONE SHAPE THIS MERGE CAN HONESTLY CLAIM is the one it already writes: the search at the front of the
  // line. A leading count is the other pattern they agree on, and no count for this page is on file, so it is
  // named as a note for the operator and never written into the copy.
  const front = first ? titles.filter((t) => topicTokens(t).slice(0, 4).includes(first)).length : 0;
  if (front < 2) return null;
  const counted = titles.filter((t) => /^\D{0,3}\d/.test(t.trim())).length;
  return { label: "Modeled on the current top 5", note: counted >= 2
    ? `${counted} of the ${titles.length} pages Google ranks for this search open with a count. If this page has a countable list, put its real number at the front.` : null };
}

/** THE AI SIDE OF THE SAME SEARCH, only where this account ALREADY HOLDS it: the answers that joined this
 *  exact search are read for who they name, and a naming that never includes this account earns one line. */
function creditLine(snapshot: EvidenceSnapshot, query: string): string {
  const joined = (snapshot.research?.aiObservations ?? []).filter((o) => observationJoinsCase(o, { queries: [query] }));
  const intel = joined.length > 0 ? answerIntelOf(joined) : null;
  return intel && intel.brand.mentioned === 0 && intel.competitors[0] ? ` AI answers about this topic credit ${intel.competitors[0].text}, never this site.` : "";
}

/** A page that already carries a change under measurement, a split no wording touches, or plumbing that keeps
 *  it out of search altogether: none of those is answered by a sharper line, so none of them earns one here. */
function eligible(c: QualifiedCandidate): boolean {
  return !!c.pageUrl && !!c.query && c.action !== "act_existing_page" && c.action !== "do_nothing"
    && !NEVER.has(c.cause.cause) && (c.recoverableClicks > 0 || AEO.has(c.cause.cause));
}

// A below-bar reason ends in the WATCH lane's own sentence, and a card asking for a minute of work may not claim it
// is not asking. The clause before it is the bar it fell under, in whichever unit that bar was said in, so it is cut
// back to the last comma and the card closes in its own honest frame. Every number before that stays.
const WATCHING = ". Watching it rather than asking for work.";
const why = (r: string, at = r.indexOf(WATCHING)): string => at < 0 ? r
  : `${r.slice(0, at).replace(/,[^,]*$/, "")}. That is under the bar for a proven change, so this is a quick test, and what it does will be measured.${r.slice(at + WATCHING.length)}`;
/** A guess says it is a guess ONCE: the diagnosis's own "not looked yet" clause is the same admission in longer words. */
const noRepeat = (r: string, at = r.indexOf(" The gap is measured but ")): string => (at < 0 ? r : r.slice(0, at));

/** THE ONE CARD SHAPE every row here shares, so a merge, an answer line and a diagnostic read as one product. */
type Card = { id: string; field: "title" | "h1" | "answer_block" | "section"; before: string | null; after: string;
  label: string; why: string; steps: string[]; limitations: string[]; confidence: ChangeProposal["confidence"];
  effort: number; impact: number; modeled: string | null };

/**
 * EVERY CONCRETE EDIT THIS ACCOUNT'S HELD EVIDENCE ALREADY SUPPORTS, at `needs_review`, strongest first.
 * `skip` carries the ids AND the page paths the strict path already produced, so a page that earned a real drafted change is never handed a second, weaker version of the same one. PURE and deterministic.
 */
export function suggestedEdits(snapshot: EvidenceSnapshot, candidates: readonly QualifiedCandidate[],
  opts: { now: Date; basis: string | null; skip?: ReadonlySet<string>; limit?: number;
    /** Two 28-day windows per page, when the caller could read both. Absent means no diagnostic is written. */
    windows?: ReadonlyMap<string, { positionNow: number; positionPrior: number; sessionsNow: number; sessionsPrior: number }>;
  }): ChangeProposal[] {
  const tenantId = snapshot.scope.tenantId;
  const skip = opts.skip ?? new Set<string>();
  const looked = new Set((snapshot.research?.serpEvidence ?? []).map((e) => canonicalQueryKey(e.query)).filter(Boolean));
  // HOST AND PATH, never the path alone, or two owned rows sharing "/guide" collapse and one wears the other's title.
  const byUrl = new Map<string, OwnedPageEvidence>(snapshot.ownedPages.map((p) => [canonicalUrlKey(p.url), p]));
  // THIS SITE'S OWN ENGLISH, read once off every page it holds: the corpus the language gate judges against.
  const corpus = new Set(snapshot.ownedPages.flatMap((p) => words(`${pathOf(p.url)} ${p.content
    ? `${p.content.title ?? ""} ${p.content.h1 ?? ""} ${p.content.metaDescription ?? ""} ${(p.content.outline ?? []).join(" ")}` : ""}`)));
  const out: ChangeProposal[] = [];
  const file = (c: Card, page: OwnedPageEvidence, url: string, path: string, query: string, cand: QualifiedCandidate | null): boolean => {
    if (skip.has(c.id) || skip.has(path.toLowerCase()) || out.some((p) => p.id === c.id)) return false;
    const content = page.content;
    out.push({
      id: c.id, tenantId, kind: "existing_edit", pagePath: path, pageUrl: url,
      pageLabel: content?.h1 ?? content?.title ?? path,
      primaryQuery: query, opportunityType: c.label, changeFamily: c.field, status: "needs_review",
      recommendedChange: { kind: "existing_edit", field: c.field, before: c.before, after: c.after },
      whyItMatters: c.why, operatorSteps: c.steps,
      estimatedEffortMinutes: c.effort, riskLevel: "low", confidence: c.confidence, limitations: c.limitations,
      // THE CHECK IS NAMED, not counted: one row backed by this account's own Google data says so out loud.
      evidence: { query, hints: ["Backed by your search data", c.why], evidenceRefCount: cand?.cause.evidenceKeys.length ?? 1 },
      impactScore: c.impact, upsidePerMonth: null, ...(c.modeled ? { modeledOn: c.modeled } : {}),
      ...(opts.basis ? { basis: opts.basis } : {}),
      ...(cand ? { causeFinding: cand.cause, diagnosisCause: cand.cause.cause } : {}),
      publish: "manual", createdAt: opts.now.toISOString(),
    });
    return out.length >= (opts.limit ?? MAX_SUGGESTIONS);
  };

  for (const c of [...candidates].filter(eligible)
    .sort((a, b) => b.recoverableClicks - a.recoverableClicks || (a.pageUrl ?? "").localeCompare(b.pageUrl ?? ""))) {
    const path = pathOf(c.pageUrl!);
    const page = byUrl.get(canonicalUrlKey(c.pageUrl!));
    const content = page?.content;
    if (!content || beatsItsCurve(page)) continue;
    const query = c.query!;
    // A results page that was READ and cleared the wording means the line is not the problem, so a sharper line there is disproved work. Never having looked is not that: it is a card that owes an honest label.
    if (DISPROVED.has(c.diagnosis?.cause ?? "")) continue;
    // GATE ONE: the search has to be this site's English, or the merge writes a word the page cannot carry.
    if (!english(query, corpus)) continue;
    // GATE TWO: the search has to be big enough in this page's own 90 day rows to rename a page over.
    const row = (page.search?.topQueries ?? []).find((q) => canonicalQueryKey(q.query) === canonicalQueryKey(query));
    if (!row || row.impressions < MIN_IMPRESSIONS) continue;
    const read = looked.has(canonicalQueryKey(query));
    const earns = page.search && page.search.clicks90d > EARNING_CLICKS;
    // WHAT THIS PAGE ALREADY EARNS, said before the merge is read, so the operator sees why the old words stay.
    const caution = earns
      ? `This page already earns ${num(page.search!.clicks90d)} clicks in 90 days; the merge keeps its current words for that reason.`
      : null;
    // A TRANSLATION ASK IS A MISSING WORD, NOT A MISSING HEADLINE. The word itself is the answer, and inventing
    // one is the one thing this kernel may never do, so the card is one line with the word left to be pasted.
    const lang = query.match(TRANSLATION)?.[1];
    if (lang) {
      const asked = cased(query), langWord = cased(lang);
      const subjectAsked = topicTokens(query).filter((t) => !topicTokens(lang).includes(t));
      if (subjectAsked.length === 0 || UNSAFE.test(asked)) continue;
      if (file({
        id: `${tenantId}::${path.toLowerCase()}::existing_edit::answer_block`,
        field: "answer_block", before: null, after: `${asked} is called NAME.`,
        label: `Answer "${query}" with the word itself`,
        why: `People searching "${query}" want the word itself, and this page never says it in a line a reader or an assistant can lift, so the answer goes near the top.${creditLine(snapshot, query)}`,
        steps: [`Open your site editor on ${path}`,
          `Paste the line above directly under the page heading, with the ${langWord} word in place of NAME`,
          "Come back here and mark it done, and measurement starts"],
        limitations: [`No ${langWord} word for this is on file here, so paste the real word in place of NAME rather than publishing NAME.`,
          ...(caution ? [caution] : [])],
        confidence: "low", effort: effortForFamily("answer"), impact: c.recoverableClicks, modeled: null,
      }, page, c.pageUrl ?? "", path, query, c)) return out;
      continue;
    }
    const factWord = (query.match(FACT)?.[1] ?? "").toLowerCase();
    const subject = topicTokens(query).filter((t) => t !== factWord).join(" ");
    // A FACT SEARCH IS A MISSING LINE, NOT A MISSING HEADLINE: the words are largely off this page's line and
    // the search asks for one countable figure, so what it earns is an answer at the top and a word on the tail.
    const subsetShape = !!factWord && !!subject
      && absent(query, content.title ?? content.h1 ?? "").length * 2 >= topicTokens(query).length;
    if (subsetShape) {
      const named = cased(subject);
      const article = /^[aeiou]/.test(factWord) ? "an" : "a";
      const line = `${named} has ${article} ${factWord} of NUMBER as of YEAR.`;
      const core = (content.title ?? "").split(/\s*\|\s*/)[0]!.trim();
      const tail = `${core}: ${cased(factWord)}`;
      const id = `${tenantId}::${path.toLowerCase()}::existing_edit::answer_block`;
      if (file({
        id, field: "answer_block", before: null, after: line,
        label: `Answer "${query}" in one line at the top of the page`,
        why: `${noRepeat(why(c.reason))} "${query}" asks this page for one figure and the page never answers it in a line a reader or an assistant can lift, so the answer goes at the top and the word goes on the title.${creditLine(snapshot, query)}`,
        steps: [`Open your site editor on ${path}`,
          "Paste the line above directly under the page heading, with the current figure in place of NUMBER and the year it comes from in place of YEAR",
          ...(core && tail.length <= TITLE_MAX ? [`Change the title to "${tail}" so the search sees the answer is here`] : []),
          "Come back here and mark it done, and measurement starts"],
        limitations: [`No ${factWord} figure for ${named} is on file here, so paste the current figure from your source rather than publishing NUMBER and YEAR.`,
          ...(caution ? [caution] : [])],
        confidence: "low", effort: effortForFamily("answer"), impact: c.recoverableClicks, modeled: null,
      }, page, c.pageUrl ?? "", path, query, c)) return out;
      continue;
    }
    // THE MERGE. Title first, heading second: the store files a title and an h1 under one identity for one page.
    const winners = modeledOnWinners(snapshot, query, c.pageUrl!);
    const modeled = winners?.label ?? null;
    const earnedWords = earningWords(page);
    const s = mergeLine("title", content.title, query, earnedWords, modeled)
      ?? mergeLine("h1", content.h1, query, earnedWords, modeled);
    if (!s) continue;
    const limitations = [modeled
      ? "The pages Google currently ranks for this search put its words at the front of the line, and this merge is built to that shape."
      : read
        ? "This merge is built from the exact words people search for on this page and the words already in its own line, so read it before you use it."
        : "Google's results for this search have not been read yet, so this is a merge off this page's own numbers and its own line. It is safe to try and cheap to undo, and it sharpens the moment those results are read."];
    if (winners?.note) limitations.push(winners.note);
    if (caution) limitations.push(caution);
    if (AEO.has(c.cause.cause)) limitations.push("An assistant answered this question without naming this page, and a sharper line is the cheapest thing to try first, not the whole answer to that.");
    const id = `${tenantId}::${path.toLowerCase()}::existing_edit::${s.field}`;
    // THE OBJECTION ANSWERED WHERE IT IS RAISED: a card working the smaller of a page's searches owes the reason the bigger ones were left alone, in their own numbers, before it asks for a minute.
    const bigger = biggerSearchesLine(page, query, true);
    if (file({
      id, field: s.field, before: s.before, after: s.after, label: s.label,
      why: `${read || modeled
        ? `${why(c.reason)} This line leads with the search in the words people actually run it in and keeps what the page already earns on.`
        : `${noRepeat(why(c.reason))} Google's results page for "${query}" has not been read yet, so this is the best merge off held numbers: ${s.label.charAt(0).toLowerCase()}${s.label.slice(1)}.`}${bigger ? ` ${bigger}` : ""}${creditLine(snapshot, query)}`,
      steps: [`Open your site editor on ${path}`, s.field === "title" ? "Replace the title with the copy above" : "Replace the page heading with the copy above",
        "Come back here and mark it done, and measurement starts"],
      limitations, confidence: modeled ? "medium" : read ? "medium" : "low",
      effort: effortForFamily(s.field), impact: c.recoverableClicks, modeled,
    }, page, c.pageUrl ?? "", path, query, c)) return out;
  }

  // THE PAGE, NOT GOOGLE. One page whose ranking held across both 28 day windows while its visits fell away is
  // not a search problem at all, and it is the one thing on this screen no rewrite fixes. Silent without both reads.
  const falling = [...(opts.windows ?? new Map())].map(([url, w]) => ({ url, w }))
    .filter(({ url, w }) => byUrl.has(canonicalUrlKey(url)) && w.positionNow > 0 && w.positionPrior > 0
      && Math.abs(w.positionNow - w.positionPrior) <= POSITION_HELD && w.sessionsPrior > 0
      && w.sessionsNow < (1 - VISIT_FALL) * w.sessionsPrior)
    .sort((a, b) => (b.w.sessionsPrior - b.w.sessionsNow) - (a.w.sessionsPrior - a.w.sessionsNow) || a.url.localeCompare(b.url))[0];
  if (falling) {
    const page = byUrl.get(canonicalUrlKey(falling.url))!;
    const path = pathOf(falling.url);
    const held = falling.w.positionNow.toFixed(1);
    const line = `Position held at ${held} but visits fell ${num(falling.w.sessionsPrior)} to ${num(falling.w.sessionsNow)}: the page, not Google.`;
    file({
      id: `${tenantId}::${path.toLowerCase()}::existing_edit::divergence`, field: "section", before: null, after: line,
      label: `${path}: rank held at ${held} but visits fell ${num(falling.w.sessionsPrior)} to ${num(falling.w.sessionsNow)}; the page, not Google`,
      why: `Google shows this page in the same place it did four weeks ago and ${num(falling.w.sessionsPrior - falling.w.sessionsNow)} fewer visits arrived, so what changed is on the page itself.`,
      steps: [`Open ${path} on a phone and time how long it takes before it is usable`,
        "Check what changed on it: loading speed, a popup or consent box over the first screen, a layout change",
        "Come back here and say what you changed, and the next two windows get read against it"],
      limitations: ["This is a diagnosis and not an edit: no wording change on this page answers a fall that Google's own ranking did not cause."],
      confidence: "medium", effort: 15, impact: falling.w.sessionsPrior - falling.w.sessionsNow, modeled: null,
    }, page, falling.url, path, page.content?.title ?? path, null);
  }
  return out;
}
