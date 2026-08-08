/**
 * decision/suggested-edits: THE GENEROUS HALF OF THE QUEUE. Ready stays strict and is untouched by this file;
 * everything here lands at `needs_review`: something concrete to try that I want you to read first.
 *
 * ONE RULE MAKES GENEROSITY HONEST: a suggestion is assembled from words this account ALREADY HOLDS and nothing else. The head is the exact search this page's own Google data says it is losing clicks on; the tail is the
 * name already sitting at the end of the page's own title. No number is invented, no source is named, no claim
 * is made about a page I have not read. Where the results page for that search is not on file, the limitation
 * says so and the confidence is directional. A page whose evidence supports no concrete edit yields NOTHING,
 * which is the whole reason this file can be generous without lying.
 *
 * PURE: no model call, no store, no clock of its own, no I/O. */

import { canonicalQueryKey, topicTokens } from "@/domains/evidence/relevance-gate";
import { defaultExpectedCtrAt } from "@/domains/evidence/forecast/tenant-ctr-curve";
import { canonicalUrlKey, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { effortForFamily, type ChangeProposal } from "./contracts";
import type { QualifiedCandidate } from "./opportunities";

/** How many hand-testable suggestions one pass may put in front of one operator. */
const MAX_SUGGESTIONS = 60;
const TITLE_MIN = 15, TITLE_MAX = 65;
/** Anything that would make a suggestion unsafe to paste: a dash I never write, a bracket nobody filled in. */
const UNSAFE = /[–—]|\[|\]|\{|\}|lorem ipsum/i;
/** Causes that mean a suggestion here would be wrong work, not weak work. */
const NEVER = new Set(["measuring_change", "cannibalization", "technical_indexability"]);
/** The causes an assistant's own behaviour proves, so the limitation can name what I watched. */
const AEO = new Set(["ai_citation_gap", "retrieved_not_cited"]);

const pathOf = (url: string): string => {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname || "/"; } catch { return url; }
};
/** Title casing for a search phrase: only the joining words a headline keeps small stay small, and the first
 *  word never does. Nothing else about the phrase is touched, so the line still says exactly what was searched. */
const SMALL = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "with"]);
const cased = (q: string): string => q.trim().split(/\s+/)
  .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
/** The name already at the end of this page's own title, READ off it, never invented. */
const brandOf = (title: string): string | null => {
  const parts = title.split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1]! : null;
};
/** The search's own words this text never says. Empty = the text already names the search. */
const absent = (query: string, text: string | null): string[] => {
  const has = new Set(topicTokens(text));
  return topicTokens(query).filter((t) => !has.has(t));
};

/** A page that ALREADY EARNS MORE clicks than its own positions predict is never handed a rewrite. One line
 *  serves every search a page wins, so chasing its softest one bets the searches that are working, and a
 *  suggestion queue that cannot tell those apart is a queue that makes an operator undo their own good pages. */
function beatsItsCurve(page: OwnedPageEvidence): boolean {
  const rows = page.search?.topQueries ?? [];
  let earned = 0, predicted = 0;
  for (const q of rows) {
    if (!(q.impressions > 0) || q.position == null || !(q.position > 0)) continue;
    earned += q.clicks; predicted += defaultExpectedCtrAt(q.position) * q.impressions;
  }
  // ONE MEASURED SEARCH IS STILL A MEASUREMENT: requiring two let a page earning 20 percent at position four on its
  // single search through the AEO clause, which waives the click test, and handed it a rewrite.
  return predicted > 0 && earned >= predicted;
}

type Suggestion = { field: "title" | "h1"; before: string; after: string; label: string };

/** ONE line assembled from the search and the page's own title. Null whenever the pieces are not on file, the
 *  line would say nothing new, or it would not survive being pasted. */
function lineFor(field: "title" | "h1", before: string | null | undefined, query: string): Suggestion | null {
  const now = (before ?? "").trim();
  if (!now || absent(query, now).length === 0) return null;
  const brand = field === "title" ? brandOf(now) : null;
  const head = cased(query);
  const after = brand && absent(query, brand).length === topicTokens(query).length ? `${head} | ${brand}` : head;
  if (after.toLowerCase() === now.toLowerCase() || after.length < TITLE_MIN || after.length > TITLE_MAX || UNSAFE.test(after)) return null;
  return { field, before: now, after,
    label: field === "title" ? "Put the search in this page's title" : "Say the search in this page's heading" };
}

/** A page that already carries a change I am reading, a split no wording touches, or plumbing that keeps it out
 *  of search altogether: none of those are answered by a sharper line, so none of them earn one here. */
