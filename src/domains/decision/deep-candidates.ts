/**
 * decision/deep-candidates: WHICH PAGES EARN THE DEEP READ, through FIVE doors rather than one: the biggest
 * proven click gap, a page an engine read or answered around, the page a coverage verdict NAMES, the strongest
 * page of a group splitting one search, and a page whose searches have fallen. Each door contributes AT MOST
 * its single strongest page, order is the honest value each door ITSELF proves, and every door carries its own
 * evidence identity so the producer proves THAT door's case rather than the click door's. THIS FILE SELECTS AND NOTHING ELSE: no draft, no purchase, no model, no clock, no I/O.
 */

import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import type { DecidedTopic } from "./coverage-pass";
import type { QualifiedCandidate } from "./opportunities";

/** The four distinct kinds of proof that can put one page in front of the deep producer. AI evidence is NOT
 *  one of them any more: the staged case path in producers/extra.ts owns every AEO decision off the same
 *  canonical observations, so a second AI door here was a second AEO brain and it is deleted, not ranked last. */
type Door = "ctr_gap" | "coverage_verdict" | "cannibalization" | "recent_decline";
/** What a door's own strength is COUNTED IN. Two doors are never compared in a unit neither proved. */
type Unit = "clicks" | "questions" | "winners";

/** WHAT ONE DOOR ITSELF PROVES, in the pieces the producer checks before it writes anything against that
 *  door. Null or empty is an honest absence and the producer refuses on it. `query` is the door's OWN search
 *  (prompt-derived, coverage topic, shared query), never a gap query. `window` is the span a fall was
 *  measured over: nothing in this generation records one, and saying so is the point. */
type DoorEvidence = { query: string | null; engine: string | null; promptText: string | null; competingUrls: string[]; window: string | null };
const NO_IDENTITY: DoorEvidence = { query: null, engine: null, promptText: null, competingUrls: [], window: null };

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
  /** This door's own case, so the producer never proves one door's page with another door's evidence. */
  evidence: DoorEvidence;
};

/** Clicks first, then the questions an engine hands elsewhere, then the winners I read. */
const UNIT_RANK: Record<Unit, number> = { clicks: 0, questions: 1, winners: 2 };
/** The fixed door order, used only to break a genuine tie so the same evidence always picks the same page. */
const DOOR_RANK: Record<Door, number> = { ctr_gap: 0, coverage_verdict: 1, cannibalization: 2, recent_decline: 3 };

const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const clicksOf = (c: QualifiedCandidate): number => Math.max(0, c.recoverableClicks);
const LEAD = "This page earned the deepest read because";

/** Most proven clicks, then page address. The SAME order the single-door pass has always used, so a
 *  snapshot where only the click door qualifies picks byte for byte the page it picked before. */
const strongest = (xs: readonly QualifiedCandidate[]): QualifiedCandidate | null =>
  [...xs].sort((a, b) => b.recoverableClicks - a.recoverableClicks || (a.pageUrl ?? "").localeCompare(b.pageUrl ?? ""))[0] ?? null;

/**
 * The pages that earn a deep read this pass, strongest first, at most `limit` of them and at most one per page. Every entry names the door it came through in the operator's own words. PURE.
 */
