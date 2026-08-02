/**
 * decision/deep-candidates (V1 final truth repair, 2026-08-01): WHICH PAGES EARN THE DEEP READ.
 *
 * What it replaced: ONE DOOR. The pass drafted its single deep change for whichever page carried the
 * largest proven click shortfall in Search Console, so an engine that read a page and quoted rivals, a
 * comparison that named the page of yours to improve, and two of your own pages splitting one search
 * were all invisible unless that SAME page also happened to be losing clicks on Google. A real AI
 * opportunity waited on a Google number that has nothing to do with it.
 *
 * FIVE DOORS NOW, every one of them read off evidence this pass ALREADY holds and already paid for:
 * the biggest proven click gap, a page an engine read or answered around, the page a coverage verdict
 * NAMES, the strongest page of a group splitting one search, and a page whose searches have fallen.
 * Each door contributes AT MOST its single strongest page, and a page arriving through two doors is
 * kept once, under the stronger door's label.
 *
 * THIS FILE SELECTS AND NOTHING ELSE. It drafts nothing, buys nothing, calls no model and invents no
 * figure. The producer it feeds is unchanged and still refuses honestly when one page's own evidence
 * is too thin to write against.
 *
 * ORDER IS THE HONEST VALUE EACH DOOR ITSELF PROVES, never one door's number worn by another: clicks I
 * can show are recoverable first, then the questions your customers ask that an engine hands to
 * somebody else, then the winning pages I actually read. PURE + deterministic: no I/O, no LLM, no clock.
 */

