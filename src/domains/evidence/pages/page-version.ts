/** pages/page-version - ONE RULE FOR WHICH CAPTURE IS THE PAGE (operator, 2026-09-01).
 *
 * Four readers each chose a "current" capture their own way: the snapshot loader kept the newest row per address even
 * when it was blank, the targeted body reader let words beat a newer blank, the page-surgeon context took the first row
 * per canonical address, and the link producer took the first link graph it met. So the actors page was zero words to
 * the diagnosis and 921 words to the writer at the same moment. PURE: hand it every capture of one page and it says which
 * one is current, which one carries the page's words, and what the difference means. Recency and quality are two
 * different facts: a newer capture the crawler could not trust never erases a body it confirmed, and an older body is
 * never called current without its date riding beside it. */

import type { OwnedPageBody } from "./owned-context"; // TYPE ONLY: the server read stays in owned-context, and the judgments below are read by the client-bundled verdict
type PageVersionState = "current" | "stale_known_good" | "sample_only" | "blank" | "unread";
type PageVersionFacts = { fetchedAt: string | null; words: number; bodyHeld: boolean; certainty: string | null };
type PageVersion<T> = {
  /** The newest capture on file, whatever it holds. */
  current: T | null;
  /** The capture whose words stand for the page: the newest one the crawler confirmed with words in it. */
  content: T | null;
  state: PageVersionState;
  /** TRUE when the newest capture is blank or untrusted and an older confirmed body stands in: presence may be read off it, absence may not. */
  conflict: boolean;
  /** When the words in `content` were captured. */
  contentAt: string | null;
  words: number;
};

const at = (f: PageVersionFacts): string => f.fetchedAt ?? "";
/** A capture the crawler could trust: confirmed, and either carrying words or holding the body whole (a genuinely empty page held whole is a real read). An `uncertain` extraction, or a zero-word row with no held body, is not one. */
const good = (f: PageVersionFacts): boolean => f.certainty !== "uncertain" && (f.words > 0 || f.bodyHeld);

export function selectPageVersion<T>(rows: readonly T[], facts: (row: T) => PageVersionFacts): PageVersion<T> {
  const sorted = [...rows].sort((a, b) => at(facts(b)).localeCompare(at(facts(a))));
  const current = sorted[0] ?? null;
  if (current == null) return { current: null, content: null, state: "unread", conflict: false, contentAt: null, words: 0 };
  const cf = facts(current);
  if (good(cf)) return { current, content: current, state: cf.bodyHeld ? "current" : "sample_only", conflict: false, contentAt: cf.fetchedAt, words: cf.words };
  const known = sorted.find((r) => good(facts(r))) ?? null;
  if (known == null) return { current, content: current, state: "blank", conflict: false, contentAt: cf.fetchedAt, words: 0 };
  const kf = facts(known);
  return { current, content: known, state: "stale_known_good", conflict: true, contentAt: kf.fetchedAt, words: kf.words };
}

/** THE JUDGMENTS READ OFF A BODY ONCE IT IS IN HAND live here beside the version rule, and never in the server-only reader: the readiness verdict runs in the browser bundle through diagnosis, so what a page carries and which of its words are its own may import nothing that opens a database. */
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
/**
 * CONTAINS OR UNKNOWN. Does this page say `phrase` anywhere? "yes" is always trustworthy, because found is
 * found. "no" comes back ONLY when the whole page is held: a sample proves presence and can never prove
 * absence, so everything else is "unknown". That is what stops a whole-page verdict being written off a
 * fragment, which is how a fact in paragraph nine came to read as a gap.
 */
export function pageContains(page: OwnedPageBody | null | undefined, phrase: string): "yes" | "no" | "unknown" {
  const needle = norm(phrase ?? "");
  if (page == null || !needle) return "unknown";
  const hay = norm([page.title ?? "", page.h1 ?? "", page.metaDescription ?? "", ...page.headings, ...page.passages,
    ...page.cardTexts, ...page.faqs.flatMap((f) => [f.question, f.answer]),
    ...page.internalLinks.map((l) => l.anchorText)].join(" \n "));
  if (hay.includes(needle)) return "yes";
  // A STALE BODY PROVES PRESENCE, NEVER A CURRENT ABSENCE: only a complete capture that is also the newest may say "no".
  return page.completeness === "complete" && page.version === "current" ? "no" : "unknown";
}

