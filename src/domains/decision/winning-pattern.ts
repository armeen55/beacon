import "server-only";

/**
 * decision/winning-pattern (V1 Truth Convergence Phase 3, 2026-07-31) - WHAT THE PAGES THAT WIN A SEARCH
 * HAVE IN COMMON, learned without copying one of them. The page by page comparison one gate earlier proves a page is OWED; it says nothing about what that page must actually DO to compete, and every answer to
 * that question so far was taste dressed up as a plan.
 *
 * DETERMINISTIC FIRST, ALWAYS. `extractPageFacts` reads the extracts the funnel already paid for and nothing else: a heading list is a heading list, a word count is a word count, and a field that read never
 * captured comes back null rather than filled in. Null means "I do not hold this", never "this page has
 * none". No model runs there, so the facts are free, repeatable and checkable, and the one reading below can only ever be taken ON them.
 *
 * ONE strict reading per case, bounded and cached: the same facts write a byte-identical prompt, so the
 * gateway's own per-account cache serves it at $0 and a case whose winners did not move never buys a second
 * one. Under three publishers I can actually learn from there is no pattern to find, so it costs nothing.
 *
 * IT IS A PATTERN, NOT A COPY, AND EVERY FIELD ANSWERS FOR ITSELF. The reading names no website and quotes no page: the model sees pages numbered from 0 upward, may cite only those numbers, and writes every
 * commonality in its own plain words. FIVE things throw the WHOLE reading away rather than shipping the half
 * of it that checks out: a run of eight words off ANY line I showed it, in ANY prose field; a heading longer
 * than a section name handed back word for word; a section or a named thing that is not actually ON every
 * page cited for it; a gap about a page of my own I never supplied; and an archetype that disagrees with the
 * shape the results already settled. Null is a complete answer: the verdict and its receipt stand as they were.
 */

import { createHash } from "node:crypto";

import { log } from "@/lib/logger";
import { topicTokens } from "@/domains/evidence/relevance-gate";
import { publisherHost, type SerpPageType } from "@/domains/evidence/serp-shape";
import { callStructuredLLM, type StructuredDraftRequest } from "./llm/structured-drafter";
import type { WinningPatternRead } from "./llm/schemas";

/** WHAT A READ ALREADY CAPTURED, named structurally so this file imports no store and no reader: a winning
 *  page's extract and the stored body of one of my own pages both satisfy it. Every field is optional
 *  because a read taken before that field existed genuinely does not carry it. */
type HeldExtract = {
  title?: string | null; h1?: string | null; wordCount?: number | null; headings?: readonly string[] | null;
  faqCount?: number | null; openingSample?: string | null; entityNames?: readonly string[] | null;
  cardTexts?: readonly string[] | null; hasList?: boolean | null; hasTable?: boolean | null;
};

/** One page as this file needs it: where it lives, and whatever was read of it. */
type ReadPage = { url: string; domain?: string | null; extract?: HeldExtract | null };

/** ONE page's bounded facts, every one of them observed. Internal on purpose: a caller reads these off
 *  `extractPageFacts` and hands them straight to the reading below, and never has to name the shape. */
type PageFacts = {
  domain: string;
  /** The distinguishing words of what the page calls itself, never the title's own sentence. */
  titleTokens: string[];
  headings: string[];
  /** The headings that are shaped like a question, which is what a searcher actually asked. */
  questionHeadings: string[];
  entities: string[];
  wordCount: number | null;
  faqCount: number | null;
  hasList: boolean | null;
  hasTable: boolean | null;
  /** True when the read found structured data on the page, false when it looked and found none,
   *  null when that read never captured it at all. Three different facts, kept apart. */
  hasSchema: boolean | null;
  opening: string | null;
};

/** THE RECEIPT-READY READING: what the model said, plus the two things it was never allowed to decide,
 *  counted here from the facts it was handed. `publishers` is index-aligned, so every cited number
 *  resolves to the site that actually showed it without the model ever naming one. */
