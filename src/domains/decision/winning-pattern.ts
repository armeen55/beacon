import "server-only";

/**
 * decision/winning-pattern (V1 Truth Convergence Phase 3, 2026-07-31) - WHAT THE PAGES THAT WIN A SEARCH
 * HAVE IN COMMON, learned without copying one of them. The page by page comparison one gate earlier proves
 * a page is OWED; it says nothing about what that page must actually DO to compete, and every answer to
 * that question so far was taste dressed up as a plan.
 *
 * DETERMINISTIC FIRST, ALWAYS. `extractPageFacts` reads the extracts the funnel already paid for and
 * nothing else: a heading list is a heading list, a word count is a word count, and a field that read never
 * captured comes back null rather than filled in. Null means "I do not hold this", never "this page has
 * none". No model runs there, so the facts are free, repeatable and checkable, and the one reading below
 * can only ever be taken ON them.
 *
 * ONE strict reading per case, bounded and cached: the same facts write a byte-identical prompt, so the
 * gateway's own per-account cache serves it at $0 and a case whose winners did not move never buys a second
 * one. Under three publishers I can actually learn from there is no pattern to find, so it costs nothing.
 *
 * IT IS A PATTERN, NOT A COPY. The reading names no website and quotes no page: the model sees pages
 * numbered from 0 upward, may cite only those numbers, and writes every commonality in its own plain words.
 * A heading handed back word for word, an opening that carries a run of a winner's own sentence, or ONE
 * number cited for a page nobody supplied throws the WHOLE reading away rather than shipping the half of it
 * that checks out. Null is a complete answer: the verdict and its receipt stand exactly as they were.
 */

import { createHash } from "node:crypto";

import { log } from "@/lib/logger";
import { topicTokens } from "@/domains/evidence/relevance-gate";
import { publisherHost } from "@/domains/evidence/serp-shape";
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
/** Longer than this and an exact heading is a quote of one page, not a pattern across several. */
const VERBATIM_HEADING_CHARS = 60;
/** This many words in a row off a winner's own opening is that winner's sentence, however it is framed. */
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
 * out, no model, no clock, no I/O. Nothing is derived that the read did not carry, so a page whose body I
 * never got produces a full row of honest nulls rather than a row of zeros that reads like a finding.
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
      // A LIST IS A LIST WHEREVER THE READ SAW ONE: the flag when it was captured, the cards it actually
      // banked when it was not, and null when neither was ever recorded.
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
  "3. Write every commonality in your OWN plain words. Never hand back a heading word for word, and never quote a sentence from any page's opening.",
  "4. Never write a figure, a count or a percentage in any sentence. I count the pages myself from the numbers you cite.",
  "5. ownedGaps say what MY OWN PAGE does not do that the winning pages agree on, and each one cites the numbers of the pages that show it.",
  "6. Where the winning pages disagree, say so in disagreements and leave it unsettled. Never settle it by quietly picking a side.",
  "7. Return every field. An empty list is the right answer whenever the pages honestly share nothing there.",
  "8. No em dash and no en dash anywhere. Never use the words experiment, control, baseline, treatment or SERP.",
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

/** Does this sentence carry a run of one page's own opening? Then it is that page's sentence,
 *  however it is introduced, and a pattern is never somebody else's sentence. */
function quotesAnOpening(text: string, pages: readonly PageFacts[]): boolean {
  const said = words(text);
  if (said.length < QUOTE_RUN_WORDS) return false;
  const runs = new Set<string>();
  for (const f of pages) {
    const o = words(f.opening ?? "");
    for (let i = 0; i + QUOTE_RUN_WORDS <= o.length; i += 1) runs.add(o.slice(i, i + QUOTE_RUN_WORDS).join(" "));
  }
  for (let i = 0; i + QUOTE_RUN_WORDS <= said.length; i += 1) if (runs.has(said.slice(i, i + QUOTE_RUN_WORDS).join(" "))) return true;
  return false;
}

/**
 * ONE strict reading of what the winning pages share, or null. Null is a complete answer: it means I hold
 * no pattern for this case, which is exactly what ships whenever this call is off, over budget, blocked,
 * unusable, or names a page nobody gave it.
 */
export async function readWinningPattern(
  winners: readonly PageFacts[],
  owned: PageFacts | null,
  tenantId: string,
  opts: Pick<StructuredDraftRequest<"winning_pattern">, "complete" | "cacheImpl" | "now"> = {},
): Promise<WinningPattern | null> {
  // ONLY PAGES I ACTUALLY READ, and only one vote per publisher: three pages from one site are one site's
  // house style, and nothing downstream of this file may ever call that a pattern.
  const pages: PageFacts[] = [];
  const seen = new Set<string>();
  for (const f of winners) {
    if (!readable(f) || seen.has(f.domain) || pages.length >= MAX_WINNERS) continue;
    seen.add(f.domain);
    pages.push(f);
  }
  if (pages.length < MIN_PATTERN_PUBLISHERS) return null; // no agreement is buyable here: no call, no cent

  const lines = factLines(pages, owned);
  const fingerprint = createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
  const user = [
    "THE PAGES THAT WIN THIS SEARCH (cite these numbers and no others)",
    ...lines,
    `FACTS: ${fingerprint}`,
    "Say what these winning pages have in common, and what my own page is missing against them.",
  ].join("\n");

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
  // A PATTERN IS AN ABSTRACTION. A heading handed back word for word is one page's wording, and putting a
  // competitor's own line into an operator-facing receipt is the one thing this whole file exists to avoid.
  const supplied = new Set([...pages, ...(owned ? [owned] : [])].flatMap((f) => f.headings).map(norm));
  const copied = v.commonHeadings.map((h) => h.heading)
    .find((h) => h.length > VERBATIM_HEADING_CHARS && supplied.has(norm(h)));
  const quoted = quotesAnOpening(v.openingPattern, pages);
  if (stray !== undefined || copied || quoted) {
    // ONE of these throws the WHOLE reading away. Keeping the half that checks out would file a real case
    // under a pattern half of which was invented or copied, and no diagnosis is worth that.
    log.warn("[winning-pattern] the reading cited a page I never showed it or copied one of them, so I kept none of it",
      { tenantId, stray, copied: copied?.slice(0, 80), quoted });
    return null;
  }
  return { ...v, winners: pages.length, publishers: pages.map((f) => f.domain), fingerprint };
}