export function selectDeepCandidates(input: {
  candidates: readonly QualifiedCandidate[];
  coverage: DecidedTopic | null;
  limit: number;
}): DeepCandidate[] {
  const { candidates, coverage, limit } = input;
  if (limit <= 0) return [];
  const doors: DeepCandidate[] = [];

  // DOOR 1: THE BIGGEST PROVEN CLICK GAP. Unchanged, and still the strongest kind of proof there is, because it is the only one carrying a number of clicks I can show you.
  const ctr = strongest(candidates.filter((c) => c.action === "act_existing_page" && !!c.pageUrl));
  if (ctr?.pageUrl) doors.push({ pageUrl: ctr.pageUrl, door: "ctr_gap", unit: "clicks", strength: clicksOf(ctr), volume: 0, evidence: NO_IDENTITY,
    entry: `${LEAD} it is the biggest proven gap on file: about ${num(clicksOf(ctr))} clicks short of what its own positions usually earn.` });

  // DOOR 2: THE PAGE A VERDICT NAMES. My comparison of a whole subject already concluded that the answer is the page you have rather than a page you do not, and that conclusion never reached the deep producer.
  // A page the comparison decided to improve AND a page whose only earned work is technical both enter by this door: either way the coverage pass itself named the page, so the deep read owes it a look.
  const named = coverage && (coverage.decision.verdict === "improve_existing" || coverage.decision.verdict === "technical_only")
    ? coverage.decision.ownedUrls[0] ?? null : null;
  const owner = named ? candidates.find((c) => !!c.pageUrl && canonicalUrlKey(c.pageUrl) === canonicalUrlKey(named)) ?? null : null;
  if (owner?.pageUrl && coverage) {
    const winners = Math.max(0, coverage.investigation.currentReadableWinners);
    const clicks = clicksOf(owner);
    doors.push({ pageUrl: owner.pageUrl, door: "coverage_verdict", volume: 0,
      evidence: { ...NO_IDENTITY, query: coverage.investigation.label },
      unit: clicks > 0 ? "clicks" : "winners", strength: clicks > 0 ? clicks : winners,
      entry: `${LEAD} the comparison of "${coverage.investigation.label}" names this as the page of yours to improve, off the ${num(winners)} winning ${winners === 1 ? "page" : "pages"} read.` });
  }

  // DOOR 3: TWO OF YOUR OWN PAGES SPLITTING ONE SEARCH, at its strongest page. The ladder proves the split and no wording change touches it, so the group's best page is where a deep read is worth buying.
  const split = strongest(candidates.filter((c) => !!c.pageUrl && !!c.query && c.cause.cause === "cannibalization"));
  const splitPayload = split?.cause.payload;
  if (split?.pageUrl) {
    const competing = splitPayload && splitPayload.cause === "cannibalization" ? splitPayload.competingPaths : [];
    doors.push({ pageUrl: split.pageUrl, door: "cannibalization", unit: "clicks", strength: clicksOf(split), volume: 0,
      evidence: { ...NO_IDENTITY, query: split.query!, competingUrls: [...competing] },
      entry: `${LEAD} ${num(competing.length || 2)} of your own pages come up for "${split.query}" and this one is the strongest of them, about ${num(clicksOf(split))} clicks short.` });
  }

  // DOOR 4: A PAGE THAT HAS FALLEN, read off the candidate's own recorded gap, so the day a producer can prove a fall this door opens on its own. The door is wired to the evidence, not to a hope.
  // A PAGE ALREADY UNDER A READING IS NOT THE PAGE TO SPEND THIS SLOT ON: nothing may be stacked on a change
  // still being measured, so the deepest read of the pass was bought for a page it could only ever refuse, and
  // the next fall down the list, which nothing was measuring, never got looked at.
  const falling = strongest(candidates.filter((c) => !!c.pageUrl && c.gap === "recent_decline" && c.cause.cause !== "measuring_change"));
  // THE SPAN THE FALL WAS MEASURED OVER TRAVELS WITH IT. Stamping a null window here made the producer refuse
  // every page this door picked ("one 90 day total is on file with nothing earlier"), so door 5 burned a slot
  // on every pass and produced nothing. The candidate carries the window now, because the windows were read.
  if (falling?.pageUrl) doors.push({ pageUrl: falling.pageUrl, door: "recent_decline", unit: "clicks", strength: clicksOf(falling), volume: 0,
    evidence: { ...NO_IDENTITY, query: falling.query ?? null, window: falling.declineWindow ?? null },
    // WHAT IT LOST, not what a curve says it should earn: this door is opened by a fall, so its sentence is the fall.
    entry: `${LEAD} it has fallen the furthest of the pages on file, about ${num(clicksOf(falling))} fewer clicks than the four weeks before.` });

  // ONE PAGE, ONE SLOT, STRONGEST FIRST. A page that arrived through two doors keeps the stronger one's label, which is simply the first it reaches in this order.
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