export type WinningPattern = WinningPatternRead & {
  /** How many winning pages the reading was taken on: the denominator in every receipt line. */
  winners: number;
  publishers: string[];
  /** The exact facts behind it, so a stored reading names the pages it was taken on. */
  fingerprint: string;
};

/** Three publishers, the same bar every claim of agreement in this product answers to. */
const MIN_PATTERN_PUBLISHERS = 3;
/** Bounded so one busy results page can never grow the prompt without limit. */
const MAX_WINNERS = 6;
const MAX_HEADINGS = 12;
const MAX_ENTITIES = 10;
const MAX_TOKENS = 12;
const MAX_HEADING_CHARS = 160;
const OPENING_CHARS = 240;
/** A verbatim heading is a shared section NAME only while it is this short; beyond it, handing one back is
 *  quoting one page at ANY length in characters. The old sixty-character bar let every real heading through:
 *  "How a Persian rug is made from wool and silk" is one page's own line and is under sixty characters. */
const VERBATIM_HEADING_WORDS = 5;
/** This many words in a row off ANY line I showed it is that page's own wording, however it is framed. */
const QUOTE_RUN_WORDS = 8;
const PATTERN_COST_USD = 0.02;

const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();
const words = (s: string): string[] => norm(s).replace(/[^a-z0-9 ]+/g, " ").split(" ").filter(Boolean);
const q = (s: string): string => `"${s.replace(/"/g, "'")}"`;
const QUESTION = /^(what|which|who|whose|where|when|why|how|is|are|do|does|did|can|should|will)\b/i;
const isQuestion = (h: string): boolean => QUESTION.test(h) || h.trim().endsWith("?");
const say = (v: boolean | null): string => (v == null ? "not captured" : v ? "yes" : "no");

/**
 * The DETERMINISTIC half, and the only half that is ever load-bearing. Pure: same extracts in, same facts
 * out, no model, no clock, no I/O. Nothing is derived that the read did not carry, so a page whose body I never got produces a full row of honest nulls rather than a row of zeros that reads like a finding.
 */
export function extractPageFacts(pages: readonly ReadPage[]): PageFacts[] {
  return pages.map((p) => {
    const x = p.extract ?? null;
    const headings = (x?.headings ?? []).map((h) => h.trim().replace(/\s+/g, " ").slice(0, MAX_HEADING_CHARS)).filter(Boolean).slice(0, MAX_HEADINGS);
    const cards = x?.cardTexts ?? null;
    return {
      domain: (p.domain ?? "").trim() || publisherHost(p.url),
      titleTokens: topicTokens([x?.title, x?.h1].filter(Boolean).join(" ")).slice(0, MAX_TOKENS),
      headings,
      questionHeadings: headings.filter(isQuestion),
      entities: (x?.entityNames ?? []).map((e) => e.trim()).filter(Boolean).slice(0, MAX_ENTITIES),
      wordCount: typeof x?.wordCount === "number" ? x.wordCount : null,
      faqCount: typeof x?.faqCount === "number" ? x.faqCount : null,
      // A LIST IS A LIST WHEREVER THE READ SAW ONE: the flag when it was captured, the cards it actually banked when it was not, and null when neither was ever recorded.
      hasList: x?.hasList ?? (cards ? cards.length > 0 : null),
      hasTable: x?.hasTable ?? null,
      hasSchema: x?.entityNames == null ? null : x.entityNames.length > 0,
      opening: (x?.openingSample ?? "").trim().slice(0, OPENING_CHARS) || null,
    };
  });
}

/** A page I can learn anything from: I hold its sections, or at least what it calls itself. */
const readable = (f: PageFacts): boolean => f.headings.length > 0 || f.titleTokens.length > 0;