/** WHICH OF A PAGE'S WORDS ARE ITS OWN, WHEN ITS SIBLINGS COME OFF ONE TEMPLATE. THE RULE, IN ONE SENTENCE: when most of a page's words are the words its template siblings carry too, whatever is left is the family's SLOT, and a word standing in that slot is this page's own ONLY where the page holds it as an entity it introduces (a name standing mid sentence, a figure, a date, or an item in its own visible list or FAQ), because every sibling fills that same slot with another example of the family's own subject: the tokens differ and the information does not. Twenty California city pages carry one shell with the city swapped in and an empty card list, and their closing paragraphs name generic dishes; "barg" is on ONE of the twenty, so no repeated-passage or string-similarity test catches it and no count of shared words can.
 *  SIMILARITY IS NEVER ITSELF A DEFECT. It decides nothing here: it decides only which words a card still has to earn. NULL when no sibling is in hand or the shared shell is a MINORITY of the page, and null asks nothing of anybody, which is why a rug or an animal page whose siblings share only their labels is untouched. The page's own name is masked out of BOTH sides as a SUBSTRING, so a sentence is not this page's own merely because the city, animal, rug, flag or person name was substituted into it, and a crawler that glued the name to the next word cannot hide the match. `figures` says the slot carries a number or a date at all, for a caller weighing copy whose specificity is a figure rather than a word. THE FAMILY IS PICKED FROM WHATEVER THE CALLER ALREADY HOLDS and never read for: the pages under the same parent address, which is the family information the site's own URLs carry. PURE. */
export function templateSlotOf(page: OwnedPageBody, held: readonly OwnedPageBody[], max = 6): { slot: ReadonlySet<string>; own: ReadonlySet<string>; figures: boolean } | null {
  const at = (u: string): string => { try { return new URL(u.startsWith("http") ? u : `https://${u}`).pathname.replace(/\/+$/, "").split("/").slice(0, -1).join("/"); } catch { return ""; } };
  const parent = at(page.url), siblings = parent === "" ? [] : held.filter((b) => b.url !== page.url && at(b.url) === parent).slice(0, max);
  const nameOf = (u: string): string[] => norm(u.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() ?? "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const toks = (s: string, mask: readonly string[], min: number): string[] => { let t = s.toLowerCase(); for (const w of mask) t = t.split(w).join(" "); return t.split(/[^a-z]+/).filter((w) => w.length >= min); };
  const list = <T,>(x: readonly T[] | null | undefined): readonly T[] => Array.isArray(x) ? x : []; // A PARTIAL BODY MAY NOT THROW: this runs inside the writer's own packet build, and one missing array there killed the producer pass outright rather than declining to answer
  const said = (b: OwnedPageBody): string => [...list(b.passages), ...list(b.cardTexts), ...list(b.faqs).map((f) => `${f?.question ?? ""} ${f?.answer ?? ""}`)].join(" "), cut = (t: string): string[] => t.split(/(?<=[.!?])/).map((x) => x.trim()).filter(Boolean);
  const own = nameOf(page.url), mine = cut(said(page)); if (siblings.length === 0 || mine.length === 0) return null;
  const frame = new Set(siblings.flatMap((b) => cut(said(b)).map((x) => toks(x, nameOf(b.url), 4).join(" "))).filter(Boolean));
  let shared = 0, all = 0; const kept: string[] = [], shell: string[] = [];
  for (const t of mine) { const k = toks(t, own, 4); all += k.length; if (k.length > 0 && frame.has(k.join(" "))) { shared += k.length; shell.push(t); } else kept.push(t); }
  if (all === 0 || shared * 2 < all) return null; // a shell that is not most of the page asks nothing of any card
  const text = kept.join(" "), family = new Set(siblings.flatMap((b) => toks(said(b), nameOf(b.url), 3)));
  const heads = new Set([...own, ...toks([page.title ?? "", page.h1 ?? "", ...list(page.headings)].join(" "), [], 3)]);
  const entity = new Set(toks([...list(page.cardTexts), ...list(page.faqs).map((f) => f?.question ?? "")].join(" "), own, 3).filter((w) => !family.has(w)));
  const named = /(?<=[a-z0-9,;:)"'\u2019])\s+([A-Z][A-Za-z'\u2019-]{2,})/g; // a name the page's own prose introduces, never a word every sibling also carries and never one of its own headings
  for (let m = named.exec(text); m; m = named.exec(text)) for (const w of toks(m[1]!, own, 3)) if (!heads.has(w) && !family.has(w)) entity.add(w); // through the same masking, or the page's own name in the possessive reads as an entity of its own
  const worn = new Set(toks(shell.join(" "), own, 3)); // A WORD THIS PAGE ALSO USES IN THE SHELL IS SHELL VOCABULARY WHEREVER IT STANDS: the crawler glues a button label to the paragraph after it ("SubmitBerkeley has a vibrant food scene"), so "submit" leaked into the slot and an honest line about what the page is FOR read as a claim about its subject.
  return { slot: new Set(toks(text, own, 3).filter((w) => !worn.has(w))), own: entity, figures: /\d/.test(text) };
}