function eligible(c: QualifiedCandidate): boolean {
  return !!c.pageUrl && !!c.query && c.action !== "act_existing_page" && c.action !== "do_nothing"
    && !NEVER.has(c.cause.cause) && (c.recoverableClicks > 0 || AEO.has(c.cause.cause));
}

/**
 * EVERY CONCRETE EDIT THIS ACCOUNT'S HELD EVIDENCE ALREADY SUPPORTS, at `needs_review`, strongest first.
 * `skip` carries the ids AND the page paths the strict path already produced, so a page that earned a real
 * drafted change is never handed a second, weaker version of the same one. PURE and deterministic.
 */
// A below-floor reason ends in the WATCH lane's own sentence, and a card asking for a minute of work may not claim it is not asking: the numbers stay, the tail becomes the suggestion's honest frame.
const why = (r: string): string => r.replace(/,? and that is too little search to act on yet \(I want [^)]+\)\. I am watching it instead of making you work\.$/, ". That is under my bar for a proven change, so this is a quick test, and I will measure what it does.");
export function suggestedEdits(snapshot: EvidenceSnapshot, candidates: readonly QualifiedCandidate[],
  opts: { now: Date; basis: string | null; skip?: ReadonlySet<string>; limit?: number }): ChangeProposal[] {
  const tenantId = snapshot.scope.tenantId;
  const skip = opts.skip ?? new Set<string>();
  const looked = new Set((snapshot.research?.serpEvidence ?? []).map((e) => canonicalQueryKey(e.query)).filter(Boolean));
  // HOST AND PATH, never the path alone: two owned rows on different hosts sharing "/guide" collapsed last wins,
  // so a suggestion could carry another page's title as its `before` and lift that page's brand into the line.
  const byUrl = new Map<string, OwnedPageEvidence>(snapshot.ownedPages.map((p) => [canonicalUrlKey(p.url), p]));
  const out: ChangeProposal[] = [];
  for (const c of [...candidates].filter(eligible)
    .sort((a, b) => b.recoverableClicks - a.recoverableClicks || (a.pageUrl ?? "").localeCompare(b.pageUrl ?? ""))) {
    const path = pathOf(c.pageUrl!);
    const page = byUrl.get(canonicalUrlKey(c.pageUrl!));
    const content = page?.content;
    if (!content || beatsItsCurve(page)) continue;
    const query = c.query!;
    const serp = looked.has(canonicalQueryKey(query));
    // WHAT I DID NOT CHECK, said before the operator asks. A suggestion that hides this is a Ready change
    // wearing a quieter name, and this whole queue exists so it never has to be one.
    const limitations = ["I wrote this from the exact words people search for on this page and the name already at the end of its own title, so read it before you use it."];
    if (!serp) limitations.push(`I have not looked at Google's results page for "${query}" yet, so I cannot tell you what the pages beating this one put in front of a searcher.`);
    if (AEO.has(c.cause.cause)) limitations.push("An assistant answered this question without naming your page, and a sharper line is the cheapest thing to try first, not the whole answer to that.");
    // ONE SUGGESTION PER PAGE, the title first because it is the line a searcher actually reads. The store files
    // a title and an h1 under the SAME identity for one page, so handing over both would have them supersede
    // each other every pass, and two near-identical rows is noise rather than generosity.
    const s = lineFor("title", content.title, query) ?? lineFor("h1", content.h1, query);
    const id = s ? `${tenantId}::${path.toLowerCase()}::existing_edit::${s.field}` : "";
    if (s && !skip.has(id) && !skip.has(path.toLowerCase()) && !out.some((p) => p.id === id)) {
      out.push({
        id, tenantId, kind: "existing_edit", pagePath: path, pageUrl: c.pageUrl ?? null, pageLabel: content.h1 ?? content.title ?? path,
        primaryQuery: query, opportunityType: s.label, changeFamily: s.field, status: "needs_review",
        recommendedChange: { kind: "existing_edit", field: s.field, before: s.before, after: s.after },
        whyItMatters: `${why(c.reason)} This line says the search in the words people actually run it in.`,
        estimatedEffortMinutes: effortForFamily(s.field), riskLevel: "low", confidence: serp ? "medium" : "low",
        limitations, evidence: { query, hints: [why(c.reason)], evidenceRefCount: c.cause.evidenceKeys.length },
        impactScore: c.recoverableClicks, upsidePerMonth: null,
        ...(opts.basis ? { basis: opts.basis } : {}), causeFinding: c.cause, diagnosisCause: c.cause.cause,
        publish: "manual", createdAt: opts.now.toISOString(),
      });
      if (out.length >= (opts.limit ?? MAX_SUGGESTIONS)) return out;
    }
  }
  return out;
}