const SYSTEM = [
  "You are handed bounded facts about several pages that already win one search, each named by a NUMBER, plus the same facts about the site owner's own page. You say what those winning pages have in common.",
  "Rules you may not break.",
  "1. Use ONLY the facts written below. Never name a website, a company, a person or a place that is not written there, and never add knowledge of your own about this subject.",
  "2. Cite pages by the numbers you were given and by no others. Every seenOn number must be a page you can see below.",
  "3. Write every commonality in your OWN plain words. Never hand back a section heading of more than five words as it was written, and never carry a run of eight words from ANY line written below into ANY sentence you write.",
  "4. Never write a figure, a count or a percentage in any sentence. I count the pages myself from the numbers you cite.",
  "5. ownedGaps say what MY OWN PAGE does not do that the winning pages agree on, and each one cites the numbers of the pages that show it. When no page of my own is written below, ownedGaps MUST be empty.",
  "6. Where the winning pages disagree, say so in disagreements and leave it unsettled. Never settle it by quietly picking a side.",
  "7. A section you name in commonHeadings must actually be on EVERY page you cite for it, and a thing you name in commonEntities must actually be named by EVERY page you cite for it. Cite only the pages that really carry it.",
  "8. When I write below that the kind of page winning here is already settled, archetype must be exactly that word. It is decided and yours to repeat, never to vote on again.",
  "9. Return every field. An empty list is the right answer whenever the pages honestly share nothing there.",
  "10. No em dash and no en dash anywhere. Never use the words experiment, control, baseline, treatment or SERP.",
].join("\n");

/** The facts, written the same way every time so the same pages ask the same question. */
function factLines(pages: readonly PageFacts[], owned: PageFacts | null): string[] {
  const one = (f: PageFacts, name: string): string => [
    name,
    `    sections: ${f.headings.map(q).join(", ") || "none captured"}`,
    `    sections shaped like a question: ${f.questionHeadings.map(q).join(", ") || "none"}`,
    `    what it calls itself: ${f.titleTokens.join(", ") || "not captured"}`,
    `    things it names: ${f.entities.join(", ") || "none captured"}`,
    `    length: ${f.wordCount == null ? "not captured" : `${f.wordCount} words`}, question and answer blocks: ${f.faqCount ?? "not captured"}`,
    `    has a list: ${say(f.hasList)}, has a table: ${say(f.hasTable)}, has structured data: ${say(f.hasSchema)}`,
    `    how it opens: ${f.opening ? q(f.opening) : "not captured"}`,
  ].join("\n");
  return [
    ...pages.map((f, i) => one(f, `PAGE ${i}`)),
    owned ? one(owned, "MY OWN PAGE") : "MY OWN PAGE\n    I hold no page of my own for this at all.",
  ];
}

/** EVERY word run I showed it, from EVERY line I showed it: sections, what each page calls itself, and how
 *  each one opens. Checking openings alone left the headings and the titles free to be handed straight back. */
function runsOf(texts: readonly string[]): Set<string> {
  const runs = new Set<string>();
  for (const t of texts) {
    const w = words(t);
    for (let i = 0; i + QUOTE_RUN_WORDS <= w.length; i += 1) runs.add(w.slice(i, i + QUOTE_RUN_WORDS).join(" "));
  }
  return runs;
}

/** Does this sentence carry a run of one page's own wording? Then it is that page's sentence, however it is
 *  introduced, and a pattern is never somebody else's sentence. */
function quotes(text: string, runs: ReadonlySet<string>): boolean {
  const said = words(text);
  for (let i = 0; i + QUOTE_RUN_WORDS <= said.length; i += 1) if (runs.has(said.slice(i, i + QUOTE_RUN_WORDS).join(" "))) return true;
  return false;
}

/** Is what it named actually ON every page it cited for it? A valid index is not existence: three real
 *  numbers beside a section no page carries counts pages that never had it, and the receipt line then says
 *  "three of the four cover X" about an X nobody wrote. Content tokens, so wording may still be its own. */