import { anchoredTopicMatch, canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { canonicalUrlKey, weakAnchorsOf, type EvidenceSnapshot } from "@/domains/evidence/snapshot";
import type { DecidedTopic } from "./coverage-pass";
import type { QualifiedCandidate } from "./opportunities";

/** The five distinct kinds of proof that can put one page in front of the deep producer. */
type Door = "ctr_gap" | "ai_absence" | "coverage_verdict" | "cannibalization" | "recent_decline";
/** What a door's own strength is COUNTED IN. Two doors are never compared in a unit neither proved. */
type Unit = "clicks" | "questions" | "winners";

type DeepCandidate = {
  pageUrl: string;
  door: Door;
  unit: Unit;
  /** What this door proves, in `unit`. Never borrowed from another door. */
  strength: number;
  /** Monthly searches on file for this page's own search, or 0 when none is. A tiebreak only. */
  volume: number;
  /** The first-person sentence this page's line on the run receipt carries, naming the door it entered by. */
  entry: string;
};

/** Clicks first, then the questions an engine hands elsewhere, then the winners I read. */
const UNIT_RANK: Record<Unit, number> = { clicks: 0, questions: 1, winners: 2 };
/** The fixed door order, used only to break a genuine tie so the same evidence always picks the same page. */
const DOOR_RANK: Record<Door, number> = { ctr_gap: 0, ai_absence: 1, coverage_verdict: 2, cannibalization: 3, recent_decline: 4 };

const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const clicksOf = (c: QualifiedCandidate): number => Math.max(0, c.recoverableClicks);
const LEAD = "I gave this page my deepest read because";

/** Most proven clicks, then page address. The SAME order the single-door pass has always used, so a
 *  snapshot where only the click door qualifies picks byte for byte the page it picked before. */
const strongest = (xs: readonly QualifiedCandidate[]): QualifiedCandidate | null =>
  [...xs].sort((a, b) => b.recoverableClicks - a.recoverableClicks || (a.pageUrl ?? "").localeCompare(b.pageUrl ?? ""))[0] ?? null;

/** The questions this account ALREADY WATCHES that are about one page's own search, and what that search
 *  is worth a month where a count is on file. Both were bought before this pass ran: this counts them and
 *  never goes looking for more. Anchored exactly as the cause ladder anchors, so one word the account puts
 *  on everything can never pull an unrelated question in. */
function aiDemand(snapshot: EvidenceSnapshot, query: string, weak: ReadonlySet<string>): { prompts: number; volume: number } {
  const prompts = new Set(snapshot.research.aiObservations
    .filter((o) => o.citationsObserved && o.citations != null && anchoredTopicMatch(query, o.promptText, weak).relevant)
    .map((o) => o.promptText.trim().toLowerCase()));
  const key = canonicalQueryKey(query);
  const volume = snapshot.keywordDemand.find((k) => canonicalQueryKey(k.query) === key)?.searchVolume ?? 0;
  return { prompts: prompts.size, volume: Math.max(0, volume) };
}

/**
 * The pages that earn a deep read this pass, strongest first, at most `limit` of them and at most one
 * per page. Every entry names the door it came through in the operator's own words. PURE.
 */
export function selectDeepCandidates(input: {
  snapshot: EvidenceSnapshot;
  candidates: readonly QualifiedCandidate[];
  coverage: DecidedTopic | null;
  limit: number;
}): DeepCandidate[] {
  const { snapshot, candidates, coverage, limit } = input;
  if (limit <= 0) return [];
  const doors: DeepCandidate[] = [];

  // DOOR 1: THE BIGGEST PROVEN CLICK GAP. Unchanged, and still the strongest kind of proof there is,
  // because it is the only one carrying a number of clicks I can show you.
  const ctr = strongest(candidates.filter((c) => c.action === "act_existing_page" && !!c.pageUrl));
  if (ctr?.pageUrl) doors.push({ pageUrl: ctr.pageUrl, door: "ctr_gap", unit: "clicks", strength: clicksOf(ctr), volume: 0,
    entry: `${LEAD} it is the biggest proven gap I hold: about ${num(clicksOf(ctr))} clicks short of what its own positions usually earn.` });

  // DOOR 2: AN ENGINE THAT READ THIS PAGE, OR ANSWERED AROUND IT. The cause ladder already fired the
  // reading and kept what it was read off; this asks only that the question is one I actually watch and
  // that there is real demand behind it, so an accusation with nothing riding on it never takes a slot.
  const weak = weakAnchorsOf(snapshot.ownedPages, snapshot.research);
  const ai = candidates
    .filter((c) => !!c.pageUrl && !!c.query && (c.cause.cause === "ai_citation_gap" || c.cause.cause === "retrieved_not_cited"))
    .map((c) => ({ c, ...aiDemand(snapshot, c.query!, weak) }))
    .filter((r) => r.prompts > 0 && (clicksOf(r.c) > 0 || r.volume > 0))
    .sort((a, b) => b.c.recoverableClicks - a.c.recoverableClicks || b.prompts - a.prompts
      || (a.c.pageUrl ?? "").localeCompare(b.c.pageUrl ?? ""))[0];
  const payload = ai?.c.cause.payload;
  if (ai?.c.pageUrl && payload && (payload.cause === "ai_citation_gap" || payload.cause === "retrieved_not_cited")) {
    const read = payload.cause === "retrieved_not_cited"
      ? `${payload.engine} read this page while answering "${payload.promptText}" and quoted somebody else`
      : `${payload.engine} answered "${payload.promptText}" for your customers and never named this page`;
    const clicks = clicksOf(ai.c);
    doors.push({ pageUrl: ai.c.pageUrl, door: "ai_absence", volume: ai.volume,
      unit: clicks > 0 ? "clicks" : "questions", strength: clicks > 0 ? clicks : ai.prompts,
      entry: `${LEAD} ${read}, and I watch ${num(ai.prompts)} ${ai.prompts === 1 ? "question" : "questions"} like it about "${ai.c.query}"${ai.volume > 0 ? `, worth about ${num(ai.volume)} searches a month` : ""}.` });
  }

  // DOOR 3: THE PAGE A VERDICT NAMES. My comparison of a whole subject already concluded that the answer
  // is the page you have rather than a page you do not, and that conclusion never reached the deep producer.
  const named = coverage && coverage.decision.verdict === "improve_existing" ? coverage.decision.ownedUrls[0] ?? null : null;
  const owner = named ? candidates.find((c) => !!c.pageUrl && canonicalUrlKey(c.pageUrl) === canonicalUrlKey(named)) ?? null : null;
  if (owner?.pageUrl && coverage) {
    const winners = Math.max(0, coverage.investigation.currentReadableWinners);
    const clicks = clicksOf(owner);
    doors.push({ pageUrl: owner.pageUrl, door: "coverage_verdict", volume: 0,
      unit: clicks > 0 ? "clicks" : "winners", strength: clicks > 0 ? clicks : winners,
      entry: `${LEAD} my comparison of "${coverage.investigation.label}" says this is the page of yours to improve, off the ${num(winners)} winning ${winners === 1 ? "page" : "pages"} I read.` });
  }

  // DOOR 4: TWO OF YOUR OWN PAGES SPLITTING ONE SEARCH, at its strongest page. The ladder proves the split
  // and no wording change touches it, so the group's best page is where a deep read is worth buying.
  const split = strongest(candidates.filter((c) => !!c.pageUrl && !!c.query && c.cause.cause === "cannibalization"));
  const splitPayload = split?.cause.payload;
  if (split?.pageUrl) {
    const pages = splitPayload && splitPayload.cause === "cannibalization" ? splitPayload.competingPaths.length : 2;
    doors.push({ pageUrl: split.pageUrl, door: "cannibalization", unit: "clicks", strength: clicksOf(split), volume: 0,
      entry: `${LEAD} ${num(pages)} of your own pages come up for "${split.query}" and this one is the strongest of them, about ${num(clicksOf(split))} clicks short.` });
  }

  // DOOR 5: A PAGE THAT HAS FALLEN. Read off the candidate's own recorded gap, so the day a producer can
  // prove a fall this door opens on its own. Nothing in this generation records one yet, and saying that
  // out loud is the point: the door is wired to the evidence, not to a hope.
  const falling = strongest(candidates.filter((c) => !!c.pageUrl && c.gap === "recent_decline"));
  if (falling?.pageUrl) doors.push({ pageUrl: falling.pageUrl, door: "recent_decline", unit: "clicks", strength: clicksOf(falling), volume: 0,
    entry: `${LEAD} it has fallen the furthest of the pages I hold, about ${num(clicksOf(falling))} clicks under what its positions usually earn.` });

  // ONE PAGE, ONE SLOT, STRONGEST FIRST. A page that arrived through two doors keeps the stronger one's
  // label, which is simply the first it reaches in this order.
  const picked: DeepCandidate[] = [];
  const seen = new Set<string>();
  for (const d of [...doors].sort((a, b) => UNIT_RANK[a.unit] - UNIT_RANK[b.unit] || b.strength - a.strength
    || b.volume - a.volume || DOOR_RANK[a.door] - DOOR_RANK[b.door] || a.pageUrl.localeCompare(b.pageUrl))) {
    const key = canonicalUrlKey(d.pageUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(d);
    if (picked.length >= limit) break;
  }
  return picked;
}