function holdsOnEvery(text: string, seenOn: readonly number[], on: readonly ReadonlySet<string>[], label: ReadonlySet<string>): boolean {
  const t = topicTokens(text);
  // THE TOPIC NOUN PROVES NOTHING. Every cited page wins the same search, so the case's own label tokens sit on all of them and carried any invention through. A claim with tokens of its OWN must
  // ground THOSE on every page it cites; a claim that is nothing but the topic grounds as the topic.
  const distinct = t.filter((x) => !label.has(x));
  const need = distinct.length > 0 ? distinct : t;
  return need.length > 0 && seenOn.every((i) => !!on[i] && need.some((x) => on[i]!.has(x)));
}

/**
 * ONE strict reading of what the winning pages share, or null. Null is a complete answer: it means I hold
 * no pattern for this case, which is exactly what ships whenever this call is off, over budget, blocked, unusable, or names a page nobody gave it.
 */
export async function readWinningPattern(
  winners: readonly PageFacts[],
  owned: PageFacts | null,
  tenantId: string,
  opts: Pick<StructuredDraftRequest<"winning_pattern">, "complete" | "cacheImpl" | "now"> & { label?: string }
  /** The shape the results ALREADY settled, counted in code one gate earlier. Supplied, it is told to the
   *  model AND enforced on the answer: the model repeats a settled shape, it never re-votes one. */
  /** THE PASS'S OWN HARD ATTEMPT BUDGET, decremented BEFORE the call below like every other charged call in the pass. This read used to be the one paid Decision call the pool never saw, so "one budget pays every attempt" was untrue by exactly this call every pass that reached a verdict. Absent = a reading standing on its own, which spends against the money caps alone. */
  & { pageType?: SerpPageType | null; attempts?: { left: number } } = {},
): Promise<WinningPattern | null> {
  // ONLY PAGES I ACTUALLY READ, and only one vote per publisher: three pages from one site are one site's house style, and nothing downstream of this file may ever call that a pattern.
  const pages: PageFacts[] = [];
  const seen = new Set<string>();
  for (const f of winners) {
    if (!readable(f) || seen.has(f.domain) || pages.length >= MAX_WINNERS) continue;
    seen.add(f.domain);
    pages.push(f);
  }
  if (pages.length < MIN_PATTERN_PUBLISHERS) return null; // no agreement is buyable here: no call, no cent

  // A SETTLED SHAPE IS PART OF THE ASK, so it rides the fingerprint too: the same pages under a shape that has since changed are a different question and must not be answered out of the old reading's cache.
  const settled = opts.pageType && opts.pageType !== "mixed" && opts.pageType !== "unknown" ? opts.pageType : null;
  const lines = [...factLines(pages, owned), ...(settled ? [`THE KIND OF PAGE THAT ALREADY WINS HERE, SETTLED: ${settled}`] : [])];
  const fingerprint = createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
  const user = [
    "THE PAGES THAT WIN THIS SEARCH (cite these numbers and no others)",
    ...lines,
    `FACTS: ${fingerprint}`,
    "Say what these winning pages have in common, and what my own page is missing against them.",
  ].join("\n");

  if (opts.attempts && (opts.attempts.left -= 1) < 0) { log.info("[winning-pattern] the pass has spent its whole attempt budget, so the winners are not read", { tenantId }); return null; }
  const call = await callStructuredLLM({
    kind: "winning_pattern", tenantId, system: SYSTEM, user, grounded: lines.join(" "),
    projectedCostUsd: PATTERN_COST_USD, maxTokens: 1800,
    complete: opts.complete, cacheImpl: opts.cacheImpl, now: opts.now,
  });
  if (call.status !== "drafted") {
    log.info("[winning-pattern] no reading of the winning pages this pass", { tenantId, status: call.status });
    return null;
  }
  const v = call.value as WinningPatternRead;

  // ── every cited number back against the pages I actually supplied ──
  const cited = [...v.commonHeadings, ...v.commonEntities, ...v.ownedGaps, ...v.uniqueNotCommon].flatMap((r) => r.seenOn);
  const stray = cited.find((i) => !Number.isInteger(i) || i < 0 || i >= pages.length);
  // EVERY PROSE FIELD, AGAINST EVERY LINE I SHOWED IT. The run check used to read openingPattern alone and
  // the copy check used to read commonHeadings alone, so a winner's own sentence reached the operator through a disagreement, a gap, an answered question or a unique detail without one gate looking at it.
  const said = [...v.commonHeadings.map((h) => h.heading), ...v.ownedGaps.map((g) => g.gap), ...v.uniqueNotCommon.map((u) => u.detail),
    ...v.disagreements, ...v.questionsAnswered, v.openingPattern].filter((s) => !!s);
  const shown = [...pages, ...(owned ? [owned] : [])];
  const runs = runsOf(shown.flatMap((f) => [...f.headings, f.titleTokens.join(" "), f.opening ?? ""]));
  const quoted = said.find((t) => quotes(t, runs));
  // A PATTERN IS AN ABSTRACTION. A heading handed back word for word is one page's wording, and putting a competitor's own line into an operator-facing receipt is the one thing this whole file exists to avoid.
  // Five words is a shared section NAME; anything longer is a quotation whatever it measures in characters.
  const supplied = new Set(shown.flatMap((f) => f.headings).map(norm));
  const copied = v.commonHeadings.map((h) => h.heading).find((h) => supplied.has(norm(h)) && words(h).length > VERBATIM_HEADING_WORDS);
  // EXISTENCE, NOT MERELY A VALID INDEX (checked only once every index is real, so nothing indexes past the end).
  const headTokens = pages.map((f) => topicTokens(f.headings.join(" ")));
  const labelTokens: ReadonlySet<string> = new Set(topicTokens(opts.label ?? ""));
  const sections = pages.map((f, i) => new Set([...headTokens[i]!, ...f.titleTokens]));
  const names = pages.map((f, i) => new Set([...headTokens[i]!, ...topicTokens(f.entities.join(" "))]));
  const invented = stray !== undefined ? undefined
    : v.commonHeadings.find((h) => !holdsOnEvery(h.heading, h.seenOn, sections, labelTokens))?.heading
      ?? v.commonEntities.find((e) => !holdsOnEvery(e.entity, e.seenOn, names, labelTokens))?.entity;
  // A GAP IS MEASURED AGAINST A PAGE, NOT IMAGINED FOR ONE. With no page of my own supplied the model was still ordered to produce ownedGaps, so it invented what my page does not do and that invention rendered
  // to the operator as a claim about a page it had never seen. AN INTERNAL SLUG IS NOT A WORD AN OPERATOR READS. The settled shape rides the prompt so the model
  // repeats it in `archetype`, which is mapped before display; any prose field carrying a raw slug is a reading that leaked machinery, and it is thrown away whole.
  const SLUG_RE = /\b(informational_guide|new_page|do_nothing|serp_[a-z_]+|[a-z]+_(?:guide|page|search|result))\b/;
  const slugged = said.find((t) => SLUG_RE.test(t));
  const blindGaps = owned == null && v.ownedGaps.length > 0;
  // THE SHAPE WAS SETTLED IN CODE ONE GATE EARLIER, and the deterministic count wins every time.
  const wrongShape = settled != null && v.archetype !== settled;
  if (stray !== undefined || copied || quoted || invented || blindGaps || wrongShape || slugged) {
    // ONE of these throws the WHOLE reading away. Keeping the half that checks out would file a real case under a pattern half of which was invented or copied, and no diagnosis is worth that.
    log.warn("[winning-pattern] the reading copied a page, named something no page carries, or overruled a settled shape, so I kept none of it",
      { tenantId, stray, copied: copied?.slice(0, 80), quoted: quoted?.slice(0, 80), invented: invented?.slice(0, 80), blindGaps, wrongShape, slugged: slugged?.slice(0, 80) });
    return null;
  }
  return { ...v, winners: pages.length, publishers: pages.map((f) => f.domain), fingerprint };
}
